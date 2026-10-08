import { constants } from "fs";
import {
  lstat,
  readdir,
  realpath,
  statfs,
  open,
  mkdtemp,
  rename,
  rmdir,
  chmod,
} from "fs/promises";
import { basename, dirname, join, resolve } from "path";
import { createHash, randomUUID } from "crypto";
import type { Stats } from "fs";
import type {
  CleanupPlan,
  CleanupReceipt,
  StorageCandidate,
  StorageReport,
} from "../../shared/device-care";

const DAY = 24 * 60 * 60 * 1000;
const LIMIT = 20000;
interface Identity {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}
interface Candidate {
  public: StorageCandidate;
  path: string;
  identity: Identity;
  hash: string;
}
interface PlanRecord {
  public: CleanupPlan;
  candidates: Candidate[];
  rootIdentity: Identity;
}

function identity(stat: Stats): Identity {
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}
function matches(stat: Stats, original: Identity, renamed = false): boolean {
  return (
    stat.isFile() &&
    !stat.isSymbolicLink() &&
    stat.nlink === 1 &&
    stat.dev === original.dev &&
    stat.ino === original.ino &&
    stat.size === original.size &&
    stat.mtimeMs === original.mtimeMs &&
    (renamed || stat.ctimeMs === original.ctimeMs)
  );
}
async function digestFile(path: string): Promise<string> {
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
  );
  try {
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false }))
      hash.update(chunk);
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}
export async function freeSpace(
  root: string,
): Promise<{ capacity: number | null; freeBytes: number | null }> {
  try {
    const stat = await statfs(root);
    return {
      capacity: stat.bsize * stat.blocks,
      freeBytes: stat.bsize * stat.bavail,
    };
  } catch {
    try {
      const stat = await statfs(dirname(root));
      return {
        capacity: stat.bsize * stat.blocks,
        freeBytes: stat.bsize * stat.bavail,
      };
    } catch {
      return { capacity: null, freeBytes: null };
    }
  }
}

export class DeviceCareStorage {
  private candidates = new Map<string, Candidate>();
  private plans = new Map<string, PlanRecord>();
  private rootIdentity: Identity | null = null;
  private cleanupRoot: string | null = null;
  private busy = false;
  private cancelRequested = false;
  constructor(
    private readonly tempRoot: string,
    private readonly stagingParent: string,
  ) {}

  cancel(): void {
    this.cancelRequested = true;
  }

  async analyze(input: string, cleanupScope: boolean): Promise<StorageReport> {
    if (this.busy) throw new Error("Device care is busy");
    this.busy = true;
    this.cancelRequested = false;
    this.candidates.clear();
    this.plans.clear();
    this.cleanupRoot = null;
    this.rootIdentity = null;
    try {
      const root = resolve(input);
      const report: StorageReport = {
        root,
        observedAt: new Date().toISOString(),
        status: "complete",
        files: 0,
        logicalBytes: 0,
        allocatedBytes: 0,
        skipped: 0,
        candidates: [],
        largest: [],
        cleanupScope,
        ...(await freeSpace(root)),
      };
      let rootStat: Stats;
      try {
        rootStat = await lstat(root);
      } catch (error) {
        if (cleanupScope && (error as NodeJS.ErrnoException).code === "ENOENT")
          return report;
        throw error;
      }
      if (
        !rootStat.isDirectory() ||
        rootStat.isSymbolicLink() ||
        (await realpath(root)) !== root
      ) {
        throw new Error(
          "Choose a real directory; symbolic-link roots are not supported",
        );
      }
      if (cleanupScope && root !== (await realpath(this.tempRoot)))
        throw new Error("Invalid cleanup scope");
      if (cleanupScope && process.getuid && rootStat.uid !== process.getuid())
        throw new Error("Invalid directory owner");
      if (cleanupScope && rootStat.mode & 0o022) {
        // A shared writable root cannot establish ownership of disposable files.
        report.cleanupScope = false;
      }
      this.rootIdentity = identity(rootStat);
      this.cleanupRoot = report.cleanupScope ? root : null;
      const queue = [{ path: root, depth: 0 }];
      const seenFiles = new Set<string>();
      const start = Date.now();
      let visited = 0;
      while (
        queue.length &&
        visited < LIMIT &&
        Date.now() - start < 15000 &&
        !this.cancelRequested
      ) {
        const entry = queue.pop()!;
        try {
          const stat = await lstat(entry.path);
          visited++;
          if (
            stat.isSymbolicLink() ||
            stat.dev !== rootStat.dev ||
            entry.depth > 16
          ) {
            report.skipped++;
            continue;
          }
          if (stat.isDirectory()) {
            if ((await realpath(entry.path)) !== entry.path) {
              report.skipped++;
              continue;
            }
            const children = await readdir(entry.path);
            const room = Math.max(0, LIMIT - visited - queue.length);
            for (const child of children.slice(0, room))
              queue.push({
                path: join(entry.path, child),
                depth: entry.depth + 1,
              });
            report.skipped += Math.max(0, children.length - room);
          } else if (stat.isFile()) {
            report.files++;
            const fileId = `${stat.dev}:${stat.ino}`;
            report.logicalBytes += stat.size;
            if (!seenFiles.has(fileId)) {
              report.allocatedBytes +=
                typeof stat.blocks === "number" ? stat.blocks * 512 : stat.size;
              seenFiles.add(fileId);
            }
            report.largest.push({ name: entry.path, bytes: stat.size });
            report.largest.sort((a, b) => b.bytes - a.bytes);
            report.largest.length = Math.min(20, report.largest.length);
            const owned = !process.getuid || stat.uid === process.getuid();
            if (
              report.cleanupScope &&
              entry.depth === 1 &&
              owned &&
              stat.nlink === 1 &&
              /^[a-f0-9]{16}-.+\.[a-zA-Z0-9]+$/.test(basename(entry.path)) &&
              Date.now() - Math.max(stat.mtimeMs, stat.atimeMs) >= DAY &&
              stat.size <= 25 * 1024 * 1024
            ) {
              const candidate: Candidate = {
                public: {
                  id: randomUUID(),
                  name: basename(entry.path),
                  bytes: stat.size,
                  modifiedAt: stat.mtime.toISOString(),
                },
                path: entry.path,
                identity: identity(stat),
                hash: await digestFile(entry.path),
              };
              if (
                candidate.hash.slice(0, 16) !==
                basename(entry.path).slice(0, 16)
              ) {
                continue;
              }
              // Hashing may update atime; identity deliberately excludes atime.
              this.candidates.set(candidate.public.id, candidate);
              report.candidates.push(candidate.public);
            }
          } else {
            report.skipped++;
          }
        } catch {
          report.skipped++;
        }
      }
      if (queue.length) report.skipped += queue.length;
      report.status = this.cancelRequested
        ? "cancelled"
        : report.skipped
          ? "partial"
          : "complete";
      return report;
    } finally {
      this.busy = false;
    }
  }

