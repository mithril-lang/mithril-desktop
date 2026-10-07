// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  capabilityResourceManifestBytes,
  type CapabilityResourceManifest,
  type CapabilityResourceTransport,
} from "@mithril/workspace/capability-resources";
import { OriginalScheduleDirectoryResources } from "./original-schedule-directory-resources";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const sha = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
function storage(): {
  transport: CapabilityResourceTransport;
  chunks: Map<string, Uint8Array>;
  uploads: () => number;
} {
  const chunks = new Map<string, Uint8Array>(),
    manifests = new Map<string, CapabilityResourceManifest>();
  let uploads = 0;
  const forOwner = (owner: string): CapabilityResourceTransport => ({
    forOwner,
    getManifest: async (id, digest) => {
      const m = manifests.get(JSON.stringify([owner, id, digest]));
      if (!m) throw Error("Capability resource request failed (404)");
      return structuredClone(m);
    },
    putManifest: async (m) => {
      const digest = sha(capabilityResourceManifestBytes(m));
      manifests.set(
        JSON.stringify([owner, m.capabilityId, digest]),
        structuredClone(m),
      );
      return digest;
    },
    putChunk: async (id, bytes) => {
      uploads++;
      const digest = sha(bytes);
      chunks.set(JSON.stringify([owner, id, digest]), new Uint8Array(bytes));
      return digest;
    },
    getChunk: async (id, digest) => {
      const bytes = chunks.get(JSON.stringify([owner, id, digest]));
      if (!bytes) throw Error("Capability resource request failed (404)");
      return new Uint8Array(bytes);
    },
  });
  return { transport: forOwner("unbound"), chunks, uploads: () => uploads };
}
function setup(): {
  home: string;
  local: string;
  remote: string;
  store: ReturnType<typeof storage>;
  scope: { owner: string; profile: string; timeZone: string };
  service: OriginalScheduleDirectoryResources;
  guard: () => Promise<void>;
  stop: () => void;
} {
  const home = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-schedule-directory-")),
  );
  roots.push(home);
  const local = join(home, "local"),
    remote = join(home, "remote");
  mkdirSync(local);
  mkdirSync(remote);
  const store = storage();
  let active = true;
  const guard = async (): Promise<void> => {
    if (!active) throw Error("Account changed");
  };
  const scope = { owner: "alice", profile: "default", timeZone: "Asia/Tokyo" };
  const service = new OriginalScheduleDirectoryResources(
    scope,
    store.transport,
    "/usr/bin/python3",
    join(home, "state"),
    guard,
  );
  return {
    home,
    local,
    remote,
    store,
    scope,
    service,
    guard,
    stop: () => {
      active = false;
    },
  };
}

// @lat: [[cloud-workspace-tests#Original schedule directory byte roundtrip]]
it("publishes actual original bytes and restores binaries/modes without executing scripts, retaining newer edits on receipt replay", async () => {
  const f = setup();
  writeFileSync(join(f.local, "run.py"), "old\n");
  const baseline = await f.service.capture(f.local);
  writeFileSync(
    join(f.remote, "run.py"),
    "raise Exception('must not execute')\n",
  );
  chmodSync(join(f.remote, "run.py"), 0o755);
  mkdirSync(join(f.remote, "assets"));
  writeFileSync(
    join(f.remote, "assets", "data.bin"),
    Buffer.from([0, 255, 13, 10]),
  );
  writeFileSync(join(f.remote, ".env"), "PRIVATE_NOT_SYNCED");
  const next = await f.service.capture(f.remote);
  expect(next.excluded).toBe(1);
  expect(
    [...f.store.chunks.values()].some((b) =>
      Buffer.from(b).includes("PRIVATE_NOT_SYNCED"),
    ),
  ).toBe(false);
  const uploads = f.store.uploads();
  expect((await f.service.capture(f.remote)).pointer).toEqual(next.pointer);
  expect(f.store.uploads()).toBe(uploads);
  expect(
    await f.service.restore(
      next.pointer,
      f.local,
      baseline.pointer.manifest,
      "apply_one",
    ),
  ).toBe("applied");
  expect(readFileSync(join(f.local, "assets", "data.bin"))).toEqual(
    Buffer.from([0, 255, 13, 10]),
  );
  expect(statSync(join(f.local, "run.py")).mode & 0o111).toBe(0o100);
  writeFileSync(join(f.local, "run.py"), "newer local edit\n");
  const restarted = new OriginalScheduleDirectoryResources(
    f.scope,
    f.store.transport,
    "/usr/bin/python3",
    join(f.home, "state"),
    f.guard,
  );
  expect(
    await restarted.restore(
      next.pointer,
      f.local,
      baseline.pointer.manifest,
      "apply_one",
    ),
  ).toBe("applied");
  expect(readFileSync(join(f.local, "run.py"), "utf8")).toBe(
    "newer local edit\n",
  );
  expect(
    await restarted.restore(
      next.pointer,
      f.local,
      baseline.pointer.manifest,
      "different_operation",
    ),
  ).toBe("conflict");
});

// @lat: [[cloud-workspace-tests#Original schedule directory isolation]]
it("refuses foreign profiles/owners, symlink capture and stale account access while preserving destination files", async () => {
  const f = setup();
  writeFileSync(join(f.local, "run.py"), "local\n");
  writeFileSync(join(f.remote, "run.py"), "remote\n");
  const baseline = await f.service.capture(f.local),
    next = await f.service.capture(f.remote);
  await expect(
    f.service.restore(
      { ...next.pointer, profile: "other" },
      f.local,
      baseline.pointer.manifest,
      "bad_profile",
    ),
  ).rejects.toThrow("Invalid schedule");
  const foreign = new OriginalScheduleDirectoryResources(
    { ...f.scope, owner: "bob" },
    f.store.transport,
    "/usr/bin/python3",
    join(f.home, "state"),
    f.guard,
  );
  await expect(
    foreign.restore(
      next.pointer,
      f.local,
      baseline.pointer.manifest,
      "bad_owner",
    ),
  ).rejects.toThrow("404");
  symlinkSync(join(f.local, "run.py"), join(f.remote, "escaped"));
  await expect(f.service.capture(f.remote)).rejects.toThrow();
  f.stop();
  await expect(
    f.service.restore(
      next.pointer,
      f.local,
      baseline.pointer.manifest,
      "old_account",
    ),
  ).rejects.toThrow("Account changed");
  expect(readFileSync(join(f.local, "run.py"), "utf8")).toBe("local\n");
});

// @lat: [[cloud-workspace-tests#Original schedule directory integrity]]
it("rejects damaged resource bytes before modifying the destination", async () => {
  const f = setup();
  writeFileSync(join(f.local, "run.py"), "local original\n");
  writeFileSync(join(f.remote, "run.py"), "remote original\n");
  const baseline = await f.service.capture(f.local);
  const next = await f.service.capture(f.remote);
  for (const [key, value] of f.store.chunks) {
    if (Buffer.from(value).toString() === "remote original\n")
      f.store.chunks.set(key, Buffer.from("tampered content\n"));
  }
  await expect(
    f.service.restore(
      next.pointer,
      f.local,
      baseline.pointer.manifest,
      "damaged",
    ),
  ).rejects.toThrow("integrity");
  expect(readFileSync(join(f.local, "run.py"), "utf8")).toBe(
    "local original\n",
  );
});
