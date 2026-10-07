import { OriginalScheduleRuntimeBindings } from "./original-schedule-runtime-bindings";
import { OriginalScheduleFileResourceBindings } from "./original-schedule-resource-bindings";
import { NativeOriginalScheduleReplicaStore } from "./original-schedule-replica-store";
import { OriginalScheduleWorkdirResources } from "./original-schedule-workdir-resources";
import { OriginalScheduleScriptResources } from "./original-schedule-script-resources";
import { captureOriginalCronFile } from "./cron-source-files";
import { patchOriginalScheduleBindingsText } from "@mithril/workspace/original-schedule-text";
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

// @lat: [[cloud-workspace-tests#Original schedule script binding roundtrip]]
it("binds real original script/monitor resources to portable source and restores original relative paths without rewriting opaque tokens", async () => {
  const f = setup();
  mkdirSync(join(f.remote, "nested"));
  writeFileSync(
    join(f.remote, "nested", "run.py"),
    "raise Exception('never execute')\n",
  );
  writeFileSync(join(f.remote, "monitor.py"), "print('monitor bytes')\n");
  const sourceRoot = join(f.home, "source");
  mkdirSync(join(sourceRoot, "cron"), { recursive: true });
  const raw =
    '\uFEFF{\r\n "metadata":9223372036854775807,"jobs":[{"id":"one","name":"one","prompt":"日本語","enabled":false,"state":"paused","schedule":{"kind":"cron","expr":"17 9 * * 1-5"},"script":' +
    JSON.stringify(join(f.remote, "nested", "run.py")) +
    ',"monitor_script":"monitor.py","opaque":9007199254740993}]\r\n}';
  writeFileSync(join(sourceRoot, "cron", "jobs.json"), raw);
  const source = captureOriginalCronFile(sourceRoot, "default")!;
  const origin = new OriginalScheduleScriptResources(
    f.scope,
    f.remote,
    f.service,
    f.guard,
  );
  const captured = await origin.capture(source);
  const portable = patchOriginalScheduleBindingsText(
    raw,
    f.scope.profile,
    f.scope.timeZone,
    captured,
  );
  expect(portable).not.toContain(f.home);
  expect(portable).toContain("9223372036854775807");
  expect(portable).toContain("9007199254740993");
  expect(portable.startsWith("\uFEFF{\r\n")).toBe(true);
  const baseline = await f.service.capture(f.local);
  const destination = new OriginalScheduleScriptResources(
    f.scope,
    f.local,
    f.service,
    f.guard,
  );
  const write = {
    ...f.scope,
    operationId: "scripts_roundtrip",
    sourceText: portable,
    expectedVersion: source.version,
  };
  const patches = await destination.restore(write, baseline.pointer.manifest);
  const restored = patchOriginalScheduleBindingsText(
    portable,
    f.scope.profile,
    f.scope.timeZone,
    patches,
  );
  expect(restored).toBe(
    raw.replace(
      JSON.stringify(join(f.remote, "nested", "run.py")),
      '"nested/run.py"',
    ),
  );
  expect(readFileSync(join(f.local, "nested", "run.py"), "utf8")).toBe(
    "raise Exception('never execute')\n",
  );
  expect(readFileSync(join(f.local, "monitor.py"), "utf8")).toBe(
    "print('monitor bytes')\n",
  );
  writeFileSync(join(f.local, "nested", "run.py"), "new local edit\n");
  await destination.restore(write, baseline.pointer.manifest);
  expect(readFileSync(join(f.local, "nested", "run.py"), "utf8")).toBe(
    "new local edit\n",
  );
});

