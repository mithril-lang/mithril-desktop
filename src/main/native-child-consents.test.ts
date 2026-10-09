import { expect, it, vi } from "vitest";
import { CloudChat } from "./cloud-chat";
import { CloudWorkspace } from "./cloud-workspace";
const scope = { userId: "owner", profile: "default", sessionId: "s1" };
const intent = {
  turnId: "turn",
  executionToken: "a".repeat(64),
  round: 0,
  parentCallId: "parent",
  childId: "child",
  name: "write_file",
  args: { path: "owned.txt", content: "one" },
};
const rid = "b".repeat(64),
  handle = { ...scope, requestId: rid };
async function fixture(windowMs = 40000): Promise<{
  client: CloudChat;
  auth: CloudWorkspace;
  calls: { url: string; init?: RequestInit }[];
  open: ReturnType<typeof vi.fn>;
  response: (body: unknown, status?: number) => Response;
  fetcher: ReturnType<typeof vi.fn>;
  allow: () => void;
  setPoll: (fn: () => Promise<Response>) => void;
  setCreate: (fn: () => Promise<Response>) => void;
  failChild: () => void;
  contextChange: (kind: string) => void;
  expiresAt: number;
}> {
  let token = `mf_${"c".repeat(43)}`,
    profile = "default",
    state = "pending";
  const expiresAt = Date.now() + windowMs;
  const calls: { url: string; init?: RequestInit }[] = [];
  let childReply: () => Promise<Response> = async () =>
    response({
      schemaVersion: 1,
      userId: "owner",
      sessionId: "s1",
      phase: "child_result",
      round: 0,
      calls: [],
      childResult: { id: "child", receipt: {}, result: "written", files: {} },
    });
  let pollReply: (() => Promise<Response>) | undefined;
  let createReply: (() => Promise<Response>) | undefined;
  const response = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status });
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/v1/me"))
      return response({
        via: "api_token",
        user: { id: "owner" },
        scopes: ["chat:read", "chat:write", "inference"],
      });
    const envelope = {
      schemaVersion: 1,
      userId: "owner",
      sessionId: "s1",
      requestId: rid,
      state,
      expiresAt,
    };
    if (url.endsWith("/native-consent"))
      return createReply ? createReply() : response(envelope);
    if (url.endsWith(`/native-consent/${rid}`)) {
      if (init?.method === "DELETE") {
        state = "cancelled";
        return response({ ...envelope, state });
      }
      return pollReply ? pollReply() : response(envelope);
    }
    if (url.endsWith("/browser")) {
      const p = JSON.parse(String(init?.body));
      if (p.action === "child") return childReply();
      return response({
        schemaVersion: 1,
        userId: "owner",
        sessionId: "s1",
        phase: "tools_wait",
        round: 0,
        calls: [{ id: "parent", function: { name: "js", arguments: "{}" } }],
        childTools: ["write_file"],
      });
    }
    throw Error("Unexpected route");
  });
  const auth = new CloudWorkspace({
    token: () => token,
    profile: () => profile,
    origin: () => "https://api.mithril.fund",
    fetch: fetcher as typeof fetch,
    changed: () => {},
    readScope: "chat:read",
    writeScope: "chat:write",
  });
  const open = vi.fn(async () => {}),
    client = new CloudChat(auth, open);
  await auth.enable();
  await client.browserStep("s1", {
    action: "next",
    turnId: "turn",
    executionToken: intent.executionToken,
    round: 0,
  });
  return {
    client,
    auth,
    calls,
    open,
    response,
    fetcher,
    allow: () => {
      state = "allowed";
    },
    setPoll: (fn: () => Promise<Response>) => {
      pollReply = fn;
    },
    setCreate: (fn: () => Promise<Response>) => {
      createReply = fn;
    },
    failChild: () => {
      childReply = async () => {
        throw Error("lost effect reply");
      };
    },
    contextChange: (kind: string) => {
      if (kind === "profile") profile = "other";
      else if (kind === "credential") token = `mf_${"d".repeat(43)}`;
      else auth.reset();
    },
    expiresAt,
  };
}
const effects = (
  f: Awaited<ReturnType<typeof fixture>>,
): { url: string; init?: RequestInit }[] =>
  f.calls.filter(
    (c) =>
      c.url.endsWith("/browser") &&
      JSON.parse(String(c.init?.body)).action === "child",
  );
