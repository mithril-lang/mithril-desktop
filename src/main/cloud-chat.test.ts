import { describe, it, expect, vi } from "vitest";
import { CloudWorkspace } from "./cloud-workspace";
import { CloudChat } from "./cloud-chat";
const session = {
  id: "s1",
  title: "Demo",
  model: "model1",
  revision: 1,
  eventSeq: 1,
  deleted: false,
  activeTurn: null,
};
function fixture(scopes = ["chat:read", "chat:write"]): {
  auth: CloudWorkspace;
  client: CloudChat;
  fetcher: ReturnType<typeof vi.fn>;
  response: (body: unknown, status?: number) => Response;
  change: () => void;
  changed: ReturnType<typeof vi.fn>;
} {
  let token = `mf_${"a".repeat(43)}`;
  const response = (body: unknown, status = 200): Response =>
    ({ ok: status === 200, status, json: async () => body }) as Response;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/me"))
      return response({
        via: "api_token",
        user: { id: token.includes("bbbb") ? "b" : "a" },
        scopes,
      });
    if (url.endsWith("/runtime"))
      return response({
        schemaVersion: 1,
        userId: "a",
        available: true,
        reason: "Fixture owned runtime",
        executionMode: "remote_runtime",
        leaseProtocol: "mithril-single-attempt-v1",
        deviceRequired: false,
      });
    if (url.endsWith("/models"))
      return response({
        schemaVersion: 1,
        userId: "a",
        models: [{ id: "model1", available: true }],
      });
    if (url.includes("/events?"))
      return response({
        schemaVersion: 1,
        userId: "a",
        session,
        events: [
          {
            seq: 1,
            type: "assistant",
            turnId: null,
            data: { content: "Result" },
            createdAt: 1,
          },
        ],
        hasMore: false,
        nextAfter: null,
      });
    if (init?.body)
      return response({
        schemaVersion: 1,
        userId: "a",
        operationId: JSON.parse(String(init.body)).operationId,
        status: "accepted",
        session,
      });
    return response({ schemaVersion: 1, userId: "a", sessions: [session] });
  });
  const changed = vi.fn();
  const auth = new CloudWorkspace({
    token: () => token,
    profile: () => "default",
    origin: () => "https://api.mithril.fund",
    fetch: fetcher as typeof fetch,
    changed,
    readScope: "chat:read",
    writeScope: "chat:write",
  });
  return {
    auth,
    client: new CloudChat(auth),
    fetcher,
    response,
    change: () => {
      token = `mf_${"b".repeat(43)}`;
      auth.reset();
    },
    changed,
  };
}
describe("Canonical Desktop chat transport", () => {
  it("requires explicit consent and dedicated scopes without token upgrade", async () => {
    const f = fixture();
    await expect(f.client.list()).rejects.toThrow("Enable");
    expect(
      f.fetcher.mock.calls.every((call) => call[0].endsWith("/v1/me")),
    ).toBe(true);
    await f.auth.enable();
    expect((await f.client.list()).sessions).toEqual([session]);
    const insufficient = fixture(["inference"]);
    await expect(insufficient.auth.enable()).rejects.toThrow("chat:read");
  });
  it("reads inventory without model probes and refuses paid turns without inference scope", async () => {
    const f = fixture();
    await f.auth.enable();
    expect(await f.client.models()).toEqual([
      { id: "model1", available: true },
    ]);
    await expect(
      f.client.apply("s1", {
        operationId: "op",
        baseRevision: 1,
        type: "turn",
        data: { content: "Hello", model: "model1" },
      }),
    ).rejects.toThrow("inference");
    expect(
      f.fetcher.mock.calls.some((call) => call[0].endsWith("/v1/models")),
    ).toBe(false);
    expect(f.fetcher.mock.calls.every((call) => !call[1]?.body)).toBe(true);
  });
  it("validates checkpoints and operation receipts; resume does not execute", async () => {
    const f = fixture();
    await f.auth.enable();
    expect((await f.client.events("s1")).events).toHaveLength(1);
    expect(f.fetcher.mock.calls.every((call) => !call[1]?.body)).toBe(true);
    await expect(f.client.events("../secrets")).rejects.toThrow("Invalid");
    await expect(
      f.client.apply("s1", {
        operationId: "op",
        baseRevision: 1,
        type: "rename",
        data: { title: "Renamed" },
      }),
    ).resolves.toMatchObject({ operationId: "op" });
    f.fetcher.mockResolvedValueOnce(
      f.response({
        via: "api_token",
        user: { id: "a" },
        scopes: ["chat:read", "chat:write"],
      }),
    );
    f.fetcher.mockResolvedValueOnce(
      f.response({ schemaVersion: 1, userId: "other", sessions: [session] }),
    );
    await expect(f.client.list()).rejects.toThrow("owner/schema");
  });
  it("inspects existing owned runtime only explicitly and gates runtime turns with both inference and sandbox", async () => {
    const noRuntime = fixture();
    await noRuntime.auth.enable();
    await expect(noRuntime.client.runtime()).rejects.toThrow("sandbox");
    expect(
      noRuntime.fetcher.mock.calls.every((call) => call[0].endsWith("/v1/me")),
    ).toBe(true);
    const runtime = fixture(["chat:read", "chat:write", "sandbox"]);
    await runtime.auth.enable();
    expect((await runtime.client.runtime()).available).toBe(true);
    await expect(
      runtime.client.apply("s1", {
        operationId: "runtime-op",
        baseRevision: 1,
        type: "runtime_turn",
        data: { content: "Explicit fixture prompt", model: "model1" },
      }),
    ).rejects.toThrow("inference");
    expect(runtime.fetcher.mock.calls.every((call) => !call[1]?.body)).toBe(
      true,
    );
    const authorized = fixture([
      "chat:read",
      "chat:write",
      "sandbox",
      "inference",
    ]);
    await authorized.auth.enable();
    await authorized.client.apply("s1", {
      operationId: "runtime-op",
      baseRevision: 1,
      type: "runtime_turn",
      data: { content: "Explicit fixture prompt", model: "model1" },
    });
    expect(
      authorized.fetcher.mock.calls.filter((call) => call[1]?.body),
    ).toHaveLength(1);
    expect(
      authorized.fetcher.mock.calls.every(
        (call) =>
          !call[0].includes("launch") && !call[0].includes("execute-tool"),
      ),
    ).toBe(true);
  });
  it("advertises only the main-process Mithril tool protocol after scoped checkpoint validation", async () => {
    const f = fixture(["chat:read", "chat:write", "inference"]);
    await f.auth.enable();
    const body = {
      action: "next",
      turnId: "tool-turn",
      executionToken: "a".repeat(64),
      round: 0,
    };
    await expect(
      f.client.browserStep("s1", { ...body, toolProtocol: "other" }),
    ).rejects.toThrow("Invalid tool checkpoint");
    f.fetcher.mockImplementation(async (url: string) =>
      url.endsWith("/v1/me")
        ? f.response({
            via: "api_token",
            user: { id: "a" },
            scopes: ["chat:read", "chat:write", "inference"],
          })
        : f.response({
            schemaVersion: 1,
            userId: "a",
            phase: "ready",
            round: 0,
            calls: [],
          }),
    );
    await f.client.browserStep("s1", body);
    const checkpoints = f.fetcher.mock.calls.filter((call) =>
      call[0].endsWith("/browser"),
    );
    expect(checkpoints).toHaveLength(1);
    expect(JSON.parse(String(checkpoints[0]?.[1]?.body))).toEqual({
      ...body,
      toolProtocol: "mithril-language-v1",
    });
  });
  it("discards late prior-account data without disabling a newly enabled account", async () => {
    const f = fixture();
    await f.auth.enable();
    let resolve!: (response: Response) => void;
    f.fetcher.mockImplementationOnce(async () =>
      f.response({
        via: "api_token",
        user: { id: "a" },
        scopes: ["chat:read", "chat:write"],
      }),
    );
    f.fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const pending = f.client.list();
    await vi.waitFor(() => expect(resolve).toBeDefined());
    f.change();
    await f.auth.enable();
    resolve(f.response({ schemaVersion: 1, userId: "a", sessions: [session] }));
    await expect(pending).rejects.toThrow("stale");
    expect((await f.auth.status()).enabled).toBe(true);
  });
});