  plan(ids: unknown): CleanupPlan {
    if (
      this.busy ||
      !this.cleanupRoot ||
      !this.rootIdentity ||
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 500 ||
      ids.some((id) => typeof id !== "string" || !this.candidates.has(id)) ||
      new Set(ids).size !== ids.length
    )
      throw new Error("Analyze and select valid temporary files first");
    const candidates = ids.map((id) => this.candidates.get(id)!);
    const plan: CleanupPlan = {
      id: randomUUID(),
      digest: createHash("sha256")
        .update(JSON.stringify(candidates))
        .digest("hex"),
      expiresAt: new Date(Date.now() + 5 * 60000).toISOString(),
      root: this.cleanupRoot,
      items: candidates.map((c) => c.public),
      bytes: candidates.reduce((sum, c) => sum + c.public.bytes, 0),
    };
    this.plans.clear();
    this.plans.set(plan.id, {
      public: plan,
      candidates,
      rootIdentity: this.rootIdentity,
    });
    return plan;
  }

  async execute(
    id: unknown,
    digest: unknown,
    approve: (plan: CleanupPlan) => Promise<boolean>,
    trash: (path: string) => Promise<void>,
  ): Promise<CleanupReceipt> {
    if (this.busy || typeof id !== "string" || typeof digest !== "string")
      throw new Error("Invalid cleanup request");
    const record = this.plans.get(id);
    if (
      !record ||
      record.public.digest !== digest ||
      Date.parse(record.public.expiresAt) <= Date.now()
    )
      throw new Error("Cleanup plan changed or expired");
    this.plans.delete(id); // Consume before native approval; cancellation requires a new plan.
    this.busy = true;
    try {
      const receipt: CleanupReceipt = {
        status: "cancelled",
        moved: 0,
        skipped: 0,
        failed: 0,
        movedBytes: 0,
        freeBytesBefore: (await freeSpace(record.public.root)).freeBytes,
        freeBytesAfter: null,
        recoveryPaths: [],
      };
      if (!(await approve(record.public))) return receipt;
      if (Date.parse(record.public.expiresAt) <= Date.now())
        throw new Error("Cleanup plan expired during review");
      const staging = await mkdtemp(
        join(this.stagingParent, "device-care-recovery-"),
      );
      await chmod(staging, 0o700);
      for (const item of record.candidates) {
        let staged: string | null = null;
        try {
          const rootStat = await lstat(record.public.root);
          if (
            rootStat.isSymbolicLink() ||
            rootStat.dev !== record.rootIdentity.dev ||
            rootStat.ino !== record.rootIdentity.ino ||
            (await realpath(record.public.root)) !== record.public.root ||
            !matches(await lstat(item.path), item.identity) ||
            (await digestFile(item.path)) !== item.hash
          ) {
            receipt.skipped++;
            continue;
          }
          staged = join(staging, item.public.name);
          await rename(item.path, staged);
          if (
            !matches(await lstat(staged), item.identity, true) ||
            (await digestFile(staged)) !== item.hash
          ) {
            // Preserve unexpected moved content in a private recovery directory; never overwrite a new source file.
            receipt.skipped++;
            receipt.recoveryPaths.push(staged);
            continue;
          }
          await trash(staged);
          receipt.moved++;
          receipt.movedBytes += item.public.bytes;
        } catch {
          receipt.failed++;
          if (staged) {
            try {
              await lstat(staged);
              receipt.recoveryPaths.push(staged);
            } catch {
              /* rename never completed */
            }
          }
        }
      }
      try {
        await rmdir(staging);
      } catch {
        /* Recovery items remain private and discoverable. */
      }
      receipt.freeBytesAfter = (await freeSpace(record.public.root)).freeBytes;
      receipt.status =
        receipt.skipped || receipt.failed ? "partial" : "complete";
      return receipt;
    } finally {
      this.busy = false;
      this.candidates.clear();
    }
  }
}
