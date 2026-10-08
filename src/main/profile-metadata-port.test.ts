// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
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
import {
  capabilityResourceManifestBytes,
  type CapabilityResourceTransport,
} from "@mithril/workspace/capability-resources";
import { uploadProfileMetadata } from "@mithril/workspace/profile-resources";
import type { ReplicaWrite } from "@mithril/workspace/replica-sync";
import type { JsonValue } from "@mithril/workspace/repository";
import { ProfileMetadataPort } from "./profile-metadata-port";
const roots: string[] = [];
const hash = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
function fixture(): {
  root: string;
  resources: CapabilityResourceTransport;
  port: ProfileMetadataPort;
  guard: ReturnType<typeof vi.fn>;
  downloading: { hook: () => void };
} {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-profile-port-")),
  );
  roots.push(root);
  const objects = new Map<string, Uint8Array>();
  const downloading = { hook: (): void => {} };
  const scoped = (owner: string): CapabilityResourceTransport => ({
    forOwner: scoped,
    async hasChunk(id, digest, size) {
      return objects.get(`${owner}/${id}/${digest}`)?.length === size;
    },
    async putChunk(id, bytes) {
      const digest = hash(bytes);
      objects.set(`${owner}/${id}/${digest}`, new Uint8Array(bytes));
      return digest;
    },
    async getChunk(id, digest) {
      downloading.hook();
      const bytes = objects.get(`${owner}/${id}/${digest}`);
      if (!bytes) throw Error("not_found");
      return new Uint8Array(bytes);
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
  const resources = scoped("unbound");
  const guard = vi.fn(async (): Promise<void> => {});
  return {
    root,
    resources,
    guard,
    downloading,
    port: new ProfileMetadataPort(
      { owner: "alice", profile: "research", root, replicaId: "device" },
      join(root, "journal"),
      resources,
      guard,
    ),
  };
}
function write(
  body: JsonValue,
  expected: Awaited<ReturnType<ProfileMetadataPort["snapshot"]>>,
  operationId = "download",
  deleted = false,
): ReplicaWrite {
  return {
    operationId,
    document: {
      collection: "profile",
      id: "profile-metadata-research",
      body,
      deleted,
      revision: 1,
      updatedAt: 1,
    },
    expectedVersion: expected?.version ?? null,
    expectedRecord: expected,
  };
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
// @lat: [[cloud-workspace-tests#Profile metadata replica resource roundtrip]]
it("captures original metadata, applies cloud bytes, replays a receipt, and preserves a subsequent original edit", async () => {
  const f = fixture(),
    path = join(f.root, "profile-meta.json");
  writeFileSync(path, '{"name":"local","opaque":9223372036854775807}');
  const original = await f.port.snapshot();
  expect(original?.collection).toBe("profile");
  const bytes = Buffer.from(
    '\ufeff{\r\n"name":"cloud","opaque":9223372036854775807\r\n}',
  );
  const pointer = await uploadProfileMetadata(
    f.resources,
    "alice",
    "research",
    bytes,
  );
  const request = write(pointer as unknown as JsonValue, original);
  const first = await f.port.apply(request);
  expect(first.status).toBe("applied");
  expect(readFileSync(path).equals(bytes)).toBe(true);
  writeFileSync(path, '{"name":"later"}');
  expect(await f.port.apply(request)).toEqual(first);
  expect(readFileSync(path, "utf8")).toBe('{"name":"later"}');
});
// @lat: [[cloud-workspace-tests#Profile metadata download fences edits and identity]]
it("refuses a local edit or changed authorization during resource download", async () => {
  const f = fixture(),
    path = join(f.root, "profile-meta.json");
  writeFileSync(path, '{"name":"local"}');
  const original = await f.port.snapshot();
  const pointer = await uploadProfileMetadata(
    f.resources,
    "alice",
    "research",
    Buffer.from('{"name":"cloud"}'),
  );
  f.downloading.hook = () =>
    writeFileSync(path, '{"name":"edited during download"}');
  expect(
    (await f.port.apply(write(pointer as unknown as JsonValue, original)))
      .status,
  ).toBe("conflict");
  expect(readFileSync(path, "utf8")).toBe('{"name":"edited during download"}');
  const current = await f.port.snapshot();
  f.downloading.hook = () => {
    f.guard.mockRejectedValue(Error("Workspace identity changed"));
  };
  await expect(
    f.port.apply(write(pointer as unknown as JsonValue, current, "new-op")),
  ).rejects.toThrow("identity");
  expect(readFileSync(path, "utf8")).toBe('{"name":"edited during download"}');
});
// @lat: [[cloud-workspace-tests#Profile metadata replica tombstone baseline]]
it("keeps the physical deletion as a stable native tombstone and rejects foreign profile documents", async () => {
  const f = fixture(),
    path = join(f.root, "profile-meta.json");
  writeFileSync(path, '{"name":"local"}');
  const original = await f.port.snapshot();
  const result = await f.port.apply(
    write(original!.body, original, "delete", true),
  );
  expect(result.status).toBe("applied");
  expect(await f.port.snapshot()).toEqual(result.record);
  await expect(
    f.port.apply({
      ...write({}, null),
      document: { ...write({}, null).document, id: "profile-metadata-other" },
    }),
  ).rejects.toThrow("Foreign");
});

// @lat: [[cloud-workspace-tests#Deleted original profile is never recreated by metadata download]]
it("defers metadata restoration when the original directory is deleted before or during download", async () => {
  for (const duringDownload of [false, true]) {
    const f = fixture();
    const pointer = await uploadProfileMetadata(
      f.resources,
      "alice",
      "research",
      Buffer.from('{"name":"cloud"}'),
    );
    const remove = (): void => rmSync(f.root, { recursive: true, force: true });
    if (duringDownload) f.downloading.hook = remove;
    else {
      remove();
      expect(await f.port.snapshot()).toBeNull();
    }
    expect(
      (await f.port.apply(write(pointer as unknown as JsonValue, null))).status,
    ).toBe("deferred");
    expect(() => readFileSync(join(f.root, "profile-meta.json"))).toThrow();
  }
});
