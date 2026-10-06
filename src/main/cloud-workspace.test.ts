import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspace } from "./cloud-workspace";
import type { WorkspaceOperation } from "@mithril/workspace/protocol";

const tokenA = `mf_${"a".repeat(43)}`;
const tokenB = `mf_${"b".repeat(43)}`;
const operation: WorkspaceOperation = {
  operationId: "op1",
  id: "project1",
  kind: "project",
  baseRevision: 0,
  data: { title: "User entered project" },
  deleted: false,
};
const record = {
  id: "project1",
  kind: "project",
  revision: 1,
  data: operation.data,
  deleted: false,
  updatedAt: 1,
};
const reply = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response;
let token: string | null;
let profile: string;
let fetcher: ReturnType<typeof vi.fn>;
let changed: ReturnType<typeof vi.fn<() => void>>;
let client: CloudWorkspace;
beforeEach(() => {
  token = tokenA;
  profile = "default";
  changed = vi.fn();
  fetcher = vi.fn(async (url: string) => {
    if (url.endsWith("/v1/me"))
      return reply({
        via: "api_token",
        scopes: ["workspace:read", "workspace:write"],
        user: { id: token === tokenB ? "b" : "a" },
      });
    if (url.endsWith("/operations"))
      return reply({
        schemaVersion: 1,
        userId: "a",
        results: [{ operationId: "op1", status: "accepted", record }],
      });
    if (url.includes("/history/"))
      return reply({
        schemaVersion: 1,
        userId: "a",
        records: [record],
        hasMore: false,
        nextOffset: null,
      });
    return reply({
      schemaVersion: 1,
      userId: "a",
      cursor: 1,
      records: [record],
    });
  });
  client = new CloudWorkspace({
    token: () => token,
    profile: () => profile,
    origin: () => "https://api.mithril.fund",
    fetch: fetcher as typeof fetch,
    changed: () => changed(),
  });
});

