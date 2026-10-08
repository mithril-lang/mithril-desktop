import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "./config";
const m = vi.hoisted(() => ({
  conn: {} as ConnectionConfig,
  id: "remote-one",
  profile: "research",
  request: vi.fn(),
  write: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("./config", () => ({
  getConnectionConfig: () => m.conn,
  getActiveConnection: () => ({ connectionId: m.id }),
}));
vi.mock("./utils", () => ({
  getActiveProfileNameSync: () => m.profile,
  profilePaths: () => ({ configFile: "unused", home: "unused" }),
  safeWriteFile: m.write,
}));
vi.mock("./installer", () => ({
  getEnhancedPath: () => "",
  HERMES_PYTHON: "unused",
  hermesCliArgs: () => [],
}));
vi.mock("./hermes", () => ({
  isRemoteMode: (conn: ConnectionConfig) => conn.mode !== "local",
  getApiUrl: () => "http://127.0.0.1:9119",
  getRemoteAuthHeader: () => ({ Authorization: "Bearer ssh-owned" }),
}));
vi.mock("./remote-api", () => ({
  remoteDashboardRequestJson: m.request,
  RemoteDashboardApiError: class extends Error {},
}));
import {
  addMcpServer,
  listMcpServers,
  listMcpCatalog,
  setMcpServerEnabled,
  testMcpServer,
  updateMcpServer,
} from "./mcp-servers";
const input = {
  name: "new",
  type: "http" as const,
  url: "https://mcp.example/mcp",
};
beforeEach(() => {
  vi.clearAllMocks();
  m.id = "remote-one";
  m.profile = "research";
  m.conn = {
    mode: "remote",
    remoteUrl: "https://owned.example",
    apiKey: "owned-token",
    remoteAuthMode: "oauth",
    remoteChatTransport: "auto",
    sshChatTransport: "auto",
    ssh: {
      host: "owned",
      port: 22,
      username: "user",
      keyPath: "",
      remotePort: 9119,
      localPort: 9119,
    },
  };
});

describe("MCP management owner routing", () => {
  // @lat: [[mcp-servers#Connection and profile isolation]]
  it("uses the OAuth-aware transport and explicit profile, including default", async () => {
    m.request.mockResolvedValue({
      servers: [{ name: "owned", transport: "http", url: input.url }],
    });
    expect((await listMcpServers("default"))[0].name).toBe("owned");
    expect(m.request).toHaveBeenCalledWith(
      m.conn,
      "/api/mcp/servers?profile=default",
      { method: undefined, body: undefined, timeoutMs: 15000 },
      "default",
    );
    await listMcpServers();
    expect(m.request.mock.calls[1][1]).toBe(
      "/api/mcp/servers?profile=research",
    );
    expect(m.write).not.toHaveBeenCalled();
  });

  it("scopes mutations and catalog operations to the initiating profile", async () => {
    m.request.mockResolvedValue({ ok: true, name: "new", entries: [] });
    await addMcpServer(input, "other");
    await setMcpServerEnabled("new", false, "other");
    await listMcpCatalog("other");
    for (const call of m.request.mock.calls) {
      expect(call[1]).toContain("profile=other");
      expect(call[3]).toBe("other");
    }
    expect(m.write).not.toHaveBeenCalled();
  });

  // @lat: [[mcp-servers#Atomic remote edit]]
  it("edits and renames with one atomic request, never deleting the original first", async () => {
    m.request.mockResolvedValue({ name: "new" });
    expect(await updateMcpServer("old", input, "research")).toEqual({
      success: true,
    });
    expect(m.request).toHaveBeenCalledTimes(1);
    expect(m.request.mock.calls[0][1]).toBe(
      "/api/mcp/servers/old?profile=research",
    );
    expect(m.request.mock.calls[0][2].method).toBe("PUT");
    m.request.mockClear();
    m.request.mockRejectedValue(new Error("404: unsupported atomic update"));
    expect((await updateMcpServer("old", input)).success).toBe(false);
    expect(m.request).toHaveBeenCalledTimes(1);
    expect(m.write).not.toHaveBeenCalled();
  });

  it("does not claim a mismatched update acknowledgement succeeded", async () => {
    m.request.mockResolvedValue({ name: "other" });
    expect(await updateMcpServer("old", input)).toMatchObject({
      success: false,
      error: expect.stringContaining("acknowledgement"),
    });
  });

  it.each(["connection", "profile", "credential"])(
    "rejects MCP discovery after %s changes",
    async (change) => {
      m.request.mockImplementation(async () => {
        if (change === "connection") m.id = "two";
        if (change === "profile") m.profile = "other";
        if (change === "credential") m.conn.apiKey = "other-token";
        return { servers: [] };
      });
      await expect(listMcpServers()).rejects.toThrow("changed");
      expect(m.request.mock.calls[0][0].apiKey).toBe("owned-token");
    },
  );

  it("does not retry a mutation after the selected connection changes", async () => {
    m.request.mockImplementation(async () => {
      m.id = "two";
      return { ok: true };
    });
    expect(await setMcpServerEnabled("owned", false)).toMatchObject({
      success: false,
      error: expect.stringContaining("may have completed"),
    });
    expect(m.request).toHaveBeenCalledTimes(1);
    expect(m.write).not.toHaveBeenCalled();
  });

  it("requires an explicit successful probe result", async () => {
    m.request.mockResolvedValue({ tools: [] });
    expect((await testMcpServer("owned")).success).toBe(false);
    m.request.mockResolvedValue({
      ok: true,
      tools: [{ name: "search", description: "Search" }],
    });
    expect((await testMcpServer("owned")).success).toBe(true);
  });

  it("keeps SSH profile scoping, deadline and redirect rejection", async () => {
    m.conn.mode = "ssh";
    m.fetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ servers: [] }),
    });
    vi.stubGlobal("fetch", m.fetch);
    try {
      await listMcpServers("default");
      expect(m.fetch.mock.calls[0][0]).toBe(
        "http://127.0.0.1:9119/api/mcp/servers?profile=default",
      );
      expect(m.fetch.mock.calls[0][1]).toMatchObject({
        redirect: "error",
        signal: expect.any(AbortSignal),
        headers: { Authorization: "Bearer ssh-owned" },
      });
      expect(m.request).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
