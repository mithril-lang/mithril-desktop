import { createClientToolTurnRunner } from "@mithril/workspace/client-tool-turn";
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
      toolProtocol: "mithril-browser-tools-v2",
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

describe("owner-bound browser code children", () => {
  it("allows only fixed read children under the initiating inference authorization and matches child receipts", async () => {
    const f = fixture(["chat:read", "chat:write", "inference"]);
    await f.auth.enable();
    const body = {
      action: "child",
      turnId: "parent-turn",
      executionToken: "a".repeat(64),
      round: 0,
      parentCallId: "parent-call",
      childId: "child-call",
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
            round: 0,
            childResult: {
              id: "child-call",
              receipt: { isolation: "server-mithril-tools-v1" },
              result: { categories: 20 },
              files: {},
            },
          }),
    );
    const result = await f.client.browserStep("s1", body);
    expect(result.childResult?.id).toBe("child-call");
    const sent = f.fetcher.mock.calls.find((call) =>
      call[0].endsWith("/browser"),
    );
    expect(JSON.parse(String(sent?.[1]?.body))).toEqual({
      ...body,
      toolProtocol: "mithril-browser-tools-v2",
    });
    for (const patch of [
      { name: "terminal" },
      { name: "memory_write" },
      { parentCallId: "../path" },
      { args: [] },
      { args: { text: "x".repeat(16001) } },
      { args: { text: "あ".repeat(6000) } },
      { results: [] },
    ])
      await expect(
        f.client.browserStep("s1", { ...body, ...patch }),
      ).rejects.toThrow("child");
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
            round: 0,
            childResult: { id: "other", receipt: {}, result: [], files: {} },
          }),
    );
    await expect(f.client.browserStep("s1", body)).rejects.toThrow(
      "Invalid child tool response",
    );
  });
});

// @lat: [[cloud-workspace-tests#Dynamic Browser children through main]]
it.each(["js", "python"])(
  "runs %s dynamic children through the compiled runner and real main adapter",
  async (language) => {
    const f = fixture(["chat:read", "chat:write", "inference"]);
    await f.auth.enable();
    const commands: Record<string, unknown>[] = [];
    f.fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/me"))
        return f.response({
          via: "api_token",
          user: { id: "a" },
          scopes: ["chat:read", "chat:write", "inference"],
        });
      const body = JSON.parse(String(init?.body));
      commands.push(body);
      return f.response({
        schemaVersion: 1,
        userId: "a",
        ...(body.action === "next" && body.round === 0
          ? {
              phase: "tools_wait",
              round: 0,
              childTools: ["dynamic_write"],
              calls: [
                { id: "parent", function: { name: language, arguments: "{}" } },
              ],
            }
          : body.action === "child"
            ? {
                phase: "child_result",
                round: 0,
                calls: [],
                childResult: {
                  id: body.childId,
                  receipt: {},
                  result: 42,
                  files: {},
                },
              }
            : { phase: "completed", round: 1, calls: [] }),
      });
    });
    let retained!: (name: string, args: unknown) => Promise<unknown>;
    const execute = vi.fn(async (call, _signal, broker) => {
      retained = broker;
      expect(await broker("dynamic_write", { content: "once" })).toMatchObject({
        result: 42,
      });
      await expect(broker("unlisted", {})).rejects.toThrow();
      return { id: call.id, receipt: {}, result: 42, files: {} };
    });
    const runner = createClientToolTurnRunner(
      (sid, body) => f.client.browserStep(sid, body),
      execute,
    );
    const op = {
      type: "browser_turn",
      operationId: "turn",
      data: { executionToken: "a".repeat(64) },
    } as never;
    runner.start("s1", op, {
      status: "accepted",
      operationId: "turn",
      session: { id: "s1", activeTurn: { id: "turn", status: "running" } },
    } as never);
    await vi.waitFor(() => expect(commands).toHaveLength(4));
    expect(commands[1]).toMatchObject({
      action: "child",
      name: "dynamic_write",
      parentCallId: "parent",
      toolProtocol: "mithril-browser-tools-v2",
    });
    expect(execute).toHaveBeenCalledOnce();
    await expect(retained("dynamic_write", {})).rejects.toThrow();
    runner.stop();
  },
);

