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
  guard: vi.fn(),
  toolProfiles: [] as string[],
}));
vi.mock("electron", () => ({ app: { getPath: () => state.userData } }));
vi.mock("./utils", () => ({
  profileHome: (profile: string) =>
    profile === "default" ? state.home : join(state.home, "profiles", profile),
}));
vi.mock("./config", () => ({ getConnectionConfig: () => ({ mode: "local" }) }));
vi.mock("./cloud-workspace-runtime", () => ({
  cloudWorkspace: {
    nativeContext: state.context,
    assertNativeContext: state.guard,
    capabilityResources: { forOwner: state.owner },
  },
}));
vi.mock("./installer", () => ({
  HERMES_PYTHON: "/usr/bin/python3",
  get HERMES_HOME() {
    return state.home;
  },
}));
vi.mock("./tools", () => ({
  getToolsets: (profile: string) => {
    state.toolProfiles.push(profile);
    return [
      {
        key: "execution",
        label: "Original execution",
        description: "Retained",
        enabled: true,
      },
    ];
  },
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
  state.toolProfiles.splice(0);
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
// @lat: [[cloud-workspace-tests#All-profile Capability configuration capture]]
it("captures each owned original Capability profile while retaining foreign source isolation and active selection", async () => {
  setup();
  for (const profile of ["research", "empty", "foreign"]) {
    const home = join(state.home, "profiles", profile);
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "config.yaml"), "# Original " + profile + "\n");
  }
  const { bindRepositorySource } = await import("./repository-kanban-runtime");
  bindRepositorySource(
    join(state.userData, "repository-source-owners"),
    "foreign",
    "bob",
  );
  writeFileSync(join(state.home, "active_profile"), "default\n");
  const snapshot = await nativeReplicaSnapshot();
  const configurations = snapshot.documents.filter(
    (row) =>
      row.collection === "capability" && row.id.startsWith("capability-"),
  );
  expect(configurations.map((row) => row.id).sort()).toEqual([
    "capability-default",
    "capability-empty",
    "capability-research",
  ]);
  expect(state.toolProfiles).toEqual(["default", "empty", "research"]);
  expect(readFileSync(join(state.home, "active_profile"), "utf8")).toBe(
    "default\n",
  );
  expect(JSON.stringify(configurations)).not.toContain("PRIVATE_VALUE");
  expect(state.test).not.toHaveBeenCalled();
  expect(state.install).not.toHaveBeenCalled();
});
// @lat: [[cloud-workspace-tests#All-profile Skill resource capture]]
it("publishes distinct original Skill resources for every owned profile", async () => {
  setup();
  const { digestBytes } = await import("@mithril/workspace/files");
  const { capabilityResourceManifestBytes } =
    await import("@mithril/workspace/capability-resources");
  state.owner.mockReturnValue(state.resources);
  state.resources.getManifest.mockRejectedValue(
    Error("Capability resource request failed (404)"),
  );
  state.resources.putChunk.mockImplementation(
    (_id: string, bytes: Uint8Array) => digestBytes(bytes),
  );
  state.resources.putManifest.mockImplementation((manifest) =>
    digestBytes(capabilityResourceManifestBytes(manifest)),
  );
  for (const profile of ["default", "research"]) {
    const home =
      profile === "default"
        ? state.home
        : join(state.home, "profiles", profile);
    mkdirSync(join(home, "skills"), { recursive: true });
    writeFileSync(join(home, "skills", "SKILL.md"), `# Original ${profile}\n`);
  }
  const snapshot = await nativeReplicaSnapshot();
  const pointers = snapshot.documents.filter((row) =>
    row.id.startsWith("skill-resources-"),
  );
  expect(pointers.map((row) => row.id).sort()).toEqual([
    "skill-resources-default",
    "skill-resources-research",
  ]);
  expect(
    state.resources.putManifest.mock.calls
      .map(([manifest]) => manifest.capabilityId)
      .sort(),
  ).toEqual(["capability-default", "capability-research"]);
  expect(
    state.resources.putChunk.mock.calls.map(([id, bytes]) => [
      id,
      new TextDecoder().decode(bytes),
    ]),
  ).toEqual([
    ["capability-default", "# Original default\n"],
    ["capability-research", "# Original research\n"],
  ]);
  expect(state.install).not.toHaveBeenCalled();
});
// @lat: [[cloud-workspace-tests#All-profile Capability restore targets its original profile]]
it("restores a cloud Capability change to its owned research profile without changing the active default configuration", async () => {
  setup();
  const home = join(state.home, "profiles", "research");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "config.yaml"), "# Research original\n");
  const snapshot = await nativeReplicaSnapshot();
  const original = snapshot.documents.find(
    (row) => row.id === "capability-research",
  )!;
  type Configuration = { toolsets: { enabled: boolean }[] };
  const target = structuredClone(original.body);
  (target as unknown as Configuration).toolsets[0].enabled = false;
  const result = await nativeReplicaApply({
    operationId: "research-config-edit",
    expectedRecord: original,
    expectedVersion: original.version,
    document: {
      collection: "capability",
      id: original.id,
      body: target,
      deleted: false,
      revision: 2,
      updatedAt: 1,
    },
  });
  expect(result.status).toBe("applied");
  expect(readFileSync(join(state.home, "config.yaml"), "utf8")).toBe(
    "# Original source\n",
  );
  expect(readFileSync(join(home, "config.yaml"), "utf8")).not.toBe(
    "# Research original\n",
  );
  expect(state.install).not.toHaveBeenCalled();
});
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