// @lat: [[mithril-code#Mithril Code#Native child exact request and release]]
it("keeps the exact main-owned intent and opens only a fixed locator URL, then releases once", async () => {
  const f = await fixture(),
    body = structuredClone(intent);
  const value = await f.client.createNativeChildConsent(scope, body);
  expect(value).toEqual({
    userId: "owner",
    sessionId: "s1",
    requestId: rid,
    state: "pending",
    expiresAt: f.expiresAt,
  });
  body.args.content = "substituted";
  await expect(
    f.client.browserStep("s1", { ...intent, action: "child" }),
  ).rejects.toThrow("approval required");
  await expect(f.client.executeNativeChildConsent(handle)).rejects.toThrow(
    "not allowed",
  );
  expect(effects(f)).toHaveLength(0);
  expect(f.open).not.toHaveBeenCalled();
  await f.client.reviewNativeChildConsent(handle);
  expect(f.open).toHaveBeenCalledExactlyOnceWith(
    `https://app.mithril.fund/?session=s1&toolApproval=${rid}`,
  );
  f.allow();
  await expect(
    f.client.executeNativeChildConsent(handle),
  ).resolves.toMatchObject({ childResult: { result: "written" } });
  expect(JSON.parse(String(effects(f)[0].init?.body)).args).toEqual(
    intent.args,
  );
  await expect(f.client.executeNativeChildConsent(handle)).rejects.toThrow(
    "retired",
  );
  expect(effects(f)).toHaveLength(1);
});
// @lat: [[mithril-code#Mithril Code#Native child identity retirement]]
it.each(["profile", "credential", "epoch"])(
  "refuses approval operations after captured %s changes",
  async (kind) => {
    const f = await fixture();
    await f.client.createNativeChildConsent(scope, intent);
    f.allow();
    f.contextChange(kind);
    await expect(f.client.executeNativeChildConsent(handle)).rejects.toThrow();
    await expect(f.client.reviewNativeChildConsent(handle)).rejects.toThrow();
    expect(effects(f)).toHaveLength(0);
    expect(f.open).not.toHaveBeenCalled();
  },
);
// @lat: [[mithril-code#Mithril Code#Native child cancellation and unknown effect]]
it("cancels through an owner-bound DELETE and never repeats an effect after a lost reply", async () => {
  const cancelled = await fixture();
  await cancelled.client.createNativeChildConsent(scope, intent);
  await cancelled.client.cancelNativeChildConsent(handle);
  expect(cancelled.calls.find((c) => c.init?.method === "DELETE")?.url).toBe(
    `https://api.mithril.fund/v1/chat/sessions/s1/gateway/native-consent/${rid}`,
  );
  cancelled.allow();
  await expect(
    cancelled.client.executeNativeChildConsent(handle),
  ).rejects.toThrow();
  expect(effects(cancelled)).toHaveLength(0);
  const unknown = await fixture();
  await unknown.client.createNativeChildConsent(scope, intent);
  unknown.allow();
  unknown.failChild();
  await expect(
    unknown.client.executeNativeChildConsent(handle),
  ).rejects.toThrow();
  await expect(
    unknown.client.executeNativeChildConsent(handle),
  ).rejects.toThrow("retired");
  expect(effects(unknown)).toHaveLength(1);
});
// @lat: [[mithril-code#Mithril Code#Native child admission boundaries]]
it("rejects substituted scope, undeclared children and malformed envelopes without dispatch", async () => {
  const f = await fixture();
  await expect(
    f.client.createNativeChildConsent({ ...scope, userId: "foreign" }, intent),
  ).rejects.toThrow();
  await expect(
    f.client.createNativeChildConsent(scope, { ...intent, name: "unlisted" }),
  ).rejects.toThrow();
  await expect(
    f.client.createNativeChildConsent(scope, {
      ...intent,
      endpoint: "https://other",
    }),
  ).rejects.toThrow();
  await expect(
    f.client.createNativeChildConsent(scope, { ...intent, args: { n: NaN } }),
  ).rejects.toThrow();
  expect(f.calls.some((c) => c.url.endsWith("/native-consent"))).toBe(false);
  await f.client.createNativeChildConsent(scope, intent);
  await expect(
    f.client.pollNativeChildConsent({ ...handle, profile: "other" }),
  ).rejects.toThrow();
  f.setPoll(async () =>
    f.response({
      schemaVersion: 1,
      userId: "owner",
      sessionId: "foreign",
      requestId: rid,
      expiresAt: f.expiresAt,
      state: "allowed",
    }),
  );
  await expect(f.client.executeNativeChildConsent(handle)).rejects.toThrow(
    "changed",
  );
  expect(effects(f)).toHaveLength(0);
});
// @lat: [[mithril-code#Mithril Code#Native child cancellation race]]
it("rejects a release whose permission poll returns after local cancellation", async () => {
  const f = await fixture();
  await f.client.createNativeChildConsent(scope, intent);
  let reply!: (v: Response) => void;
  f.setPoll(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  const executing = f.client.executeNativeChildConsent(handle);
  await vi.waitFor(() => expect(reply).toBeTypeOf("function"));
  await f.client.cancelNativeChildConsent(handle);
  reply(
    f.response({
      schemaVersion: 1,
      userId: "owner",
      sessionId: "s1",
      requestId: rid,
      expiresAt: f.expiresAt,
      state: "allowed",
    }),
  );
  await expect(executing).rejects.toThrow("not allowed");
  expect(effects(f)).toHaveLength(0);
});

// @lat: [[mithril-code#Mithril Code#Native consent window matches release]]
it.each([45001, 59999, 60000])(
  "honors the exact native consent window at %s ms without replay authority",
  async (elapsed) => {
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const f = await fixture(60000);
      await f.client.createNativeChildConsent(scope, intent);
      now += elapsed;
      f.allow();
      if (elapsed < 60000) {
        await expect(
          f.client.executeNativeChildConsent(handle),
        ).resolves.toMatchObject({ childResult: { result: "written" } });
        expect(effects(f)).toHaveLength(1);
        await expect(
          f.client.executeNativeChildConsent(handle),
        ).rejects.toThrow("retired");
      } else {
        await expect(
          f.client.executeNativeChildConsent(handle),
        ).rejects.toThrow("retired");
        expect(effects(f)).toHaveLength(0);
      }
      await expect(
        f.client.browserStep("s1", { ...intent, action: "child" }),
      ).rejects.toThrow();
      expect(effects(f)).toHaveLength(elapsed < 60000 ? 1 : 0);
    } finally {
      clock.mockRestore();
    }
  },
);

