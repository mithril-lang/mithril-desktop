import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "./config";

const mocks = vi.hoisted(() => ({
  connection: {} as ConnectionConfig,
  id: "one",
  profile: "research",
  localRead: vi.fn(),
  localWrite: vi.fn(),
  sshRead: vi.fn(),
  sshWrite: vi.fn(),
  remote: vi.fn(),
}));
vi.mock("./config", () => ({
  getConnectionConfig: () => mocks.connection,
  getActiveConnection: () => ({ connectionId: mocks.id }),
}));
vi.mock("./utils", () => ({ getActiveProfileNameSync: () => mocks.profile }));
vi.mock("./tools", () => ({
  getToolsets: mocks.localRead,
  setToolsetEnabled: mocks.localWrite,
}));
vi.mock("./ssh-remote", () => ({
  sshGetToolsets: mocks.sshRead,
  sshSetToolsetEnabled: mocks.sshWrite,
}));
vi.mock("./remote-api", () => ({ remoteDashboardRequestJson: mocks.remote }));
import {
  getSelectedToolsets,
  setSelectedToolsetEnabled,
} from "./tool-settings";

const row = {
  name: "homeassistant",
  label: "Home",
  description: "Devices",
  enabled: false,
  configured: false,
  platform: "cli",
  tools: ["ha_get_state"],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.id = "one";
  mocks.profile = "research";
  mocks.connection = {
    mode: "remote",
    remoteUrl: "https://owned.example",
    apiKey: "owned-token",
    remoteAuthMode: "oauth",
    remoteChatTransport: "auto",
    sshChatTransport: "auto",
    ssh: {
      host: "owned-ssh",
      port: 22,
      username: "user",
      keyPath: "",
      remotePort: 9119,
      localPort: 9119,
    },
  };
});

describe("selected tool-settings isolation", () => {
  // @lat: [[tool-settings#Remote settings isolation]]
  it("keeps dynamic remote metadata and scopes both reads and writes to the same explicit profile", async () => {
    mocks.remote.mockResolvedValueOnce([row]).mockResolvedValueOnce({
      ok: true,
      name: "homeassistant",
      enabled: true,
    });
    expect(await getSelectedToolsets("default")).toEqual(
      [{ ...row, name: undefined, key: row.name }].map(
        ({ name: _name, ...rest }) => rest,
      ),
    );
    await expect(
      setSelectedToolsetEnabled("homeassistant", true, "default"),
    ).resolves.toBe(true);
    expect(mocks.remote.mock.calls[0]).toEqual([
      mocks.connection,
      "/api/tools/toolsets?profile=default",
      { timeoutMs: 15000 },
      "default",
    ]);
    expect(mocks.remote.mock.calls[1][1]).toBe(
      "/api/tools/toolsets/homeassistant?profile=default",
    );
    expect(mocks.remote.mock.calls[1][2]).toEqual({
      method: "PUT",
      body: { enabled: true, profile: "default" },
      timeoutMs: 15000,
    });
    expect(mocks.localRead).not.toHaveBeenCalled();
    expect(mocks.localWrite).not.toHaveBeenCalled();
  });

  it("fails visibly on unsupported/unreachable remote without local fallback or write retry", async () => {
    mocks.remote.mockRejectedValue(new Error("404: unsupported"));
    await expect(getSelectedToolsets()).rejects.toThrow("404");
    await expect(setSelectedToolsetEnabled("web", false)).rejects.toThrow(
      "404",
    );
    expect(mocks.remote).toHaveBeenCalledTimes(2);
    expect(mocks.localRead).not.toHaveBeenCalled();
    expect(mocks.localWrite).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    [row, row],
    [{ ...row, enabled: "false" }],
    [{ ...row, tools: ["../tool"] }],
  ])("rejects malformed metadata %j", async (body) => {
    mocks.remote.mockResolvedValue(body);
    await expect(getSelectedToolsets()).rejects.toThrow("Invalid remote");
  });

  it.each([
    { ok: true },
    { ok: true, name: "web", enabled: false },
    { ok: false, name: "web", enabled: true },
  ])("requires matching mutation acknowledgement %j", async (ack) => {
    mocks.remote.mockResolvedValue(ack);
    await expect(setSelectedToolsetEnabled("web", true)).rejects.toThrow(
      "matching acknowledgement",
    );
    expect(mocks.remote).toHaveBeenCalledTimes(1);
  });

  // @lat: [[tool-settings#Connection changes during requests]]
  it.each(["connection", "profile", "credential"])(
    "rejects a stale result after %s changes",
    async (change) => {
      mocks.remote.mockImplementation(async () => {
        if (change === "connection") mocks.id = "two";
        if (change === "profile") mocks.profile = "other";
        if (change === "credential") mocks.connection.apiKey = "other-token";
        return [row];
      });
      await expect(getSelectedToolsets()).rejects.toThrow("changed");
      // Captured credentials remain bound to the original request.
      expect(mocks.remote.mock.calls[0][0].apiKey).toBe("owned-token");
    },
  );

  it("does not report success or automatically retry after connection changes during a write", async () => {
    mocks.remote.mockImplementation(async () => {
      mocks.id = "two";
      return { ok: true, name: "web", enabled: false };
    });
    await expect(setSelectedToolsetEnabled("web", false)).rejects.toThrow(
      "may have completed",
    );
    expect(mocks.remote).toHaveBeenCalledTimes(1);
    expect(mocks.localWrite).not.toHaveBeenCalled();
  });

  it("routes local and SSH operations to their own selected profile", async () => {
    mocks.connection.mode = "local";
    mocks.localRead.mockReturnValue([]);
    mocks.localWrite.mockReturnValue(true);
    await getSelectedToolsets();
    await setSelectedToolsetEnabled("web", false);
    expect(mocks.localRead).toHaveBeenCalledWith("research");
    expect(mocks.localWrite).toHaveBeenCalledWith("web", false, "research");
    mocks.connection.mode = "ssh";
    mocks.sshRead.mockResolvedValue([]);
    mocks.sshWrite.mockResolvedValue(true);
    await getSelectedToolsets("other");
    await setSelectedToolsetEnabled("web", true, "other");
    expect(mocks.sshRead).toHaveBeenCalledWith(mocks.connection.ssh, "other");
    expect(mocks.sshWrite).toHaveBeenCalledWith(
      mocks.connection.ssh,
      "web",
      true,
      "other",
    );
    expect(mocks.remote).not.toHaveBeenCalled();
  });

  it("rejects aggregate profiles, path-like keys and unconfigured SSH before dispatch", async () => {
    await expect(getSelectedToolsets("all")).rejects.toThrow("single valid");
    await expect(setSelectedToolsetEnabled("../web", true)).rejects.toThrow(
      "Invalid",
    );
    mocks.connection.mode = "ssh";
    mocks.connection.ssh.host = "";
    await expect(getSelectedToolsets()).rejects.toThrow("not configured");
    expect(mocks.localRead).not.toHaveBeenCalled();
    expect(mocks.remote).not.toHaveBeenCalled();
  });
});