// @lat: [[cloud-workspace-tests#Skill resource upload preserves concurrent original edits]]
it("refuses a stale pointer if original Skill bytes change while uploading", async () => {
  setup();
  const root = join(state.home, "skills");
  mkdirSync(root);
  const file = join(root, "SKILL.md");
  writeFileSync(file, "# Before upload\n");
  const { digestBytes } = await import("@mithril/workspace/files");
  const { capabilityResourceManifestBytes } =
    await import("@mithril/workspace/capability-resources");
  state.owner.mockReturnValue(state.resources);
  state.resources.getManifest.mockRejectedValue(
    Error("Capability resource request failed (404)"),
  );
  state.resources.putChunk.mockImplementation(
    (_id: string, bytes: Uint8Array) => {
      writeFileSync(file, "# Edited during upload\n");
      return digestBytes(bytes);
    },
  );
  state.resources.putManifest.mockImplementation((manifest) =>
    digestBytes(capabilityResourceManifestBytes(manifest)),
  );
  await expect(nativeSkillResourceSnapshot()).rejects.toThrow(
    "files changed during upload",
  );
  expect(readFileSync(file, "utf8")).toBe("# Edited during upload\n");
  expect(
    readdirSync(join(state.userData, "repository-skill-captures")),
  ).toEqual([]);
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

it.each(["default", "research"])(
  "applies owned cloud Skills to %s and replays receipts before downloading",
  async (profile) => {
    setup();
    const { captureSkillResources } = await import("./skill-resource-snapshot");
    const { repositoryFingerprint } =
      await import("@mithril/workspace/repository");
    const { createHash } = await import("node:crypto");
    const home =
      profile === "default"
        ? state.home
        : join(state.home, "profiles", profile);
    mkdirSync(home, { recursive: true });
    const native = join(home, "skills"),
      remote = join(state.userData, "remote-skills");
    mkdirSync(native);
    mkdirSync(remote);
    writeFileSync(join(native, "SKILL.md"), "# Native original\n");
    writeFileSync(join(remote, "SKILL.md"), "# Cloud edit\n");
    const old = captureSkillResources(
      native,
      "/usr/bin/python3",
      join(state.userData, "captures"),
      `capability-${profile}`,
    );
    const target = captureSkillResources(
      remote,
      "/usr/bin/python3",
      join(state.userData, "captures"),
      `capability-${profile}`,
    );
    const body = {
      format: "mithril-skill-resources-v1",
      profile,
      capabilityId: `capability-${profile}`,
      manifest: target.digest,
    };
    const oldBody = { ...body, manifest: old.digest };
    const expectedRecord = {
      collection: "capability" as const,
      id: `skill-resources-${profile}`,
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
    expect(readFileSync(join(native, "SKILL.md"), "utf8")).toBe(
      "# Cloud edit\n",
    );
    expect(state.owner).toHaveBeenCalledWith("alice");
    const stateRoot = join(state.userData, "repository-skill-transactions");
    const ledger = join(stateRoot, readdirSync(stateRoot)[0]);
    const receiptPath = join(
      ledger,
      readdirSync(ledger).find((name) => name.endsWith(".json"))!,
    );
    const saved = JSON.parse(readFileSync(receiptPath, "utf8"));
    writeFileSync(receiptPath, JSON.stringify({ ...saved, state: "pending" }));
    if (profile === "default")
      await expect(nativeCapabilitySnapshot()).rejects.toThrow(
        "recovery required",
      );
    else expect((await nativeCapabilitySnapshot()).profile).toBe("default");
    const unavailable = await nativeReplicaSnapshot();
    expect(unavailable.recoveryRecords).toEqual([
      { collection: "capability", id: `skill-resources-${profile}` },
    ]);
    expect(
      unavailable.documents.some(
        (record) =>
          record.id === `skill-resources-${profile}` ||
          record.id === `capability-${profile}`,
      ),
    ).toBe(false);
    writeFileSync(receiptPath, JSON.stringify(saved));
    const downloadsBeforeReplay = state.resources.getManifest.mock.calls.length;
    state.resources.getManifest.mockRejectedValue(Error("offline"));
    writeFileSync(join(native, "SKILL.md"), "# Later original edit\n");
    expect((await nativeReplicaApply(write)).status).toBe("applied");
    expect(state.resources.getManifest).toHaveBeenCalledTimes(
      downloadsBeforeReplay,
    );
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
  },
);
