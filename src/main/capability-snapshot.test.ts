import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
const state = vi.hoisted(() => ({
  home: "",
  userData: "",
  context: vi.fn(),
  test: vi.fn(),
  install: vi.fn(),
  resources: {
    getManifest: vi.fn(),
    getChunk: vi.fn(),
    putChunk: vi.fn(),
    putManifest: vi.fn(),
  },
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
  nativeReplicaApply,
  nativeReplicaSnapshot,
} from "./repository-kanban-runtime";
const roots: string[] = [];
afterEach(() => {
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }));
  vi.clearAllMocks();
  state.resources.getManifest.mockReset();
  state.resources.getChunk.mockReset();
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
it("reads owner-profile configuration without duplicating Skill bytes, credentials, paths or execution", async () => {
  setup();
  const result = await nativeCapabilitySnapshot();
  expect(result).toMatchObject({
    userId: "alice",
    profile: "default",
    body: {
      format: "mithril-capability-v2",
      skillStorage: "resources",
      skills: [],
    },
  });
  expect(result.body.toolsets[0].key).toBe("execution");
  expect(result.body.mcps[0].name).toBe("evidence");
  expect(JSON.stringify(result)).not.toContain("PRIVATE_VALUE");
  expect(JSON.stringify(result)).not.toContain("/private/skill");
  expect(state.test).not.toHaveBeenCalled();
  expect(state.install).not.toHaveBeenCalled();
});
it("creates a bounded configuration anchor while duplicate large Skills remain in original directories", async () => {
  setup();
  const content =
    "---\nname: Same display name\n---\n" + "original ".repeat(60000);
  for (const directory of ["first", "second", "third"]) {
    const root = join(state.home, "skills", "research", directory);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "SKILL.md"), content);
  }
  const source = await nativeCapabilitySnapshot();
  expect(JSON.stringify(source).length).toBeLessThan(10000);
  expect(source.body.skills).toEqual([]);
  for (const directory of ["first", "second", "third"])
    expect(
      readFileSync(
        join(state.home, "skills", "research", directory, "SKILL.md"),
        "utf8",
      ),
    ).toBe(content);
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
  const markdown =
    "---\nname: Duplicate display name\n---\n" + "original ".repeat(60000);
  writeFileSync(join(root, "SKILL.md"), markdown);
  const second = join(state.home, "skills", "research", "second-directory");
  mkdirSync(second, { recursive: true });
  writeFileSync(join(second, "SKILL.md"), markdown);
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
    "research/second-directory/SKILL.md",
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

it("applies an owned cloud resource pointer to original native Skills and replays receipts before downloading", async () => {
  setup();
  const { captureSkillResources } = await import("./skill-resource-snapshot");
  const { repositoryFingerprint } =
    await import("@mithril/workspace/repository");
  const { createHash } = await import("node:crypto");
  const native = join(state.home, "skills"),
    remote = join(state.userData, "remote-skills");
  mkdirSync(native);
  mkdirSync(remote);
  writeFileSync(join(native, "SKILL.md"), "# Native original\n");
  writeFileSync(join(remote, "SKILL.md"), "# Cloud edit\n");
  const old = captureSkillResources(
    native,
    "/usr/bin/python3",
    join(state.userData, "captures"),
    "capability-default",
  );
  const target = captureSkillResources(
    remote,
    "/usr/bin/python3",
    join(state.userData, "captures"),
    "capability-default",
  );
  const body = {
    format: "mithril-skill-resources-v1",
    profile: "default",
    capabilityId: "capability-default",
    manifest: target.digest,
  };
  const oldBody = { ...body, manifest: old.digest };
  const expectedRecord = {
    collection: "capability" as const,
    id: "skill-resources-default",
    body: oldBody,
    deleted: false,
    version: createHash("sha256")
      .update(repositoryFingerprint({ body: oldBody, deleted: false }))
      .digest("hex"),
  };
  const write = {
    operationId: "resource-replica-test",
    document: {
      collection: "capability" as const,
      id: expectedRecord.id,
      body,
      deleted: false,
      revision: 2,
      updatedAt: 1,
    },
    expectedRecord,
    expectedVersion: expectedRecord.version,
  };
  state.owner.mockReturnValue(state.resources);
  state.resources.getManifest.mockResolvedValue(target.manifest);
  state.resources.getChunk.mockImplementation((_id: string, digest: string) =>
    target.readChunk(digest),
  );
  const result = await nativeReplicaApply(write);
  expect(result.status).toBe("applied");
  expect(result.record?.body).toEqual(body);
  expect(readFileSync(join(native, "SKILL.md"), "utf8")).toBe("# Cloud edit\n");
  expect(state.owner).toHaveBeenCalledWith("alice");
  const stateRoot = join(state.userData, "repository-skill-transactions");
  const ledger = join(stateRoot, readdirSync(stateRoot)[0]);
  const receiptPath = join(
    ledger,
    readdirSync(ledger).find((name) => name.endsWith(".json"))!,
  );
  const saved = JSON.parse(readFileSync(receiptPath, "utf8"));
  writeFileSync(receiptPath, JSON.stringify({ ...saved, state: "pending" }));
  await expect(nativeCapabilitySnapshot()).rejects.toThrow("recovery required");
  const unavailable = await nativeReplicaSnapshot();
  expect(unavailable.recoveryRecords).toEqual([
    { collection: "capability", id: "skill-resources-default" },
  ]);
  expect(
    unavailable.documents.some(
      (record) =>
        record.id === "skill-resources-default" ||
        record.id === "capability-default",
    ),
  ).toBe(false);
  writeFileSync(receiptPath, JSON.stringify(saved));
  state.resources.getManifest.mockRejectedValue(Error("offline"));
  writeFileSync(join(native, "SKILL.md"), "# Later original edit\n");
  expect((await nativeReplicaApply(write)).status).toBe("applied");
  expect(state.resources.getManifest).toHaveBeenCalledTimes(1);
  expect(readFileSync(join(native, "SKILL.md"), "utf8")).toBe(
    "# Later original edit\n",
  );
  await expect(
    nativeReplicaApply({
      ...write,
      document: { ...write.document, body: oldBody },
    }),
  ).rejects.toThrow("reused");
  expect(state.install).not.toHaveBeenCalled();
  expect(state.test).not.toHaveBeenCalled();
  old.dispose();
  target.dispose();
});
