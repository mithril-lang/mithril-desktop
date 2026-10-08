// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReplicaRecord } from "@mithril/workspace/replica-sync";
import { ProfileMetadataReplica } from "./profile-metadata-replica";
const roots: string[] = [];
const hash = (bytes: string | Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");
const bytes = Buffer.from(
  '\ufeff{\r\n"opaque":9223372036854775807,"name":"cloud"\r\n}',
);
const record: ReplicaRecord = {
  collection: "profile",
  id: "profile-metadata-research",
  body: {
    format: "mithril-profile-metadata-v1",
    profile: "research",
    resourceId: "profile-metadata-" + hash(JSON.stringify(["research"])),
    manifest: "a".repeat(64),
    digest: hash(bytes),
    size: bytes.length,
  },
  deleted: false,
  version: "version-1",
};
function fixture(): {
  root: string;
  directory: string;
  scope: { owner: string; profile: string; root: string };
  store: ProfileMetadataReplica;
  path: string;
} {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-profile-replica-")),
  );
  roots.push(root);
  const directory = join(root, "journal");
  const scope = { owner: "alice", profile: "research", root };
  const store = new ProfileMetadataReplica(directory, scope);
  return {
    root,
    directory,
    scope,
    store,
    path: join(
      directory,
      hash(JSON.stringify([scope.owner, scope.profile, root])) + ".sqlite",
    ),
  };
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function interrupt(f: ReturnType<typeof fixture>, applied: boolean): void {
  f.store.recover(); // Initialize the real SQLite schema.
  const db = new Database(f.path);
  db.prepare("INSERT INTO profile_operations VALUES (?,?,?,?,?,'pending')").run(
    "op",
    "b".repeat(64),
    null,
    bytes,
    JSON.stringify(record),
  );
  db.close();
  if (applied) writeFileSync(join(f.root, "profile-meta.json"), bytes);
}
// @lat: [[cloud-workspace-tests#Profile metadata durable interruption recovery]]
it("recovers interruptions both before and after the native rename with exact original bytes", () => {
  for (const applied of [false, true]) {
    const f = fixture();
    interrupt(f, applied);
    const restarted = new ProfileMetadataReplica(f.directory, f.scope);
    expect(restarted.recover()).toEqual([record]);
    expect(readFileSync(join(f.root, "profile-meta.json")).equals(bytes)).toBe(
      true,
    );
    expect(restarted.recover()).toEqual([]);
  }
});
// @lat: [[cloud-workspace-tests#Profile metadata durable receipt replay]]
it("returns the completed receipt after restart without overwriting a later appearance edit", () => {
  const f = fixture();
  expect(f.store.apply("op", "b".repeat(64), null, bytes, record)).toEqual(
    record,
  );
  const path = join(f.root, "profile-meta.json");
  writeFileSync(path, '{"name":"new local edit"}');
  const restarted = new ProfileMetadataReplica(f.directory, f.scope);
  expect(restarted.receipt("op", "b".repeat(64))).toEqual(record);
  expect(restarted.apply("op", "b".repeat(64), null, bytes, record)).toEqual(
    record,
  );
  expect(readFileSync(path, "utf8")).toBe('{"name":"new local edit"}');
  expect(() =>
    restarted.apply("op", "c".repeat(64), null, bytes, record),
  ).toThrow("reused");
});
// @lat: [[cloud-workspace-tests#Profile metadata interrupted restoration conflict]]
it("retains an interrupted operation and newer local data instead of adopting it as a successful restore", () => {
  const f = fixture();
  interrupt(f, false);
  const path = join(f.root, "profile-meta.json");
  writeFileSync(path, '{"name":"newer"}');
  expect(() => f.store.recover()).toThrow("conflict");
  const db = new Database(f.path);
  expect(db.prepare("SELECT state FROM profile_operations").get()).toEqual({
    state: "pending",
  });
  db.close();
  expect(readFileSync(path, "utf8")).toBe('{"name":"newer"}');
  const foreign = new ProfileMetadataReplica(f.directory, {
    ...f.scope,
    owner: "bob",
  });
  expect(foreign.recover()).toEqual([]);
});
// @lat: [[cloud-workspace-tests#Profile metadata receipt binds target bytes]]
it("rejects a mismatched target or foreign profile receipt before creating any native file", () => {
  const f = fixture();
  expect(() =>
    f.store.apply("op", "b".repeat(64), null, Buffer.from("{}"), record),
  ).toThrow("differs");
  expect(() =>
    f.store.apply("op", "b".repeat(64), null, bytes, {
      ...record,
      id: "profile-metadata-foreign",
    }),
  ).toThrow("receipt");
});

// @lat: [[cloud-workspace-tests#Profile metadata durable tombstone restoration]]
it("retains a physical deletion receipt across restart without deleting a later recreation", () => {
  const f = fixture(),
    path = join(f.root, "profile-meta.json");
  writeFileSync(path, bytes);
  const deleted = { ...record, deleted: true, version: "deleted-1" };
  expect(f.store.apply("delete", "d".repeat(64), bytes, null, deleted)).toEqual(
    deleted,
  );
  const restarted = new ProfileMetadataReplica(f.directory, f.scope);
  expect(restarted.receipt("delete", "d".repeat(64))).toEqual(deleted);
  writeFileSync(path, '{"name":"recreated"}');
  expect(
    restarted.apply("delete", "d".repeat(64), bytes, null, deleted),
  ).toEqual(deleted);
  expect(readFileSync(path, "utf8")).toBe('{"name":"recreated"}');
});
