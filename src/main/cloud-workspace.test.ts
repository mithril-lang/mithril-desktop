import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspace } from "./cloud-workspace";
import type { RepositoryEdit } from "@mithril/workspace/repository";
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
  // @lat: [[discover#Original Discover#Shared marketplace]]
  it("loads a verified Skill bundle through the main-owned API route and rejects changed accounts", async () => {
    await client.enable();
    const bytes = new TextEncoder().encode("# Original Skill");
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const bundle = {
      source: "hermes",
      id: "apple-notes",
      commit: "a".repeat(40),
      directory: "apple/apple-notes",
      license: "MIT",
      files: [
        {
          path: "SKILL.md",
          executable: false,
          size: bytes.length,
          digest,
          base64: btoa("# Original Skill"),
        },
      ],
    };
    const item = {
      id: "apple-notes",
      registry: "hermes" as const,
      name: "Notes",
      description: "",
      path: "../private",
      artifact: { format: "git" as const, url: "https://evil.test" },
    };
    fetcher.mockImplementation(async (url: string) =>
      url.endsWith("/v1/me")
        ? reply({
            via: "api_token",
            scopes: ["workspace:read", "workspace:write"],
            user: { id: "a" },
          })
        : reply(bundle),
    );
    expect(await client.registrySkill(item)).toEqual(bundle);
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://api.mithril.fund/v1/discover/bundle/hermes/apple-notes",
      expect.objectContaining({
        credentials: "omit",
        redirect: "error",
        headers: expect.objectContaining({ authorization: `Bearer ${tokenA}` }),
      }),
    );
    const count = fetcher.mock.calls.length;
    await expect(
      client.registrySkill({ ...item, id: "../private" }),
    ).rejects.toThrow("Invalid registry entry");
    expect(fetcher).toHaveBeenCalledTimes(count);
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith("/v1/me"))
        return reply({
          via: "api_token",
          scopes: ["workspace:read", "workspace:write"],
          user: { id: "a" },
        });
      return {
        ...reply(bundle),
        json: async () => {
          token = tokenB;
          return bundle;
        },
      };
    });
    await expect(client.registrySkill(item)).rejects.toThrow("account changed");
  });
  // @lat: [[discover#Original Discover#Shared marketplace]]
  it("reads original registry documents through fixed Mithril API routes without renderer URLs or credentials", async () => {
    fetcher.mockResolvedValueOnce(
      reply({ skills: [], mcps: [], agents: [], workflows: [], plugins: [] }),
    );
    await client.discoverDocuments.fetchRegistry();
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://api.mithril.fund/v1/discover/registry",
      expect.objectContaining({
        credentials: "omit",
        redirect: "error",
        headers: { accept: "application/json" },
      }),
    );
    fetcher.mockResolvedValueOnce(
      reply({ markdown: "# Full original detail" }),
    );
    expect(
      await client.discoverDocuments.fetchRegistryDetail("skills", {
        id: "apple-notes",
        registry: "hermes",
        name: "Notes",
        description: "",
        path: "../private",
        artifact: { format: "git", url: "https://evil.test" },
      }),
    ).toEqual({ markdown: "# Full original detail" });
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://api.mithril.fund/v1/discover/detail/skills/hermes/apple-notes",
      expect.objectContaining({ credentials: "omit", redirect: "error" }),
    );
    expect(
      fetcher.mock.calls.every(
        ([, init]) => !new Headers(init?.headers).has("authorization"),
      ),
    ).toBe(true);
    const count = fetcher.mock.calls.length;
    await expect(
      client.discoverDocuments.fetchRegistryDetail("skills", {
        id: "../private",
        registry: "hermes",
        name: "",
        description: "",
      }),
    ).rejects.toThrow("Invalid registry entry");
    expect(fetcher).toHaveBeenCalledTimes(count);
  });
  // @lat: [[cloud-workspace-tests#Cloud workspace tests#Dedicated authorization scopes]]
  it("rechecks write authorization before applying native replica data", async () => {
    await client.enable();
    fetcher.mockResolvedValueOnce(
      reply({
        via: "api_token",
        user: { id: "a" },
        scopes: ["workspace:read"],
      }),
    );
    await expect(client.nativeContext(true)).rejects.toThrow(
      "workspace:write authorization",
    );
    expect(fetcher.mock.calls.every((call) => call[0].endsWith("/v1/me"))).toBe(
      true,
    );
  });
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

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Capability resource transport]]
it("keeps Capability resource auth in main, checks owners and discards responses after account changes", async () => {
  const { digestBytes } = await import("@mithril/workspace/files");
  const bytes = new Uint8Array([0, 255, 3]);
  const digest = await digestBytes(bytes);
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let release: ((response: Response) => void) | undefined;
  let delayed = false;
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/me"))
      return reply({
        via: "api_token",
        user: { id: token === tokenB ? "b" : "a" },
        scopes: ["workspace:read", "workspace:write"],
      });
    calls.push({ url, init });
    if (delayed)
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    return init?.method === "POST"
      ? Response.json({ digest, size: bytes.length })
      : new Response(new Uint8Array(bytes));
  });
  await client.enable();
  const resources = client.capabilityResources.forOwner("a");
  expect(await resources.putChunk("capability-default", bytes)).toBe(digest);
  expect(await resources.getChunk("capability-default", digest)).toEqual(bytes);
  expect(calls[0].url).toBe(
    "https://api.mithril.fund/v1/workspace/resources/capability/capability-default/chunks",
  );
  expect(new Headers(calls[0].init?.headers).get("authorization")).toBe(
    `Bearer ${tokenA}`,
  );
  expect(
    new Headers(calls[0].init?.headers).get("x-mithril-workspace-owner"),
  ).toBe("a");
  expect(new Headers(calls[0].init?.headers).get("content-type")).toBe(
    "application/octet-stream",
  );
  expect(calls[0].init).toMatchObject({
    credentials: "omit",
    redirect: "error",
  });
  await expect(
    client.capabilityResources
      .forOwner("b")
      .getChunk("capability-default", digest),
  ).rejects.toThrow("owner changed");
  await expect(
    client.authorizedBinaryRequest("/v1/workspace/resources/project/p/chunks"),
  ).rejects.toThrow("Unsupported");
  await expect(
    client.authorizedBinaryRequest(
      "/v1/workspace/resources/capability/x/chunks?remote=https://other",
    ),
  ).rejects.toThrow("Unsupported");
  expect(calls).toHaveLength(2);
  delayed = true;
  const pending = resources.getChunk("capability-default", digest);
  await vi.waitFor(() => expect(release).toBeDefined());
  client.reset();
  token = tokenB;
  release!(new Response(new Uint8Array(bytes)));
  await expect(pending).rejects.toThrow("Account changed");
});

