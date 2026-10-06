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
  resources: { getManifest: vi.fn(), putChunk: vi.fn(), putManifest: vi.fn() },
  owner: vi.fn(),
}));
vi.mock("electron", () => ({ app: { getPath: () => state.userData } }));
vi.mock("./utils", () => ({ profileHome: () => state.home }));
vi.mock("./config", () => ({ getConnectionConfig: () => ({ mode: "local" }) }));
vi.mock("./cloud-workspace-runtime", () => ({
  cloudWorkspace: {
    nativeContext: state.context,
    capabilityResources: { forOwner: state.owner },
  },
}));
vi.mock("./installer", () => ({ HERMES_PYTHON: "/usr/bin/python3" }));
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
import {
  nativeSkillResourceSnapshot,
  nativeCapabilitySnapshot,
} from "./repository-kanban-runtime";
const roots: string[] = [];
afterEach(() => {
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }));
  vi.clearAllMocks();
  state.resources.getManifest.mockReset();
  state.resources.putChunk.mockReset();
  state.resources.putManifest.mockReset();
  state.owner.mockReset();
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

it("feeds original Skill resources into a separate repository pointer without execution or device paths", async () => {
  setup();
  const { digestBytes } = await import("@mithril/workspace/files");
  const { capabilityResourceManifestBytes } =
    await import("@mithril/workspace/capability-resources");
  const root = join(state.home, "skills", "research", "actual-directory");
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "SKILL.md"), "# Original\nSee assets/input.bin\n");
  writeFileSync(join(root, "assets", "input.bin"), new Uint8Array([0, 255, 3]));
  state.owner.mockReturnValue(state.resources);
  state.resources.getManifest.mockRejectedValue(
    Error("Capability resource request failed (404)"),
  );
  state.resources.putChunk.mockImplementation(
    (id: string, bytes: Uint8Array) => {
      expect(id).toBe("capability-default");
      return digestBytes(bytes);
    },
  );
  state.resources.putManifest.mockImplementation((manifest) =>
    digestBytes(capabilityResourceManifestBytes(manifest)),
  );
  const result = await nativeSkillResourceSnapshot();
  expect(result).toMatchObject({
    collection: "capability",
    id: "skill-resources-default",
    deleted: false,
    body: {
      format: "mithril-skill-resources-v1",
      profile: "default",
      capabilityId: "capability-default",
    },
  });
  expect(JSON.stringify(result)).not.toContain(state.home);
  expect(state.owner).toHaveBeenCalledWith("alice");
  expect(state.resources.putChunk).toHaveBeenCalledTimes(2);
  expect(
    state.resources.putManifest.mock.calls[0][0].files.map((file) => file.path),
  ).toEqual([
    "research/actual-directory/SKILL.md",
    "research/actual-directory/assets/input.bin",
  ]);
  expect(state.test).not.toHaveBeenCalled();
  expect(state.install).not.toHaveBeenCalled();
});

it("abandons pointer publication on identity changes during resource upload while retaining native files", async () => {
  setup();
  const root = join(state.home, "skills", "research", "actual-directory");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "SKILL.md"), "# Retain original\n");
  state.owner.mockReturnValue(state.resources);
  state.resources.getManifest.mockRejectedValue(
    Error("Capability resource request failed (404)"),
  );
  const { digestBytes } = await import("@mithril/workspace/files");
  state.resources.putChunk.mockImplementation(
    (_id: string, bytes: Uint8Array) => {
      state.context.mockResolvedValue({ userId: "bob", profile: "default" });
      return digestBytes(bytes);
    },
  );
  await expect(nativeSkillResourceSnapshot()).rejects.toThrow(
    "identity changed",
  );
  expect(state.resources.putManifest).not.toHaveBeenCalled();
  const { readFileSync, readdirSync } = await import("node:fs");
  expect(readFileSync(join(root, "SKILL.md"), "utf8")).toBe(
    "# Retain original\n",
  );
  expect(
    readdirSync(join(state.userData, "repository-skill-captures")),
  ).toEqual([]);
});