// @lat: [[cloud-workspace-tests#Original schedule script binding refusal]]
it("rejects escaped paths, raw remote paths, foreign directory scope and incomplete script manifests before changing destination files", async () => {
  const f = setup();
  const sourceRoot = join(f.home, "source");
  mkdirSync(join(sourceRoot, "cron"), { recursive: true });
  const file = (script: string): ReturnType<typeof captureOriginalCronFile> => {
    writeFileSync(
      join(sourceRoot, "cron", "jobs.json"),
      JSON.stringify({
        jobs: [
          {
            id: "one",
            name: "one",
            prompt: "日本語",
            enabled: false,
            state: "paused",
            schedule: { kind: "cron", expr: "17 9 * * 1-5" },
            script,
          },
        ],
      }),
    );
    return captureOriginalCronFile(sourceRoot, "default");
  };
  const binder = new OriginalScheduleScriptResources(
    f.scope,
    f.remote,
    f.service,
    f.guard,
  );
  await expect(binder.capture(file("../../outside.py")!)).rejects.toThrow(
    "outside",
  );
  writeFileSync(join(f.remote, ".env"), "never publish");
  await expect(binder.capture(file(".env")!)).rejects.toThrow("unavailable");
  expect(
    () =>
      new OriginalScheduleScriptResources(
        { ...f.scope, owner: "bob" },
        f.remote,
        f.service,
        f.guard,
      ),
  ).toThrow("scope");
  const baseline = await f.service.capture(f.local);
  const raw = file("relative.py")!;
  await expect(
    binder.restore(
      {
        ...f.scope,
        operationId: "raw_remote",
        sourceText: raw.sourceText,
        expectedVersion: null,
      },
      baseline.pointer.manifest,
    ),
  ).rejects.toThrow("binding required");
  const escaped =
    "mithril-schedule-script:v1:" +
    Buffer.from(
      JSON.stringify([
        f.scope.profile,
        baseline.pointer.manifest,
        "../outside.py",
      ]),
    ).toString("base64url");
  await expect(
    binder.restore(
      {
        ...f.scope,
        operationId: "escaped",
        sourceText: file(escaped)!.sourceText,
        expectedVersion: null,
      },
      baseline.pointer.manifest,
    ),
  ).rejects.toThrow("reference");
  const missing =
    "mithril-schedule-script:v1:" +
    Buffer.from(
      JSON.stringify([f.scope.profile, baseline.pointer.manifest, "absent.py"]),
    ).toString("base64url");
  await expect(
    binder.restore(
      {
        ...f.scope,
        operationId: "missing",
        sourceText: file(missing)!.sourceText,
        expectedVersion: null,
      },
      baseline.pointer.manifest,
    ),
  ).rejects.toThrow("required file");
});

function workdirFile(
  home: string,
  workdir: string,
): NonNullable<ReturnType<typeof captureOriginalCronFile>> {
  const root = join(home, "workdir-source");
  mkdirSync(join(root, "cron"), { recursive: true });
  const raw =
    '\uFEFF{\r\n"opaque":9007199254740993,"jobs":[{"id":"one","name":"one","prompt":"日本語","enabled":false,"state":"paused","schedule":{"kind":"cron","expr":"17 9 * * 1-5"},"workdir":' +
    JSON.stringify(workdir) +
    ',"script":"run.py"}]}\r\n';
  writeFileSync(join(root, "cron", "jobs.json"), raw);
  return captureOriginalCronFile(root, "default")!;
}