it("refuses Capability resource uploads without write scope", async () => {
  await client.enable();
  fetcher.mockImplementation(async (url: string) => {
    if (url.endsWith("/v1/me"))
      return reply({
        via: "api_token",
        user: { id: "a" },
        scopes: ["workspace:read"],
      });
    throw new Error("Storage must not be requested");
  });
  await expect(
    client.capabilityResources
      .forOwner("a")
      .putChunk("capability-default", new Uint8Array([1])),
  ).rejects.toThrow("write scope");
  expect(fetcher.mock.calls.every((call) => call[0].endsWith("/v1/me"))).toBe(
    true,
  );
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Task attachment IPC authority]]
it("keeps task attachment credentials in main and discards late data after account changes", async () => {
  const { digestBytes } = await import("@mithril/workspace/files");
  const bytes = new Uint8Array([0, 255, 7]),
    digest = await digestBytes(bytes);
  let release: ((response: Response) => void) | undefined;
  let delayed = false;
  const calls: { url: string; init?: RequestInit }[] = [];
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/me"))
      return reply({
        via: "api_token",
        user: { id: token === tokenB ? "b" : "a" },
        scopes: ["workspace:read", "workspace:write"],
      });
    calls.push({ url, init });
    if (delayed)
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    if (init?.method === "HEAD")
      return new Response(null, {
        headers: { "content-length": "3", "x-mithril-resource-digest": digest },
      });
    return init?.method === "POST"
      ? Response.json({ digest, size: bytes.length })
      : new Response(bytes);
  });
  await client.enable();
  const files = client.taskAttachments.forOwner("a");
  expect(await files.putChunk("original", bytes)).toBe(digest);
  expect(await files.hasChunk("original", digest, bytes.length)).toBe(true);
  expect(await files.getChunk("original", digest)).toEqual(bytes);
  expect(calls[0].url).toBe(
    "https://api.mithril.fund/v1/workspace/resources/task/original/chunks",
  );
  expect(new Headers(calls[0].init?.headers).get("authorization")).toBe(
    `Bearer ${tokenA}`,
  );
  expect(
    new Headers(calls[0].init?.headers).get("x-mithril-workspace-owner"),
  ).toBe("a");
  expect(calls[0].init).toMatchObject({
    credentials: "omit",
    redirect: "error",
  });
  await expect(
    client.taskAttachments.forOwner("b").getChunk("original", digest),
  ).rejects.toThrow("owner changed");
  await expect(
    client.authorizedBinaryRequest(
      "/v1/workspace/resources/task/original/manifests",
    ),
  ).rejects.toThrow("Unsupported");
  await expect(
    client.authorizedBinaryRequest(
      "/v1/workspace/resources/task/original/chunks?url=https://other",
    ),
  ).rejects.toThrow("Unsupported");
  expect(calls).toHaveLength(3);
  delayed = true;
  const pending = files.getChunk("original", digest);
  await vi.waitFor(() => expect(release).toBeDefined());
  client.reset();
  token = tokenB;
  release!(new Response(bytes));
  await expect(pending).rejects.toThrow("Account changed");
});