describe("Desktop cloud workspace boundary", () => {
  // @lat: [[cloud-workspace-tests#Cloud workspace tests#Dedicated authorization scopes]]
  it("refuses inference-only and read-only credentials without upgrading them", async () => {
    fetcher.mockResolvedValueOnce(
      reply({
        via: "api_token",
        user: { id: "a" },
        scopes: ["inference", "billing:read"],
      }),
    );
    await expect(client.enable()).rejects.toThrow(
      "workspace:read authorization",
    );
    fetcher.mockResolvedValueOnce(
      reply({
        via: "api_token",
        user: { id: "a" },
        scopes: ["workspace:read"],
      }),
    );
    await expect(client.enable()).rejects.toThrow(
      "workspace:write authorization",
    );
    expect(fetcher.mock.calls.every((call) => call[0].endsWith("/v1/me"))).toBe(
      true,
    );
    expect(fetcher.mock.calls.every((call) => call[1].method === "GET")).toBe(
      true,
    );
  });
  // @lat: [[cloud-workspace-tests#Cloud workspace tests#Explicit consent]]
  it("does not read or write workspace data before explicit consent", async () => {
    expect(await client.status()).toEqual({ userId: "a", enabled: false });
    await expect(client.getSnapshot()).rejects.toThrow(
      "Enable Cloud Workspace",
    );
    await expect(client.applyOperations([operation])).rejects.toThrow(
      "Enable Cloud Workspace",
    );
    expect(fetcher.mock.calls.every((call) => call[0].endsWith("/v1/me"))).toBe(
      true,
    );
    await client.enable();
    expect(await client.getSnapshot()).toMatchObject({ userId: "a" });
  });

  // @lat: [[cloud-workspace-tests#Cloud workspace tests#Narrow data and fixed transport]]
  it("rejects config and secrets before network, sends only the explicit operation to a fixed API", async () => {
    await client.enable();
    fetcher.mockClear();
    for (const key of [
      "apiKey",
      "token",
      "localPath",
      "permissions",
      "providerConfig",
    ]) {
      await expect(
        client.applyOperations([
          { ...operation, data: { ...operation.data, [key]: "private" } },
        ]),
      ).rejects.toThrow("Unsupported");
    }
    expect(fetcher).not.toHaveBeenCalled();
    await client.applyOperations([operation]);
    const [url, options] = fetcher.mock.calls[1];
    expect(url).toBe("https://api.mithril.fund/v1/workspace/operations");
    expect(options).toMatchObject({
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      method: "POST",
    });
    expect(JSON.parse(options.body)).toEqual({
      schemaVersion: 1,
      operations: [operation],
    });
    expect(JSON.parse(options.body)).not.toHaveProperty("token");
  });

  // @lat: [[cloud-workspace-tests#Cloud workspace tests#Account isolation]]
  it("revokes consent on replacement token or switched local profile", async () => {
    await client.enable();
    token = tokenB;
    expect(await client.status()).toEqual({ userId: "b", enabled: false });
    await expect(client.applyOperations([operation])).rejects.toThrow(
      "Enable Cloud Workspace",
    );
    await client.enable();
    profile = "another-profile";
    expect(await client.status()).toEqual({ userId: "b", enabled: false });
    token = null;
    expect(await client.status()).toEqual({ userId: null, enabled: false });
    expect(changed).toHaveBeenCalledTimes(3);
  });

  // @lat: [[cloud-workspace-tests#Cloud workspace tests#Late responses and expiry]]
  it("discards responses received after logout, and does not continue on expired identity", async () => {
    await client.enable();
    let resolve!: (response: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const pending = client.getSnapshot();
    client.reset();
    token = null;
    resolve(
      reply({
        via: "api_token",
        scopes: ["workspace:read", "workspace:write"],
        user: { id: "a" },
      }),
    );
    await expect(pending).rejects.toThrow("account changed");
    token = tokenA;
    await client.enable();
    fetcher.mockResolvedValueOnce(reply({}, 401));
    await expect(client.getSnapshot()).rejects.toThrow("expired");
    expect(await client.status()).toMatchObject({ enabled: false });
  });

  it("does not clear a newly enabled account when an old account response arrives late", async () => {
    await client.enable();
    let resolve!: (response: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const pendingA = client.getSnapshot();
    client.reset();
    token = tokenB;
    expect(await client.enable()).toEqual({ userId: "b", enabled: true });
    resolve(
      reply({
        via: "api_token",
        scopes: ["workspace:read", "workspace:write"],
        user: { id: "a" },
      }),
    );
    await expect(pendingA).rejects.toThrow("stale response discarded");
    expect(await client.status()).toEqual({ userId: "b", enabled: true });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("does not apply an old enable click to the newly signed-in account", async () => {
    let resolve!: (response: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const pendingEnableA = client.enable();
    client.reset();
    token = tokenB;
    expect(await client.status()).toEqual({ userId: "b", enabled: false });
    resolve(
      reply({
        via: "api_token",
        scopes: ["workspace:read", "workspace:write"],
        user: { id: "a" },
      }),
    );
    await expect(pendingEnableA).rejects.toThrow("stale response discarded");
    expect(await client.status()).toEqual({ userId: "b", enabled: false });
  });

  // @lat: [[cloud-workspace-tests#Cloud workspace tests#Offline and owner mismatch]]
  it("retains consent through transient offline failure, rejects another owner's snapshot", async () => {
    await client.enable();
    fetcher.mockRejectedValueOnce(
      new Error(`request failed authorization Bearer ${tokenA}`),
    );
    await expect(client.getSnapshot()).rejects.toThrow("network unavailable");
    expect(await client.status()).toMatchObject({ enabled: true });
    expect(await client.getSnapshot()).toMatchObject({ userId: "a" });
    fetcher
      .mockResolvedValueOnce(
        reply({
          via: "api_token",
          scopes: ["workspace:read", "workspace:write"],
          user: { id: "a" },
        }),
      )
      .mockResolvedValueOnce(
        reply({ schemaVersion: 1, userId: "b", records: [] }),
      );
    await expect(client.getSnapshot()).rejects.toThrow("owner/schema mismatch");
    expect(await client.status()).toMatchObject({ enabled: false });
  });

  // @lat: [[cloud-workspace-tests#Cloud workspace tests#Conflict and history]]
  it("preserves CAS conflicts and idempotency ids, accepts tombstone history and rejects injected fields", async () => {
    await client.enable();
    const conflict = {
      schemaVersion: 1,
      userId: "a",
      results: [{ operationId: "op1", status: "conflict", record }],
    };
    fetcher
      .mockResolvedValueOnce(
        reply({
          via: "api_token",
          scopes: ["workspace:read", "workspace:write"],
          user: { id: "a" },
        }),
      )
      .mockResolvedValueOnce(reply(conflict));
    expect(await client.applyOperations([operation])).toEqual(conflict);
    expect(await client.history("project1")).toMatchObject({
      userId: "a",
      records: [record],
    });
    await expect(client.history("../../secret")).rejects.toThrow("Invalid");
    fetcher
      .mockResolvedValueOnce(
        reply({
          via: "api_token",
          scopes: ["workspace:read", "workspace:write"],
          user: { id: "a" },
        }),
      )
      .mockResolvedValueOnce(
        reply({
          schemaVersion: 1,
          userId: "a",
          records: [{ ...record, deleted: true, token: "no" }],
          hasMore: false,
          nextOffset: null,
        }),
      );
    await expect(client.history("project1")).rejects.toThrow("history invalid");
  });
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Cloud sidebar identity]]
it("checks cloud sidebar owners and retains exact operation IDs on fixed routes", async () => {
  await client.enable();
  const op = {
    operationId: "pin-op",
    chatId: "chat",
    baseRevision: 0,
    pinned: true,
    projectId: null,
  };
  const fallback = fetcher.getMockImplementation()! as (
    url: string,
    init?: RequestInit,
  ) => Promise<Response>;
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/workspace/sidebar"))
      return reply(
        init?.method === "POST"
          ? {
              schemaVersion: 1,
              userId: "a",
              operationId: "pin-op",
              status: "accepted",
              placement: {
                chatId: "chat",
                revision: 1,
                pinned: true,
                projectId: null,
              },
            }
          : { schemaVersion: 1, userId: "a", placements: [] },
      );
    return fallback(url, init);
  });
  expect((await client.getSidebar()).placements).toEqual([]);
  expect((await client.applySidebar(op)).status).toBe("accepted");
  expect(
    JSON.parse(
      fetcher.mock.calls.find(
        (c) => c[0].endsWith("/sidebar") && c[1].method === "POST",
      )![1].body,
    ),
  ).toEqual(op);
  await expect(
    client.applySidebar({ ...op, projectId: "/Users/private" }),
  ).rejects.toThrow("Invalid sidebar");
  fetcher.mockImplementation(async (url: string) =>
    url.endsWith("/sidebar")
      ? reply({ schemaVersion: 1, userId: "other", placements: [] })
      : fallback(url),
  );
  await expect(client.getSidebar()).rejects.toThrow("owner/schema mismatch");
});
// @lat: [[cloud-workspace-tests#Cloud workspace tests#Cloud schedule boundaries]]
it("uses fixed owner-checked schedule routes and refuses writes without chat and inference authority", async () => {
  const op = {
    operationId: "schedule-op",
    id: "schedule",
    baseRevision: 0,
    name: "Test",
    prompt: "Synthetic",
    model: "model",
    intervalMinutes: 60,
    enabled: false,
    deleted: false,
  };
  await client.enable();
  await expect(client.applySchedule(op)).rejects.toThrow("chat:write");
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/me"))
      return reply({
        via: "api_token",
        user: { id: "a" },
        scopes: [
          "workspace:read",
          "workspace:write",
          "chat:write",
          "inference",
        ],
      });
    if (init?.method === "POST")
      return reply({
        schemaVersion: 1,
        userId: "a",
        operationId: "schedule-op",
        status: "accepted",
        schedule: null,
      });
    return reply({ schemaVersion: 1, userId: "a", schedules: [] });
  });
  expect((await client.getSchedules()).schedules).toEqual([]);
  expect((await client.applySchedule(op)).status).toBe("accepted");
  expect(
    fetcher.mock.calls.some(
      ([url, init]) =>
        String(url).endsWith("/v1/schedules") && init?.method === "POST",
    ),
  ).toBe(true);
  fetcher.mockImplementation(async (url: string) =>
    url.endsWith("/v1/me")
      ? reply({
          via: "api_token",
          user: { id: "a" },
          scopes: [
            "workspace:read",
            "workspace:write",
            "chat:write",
            "inference",
          ],
        })
      : reply({ schemaVersion: 1, userId: "b", schedules: [] }),
  );
  await expect(client.getSchedules()).rejects.toThrow(/owner/i);
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Stable disconnected identity]]
it("does not emit an account-change loop for repeated rejected connections", async () => {
  fetcher.mockResolvedValue(
    reply({ via: "api_token", user: { id: "a" }, scopes: ["inference"] }),
  );
  await expect(client.enable()).rejects.toThrow("workspace:read");
  await expect(client.enable()).rejects.toThrow("workspace:read");
  expect(changed).not.toHaveBeenCalled();
  fetcher.mockResolvedValue(reply(null, 401));
  await expect(client.enable()).rejects.toThrow("sign-in expired");
  await expect(client.enable()).rejects.toThrow("sign-in expired");
  expect(changed).not.toHaveBeenCalled();
  client.reset(); // A newly stored credential must wake disconnected renderers.
  expect(changed).toHaveBeenCalledTimes(1);
  await expect(client.enable()).rejects.toThrow("sign-in expired");
  expect(changed).toHaveBeenCalledTimes(1);
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Security execution boundaries]]
it("uses fixed security routes with explicit read/run scopes and rejects owner changes", async () => {
  const op = {
    id: "security-op",
    targetId: "sandbox",
    policyDigest: "a".repeat(64),
  };
  await client.enable();
  await expect(client.getSecurity()).rejects.toThrow("security:read");
  await expect(client.submitSecurity(op)).rejects.toThrow("security:run");
  fetcher.mockImplementation(async (url: string) =>
    url.endsWith("/v1/me")
      ? reply({
          via: "api_token",
          user: { id: "a" },
          scopes: [
            "workspace:read",
            "workspace:write",
            "security:read",
            "security:run",
          ],
        })
      : reply({ schemaVersion: 1, userId: "a", targets: [], runs: [] }),
  );
  expect((await client.getSecurity()).runs).toEqual([]);
  await client.submitSecurity(op);
  const call = fetcher.mock.calls.find(
    ([url, init]) =>
      String(url).endsWith("/v1/security") && init?.method === "POST",
  );
  expect(call).toBeTruthy();
  expect(JSON.parse(String(call![1]!.body))).toEqual(op);
  await expect(
    client.submitSecurity({ ...op, token: "renderer-secret" } as typeof op),
  ).rejects.toThrow("Invalid security operation");
  fetcher.mockImplementation(async (url: string) =>
    url.endsWith("/v1/me")
      ? reply({
          via: "api_token",
          user: { id: "a" },
          scopes: ["workspace:read", "workspace:write", "security:read"],
        })
      : reply({ schemaVersion: 1, userId: "b", targets: [], runs: [] }),
  );
  await expect(client.getSecurity()).rejects.toThrow("owner");
});
