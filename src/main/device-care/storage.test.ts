// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  utimes,
  rm,
  lstat,
  symlink,
  readFile,
  readdir,
  realpath,
} from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";
import { DeviceCareStorage } from "./storage";

describe("device-care scoped storage executor", () => {
  let parent: string, root: string, service: DeviceCareStorage;
  const body = "disposable media fixture";
  const name = `${createHash("sha256").update(body).digest("hex").slice(0, 16)}-fixture.png`;
  const old = new Date(Date.now() - 3 * 86400000);
  beforeEach(async () => {
    parent = await realpath(await mkdtemp(join(tmpdir(), "device-care-test-")));
    root = join(parent, "media");
    await mkdir(root, { mode: 0o700 });
    service = new DeviceCareStorage(root, parent);
  });
  afterEach(async () => {
    vi.useRealTimers();
    await rm(parent, { recursive: true, force: true });
  });
  const fixture = async (): Promise<string> => {
    const path = join(root, name);
    await writeFile(path, body);
    await utimes(path, old, old);
    return path;
  };

  // @lat: [[device-care#Implementation verification#Protects unselected data]]
  it("only proposes old direct generated media, and selected-folder analysis never grants cleanup", async () => {
    await fixture();
    await writeFile(join(root, "credentials.json"), "preserve");
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", name), body);
    await utimes(join(root, "nested", name), old, old);
    await symlink(join(root, "credentials.json"), join(root, "link"));
    const report = await service.analyze(root, true);
    expect(report.files).toBe(3);
    expect(report.candidates.map((c) => c.name)).toEqual([name]);
    expect(report.skipped).toBe(1);
    const readonly = await service.analyze(root, false);
    expect(readonly.candidates).toEqual([]);
    expect(() => service.plan([report.candidates[0].id])).toThrow();
    expect(await readFile(join(root, "credentials.json"), "utf8")).toBe(
      "preserve",
    );
  });
  // @lat: [[device-care#Implementation verification#Binds single-use approval]]
  it("requires native approval, rejects digest changes and prevents replay", async () => {
    const path = await fixture();
    const report = await service.analyze(root, true);
    const plan = service.plan([report.candidates[0].id]);
    const trash = vi.fn();
    await expect(
      service.execute(plan.id, "different", async () => true, trash),
    ).rejects.toThrow();
    const cancelled = await service.execute(
      plan.id,
      plan.digest,
      async () => false,
      trash,
    );
    expect(cancelled.status).toBe("cancelled");
    expect(trash).not.toHaveBeenCalled();
    expect(await readFile(path, "utf8")).toBe(body);
    await expect(
      service.execute(plan.id, plan.digest, async () => true, trash),
    ).rejects.toThrow();
  });
  // @lat: [[device-care#Implementation verification#Revalidates changed files]]
  it("skips replacement symlinks and changed content without touching their targets", async () => {
    const path = await fixture();
    const report = await service.analyze(root, true);
    const plan = service.plan([report.candidates[0].id]);
    const protectedPath = join(parent, "project-source.ts");
    await writeFile(protectedPath, "protected");
    await rm(path);
    await symlink(protectedPath, path);
    const trash = vi.fn();
    const result = await service.execute(
      plan.id,
      plan.digest,
      async () => true,
      trash,
    );
    expect(result.skipped).toBe(1);
    expect(trash).not.toHaveBeenCalled();
    expect(await readFile(protectedPath, "utf8")).toBe("protected");
  });
  it("skips a rewritten file even when its name is unchanged", async () => {
    const path = await fixture();
    const report = await service.analyze(root, true);
    const plan = service.plan([report.candidates[0].id]);
    await writeFile(path, "changed");
    const trash = vi.fn();
    const result = await service.execute(
      plan.id,
      plan.digest,
      async () => true,
      trash,
    );
    expect(result.skipped).toBe(1);
    expect(trash).not.toHaveBeenCalled();
  });
  // @lat: [[device-care#Implementation verification#Preserves failed cleanup]]
  it("retains the verified original in a private recovery folder when OS Trash rejects it", async () => {
    await fixture();
    const report = await service.analyze(root, true);
    const plan = service.plan([report.candidates[0].id]);
    const result = await service.execute(
      plan.id,
      plan.digest,
      async () => true,
      async () => {
        throw new Error("Trash unavailable");
      },
    );
    expect(result.status).toBe("partial");
    expect(result.failed).toBe(1);
    expect(result.recoveryPaths).toHaveLength(1);
    expect(await readFile(result.recoveryPaths[0], "utf8")).toBe(body);
    const folder = result.recoveryPaths[0].slice(
      0,
      result.recoveryPaths[0].lastIndexOf("/"),
    );
    expect((await lstat(folder)).mode & 0o777).toBe(0o700);
  });
  it("reports bytes moved separately from space reclaimed and removes only selected items", async () => {
    const path = await fixture();
    await writeFile(join(root, "keep.txt"), "preserve");
    const report = await service.analyze(root, true);
    const plan = service.plan([report.candidates[0].id]);
    const trash = vi.fn(async (staged: string) => {
      expect(await readFile(staged, "utf8")).toBe(body);
      await rm(staged);
    });
    const result = await service.execute(
      plan.id,
      plan.digest,
      async () => true,
      trash,
    );
    expect(result.moved).toBe(1);
    expect(result.movedBytes).toBe(Buffer.byteLength(body));
    expect(result.freeBytesAfter).not.toBeNull();
    await expect(lstat(path)).rejects.toThrow();
    expect(await readFile(join(root, "keep.txt"), "utf8")).toBe("preserve");
    expect(
      (await readdir(parent)).filter((value) =>
        value.startsWith("device-care-recovery"),
      ),
    ).toEqual([]);
  });
  // @lat: [[device-care#Implementation verification#Rejects stale plans]]
  it("rejects expiry and invalid selections before execution", async () => {
    await fixture();
    const report = await service.analyze(root, true);
    expect(() => service.plan(["arbitrary-path"])).toThrow();
    expect(() =>
      service.plan([report.candidates[0].id, report.candidates[0].id]),
    ).toThrow();
    const plan = service.plan([report.candidates[0].id]);
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(plan.expiresAt) + 1);
    await expect(
      service.execute(plan.id, plan.digest, async () => true, vi.fn()),
    ).rejects.toThrow();
    vi.restoreAllMocks();
  });
  it("rejects symlink roots", async () => {
    const linked = join(parent, "link");
    await symlink(root, linked);
    await expect(service.analyze(linked, false)).rejects.toThrow();
  });
});