// @lat: [[cloud-workspace-tests#Original schedule workdir roundtrip]]
it("roundtrips workdir bytes and native path tokens without altering original metadata or executing jobs", async () => {
  const f = setup(),
    binder = new OriginalScheduleWorkdirResources(f.scope, f.service, f.guard);
  writeFileSync(join(f.local, "data.bin"), Buffer.from([1, 2]));
  const baseline = await f.service.capture(f.local);
  writeFileSync(join(f.remote, "data.bin"), Buffer.from([255, 0, 13, 10]));
  writeFileSync(join(f.remote, ".env"), "PRIVATE_WORKDIR_SECRET");
  const source = workdirFile(f.home, f.remote);
  const portable = patchOriginalScheduleBindingsText(
    source.sourceText,
    f.scope.profile,
    f.scope.timeZone,
    await binder.capture(source),
  );
  expect(portable).not.toContain(f.remote);
  expect(portable).toContain("9007199254740993");
  expect(
    [...f.store.chunks.values()].some((b) =>
      Buffer.from(b).includes("PRIVATE_WORKDIR_SECRET"),
    ),
  ).toBe(false);
  const write = {
    ...f.scope,
    operationId: "workdir_one",
    sourceText: portable,
    expectedVersion: null,
  };
  const target = async (): Promise<{
    root: string;
    expectedManifest: string;
  }> => ({
    root: f.local,
    expectedManifest: baseline.pointer.manifest,
  });
  const restored = patchOriginalScheduleBindingsText(
    portable,
    f.scope.profile,
    f.scope.timeZone,
    await binder.restore(write, target),
  );
  expect(restored).toBe(
    source.sourceText.replace(
      JSON.stringify(f.remote),
      JSON.stringify(f.local),
    ),
  );
  expect(readFileSync(join(f.local, "data.bin"))).toEqual(
    Buffer.from([255, 0, 13, 10]),
  );
  writeFileSync(join(f.local, "data.bin"), "new local edit");
  await new OriginalScheduleWorkdirResources(
    f.scope,
    f.service,
    f.guard,
  ).restore(write, target);
  expect(readFileSync(join(f.local, "data.bin"), "utf8")).toBe(
    "new local edit",
  );
});

// @lat: [[cloud-workspace-tests#Original schedule workdir conflict and scope]]
it("refuses workdir conflicts, raw cloud paths and cross-job references without overwriting local data", async () => {
  const f = setup(),
    binder = new OriginalScheduleWorkdirResources(f.scope, f.service, f.guard);
  writeFileSync(join(f.local, "data.txt"), "old");
  const baseline = await f.service.capture(f.local);
  writeFileSync(join(f.remote, "data.txt"), "remote");
  const source = workdirFile(f.home, f.remote);
  const portable = patchOriginalScheduleBindingsText(
    source.sourceText,
    f.scope.profile,
    f.scope.timeZone,
    await binder.capture(source),
  );
  const write = {
    ...f.scope,
    operationId: "conflict_one",
    sourceText: portable,
    expectedVersion: null,
  };
  const target = async (): Promise<{
    root: string;
    expectedManifest: string;
  }> => ({
    root: f.local,
    expectedManifest: baseline.pointer.manifest,
  });
  writeFileSync(join(f.local, "data.txt"), "concurrent edit");
  await expect(binder.restore(write, target)).rejects.toThrow("conflict");
  expect(readFileSync(join(f.local, "data.txt"), "utf8")).toBe(
    "concurrent edit",
  );
  await expect(
    binder.restore({ ...write, sourceText: source.sourceText }, target),
  ).rejects.toThrow("binding required");
  const foreign =
    "mithril-schedule-workdir:v1:" +
    Buffer.from(
      JSON.stringify(["default", "other", baseline.pointer.manifest]),
    ).toString("base64url");
  await expect(
    binder.restore(
      { ...write, sourceText: workdirFile(f.home, foreign).sourceText },
      target,
    ),
  ).rejects.toThrow("reference");
  expect(
    () =>
      new OriginalScheduleWorkdirResources(
        { ...f.scope, owner: "bob" },
        f.service,
        f.guard,
      ),
  ).toThrow("scope");
  await expect(
    binder.capture(workdirFile(f.home, "relative/path")),
  ).rejects.toThrow("absolute");
  f.stop();
  await expect(binder.capture(source)).rejects.toThrow("Account changed");
});

