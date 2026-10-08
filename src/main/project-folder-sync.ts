import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  lstat,
  writeFile,
  unlink,
} from "node:fs/promises";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import {
  CHUNK_BYTES,
  MAX_PROJECT_BYTES,
  digestBytes,
  fileFingerprint,
  fileSetId,
  mergeFiles,
  syncablePath,
  validateManifest,
  type FileManifest,
  type ProjectFile,
  manifestBytes,
  type ProjectFileTransport,
} from "@mithril/workspace/files";
import type {
  WorkspaceOperation,
  WorkspaceRecord,
} from "@mithril/workspace/protocol";

type Identity = {
  userId: string;
  profile: string;
  actor: string;
  epoch: number;
};
interface Link {
  datasetGeneration?: number;
  projectId: string;
  root: string;
  enabled: boolean;
  base: ProjectFile[];
  pending?: WorkspaceOperation;
  pendingFiles?: ProjectFile[];
  error?: string;
}
interface Dependencies {
  context(): Promise<Identity>;
  snapshot(): Promise<{
    records: WorkspaceRecord[];
    datasetGeneration?: number;
  }>;
  apply(op: WorkspaceOperation): Promise<{ status: string }>;
  files: ProjectFileTransport;
  stateDir: string;
}
/** A selected root is a device permission. It never enters the API or renderer payload. */
export class ProjectFolderSync {
  private tickets = new Map<string, { identity: Identity; link: Link }>();
  private busy = false;
  private permissionGeneration = 0;
  private stateWrite: Promise<void> = Promise.resolve();
  constructor(private deps: Dependencies) {}
  private statePath(identity: Identity): string {
    return join(
      this.deps.stateDir,
      createHash("sha256")
        .update(JSON.stringify([identity.userId, identity.profile]))
        .digest("hex") + ".json",
    );
  }
  private async load(identity: Identity): Promise<Link[]> {
    try {
      const value = JSON.parse(
        await readFile(this.statePath(identity), "utf8"),
      ) as Link[];
      if (
        !Array.isArray(value) ||
        value.some(
          (l) =>
            typeof l.root !== "string" ||
            !isAbsolute(l.root) ||
            (l.datasetGeneration !== undefined &&
              (!Number.isSafeInteger(l.datasetGeneration) ||
                l.datasetGeneration < 0)) ||
            !Array.isArray(l.base),
        )
      )
        throw new Error("Invalid sync state");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  private async save(
    identity: Identity,
    links: Link[],
    generation = this.permissionGeneration,
  ): Promise<void> {
    const contents = JSON.stringify(links);
    const job = this.stateWrite.then(async () => {
      await this.guard(identity, generation);
      await mkdir(this.deps.stateDir, { recursive: true, mode: 0o700 });
      const file = this.statePath(identity),
        temp = file + "." + randomUUID() + ".tmp";
      try {
        await writeFile(temp, contents, { mode: 0o600 });
        await this.guard(identity, generation);
        await rename(temp, file);
      } finally {
        await unlink(temp).catch(() => {});
      }
    });
    this.stateWrite = job.catch(() => {});
    await job;
  }
  private async guard(
    identity: Identity,
    generation = this.permissionGeneration,
  ): Promise<void> {
    const current = await this.deps.context();
    if (JSON.stringify(current) !== JSON.stringify(identity))
      throw new Error("Account changed; synchronization stopped");
    if (generation !== this.permissionGeneration)
      throw new Error("Folder synchronization permission changed; stopped");
  }
  private async dataset(expected: number): Promise<void> {
    const current = (await this.deps.snapshot()).datasetGeneration ?? 0;
    if (!Number.isSafeInteger(current) || current < 0 || current !== expected)
      throw new Error("Workspace restored; folder changes retained for review");
  }
  private async safePath(
    root: string,
    path: string,
    internal = false,
  ): Promise<string> {
    if (
      (!syncablePath(path) &&
        !(internal && /^\.mithril-sync-trash\/[a-f0-9-]+\//.test(path))) ||
      !isAbsolute(root)
    )
      throw new Error("Unsupported sync path");
    if (
      (await realpath(root)) !== resolve(root) ||
      (await lstat(root)).isSymbolicLink()
    )
      throw new Error("Selected folder changed");
    const target = resolve(root, path),
      rel = relative(root, target);
    if (!rel || rel.startsWith("..") || isAbsolute(rel))
      throw new Error("Path escaped folder");
    let current = root;
    for (const part of path.split("/")) {
      current = join(current, part);
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw new Error("Symlinks cannot be synchronized");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return target;
  }
  async scan(
    root: string,
  ): Promise<{ files: ProjectFile[]; excluded: number; bytes: number }> {
    const files: ProjectFile[] = [];
    let excluded = 0,
      bytes = 0;
    if ((await lstat(root)).isSymbolicLink())
      throw new Error("Select a real project folder");
    root = await realpath(root);
    const walk = async (prefix: string): Promise<void> => {
      for (const entry of await readdir(join(root, prefix), {
        withFileTypes: true,
      })) {
        const path = prefix ? prefix + "/" + entry.name : entry.name;
        if (!syncablePath(path) || entry.isSymbolicLink()) {
          excluded++;
          continue;
        }
        if (entry.isDirectory()) {
          await walk(path);
          continue;
        }
        if (!entry.isFile()) {
          excluded++;
          continue;
        }
        const target = await this.safePath(root, path),
          handle = await open(
            target,
            constants.O_RDONLY | constants.O_NOFOLLOW,
          );
        try {
          const before = await handle.stat();
          const chunks: string[] = [];
          let size = 0;
          for (;;) {
            const buffer = Buffer.alloc(CHUNK_BYTES);
            const result = await handle.read(buffer, 0, buffer.length, size);
            if (!result.bytesRead) break;
            size += result.bytesRead;
            if (size + bytes > MAX_PROJECT_BYTES)
              throw new Error("Project exceeds 1 GiB synchronization limit");
            chunks.push(
              await digestBytes(buffer.subarray(0, result.bytesRead)),
            );
          }
          const after = await handle.stat();
          if (size !== before.size || before.mtimeMs !== after.mtimeMs)
            throw new Error("File changed during scan; retry");
          files.push({
            path,
            size,
            chunks,
            digest: await fileFingerprint(size, chunks),
          });
          bytes += size;
          if (files.length > 10000)
            throw new Error("Project exceeds 10000 files");
        } finally {
          await handle.close();
        }
      }
    };
    await walk("");
    if (!validateManifest({ version: 1, projectId: "scan", files }))
      throw new Error("Project contains colliding file paths");
    return { files, excluded, bytes };
  }
  async preview(
    projectId: string,
    root: string,
  ): Promise<{
    ticket: string;
    count: number;
    bytes: number;
    excluded: number;
  }> {
    const identity = await this.deps.context();
    const snapshot = await this.deps.snapshot();
    const datasetGeneration = snapshot.datasetGeneration ?? 0;
    if (!Number.isSafeInteger(datasetGeneration) || datasetGeneration < 0)
      throw new Error("Invalid workspace generation");
    const project = snapshot.records.find(
      (r) => r.kind === "project" && r.id === projectId && !r.deleted,
    );
    if (!project) throw new Error("Project not found");
    if ((await lstat(root)).isSymbolicLink())
      throw new Error("Select a real project folder");
    root = await realpath(root);
    const scan = await this.scan(root);
    await this.guard(identity);
    const ticket = randomUUID();
    this.tickets.clear();
    this.tickets.set(ticket, {
      identity,
      link: {
        projectId,
        root: resolve(root),
        enabled: true,
        base: [],
        datasetGeneration,
      },
    });
    return {
      ticket,
      count: scan.files.length,
      bytes: scan.bytes,
      excluded: scan.excluded,
    };
  }
  async connect(
    projectId: string,
    ticket: string,
  ): Promise<{ connected: boolean; error: string | null }> {
    const candidate = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!candidate || candidate.link.projectId !== projectId)
      throw new Error("Choose the folder again");
    await this.guard(candidate.identity);
    this.permissionGeneration++;
    const links = await this.load(candidate.identity);
    const prior = links.find(
      (l) => l.projectId === projectId && l.root === candidate.link.root,
    );
    const link = prior ? { ...prior, enabled: true } : candidate.link;
    await this.save(candidate.identity, [
      ...links.filter((l) => l.projectId !== projectId),
      link,
    ]);
    // The scheduled pass runs in the background; starting sync must not block
    // the renderer from stopping a long initial transfer.
    return this.status(projectId);
  }
  async status(
    projectId: string,
  ): Promise<{ connected: boolean; error: string | null }> {
    const identity = await this.deps.context();
    const link = (await this.load(identity)).find(
      (l) => l.projectId === projectId,
    );
    return { connected: !!link?.enabled, error: link?.error ?? null };
  }
  async disconnect(projectId: string): Promise<void> {
    this.permissionGeneration++;
    const identity = await this.deps.context();
    const links = await this.load(identity);
    for (const l of links) if (l.projectId === projectId) l.enabled = false;
    await this.save(identity, links);
  }
  private async upload(
    identity: Identity,
    link: Link,
    file: ProjectFile,
    generation: number,
  ): Promise<void> {
    const handle = await open(
      await this.safePath(link.root, file.path),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      for (let i = 0; i < file.chunks.length; i++) {
        await this.guard(identity, generation);
        const length = Math.min(CHUNK_BYTES, file.size - i * CHUNK_BYTES),
          buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(
          buffer,
          0,
          length,
          i * CHUNK_BYTES,
        );
        if (
          bytesRead !== length ||
          (await digestBytes(buffer)) !== file.chunks[i]
        )
          throw new Error("File changed before upload");
        const digest = await (
          this.deps.files.forOwner?.(identity.userId) ?? this.deps.files
        ).putChunk(link.projectId, buffer);
        if (digest !== file.chunks[i]) throw new Error("Upload mismatch");
      }
    } finally {
      await handle.close();
    }
  }
  private async download(
    identity: Identity,
    link: Link,
    file: ProjectFile,
    old: ProjectFile | undefined,
    generation: number,
  ): Promise<void> {
    await this.guard(identity, generation);
    const target = await this.safePath(link.root, file.path);
    await mkdir(dirname(target), { recursive: true });
    const temp = join(
      dirname(target),
      ".mithril-sync-" + randomUUID() + ".tmp",
    );
    const handle = await open(temp, "wx", 0o600);
    let size = 0;
    try {
      try {
        for (const digest of file.chunks) {
          await this.guard(identity, generation);
          const bytes = await (
            this.deps.files.forOwner?.(identity.userId) ?? this.deps.files
          ).getChunk(link.projectId, digest);
          await this.guard(identity, generation);
          if ((await digestBytes(bytes)) !== digest)
            throw new Error("Download mismatch");
          await handle.writeFile(bytes);
          size += bytes.length;
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (
        size !== file.size ||
        (await fileFingerprint(size, file.chunks)) !== file.digest
      )
        throw new Error("File integrity mismatch");
      // A local edit after scanning must never be replaced by a delayed download.
      const current = (await this.scan(link.root)).files.find(
        (f) => f.path === file.path,
      );
      if (current?.digest !== old?.digest)
        throw new Error("Local file changed during download");
      await this.guard(identity, generation);
      await this.dataset(link.datasetGeneration ?? 0);
      await this.safePath(link.root, file.path);
      await rename(temp, target);
    } finally {
      await unlink(temp).catch(() => {});
    }
  }
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const generation = this.permissionGeneration;
    try {
      const identity = await this.deps.context(),
        links = await this.load(identity);
      for (const link of links.filter((l) => l.enabled)) {
        try {
          await this.guard(identity, generation);
          const initial = await this.deps.snapshot();
          const datasetGeneration = initial.datasetGeneration ?? 0;
          if (!Number.isSafeInteger(datasetGeneration) || datasetGeneration < 0)
            throw new Error("Invalid workspace generation");
          if (link.pending) {
            if ((link.pending.datasetGeneration ?? 0) !== datasetGeneration)
              throw new Error(
                "Workspace restored; saved file operation retained for review",
              );
            await this.guard(identity, generation);
            const result = await this.deps.apply(link.pending);
            await this.guard(identity, generation);
            if (result.status === "accepted") {
              link.base = link.pendingFiles ?? link.base;
              delete link.pending;
              delete link.pendingFiles;
              await this.save(identity, links, generation);
            } else {
              delete link.pending;
              delete link.pendingFiles;
              await this.save(identity, links, generation);
              throw new Error("Cloud revision changed; synchronize again");
            }
          }
          const snapshot = await this.deps.snapshot(),
            pointer = snapshot.records.find(
              (r) =>
                r.kind === "file_set" && r.data.projectId === link.projectId,
            );
          if (
            !snapshot.records.some(
              (r) =>
                r.id === link.projectId && r.kind === "project" && !r.deleted,
            )
          )
            throw new Error("Project removed; folder sync paused");
          const remote: FileManifest =
            pointer && !pointer.deleted
              ? await (
                  this.deps.files.forOwner?.(identity.userId) ?? this.deps.files
                ).getManifest(link.projectId, String(pointer.data.manifest))
              : { version: 1, projectId: link.projectId, files: [] };
          const local = (await this.scan(link.root)).files,
            merged = mergeFiles(link.base, local, remote.files);
          const identityOf = (files: ProjectFile[]): string =>
            JSON.stringify(
              files
                .map((f) => [f.path, f.digest])
                .sort((a, b) => a[0].localeCompare(b[0])),
            );
          if (
            (link.datasetGeneration ?? 0) !== datasetGeneration &&
            identityOf(local) !== identityOf(link.base)
          )
            throw new Error(
              "Workspace restored; folder changes retained for review",
            );
          link.datasetGeneration = datasetGeneration;
          await this.dataset(datasetGeneration);
          if (merged.conflicts.length)
            throw new Error(
              "Concurrent edits: " + merged.conflicts.slice(0, 5).join(", "),
            );
          if (
            !validateManifest({
              version: 1,
              projectId: link.projectId,
              files: merged.files,
            })
          )
            throw new Error("Local and cloud paths collide; sync paused");
          for (const file of merged.files) {
            const before = local.find((f) => f.path === file.path);
            if (before?.digest !== file.digest)
              await this.download(identity, link, file, before, generation);
          }
          // Cloud removals move to a local recovery directory rather than unlinking bytes.
          for (const old of local.filter(
            (f) => !merged.files.some((m) => m.path === f.path),
          )) {
            const current = (await this.scan(link.root)).files.find(
              (f) => f.path === old.path,
            );
            if (current?.digest !== old.digest)
              throw new Error("Local file changed before removal");
            await this.guard(identity, generation);
            await this.dataset(datasetGeneration);
            const source = await this.safePath(link.root, old.path),
              trash = await this.safePath(
                link.root,
                ".mithril-sync-trash/" + randomUUID() + "/" + old.path,
                true,
              );
            await mkdir(dirname(trash), { recursive: true });
            await rename(source, trash);
          }
          for (const file of merged.files.filter(
            (f) =>
              remote.files.find((r) => r.path === f.path)?.digest !== f.digest,
          ))
            await this.upload(identity, link, file, generation);
          const manifest = {
            version: 1 as const,
            projectId: link.projectId,
            files: merged.files,
          };
          const digest = await digestBytes(manifestBytes(manifest));
          await this.guard(identity, generation);
          await this.dataset(datasetGeneration);
          // A remote tombstone is acknowledged as empty without resurrecting it.
          const publish = pointer?.deleted
            ? merged.files.length > 0
            : digest !== pointer?.data.manifest;
          if (publish)
            await (
              this.deps.files.forOwner?.(identity.userId) ?? this.deps.files
            ).putManifest(manifest);
          await this.guard(identity, generation);
          if (publish) {
            link.pending = {
              operationId: randomUUID(),
              datasetGeneration,
              id: await fileSetId(link.projectId),
              kind: "file_set",
              baseRevision: pointer?.revision ?? 0,
              data: { projectId: link.projectId, manifest: digest },
              deleted: false,
            };
            link.pendingFiles = merged.files;
            await this.save(identity, links, generation);
            await this.guard(identity, generation);
            const result = await this.deps.apply(link.pending);
            await this.guard(identity, generation);
            if (result.status !== "accepted") {
              delete link.pending;
              delete link.pendingFiles;
              await this.save(identity, links, generation);
              throw new Error("Cloud revision changed; synchronize again");
            }
            delete link.pending;
            delete link.pendingFiles;
          }
          link.base = merged.files;
          delete link.error;
        } catch (error) {
          link.error =
            error instanceof Error
              ? error.message
              : "File synchronization failed";
        }
        await this.save(identity, links, generation);
      }
    } finally {
      this.busy = false;
    }
  }
}