// @lat: [[cloud-workspace-tests#Dynamic inventory authority fences]]
it("binds a dynamic child inventory to owner, token, turn, round and parent and retires it after result", async () => {
  const f = fixture(["chat:read", "chat:write", "inference"]);
  await f.auth.enable();
  const base = { turnId: "turn", executionToken: "a".repeat(64), round: 0 };
  f.fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/me"))
      return f.response({
        via: "api_token",
        user: { id: "a" },
        scopes: ["chat:read", "chat:write", "inference"],
      });
    const body = JSON.parse(String(init?.body));
    return f.response({
      schemaVersion: 1,
      userId: "a",
      ...(body.action === "next"
        ? {
            phase: "tools_wait",
            round: 0,
            childTools: ["dynamic_write"],
            calls: [
              { id: "parent", function: { name: "js", arguments: "{}" } },
            ],
          }
        : body.action === "child"
          ? {
              phase: "child_result",
              round: 0,
              calls: [],
              childResult: { id: body.childId, receipt: {} },
            }
          : { phase: "ready", round: 1, calls: [] }),
    });
  });
  const child = {
    ...base,
    action: "child",
    parentCallId: "parent",
    childId: "child",
    name: "dynamic_write",
    args: {},
  };
  await expect(f.client.browserStep("s1", child)).rejects.toThrow("child");
  await f.client.browserStep("s1", { ...base, action: "next" });
  for (const patch of [
    { turnId: "other" },
    { executionToken: "b".repeat(64) },
    { round: 1 },
    { parentCallId: "other" },
    { name: "unlisted" },
    { childTools: ["unlisted"] },
  ])
    await expect(
      f.client.browserStep("s1", { ...child, ...patch }),
    ).rejects.toThrow();
  await f.client.browserStep("s1", child);
  await f.client.browserStep("s1", { ...base, action: "result", results: [] });
  await expect(f.client.browserStep("s1", child)).rejects.toThrow("child");
  await f.client.browserStep("s1", { ...base, action: "next" });
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 45001);
  await expect(f.client.browserStep("s1", child)).rejects.toThrow("child");
  clock.mockRestore();
  await f.client.browserStep("s1", { ...base, action: "next" });
  f.change();
  await expect(f.client.browserStep("s1", child)).rejects.toThrow();
  await f.auth.enable();
  await expect(f.client.browserStep("s1", child)).rejects.toThrow("child");
});

// @lat: [[cloud-workspace-tests#Dynamic inventory invalid and stale responses]]
it("rejects malformed inventories and ignores superseded next responses", async () => {
  const f = fixture(["chat:read", "chat:write", "inference"]);
  await f.auth.enable();
  const base = { turnId: "turn", executionToken: "a".repeat(64), round: 0 };
  let mode: unknown = ["js"];
  let release!: (value: Response) => void;
  f.fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/me"))
      return f.response({
        via: "api_token",
        user: { id: "a" },
        scopes: ["chat:read", "chat:write", "inference"],
      });
    const body = JSON.parse(String(init?.body));
    if (mode === "stall" && body.action === "next")
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    return f.response({
      schemaVersion: 1,
      userId: "a",
      phase: body.action === "next" ? "tools_wait" : "ready",
      round: 0,
      childTools: mode,
      calls: [{ id: "parent", function: { name: "js", arguments: "{}" } }],
    });
  });
  for (mode of [
    ["js"],
    ["x", "x"],
    ["../path"],
    ["x".repeat(257)],
    Array(4101).fill("x"),
    "all",
  ])
    await expect(
      f.client.browserStep("s1", { ...base, action: "next" }),
    ).rejects.toThrow("inventory");
  mode = "stall";
  const old = f.client.browserStep("s1", { ...base, action: "next" });
  await vi.waitFor(() => expect(release).toBeDefined());
  mode = [];
  await f.client.browserStep("s1", { ...base, action: "result", results: [] });
  release(
    f.response({
      schemaVersion: 1,
      userId: "a",
      phase: "tools_wait",
      round: 0,
      childTools: ["dynamic_write"],
      calls: [{ id: "parent", function: { name: "js", arguments: "{}" } }],
    }),
  );
  await old;
  await expect(
    f.client.browserStep("s1", {
      ...base,
      action: "child",
      parentCallId: "parent",
      childId: "child",
      name: "dynamic_write",
      args: {},
    }),
  ).rejects.toThrow("child");
});

// @lat: [[cloud-workspace-tests#Browser context switch before send]]
it("never sends a Browser checkpoint after context capture is retired and re-enabled", async () => {
  const f = fixture(["chat:read", "chat:write", "inference"]);
  await f.auth.enable();
  const nativeContext = f.auth.nativeContext.bind(f.auth);
  vi.spyOn(f.auth, "nativeContext").mockImplementationOnce(async () => {
    const captured = await nativeContext();
    f.auth.reset();
    await f.auth.enable();
    return captured;
  });
  f.fetcher.mockClear();
  await expect(
    f.client.browserStep("s1", {
      action: "child",
      turnId: "turn1",
      executionToken: "a".repeat(64),
      round: 0,
      parentCallId: "parent1",
      childId: "child1",
      name: "web_search",
      args: { query: "test" },
    }),
  ).rejects.toThrow("Native request context changed");
  expect(f.fetcher.mock.calls.some((call) => call[1]?.body)).toBe(false);
});
