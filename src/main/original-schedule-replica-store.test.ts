// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { spawn } from "child_process";
import { once } from "events";
import { createRequire } from "module";
import {
  mkdtempSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  mkdirSync,
  symlinkSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { NativeOriginalScheduleReplicaStore } from "./original-schedule-replica-store";
import type { OriginalScheduleReplicaJournal } from "@mithril/workspace/original-schedule-file-replica";

const roots: string[] = [];
const scope = { owner: "alice", profile: "default", timeZone: "Asia/Tokyo" };
function root(): string {
  const path = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-schedule-journal-")),
  );
  roots.push(path);
  return path;
}
const pending: OriginalScheduleReplicaJournal = {
  ...scope,
  schemaVersion: 1,
  baseline: null,
  pending: {
    operationId: "retained-operation",
    direction: "upload",
    sourceText: '\uFEFF[\r\n {"opaque":9007199254740993}\r\n]',
    digest: "a".repeat(64),
    expectedVersion: "b".repeat(64),
    cloudRevision: 0,
  },
};
afterEach(() => {
  for (const path of roots.splice(0))
    rmSync(path, { recursive: true, force: true });
});

// @lat: [[cloud-workspace-tests#Durable original schedule replica journal]]
it("commits exact pending source before external failure and reopens it with its original identity", async () => {
  const directory = root();
  const first = new NativeOriginalScheduleReplicaStore(directory, scope);
  await expect(
    first.exclusive(scope, async () => {
      await first.write(pending);
      throw Error("lost network acknowledgement");
    }),
  ).rejects.toThrow("lost network acknowledgement");
  const restarted = new NativeOriginalScheduleReplicaStore(directory, scope);
  await restarted.exclusive(scope, async () => {
    expect(await restarted.read(scope)).toEqual(pending);
  });
  if (process.platform !== "win32")
    for (const file of readdirSync(directory))
      expect(statSync(join(directory, file)).mode & 0o777).toBe(0o600);
});

// @lat: [[cloud-workspace-tests#Original schedule replica process lock]]
it("excludes another instance without blocking and releases the lock after failure", async () => {
  const directory = root();
  const first = new NativeOriginalScheduleReplicaStore(directory, scope);
  const second = new NativeOriginalScheduleReplicaStore(directory, scope);
  let release!: () => void;
  const held = first.exclusive(
    scope,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await expect(second.exclusive(scope, async () => undefined)).rejects.toThrow(
    "Schedule replica busy",
  );
  await expect(first.read({ ...scope, owner: "bob" })).rejects.toThrow(
    "identity changed",
  );
  release();
  await held;
  await second.exclusive(scope, async () => {
    await second.write(pending);
  });
  await expect(first.write(pending)).rejects.toThrow("lock required");
});

// @lat: [[cloud-workspace-tests#Original schedule replica process lock]]
it("uses an OS-held lock across processes and releases it after abrupt process termination", async () => {
  const directory = root();
  const store = new NativeOriginalScheduleReplicaStore(directory, scope);
  await store.exclusive(scope, async () => {
    await store.write(pending);
  });
  const lockPath = join(
    directory,
    readdirSync(directory).find((file) => file.endsWith(".lock.sqlite"))!,
  );
  const modulePath = createRequire(import.meta.url).resolve("better-sqlite3");
  const child = spawn(
    process.execPath,
    [
      "-e",
      `const DB=require(process.argv[1]);const db=new DB(process.argv[2]);db.exec('BEGIN IMMEDIATE');process.stdout.write('locked');setInterval(()=>{},1000);`,
      modulePath,
      lockPath,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const closed = once(child, "exit");
  try {
    const ready = await Promise.race([
      once(child.stdout!, "data"),
      closed.then(() => {
        throw Error("lock process exited before acquisition");
      }),
    ]);
    expect(String(ready[0])).toBe("locked");
    await expect(store.exclusive(scope, async () => undefined)).rejects.toThrow(
      "Schedule replica busy",
    );
  } finally {
    child.kill("SIGKILL");
    await closed;
  }
  await store.exclusive(scope, async () => {
    expect(await store.read(scope)).toEqual(pending);
  });
});

// @lat: [[cloud-workspace-tests#Original schedule replica identity isolation]]
it("keeps owners, profiles and timezones separate and refuses mismatched writes", async () => {
  const directory = root();
  const first = new NativeOriginalScheduleReplicaStore(directory, scope);
  await first.exclusive(scope, async () => {
    await first.write(pending);
    await expect(first.write({ ...pending, owner: "bob" })).rejects.toThrow(
      "identity changed",
    );
  });
  for (const other of [
    { ...scope, owner: "bob" },
    { ...scope, profile: "other" },
    { ...scope, timeZone: "UTC" },
  ]) {
    const store = new NativeOriginalScheduleReplicaStore(directory, other);
    await store.exclusive(other, async () => {
      expect(await store.read(other)).toBeNull();
    });
  }
});

// @lat: [[cloud-workspace-tests#Original schedule replica storage isolation]]
it.skipIf(process.platform === "win32")(
  "refuses redirected or publicly readable journal storage",
  async () => {
    const directory = root();
    const target = root();
    symlinkSync(target, join(directory, "redirect"));
    expect(
      () =>
        new NativeOriginalScheduleReplicaStore(
          join(directory, "redirect"),
          scope,
        ),
    ).toThrow("Unsafe");
    const publicDirectory = join(directory, "public");
    mkdirSync(publicDirectory, { mode: 0o755 });
    expect(
      () => new NativeOriginalScheduleReplicaStore(publicDirectory, scope),
    ).toThrow("Unsafe");
    const store = new NativeOriginalScheduleReplicaStore(directory, scope);
    await store.exclusive(scope, async () => {
      await store.write(pending);
    });
    const file = join(
      directory,
      readdirSync(directory).find(
        (name) => name.endsWith(".sqlite") && !name.endsWith(".lock.sqlite"),
      )!,
    );
    rmSync(file);
    symlinkSync(join(target, "must-not-create"), file);
    await expect(
      store.exclusive(scope, () => store.read(scope)),
    ).rejects.toThrow("Unsafe");
    expect(readdirSync(target)).toEqual([]);
  },
);