// @lat: [[mithril-code#Mithril Code#Native late registration cannot revive inventory]]
it.each(["expired", "new-parent"])(
  "withdraws native creation after the original inventory is %s",
  async (mode) => {
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const f = await fixture(60000);
      let reply!: (response: Response) => void;
      f.setCreate(
        () =>
          new Promise((resolve) => {
            reply = resolve;
          }),
      );
      const created = f.client.createNativeChildConsent(scope, intent).then(
        (value) => value,
        (error) => error,
      );
      await vi.waitFor(() => expect(reply).toBeTypeOf("function"));
      if (mode === "expired") now += 45001;
      else
        await f.client.browserStep("s1", {
          action: "next",
          turnId: "new-turn",
          executionToken: "d".repeat(64),
          round: 0,
        });
      reply(
        f.response({
          schemaVersion: 1,
          userId: "owner",
          sessionId: "s1",
          requestId: rid,
          state: "pending",
          expiresAt: f.expiresAt,
        }),
      );
      expect(await created).toBeInstanceOf(Error);
      expect(f.calls.filter((c) => c.init?.method === "DELETE")).toHaveLength(
        1,
      );
      f.allow();
      await expect(
        f.client.executeNativeChildConsent(handle),
      ).rejects.toThrow();
      expect(effects(f)).toHaveLength(0);
      expect(f.open).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  },
);
