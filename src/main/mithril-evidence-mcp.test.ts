import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  token: "mf_x" as string | null,
  remote: false,
  exists: true,
  servers: [] as { name: string }[],
}));

vi.mock("fs", () => {
  const existsSync = vi.fn(() => state.exists);
  return { existsSync, default: { existsSync } };
});
vi.mock("./installer", () => ({
  HERMES_PYTHON: "/h/venv/bin/python",
  HERMES_REPO: "/h/hermes-agent",
}));
vi.mock("./mithril-token-store", () => ({
  readMithrilToken: vi.fn(() => state.token),
}));
vi.mock("./hermes", () => ({ isRemoteMode: vi.fn(() => state.remote) }));
const addMcpServer = vi.hoisted(() => vi.fn(async () => ({ success: true })));
vi.mock("./mcp-servers", () => ({
  addMcpServer,
  listMcpServers: vi.fn(async () => state.servers),
}));

import {
  installMithrilEvidenceMcp,
  mithrilEvidenceServerInput,
  mithrilEvidenceServerScript,
} from "./mithril-evidence-mcp";

beforeEach(() => {
  Object.assign(state, {
    token: "mf_x",
    remote: false,
    exists: true,
    servers: [],
  });
  addMcpServer.mockClear();
});

describe("mithril evidence MCP registration", () => {
  it("builds a stdio entry that references the token instead of holding it", () => {
    const input = mithrilEvidenceServerInput("/py", "/s/server.py");
    expect(input).toEqual({
      name: "mithril-evidence",
      type: "stdio",
      command: "/py",
      args: ["/s/server.py"],
      env: { MITHRIL_API_TOKEN: "${MITHRIL_API_KEY}" },
    });
    expect(JSON.stringify(input)).not.toMatch(/mf_[A-Za-z0-9]{8,}/);
    expect(mithrilEvidenceServerScript("/r")).toBe(
      "/r/mcp/mithril-fund/server.py",
    );
  });

  it("adds the entry when connected and the server file exists", async () => {
    await expect(installMithrilEvidenceMcp()).resolves.toEqual({
      success: true,
    });
    expect(addMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "mithril-evidence",
        command: "/h/venv/bin/python",
      }),
      undefined,
    );
  });

  it.each([
    ["no Mithril token", { token: null }, /Connect your Mithril account/],
    ["remote mode", { remote: true }, /this computer only/],
    [
      "missing server file",
      { exists: false },
      /does not include the Mithril evidence tools/,
    ],
    [
      "already added",
      { servers: [{ name: "mithril-evidence" }] },
      /already added/,
    ],
  ])("refuses with %s and writes nothing", async (_n, patch, message) => {
    Object.assign(state, patch);
    const result = await installMithrilEvidenceMcp();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(message);
    expect(addMcpServer).not.toHaveBeenCalled();
  });
});