// @lat: [[cloud-workspace-tests#Original schedule resource composition restart]]
it("composes script and workdir restoration with durable baselines across a failed source write and restart", async () => {
  const f = setup();
  const sourceScripts = join(f.home, "source-scripts"),
    targetScripts = join(f.home, "target-scripts");
  mkdirSync(sourceScripts);
  mkdirSync(targetScripts);
  writeFileSync(
    join(sourceScripts, "run.py"),
    "raise Exception('never run')\n",
  );
  writeFileSync(join(targetScripts, "run.py"), "old script");
  writeFileSync(join(f.remote, "data.bin"), Buffer.from([0, 255]));
  writeFileSync(join(f.local, "data.bin"), "old data");
  const scriptBaseline = await f.service.capture(targetScripts),
    workBaseline = await f.service.capture(f.local);
  const source = workdirFile(f.home, f.remote);
  const runtime = new OriginalScheduleRuntimeBindings(
    f.scope,
    { capture: () => null },
    { assert: async () => undefined },
    f.guard,
  );
  const journal = join(f.home, "replica-journal");
  const store = new NativeOriginalScheduleReplicaStore(journal, f.scope);
  const sender = new OriginalScheduleFileResourceBindings(
    new OriginalScheduleScriptResources(
      f.scope,
      sourceScripts,
      f.service,
      f.guard,
    ),
    new OriginalScheduleWorkdirResources(f.scope, f.service, f.guard),
    store,
    runtime,
    async () => scriptBaseline.pointer.manifest,
    async () => ({
      root: f.local,
      expectedManifest: workBaseline.pointer.manifest,
    }),
    f.guard,
  );
  const portable = patchOriginalScheduleBindingsText(
    source.sourceText,
    f.scope.profile,
    f.scope.timeZone,
    await sender.capture(source),
  );
  let resolutions = 0;
  const baseline = async (): Promise<string> => {
    resolutions++;
    return scriptBaseline.pointer.manifest;
  };
  const workTarget = async (): Promise<{
    root: string;
    expectedManifest: string;
  }> => {
    resolutions++;
    return { root: f.local, expectedManifest: workBaseline.pointer.manifest };
  };
  const receive = (
    journalStore: NativeOriginalScheduleReplicaStore,
  ): OriginalScheduleFileResourceBindings =>
    new OriginalScheduleFileResourceBindings(
      new OriginalScheduleScriptResources(
        f.scope,
        targetScripts,
        f.service,
        f.guard,
      ),
      new OriginalScheduleWorkdirResources(f.scope, f.service, f.guard),
      journalStore,
      runtime,
      baseline,
      workTarget,
      f.guard,
    );
  const write = {
    ...f.scope,
    operationId: "composed_restore",
    expectedVersion: null,
    sourceText: portable,
  };
  let firstPatches: Awaited<
    ReturnType<OriginalScheduleFileResourceBindings["restore"]>
  > = [];
  await expect(
    store.exclusive(f.scope, async () => {
      firstPatches = await receive(store).restore(write);
      throw Error("source write not acknowledged");
    }),
  ).rejects.toThrow("not acknowledged");
  expect(readFileSync(join(targetScripts, "run.py"), "utf8")).toBe(
    "raise Exception('never run')\n",
  );
  expect(readFileSync(join(f.local, "data.bin"))).toEqual(
    Buffer.from([0, 255]),
  );
  expect(resolutions).toBe(2);
  writeFileSync(join(targetScripts, "run.py"), "newer local script");
  writeFileSync(join(f.local, "data.bin"), "newer local data");
  const reopened = new NativeOriginalScheduleReplicaStore(journal, f.scope);
  await reopened.exclusive(f.scope, async () =>
    expect(await receive(reopened).restore(write)).toEqual(firstPatches),
  );
  expect(resolutions).toBe(2);
  expect(readFileSync(join(targetScripts, "run.py"), "utf8")).toBe(
    "newer local script",
  );
  expect(readFileSync(join(f.local, "data.bin"), "utf8")).toBe(
    "newer local data",
  );
});
