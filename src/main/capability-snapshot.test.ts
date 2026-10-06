import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
const state = vi.hoisted(() => ({
  home: "",
  userData: "",
  context: vi.fn(),
  test: vi.fn(),
  install: vi.fn(),
}));
vi.mock("electron", () => ({ app: { getPath: () => state.userData } }));
vi.mock("./utils", () => ({ profileHome: () => state.home }));
vi.mock("./config", () => ({ getConnectionConfig: () => ({ mode: "local" }) }));
vi.mock("./cloud-workspace-runtime", () => ({
  cloudWorkspace: { nativeContext: state.context },
}));
vi.mock("./tools", () => ({
  getToolsets: () => [
    {
      key: "execution",
      label: "Original execution",
      description: "Retained",
      enabled: true,
    },
  ],
}));
vi.mock("./mcp-servers", () => ({
  listMcpServers: async () => [
    {
      name: "evidence",
      type: "http",
      transport: "http",
      detail: "Evidence",
      enabled: true,
      url: "https://example.com/mcp",
      command: undefined,
      args: [],
      env: { API_TOKEN: "PRIVATE_VALUE" },
      auth: "PRIVATE_AUTH",
    },
  ],
  testMcpServer: state.test,
}));
vi.mock("./skills", () => ({
  listInstalledSkills: () => [
    {
      name: "Evidence",
      category: "research",
      description: "Original",
      path: "/private/skill",
    },
  ],
  getSkillContent: () => "# Full evidence\n" + "retained ".repeat(900),
  installSkill: state.install,
}));
import { nativeCapabilitySnapshot } from "./repository-kanban-runtime";
const roots: string[] = [];
afterEach(() => {
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }));
  vi.clearAllMocks();
});
function setup(): void {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-capability-source-")),
  );
  roots.push(root);
  state.home = join(root, "profile");
  state.userData = join(root, "app");
  mkdirSync(state.home);
  mkdirSync(state.userData);
  writeFileSync(join(state.home, "config.yaml"), "# Original source\n");
  state.context.mockResolvedValue({ userId: "alice", profile: "default" });
}
// @lat: [[cloud-workspace-tests#Cloud workspace tests#Capability snapshot identity]]
it("reads full owner-profile capability data without credentials, paths or execution", async () => {
  setup();
  const result = await nativeCapabilitySnapshot();
  expect(result).toMatchObject({
    userId: "alice",
    profile: "default",
    body: { skills: [{ name: "Evidence" }] },
  });
  expect(result.body.skills[0].content.length).toBeGreaterThan(4000);
  expect(JSON.stringify(result)).not.toContain("PRIVATE_VALUE");
  expect(JSON.stringify(result)).not.toContain("/private/skill");
  expect(state.test).not.toHaveBeenCalled();
  expect(state.install).not.toHaveBeenCalled();
});
it("rejects an identity change during a source read", async () => {
  setup();
  state.context
    .mockResolvedValueOnce({ userId: "alice", profile: "default" })
    .mockResolvedValueOnce({ userId: "bob", profile: "default" });
  await expect(nativeCapabilitySnapshot()).rejects.toThrow("identity");
});
