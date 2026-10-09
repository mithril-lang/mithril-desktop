import { describe, it, expect, vi } from "vitest";
import { CloudWorkspace } from "./cloud-workspace";
import { CloudChat } from "./cloud-chat";
import { createClientToolTurnRunner } from "@mithril/workspace/client-tool-turn";
import type { ChatOperation } from "@mithril/workspace/sessions";
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
    return response({
      schemaVersion: 1,
      userId: "a",
      sessions: [session],
      anchor: 1,
      total: 1,
      updatedAt: [1],
      nextAfter: null,
    });
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
      toolProtocol: "mithril-browser-tools-v2",
    });
  });
  // @lat: [[lat.md/cloud-workspace#Cloud workspace#Interpreter child tool checkpoints]]
  it("transports bounded interpreter child calls and binds their receipts", async () => {
    const f = fixture(["chat:read", "chat:write", "inference"]);
    await f.auth.enable();
    const body = {
      action: "child",
      turnId: "tool-turn",
      executionToken: "a".repeat(64),
      round: 1,
      parentCallId: "js-parent",
      childId: "child-1",
      name: "tool_catalog",
      args: {},
    };
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
            phase: "child_result",
            round: 1,
            calls: [],
            childResult: { id: "child-1", receipt: {}, result: [], files: {} },
          }),
    );
    const result = await f.client.browserStep("s1", body);
    expect(result.childResult?.id).toBe("child-1");
    expect(
      JSON.parse(
        String(
          f.fetcher.mock.calls.find((call) => call[0].endsWith("/browser"))?.[1]
            ?.body,
        ),
      ),
    ).toEqual({ ...body, toolProtocol: "mithril-browser-tools-v2" });
    for (const invalid of [
      { ...body, name: "execute_shell" },
      { ...body, parentCallId: "../escape" },
      { ...body, results: [] },
      { ...body, args: { text: "x".repeat(16001) } },
      { ...body, action: "next" },
    ]) {
      await expect(f.client.browserStep("s1", invalid)).rejects.toThrow(
        "Invalid tool checkpoint",
      );
    }
    expect(
      f.fetcher.mock.calls.filter((call) => call[0].endsWith("/browser")),
    ).toHaveLength(1);
    f.fetcher.mockImplementation(async (url: string) =>
      url.endsWith("/v1/me")
        ? f.response({
            via: "api_token",
            user: { id: "a" },
            scopes: ["chat:read", "chat:write", "inference"],
          })
        : f.response({
            phase: "child_result",
            round: 1,
            calls: [],
            schemaVersion: 1,
            userId: "a",
            childResult: { id: "other-child" },
          }),
    );
    await expect(f.client.browserStep("s1", body)).rejects.toThrow(
      "Invalid tool response",
    );
  });
  it("completes the shared JS runner through the Desktop child checkpoint adapter", async () => {
    const f = fixture(["chat:read", "chat:write", "inference"]);
    await f.auth.enable();
    const checkpoints: Record<string, unknown>[] = [];
    f.fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/me"))
        return f.response({
          via: "api_token",
          user: { id: "a" },
          scopes: ["chat:read", "chat:write", "inference"],
        });
      const body = JSON.parse(String(init?.body));
      // Real API v2 checkpoints bind the first round to the code bridge marker.
      // A language-only first round cannot admit child tools later in the turn.
      expect(body.toolProtocol).toBe("mithril-browser-tools-v2");
      checkpoints.push(body);
      return f.response({
        schemaVersion: 1,
        userId: "a",
        round: body.round,
        ...(body.action === "child"
          ? {
              phase: "child_result",
              calls: [],
              childResult: {
                id: body.childId,
                receipt: {},
                files: {},
                result: { count: 20 },
              },
            }
          : body.action === "next" && body.round === 0
            ? {
                phase: "tools_wait",
                calls: [
                  { id: "parent", function: { name: "js", arguments: "{}" } },
                ],
              }
            : { phase: "completed", calls: [] }),
      });
    });
    const runner = createClientToolTurnRunner(
      (id, body) => f.client.browserStep(id, body),
      async (call, _signal, broker) => {
        const child = await broker!("tool_catalog", {});
        expect(child.result).toEqual({ count: 20 });
        return { id: call.id, receipt: {}, result: child.result, files: {} };
      },
    );
    const operation = {
      type: "browser_turn",
      operationId: "parent-turn",
      data: { executionToken: "a".repeat(64) },
    } as ChatOperation;
    runner.start("s1", operation, {
      schemaVersion: 1,
      userId: "a",
      operationId: operation.operationId,
      status: "accepted",
      session: {
        ...session,
        activeTurn: {
          id: operation.operationId,
          status: "running",
          leaseExpiresAt: Date.now() + 60000,
        },
      },
    });
    await vi.waitFor(() =>
      expect(checkpoints.map((body) => body.action)).toEqual([
        "next",
        "child",
        "result",
        "next",
      ]),
    );
    expect(checkpoints[1]).toMatchObject({
      parentCallId: "parent",
      name: "tool_catalog",
      turnId: "parent-turn",
      toolProtocol: "mithril-browser-tools-v2",
    });
    runner.stop();
  });
  it("receives a slow model checkpoint once without the ordinary read timeout aborting it", async () => {
    const f = fixture(["chat:read", "chat:write", "inference"]);
    await f.auth.enable();
    vi.useFakeTimers();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((ms) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), ms);
        return controller.signal;
      });
    f.fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/me"))
        return f.response({
          via: "api_token",
          user: { id: "a" },
          scopes: ["chat:read", "chat:write", "inference"],
        });
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(Error("aborted")),
          { once: true },
        );
        setTimeout(
          () =>
            resolve(
              f.response({
                schemaVersion: 1,
                userId: "a",
                phase: "completed",
                round: 0,
                calls: [],
              }),
            ),
          20000,
        );
      });
    });
    try {
      const pending = f.client.browserStep("s1", {
        action: "next",
        turnId: "slow-turn",
        executionToken: "a".repeat(64),
        round: 0,
      });
      const settled = expect(pending).resolves.toMatchObject({
        phase: "completed",
      });
      await vi.advanceTimersByTimeAsync(20000);
      await settled;
      expect(
        f.fetcher.mock.calls.filter((call) => call[0].endsWith("/browser")),
      ).toHaveLength(1);
      expect(f.changed).not.toHaveBeenCalled();
    } finally {
      timeout.mockRestore();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
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

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Paged canonical chat inventory]]
it("reads complete canonical pages through main-owned authority and preserves recent-first order", async () => {
  const f = fixture();
  await f.auth.enable();
  const original = f.fetcher.getMockImplementation() as (
    url: string,
    init?: RequestInit,
  ) => Promise<Response>;
  f.fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes("/v1/chat/sessions?page=1")) {
      const last = new URL(url).searchParams.has("after");
      return f.response({
        schemaVersion: 1,
        userId: "a",
        anchor: 3,
        total: 2,
        sessions: [{ ...session, id: last ? "s2" : "s1" }],
        updatedAt: [last ? 2 : 1],
        nextAfter: last ? null : "s1",
      });
    }
    return original(url, init);
  });
  expect((await f.client.list()).sessions.map((s) => s.id)).toEqual([
    "s2",
    "s1",
  ]);
  expect(
    f.fetcher.mock.calls
      .filter(([url]) => url.includes("sessions?page=1"))
      .map(([url]) => url),
  ).toEqual([
    "https://api.mithril.fund/v1/chat/sessions?page=1",
    "https://api.mithril.fund/v1/chat/sessions?page=1&anchor=3&after=s1",
  ]);
});