it("bounds resource bodies in main even when the server omits content-length", async () => {
  const { CHUNK_BYTES } = await import("@mithril/workspace/files");
  fetcher.mockImplementation(async (url: string) =>
    url.endsWith("/v1/me")
      ? reply({
          via: "api_token",
          user: { id: "a" },
          scopes: ["workspace:read", "workspace:write"],
        })
      : new Response(new Uint8Array(CHUNK_BYTES + 1)),
  );
  await client.enable();
  await expect(
    client.capabilityResources
      .forOwner("a")
      .getChunk("capability-default", "a".repeat(64)),
  ).rejects.toThrow("too large");
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Repository retained history]]
it("reads retained repository bodies on the fixed authenticated route and refuses malformed history or missing Chat authority", async () => {
  const original = fetcher.getMockImplementation()! as (
    url: string,
  ) => Promise<Response>;
  let malformed = false;
  fetcher.mockImplementation(async (url: string) => {
    if (url.includes("/repository/capability/"))
      return reply({
        schemaVersion: 1,
        userId: "a",
        documents: [
          {
            collection: "capability",
            id: malformed ? "wrong" : "capability-default",
            revision: 2,
            deleted: false,
            updatedAt: 1,
            body: { original: "Full Skill text" },
          },
        ],
        nextBefore: null,
      });
    return original(url);
  });
  await client.enable();
  expect(
    (await client.repositoryHistory("capability", "capability-default", 3))
      .documents[0].body,
  ).toEqual({ original: "Full Skill text" });
  expect(
    fetcher.mock.calls.some(
      (call) =>
        call[0] ===
        "https://api.mithril.fund/v1/workspace/repository/capability/capability-default/history?before=3",
    ),
  ).toBe(true);
  malformed = true;
  await expect(
    client.repositoryHistory("capability", "capability-default", 3),
  ).rejects.toThrow("Invalid repository history");
  const count = fetcher.mock.calls.length;
  await expect(
    client.repositoryHistory("capability", "../another", 3),
  ).rejects.toThrow();
  expect(fetcher.mock.calls).toHaveLength(count);
  await expect(client.repositoryHistory("chat", "session")).rejects.toThrow(
    "chat:read",
  );
  expect(
    fetcher.mock.calls.some((call) => call[0].includes("/repository/chat/")),
  ).toBe(false);
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Capability migration transport]]
it("preserves both migration revisions on the fixed native API transport and rejects malformed guards before requesting", async () => {
  const original = fetcher.getMockImplementation()! as (
    url: string,
  ) => Promise<Response>;
  let submitted: RepositoryEdit | undefined;
  const edit: RepositoryEdit = {
    collection: "capability",
    id: "capability-default",
    operationId: "migration-one",
    baseRevision: 1,
    deleted: false,
    body: {
      format: "mithril-capability-v2",
      profile: "default",
      skillStorage: "resources",
      skills: [],
      toolsets: [],
      mcps: [],
    },
    capabilityMigration: {
      profile: "default",
      pointerRevision: 3,
      manifest: "a".repeat(64),
    },
  };
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/repository/capability")) {
      submitted = JSON.parse(String(init?.body));
      return reply({
        schemaVersion: 1,
        userId: "a",
        operationId: edit.operationId,
        status: "accepted",
        document: {
          collection: edit.collection,
          id: edit.id,
          revision: 2,
          body: edit.body,
          deleted: false,
          updatedAt: 1,
        },
      });
    }
    return original(url);
  });
  await client.enable();
  expect((await client.repositoryApply(edit)).status).toBe("accepted");
  expect(submitted).toEqual(edit);
  const count = fetcher.mock.calls.length;
  await expect(
    client.repositoryApply({
      ...edit,
      capabilityMigration: { ...edit.capabilityMigration!, pointerRevision: 0 },
    }),
  ).rejects.toThrow("Invalid repository edit");
  expect(fetcher.mock.calls).toHaveLength(count);
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Original schedule resource transport]]
it("keeps original schedule source resources in the main-process owner-bound API transport", async () => {
  const { digestBytes } = await import("@mithril/workspace/files");
  const { originalScheduleResourceId } =
    await import("@mithril/workspace/original-schedule-resources");
  const bytes = new Uint8Array(new TextEncoder().encode("[]\r\n")),
    digest = await digestBytes(bytes);
  const id = await originalScheduleResourceId("default");
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let release: ((response: Response) => void) | undefined;
  let delayed = false;
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/me"))
      return reply({
        via: "api_token",
        user: { id: token === tokenB ? "b" : "a" },
        scopes: ["workspace:read", "workspace:write"],
      });
    calls.push({ url, init });
    if (delayed)
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    if (init?.method === "HEAD")
      return new Response(null, {
        headers: {
          "content-length": String(bytes.length),
          "x-mithril-resource-digest": digest,
        },
      });
    return init?.method === "POST"
      ? Response.json({ digest, size: bytes.length })
      : new Response(bytes.slice());
  });
  await client.enable();
  const resources = client.scheduleResources.forOwner("a");
  expect(await resources.putChunk(id, bytes)).toBe(digest);
  expect(await resources.hasChunk!(id, digest, bytes.length)).toBe(true);
  expect(await resources.getChunk(id, digest)).toEqual(bytes);
  expect(calls[0].url).toBe(
    `https://api.mithril.fund/v1/workspace/resources/schedule/${id}/chunks`,
  );
  expect(new Headers(calls[0].init?.headers).get("authorization")).toBe(
    `Bearer ${tokenA}`,
  );
  expect(
    new Headers(calls[0].init?.headers).get("x-mithril-workspace-owner"),
  ).toBe("a");
  expect(calls[0].init).toMatchObject({
    credentials: "omit",
    redirect: "error",
  });
  await expect(
    client.scheduleResources.forOwner("b").getChunk(id, digest),
  ).rejects.toThrow("owner changed");
  await expect(
    resources.getChunk("capability-default", digest),
  ).rejects.toThrow("route");
  await expect(
    client.authorizedBinaryRequest(
      "/v1/workspace/resources/schedule/other/chunks",
    ),
  ).rejects.toThrow("schedule resource route");
  expect(calls).toHaveLength(3);
  delayed = true;
  const pending = resources.getChunk(id, digest);
  await vi.waitFor(() => expect(release).toBeDefined());
  client.reset();
  token = tokenB;
  release!(new Response(bytes.slice()));
  await expect(pending).rejects.toThrow("Account changed");
});
it("does not upgrade inference or read-only credentials to write original schedule resources", async () => {
  const { originalScheduleResourceId } =
    await import("@mithril/workspace/original-schedule-resources");
  await client.enable();
  fetcher.mockImplementation(async (url: string) => {
    if (url.endsWith("/v1/me"))
      return reply({
        via: "api_token",
        user: { id: "a" },
        scopes: ["workspace:read"],
      });
    throw Error("Storage must not be requested");
  });
  await expect(
    client.scheduleResources
      .forOwner("a")
      .putChunk(
        await originalScheduleResourceId("default"),
        new Uint8Array([1]),
      ),
  ).rejects.toThrow("write scope");
  expect(fetcher.mock.calls.every((call) => call[0].endsWith("/v1/me"))).toBe(
    true,
  );
});
