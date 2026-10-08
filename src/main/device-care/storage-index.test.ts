// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  realpath,
  rm,
  readFile,
  lstat,
} from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { DeviceCareStorage } from "./storage";
import { StorageIndex } from "./storage-index";

describe("bounded storage index", () => {
  let parent: string, root: string;
  const services: DeviceCareStorage[] = [];
  beforeEach(async () => {
    parent = await realpath(
      await mkdtemp(join(tmpdir(), "storage-index-test-")),
    );
    root = join(parent, "scope");
    await mkdir(root);
    for (const name of ["a", "b"]) {
      await mkdir(join(root, name));
      await writeFile(join(root, name, "data"), "123");
    }
  });
  afterEach(async () => {
    services.forEach((s) => s.dispose());
    services.length = 0;
    await rm(parent, { recursive: true, force: true });
  });
  const service = (): DeviceCareStorage => {
    const next = new DeviceCareStorage(root, parent);
    services.push(next);
    return next;
  };
  // @lat: [[device-care#Incremental storage index#Reuses unchanged files and refreshes changed folders]]
  it("avoids enumeration and metadata reads on warm repeats, then updates only dirty folders", async () => {
    const s = service();
    const first = await s.analyze(root, false);
    expect(first.logicalBytes).toBe(6);
    expect(first.index?.reusedFiles).toBe(0);
    // Native watchers may deliver earlier fixture-creation events after registration.
    // Establish a quiet warm pass rather than assuming notification ordering.
    await vi.waitFor(
      async () => {
        const second = await s.analyze(root, false);
        expect(second.index).toMatchObject({
          reusedDirectories: 3,
          enumeratedDirectories: 0,
          reusedFiles: 2,
        });
      },
      { timeout: 5000 },
    );
    // Modifying an existing file need not change its parent's directory mtime.
    await writeFile(join(root, "a", "data"), "123456789");
    await vi.waitFor(
      async () => {
        const changed = await s.analyze(root, false);
        expect(changed.logicalBytes).toBe(12);
        expect(changed.index?.reusedFiles).toBe(1);
      },
      { timeout: 5000 },
    );
    const forced = await s.analyzeNode(
      (await s.analyze(root, false)).tree![0].id,
    );
    expect(forced.index).toMatchObject({
      reusedDirectories: 0,
      reusedFiles: 0,
      enumeratedDirectories: 3,
    });
    expect(forced.logicalBytes).toBe(12);
    expect((await s.analyze(root, true)).index).toBeUndefined();
  });
  // @lat: [[device-care#Incremental storage index#Restarts validate metadata and reject corrupt indexes]]
  it("persists private listings while requiring fresh child metadata after restart", async () => {
    const s = service();
    await s.analyze(root, false);
    s.dispose();
    const indexPath = join(parent, "device-care-storage-index.json");
    const saved = JSON.parse(await readFile(indexPath, "utf8"));
    expect(saved.version).toBe(1);
    expect(saved.directories).toHaveLength(3);
    expect(saved.directories[0].stats).toBeUndefined();
    expect((await lstat(indexPath)).mode & 0o777).toBe(0o600);
    await writeFile(join(root, "a", "data"), "12345");
    const restarted = await service().analyze(root, false);
    expect(restarted.logicalBytes).toBe(8);
    expect(restarted.index?.reusedFiles).toBe(0);
    expect(restarted.index?.reusedDirectories).toBe(3);
    await writeFile(indexPath, "not JSON");
    expect(
      (await service().analyze(root, false)).index?.enumeratedDirectories,
    ).toBe(3);
  });
  // @lat: [[device-care#Incremental storage index#Falls back without monitoring and expires leases]]
  it("checks children when no watcher is available or a metadata lease has expired", async () => {
    for (const [lease, watchers] of [
      [60000, 0],
      [0, 256],
    ]) {
      const index = new StorageIndex(
        join(parent, `index-${lease}-${watchers}`),
        lease,
        watchers,
      );
      try {
        for (let pass = 0; pass < 2; pass++) {
          await index.begin();
          const cursor = await index.openDirectory(
            join(root, "a"),
            await lstat(join(root, "a")),
          );
          while (await cursor.read()) await index.stat(join(root, "a", "data"));
          await cursor.close();
          expect(await index.finish()).toMatchObject({
            reusedFiles: 0,
            checkedFiles: 1,
          });
        }
      } finally {
        index.dispose();
      }
    }
  });
});
