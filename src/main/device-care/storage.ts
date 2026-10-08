import { constants } from "fs";
import {
  lstat,
  opendir,
  realpath,
  statfs,
  open,
  mkdtemp,
  rename,
  rmdir,
  chmod,
} from "fs/promises";
import { basename, dirname, join, resolve, relative, sep } from "path";
import { createHash, randomUUID } from "crypto";
import type { Stats, Dir } from "fs";
import type {
  CleanupPlan,
  CleanupReceipt,
  StorageCandidate,
  StorageReport,
  StorageGroup,
  StorageNode,
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
  private folders = new Map<
    string,
    { path: string; dev: number; ino: number }
  >();
  private busy = false;
  private cancelRequested = false;
  constructor(
    private readonly tempRoot: string,
    private readonly stagingParent: string,
    private readonly entryLimit = LIMIT,
  ) {}

  cancel(): void {
    this.cancelRequested = true;
  }

  async analyze(input: string, cleanupScope: boolean): Promise<StorageReport> {
    if (this.busy) throw new Error("Device care is busy");
    this.busy = true;
    this.cancelRequested = false;
    this.candidates.clear();
    this.folders.clear();
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
        groups: [],
        tree: [],
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
      const rootNode: StorageNode = {
        id: randomUUID(),
        parentId: null,
        name: basename(root) || root,
        kind: "folder",
        logicalBytes: 0,
        allocatedBytes: 0,
        files: 0,
      };
      const nodes = new Map<string, StorageNode>([[rootNode.id, rootNode]]);
      this.folders.set(rootNode.id, {
        path: root,
        dev: rootStat.dev,
        ino: rootStat.ino,
      });
      const queue: {
        path: string;
        depth: number;
        node: StorageNode;
        cursor?: Dir;
      }[] = [{ path: root, depth: 0, node: rootNode }];
      const openCursors = new Set<Dir>();
      const seenFiles = new Set<string>();
      const groups = new Map<string, StorageGroup>();
      const start = Date.now();
      let visited = 1;
      try {
        while (
          queue.length &&
          visited < this.entryLimit &&
          Date.now() - start < 15000 &&
          !this.cancelRequested
        ) {
          const entry = queue.shift()!;
          try {
            if (!entry.cursor) {
              const current = await lstat(entry.path);
              if (
                !current.isDirectory() ||
                current.dev !== rootStat.dev ||
                (await realpath(entry.path)) !== entry.path
              ) {
                report.skipped++;
                continue;
              }
              entry.cursor = await opendir(entry.path);
              openCursors.add(entry.cursor);
            }
            let exhausted = false;
            // Rotate directory cursors so a huge folder cannot consume the entire scan.
            for (
              let batch = 0;
              batch < 32 &&
              visited < this.entryLimit &&
              Date.now() - start < 15000 &&
              !this.cancelRequested;
              batch++
            ) {
              const child = await entry.cursor.read();
              if (!child) {
                exhausted = true;
                break;
              }
              visited++;
              const filePath = join(entry.path, child.name);
              const depth = entry.depth + 1;
              let stat: Stats;
              try {
                stat = await lstat(filePath);
              } catch {
                report.skipped++;
                continue;
              }
              if (
                stat.isSymbolicLink() ||
                stat.dev !== rootStat.dev ||
                depth > 16
              ) {
                report.skipped++;
                continue;
              }
              const node: StorageNode = {
                id: randomUUID(),
                parentId: entry.node.id,
                name: child.name,
                kind: stat.isDirectory() ? "folder" : "file",
                logicalBytes: 0,
                allocatedBytes: 0,
                files: 0,
              };
              if (stat.isDirectory()) {
                if (
                  queue.length >= 128 ||
                  (await realpath(filePath)) !== filePath
                ) {
                  report.skipped++;
                  continue;
                }
                nodes.set(node.id, node);
                this.folders.set(node.id, {
                  path: filePath,
                  dev: stat.dev,
                  ino: stat.ino,
                });
                queue.push({ path: filePath, depth, node });
              } else if (stat.isFile()) {
                nodes.set(node.id, node);
                report.files++;
                const fileId = `${stat.dev}:${stat.ino}`;
                report.logicalBytes += stat.size;
                const parts = relative(root, filePath).split(sep);
                const groupKey = parts.length === 1 ? "" : parts[0];
                const group = groups.get(groupKey) || {
                  name: groupKey,
                  kind: groupKey ? ("folder" as const) : ("files" as const),
                  logicalBytes: 0,
                  allocatedBytes: 0,
                  files: 0,
                };
                group.logicalBytes += stat.size;
                group.files++;
                const fileAllocated = seenFiles.has(fileId)
                  ? 0
                  : typeof stat.blocks === "number"
                    ? stat.blocks * 512
                    : stat.size;
                group.allocatedBytes += fileAllocated;
                groups.set(groupKey, group);
                if (!seenFiles.has(fileId)) {
                  report.allocatedBytes +=
                    typeof stat.blocks === "number"
                      ? stat.blocks * 512
                      : stat.size;
                  seenFiles.add(fileId);
                }
                node.files = 1;
                node.logicalBytes = stat.size;
                // Allocation was assigned to the first measured pathname of this inode.
                let ancestor: StorageNode | undefined = nodes.get(
                  node.parentId!,
                );
                while (ancestor) {
                  ancestor.files++;
                  ancestor.logicalBytes += stat.size;
                  ancestor.allocatedBytes += fileAllocated;
                  ancestor = ancestor.parentId
                    ? nodes.get(ancestor.parentId)
                    : undefined;
                }
                node.allocatedBytes = fileAllocated;
                report.largest.push({ name: filePath, bytes: stat.size });
                report.largest.sort((a, b) => b.bytes - a.bytes);
                report.largest.length = Math.min(20, report.largest.length);
                const owned = !process.getuid || stat.uid === process.getuid();
                if (
                  report.cleanupScope &&
                  depth === 1 &&
                  owned &&
                  stat.nlink === 1 &&
                  /^[a-f0-9]{16}-.+\.[a-zA-Z0-9]+$/.test(basename(filePath)) &&
                  Date.now() - Math.max(stat.mtimeMs, stat.atimeMs) >= DAY &&
                  stat.size <= 25 * 1024 * 1024
                ) {
                  const candidate: Candidate = {
                    public: {
                      id: randomUUID(),
                      name: basename(filePath),
                      bytes: stat.size,
                      modifiedAt: stat.mtime.toISOString(),
                    },
                    path: filePath,
                    identity: identity(stat),
                    hash: await digestFile(filePath),
                  };
                  if (
                    candidate.hash.slice(0, 16) !==
                    basename(filePath).slice(0, 16)
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
            }
            if (exhausted) {
              await entry.cursor.close();
              openCursors.delete(entry.cursor);
            } else queue.push(entry);
          } catch {
            report.skipped++;
            if (entry.cursor) {
              await entry.cursor.close().catch(() => {});
              openCursors.delete(entry.cursor);
            }
          }
        }
      } finally {
        await Promise.all(
          [...openCursors].map((cursor) => cursor.close().catch(() => {})),
        );
      }
      report.tree = [...nodes.values()];
      const ordered = [...groups.values()].sort(
        (a, b) =>
          b.logicalBytes - a.logicalBytes || a.name.localeCompare(b.name),
      );
      report.groups = ordered.slice(0, 12);
      if (ordered.length > 12) {
        const rest = ordered.slice(12);
        report.groups.push({
          name: "",
          kind: "other",
          logicalBytes: rest.reduce(
            (sum, group) => sum + group.logicalBytes,
            0,
          ),
          allocatedBytes: rest.reduce(
            (sum, group) => sum + group.allocatedBytes,
            0,
          ),
          files: rest.reduce((sum, group) => sum + group.files, 0),
        });
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

  async analyzeNode(id: unknown): Promise<StorageReport> {
    const selected = typeof id === "string" ? this.folders.get(id) : undefined;
    if (!selected || this.busy)
      throw new Error("Choose a folder from the current storage report");
    const stat = await lstat(selected.path);
    if (
      !stat.isDirectory() ||
      stat.dev !== selected.dev ||
      stat.ino !== selected.ino ||
      (await realpath(selected.path)) !== selected.path
    )
      throw new Error("Folder changed; analyze again");
    return this.analyze(selected.path, false);
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
