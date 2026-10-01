import { createHash } from "crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  readdirSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawn } from "child_process";
import { mutateMemoryFiles, type MemoryMutation } from "./memory-file-lock";
const temporary: string[] = [];
function fixture(): {
  home: string;
  mutate(
    mutation: MemoryMutation,
    expected?: { memory: string; user: string },
  ): ReturnType<typeof mutateMemoryFiles>;
  read(name: string): string;
} {
  const home = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-memory-lock-")),
  );
  temporary.push(home);
  mkdirSync(join(home, "memories"));
  writeFileSync(join(home, "memories", "MEMORY.md"), "First\n§\nSecond");
  writeFileSync(join(home, "memories", "USER.md"), "Person");
  return {
    home,
    mutate: (mutation, expected) =>
      mutateMemoryFiles({
        home,
        python: "/usr/bin/python3",
        configDigest: createHash("sha256").update("").digest("hex"),
        limits: { memoryCharLimit: 64, userCharLimit: 32 },
        mutation,
        ...(expected ? { expected } : {}),
      }),
    read: (name) => readFileSync(join(home, "memories", name), "utf8"),
  };
}
afterEach(() => {
  for (const home of temporary.splice(0))
    rmSync(home, { recursive: true, force: true });
});
describe("Hermes-compatible memory transaction", () => {
  it("edits entries and USER with limits and preserves local pre-edit backups", () => {
    const f = fixture();
    expect(f.mutate({ action: "add", content: "Third" }).success).toBe(true);
    expect(
      f.mutate({ action: "update", index: 1, content: "Changed" }).success,
    ).toBe(true);
    expect(f.mutate({ action: "remove", index: 0 }).success).toBe(true);
    expect(f.read("MEMORY.md")).toBe("Changed\n§\nThird");
    expect(f.mutate({ action: "user", content: "Updated" }).success).toBe(true);
    expect(f.read("USER.md")).toBe("Updated");
    expect(f.mutate({ action: "add", content: "x".repeat(100) }).success).toBe(
      false,
    );
    const backups = readdirSync(join(f.home, "memories")).filter((name) =>
      name.startsWith("desktop-backup-"),
    );
    expect(backups).toHaveLength(4);
    expect(JSON.parse(f.read(backups[0])).memory).toBeDefined();
  });
  it("rejects stale raw snapshots under the same lock without changing either file", () => {
    const f = fixture();
    const result = f.mutate(
      { action: "update", index: 0, content: "Overwrite" },
      { memory: "Stale", user: "Person" },
    );
    expect(result.error).toContain("changed");
    expect(f.read("MEMORY.md")).toBe("First\n§\nSecond");
    expect(f.read("USER.md")).toBe("Person");
  });
  it("waits for an actual competing Hermes flock and rejects its newer contents", async () => {
    const f = fixture();
    const child = spawn(
      "/usr/bin/python3",
      [
        "-I",
        "-c",
        "import fcntl,pathlib,sys,time; p=pathlib.Path(sys.argv[1]); lock=open(p/'memories'/'MEMORY.md.lock','a+'); fcntl.flock(lock,fcntl.LOCK_EX); print('locked',flush=True); time.sleep(.15); (p/'memories'/'MEMORY.md').write_text('Agent update'); fcntl.flock(lock,fcntl.LOCK_UN)",
        f.home,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await new Promise<void>((resolve, reject) => {
      child.stdout.once("data", () => resolve());
      child.once("error", reject);
    });
    const result = f.mutate(
      { action: "update", index: 0, content: "Desktop overwrite" },
      { memory: "First\n§\nSecond", user: "Person" },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("changed");
    expect(f.read("MEMORY.md")).toBe("Agent update");
  });
  it("fails closed for symlinked files and missing interpreter without reading target data", () => {
    const f = fixture();
    rmSync(join(f.home, "memories", "MEMORY.md"));
    const target = join(f.home, "untouched");
    writeFileSync(target, "Outside");
    symlinkSync(target, join(f.home, "memories", "MEMORY.md"));
    expect(f.mutate({ action: "add", content: "Edit" }).success).toBe(false);
    expect(readFileSync(target, "utf8")).toBe("Outside");
    expect(
      mutateMemoryFiles({
        home: f.home,
        python: "/missing-python",
        configDigest: createHash("sha256").update("").digest("hex"),
        limits: { memoryCharLimit: 10, userCharLimit: 10 },
        mutation: { action: "user", content: "Edit" },
      }).success,
    ).toBe(false);
  });
  it("rejects configured-limit changes made while waiting for the Hermes lock", async () => {
    const f = fixture();
    const child = spawn(
      "/usr/bin/python3",
      [
        "-I",
        "-c",
        "import fcntl,pathlib,sys,time; p=pathlib.Path(sys.argv[1]); lock=open(p/'memories'/'MEMORY.md.lock','a+'); fcntl.flock(lock,fcntl.LOCK_EX); print('locked',flush=True); time.sleep(.15); (p/'config.yaml').write_text('memory:\\n  memory_char_limit: 1\\n'); fcntl.flock(lock,fcntl.LOCK_UN)",
        f.home,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await new Promise<void>((resolve, reject) => {
      child.stdout.once("data", () => resolve());
      child.once("error", reject);
    });
    expect(f.mutate({ action: "add", content: "Edited" }).success).toBe(false);
    expect(f.read("MEMORY.md")).toBe("First\n§\nSecond");
  });
});
