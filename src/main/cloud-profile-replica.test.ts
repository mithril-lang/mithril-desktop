// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  capabilityResourceManifestBytes,
  type CapabilityResourceTransport,
} from "@mithril/workspace/capability-resources";
import { uploadProfileMetadata } from "@mithril/workspace/profile-resources";
import type {
  JsonValue,
  RepositoryDocument,
} from "@mithril/workspace/repository";
import type { ReplicaWrite } from "@mithril/workspace/replica-sync";
const runtime = vi.hoisted(() => ({
  home: "",
  state: "",
  context: { profile: "default", userId: "alice" },
  resources: null as CapabilityResourceTransport | null,
  invalid: false,
  rows: [] as RepositoryDocument[],
}));
vi.mock("electron", () => ({ app: { getPath: () => runtime.state } }));
vi.mock("./utils", () => ({ profileHome: () => runtime.home }));
vi.mock("./installer", () => ({
  get HERMES_HOME() {
    return runtime.home;
  },
}));
vi.mock("./config", () => ({ getConnectionConfig: () => ({ mode: "local" }) }));
vi.mock("./cloud-workspace-runtime", () => ({
  cloudWorkspace: {
    nativeContext: async () => runtime.context,
    assertNativeContext: () => {
      if (runtime.invalid) throw Error("Workspace identity changed");
    },
    repositoryPage: async () => ({
      schemaVersion: 1,
      userId: "alice",
      documents: runtime.rows,
      nextAfter: null,
    }),
    get profileResources() {
      return runtime.resources;
    },
  },
}));
import {
  nativeReplicaApply,
  nativeReplicaSnapshot,
  bindRepositorySource,
} from "./repository-kanban-runtime";
const roots: string[] = [];
afterEach(() => {
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }));
  runtime.invalid = false;
  runtime.rows = [];
});
async function fixture(): Promise<ReplicaWrite> {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-cloud-replica-")),
  );
  roots.push(root);
  runtime.home = join(root, "home");
  runtime.state = join(root, "state");
  mkdirSync(runtime.home);
  mkdirSync(runtime.state);
  const objects = new Map<string, Uint8Array>();
  const hash = (bytes: Uint8Array): string =>
    createHash("sha256").update(bytes).digest("hex");
  const scoped = (owner: string): CapabilityResourceTransport => ({
    forOwner: scoped,
    async hasChunk(id, digest, size) {
      return objects.get(`${owner}/${id}/${digest}`)?.length === size;
    },
    async putChunk(id, bytes) {
      const digest = hash(bytes);
      objects.set(`${owner}/${id}/${digest}`, bytes);
      return digest;
    },
    async getChunk(id, digest) {
      const bytes = objects.get(`${owner}/${id}/${digest}`);
      if (!bytes) throw Error("not_found");
      return bytes;
    },
    async putManifest(manifest) {
      const bytes = capabilityResourceManifestBytes(manifest),
        digest = hash(bytes);
      objects.set(`${owner}/${manifest.capabilityId}/${digest}`, bytes);
      return digest;
    },
    async getManifest(id, digest) {
      const bytes = objects.get(`${owner}/${id}/${digest}`);
      if (!bytes) throw Error("not_found");
      return JSON.parse(new TextDecoder().decode(bytes));
    },
  });
  runtime.resources = scoped("unbound");
  const pointer = await uploadProfileMetadata(
    runtime.resources,
    "alice",
    "research",
    Buffer.from('{"name":"Cloud research","opaque":9223372036854775807}'),
  );
  return {
    operationId: "first-copy",
    document: {
      collection: "profile",
      id: "profile-metadata-research",
      body: pointer as unknown as JsonValue,
      deleted: false,
      revision: 1,
      updatedAt: 1,
    },
    expectedRecord: null,
    expectedVersion: null,
  };
}
// @lat: [[cloud-workspace-tests#Cloud workspace tests#Cloud profile replica materialization]]
it("restores real owner-scoped metadata through the Native replica transport and never resurrects its deleted working copy", async () => {
  const write = await fixture();
  const result = await nativeReplicaApply(write);
  expect(result.status).toBe("applied");
  const root = join(runtime.home, "profiles", "research");
  expect(readFileSync(join(root, "profile-meta.json"), "utf8")).toBe(
    '{"name":"Cloud research","opaque":9223372036854775807}',
  );
  expect(readdirSync(root)).toEqual(["profile-meta.json"]);
  const resources = runtime.resources!;
  runtime.resources = {
    ...resources,
    forOwner: () => ({
      ...resources,
      getManifest: async () => {
        throw Error("resource unavailable");
      },
    }),
  };
  expect((await nativeReplicaApply(write)).status).toBe("applied");
  runtime.resources = resources;
  rmSync(root, { recursive: true });
  expect((await nativeReplicaApply(write)).status).toBe("deferred");
  expect(existsSync(root)).toBe(false);
});
// @lat: [[cloud-workspace-tests#Cloud workspace tests#Cloud profile replica resource failure]]
it("does not create a profile when owner-scoped resources fail verification or identity changes", async () => {
  const write = await fixture();
  const resources = runtime.resources!;
  runtime.resources = {
    ...resources,
    forOwner: () => ({
      ...resources,
      getManifest: async () => {
        throw Error("resource unavailable");
      },
    }),
  };
  await expect(nativeReplicaApply(write)).rejects.toThrow();
  expect(existsSync(join(runtime.home, "profiles", "research"))).toBe(false);
  runtime.resources = resources;
  runtime.invalid = true;
  await expect(nativeReplicaApply(write)).rejects.toThrow(
    "Workspace identity changed",
  );
  expect(existsSync(join(runtime.home, "profiles", "research"))).toBe(false);
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Cloud profile replica scope]]
it("admits remote-only profiles into the actual snapshot scope without admitting foreign original sources", async () => {
  const write = await fixture();
  runtime.rows = [write.document];
  let snapshot = await nativeReplicaSnapshot();
  expect(
    snapshot.recordScopes?.find((scope) => scope.collection === "profile")?.ids,
  ).toContain("profile-metadata-research");
  bindRepositorySource(
    join(runtime.state, "repository-source-owners"),
    "research",
    "bob",
  );
  snapshot = await nativeReplicaSnapshot();
  expect(
    snapshot.recordScopes?.find((scope) => scope.collection === "profile")?.ids,
  ).not.toContain("profile-metadata-research");
});
