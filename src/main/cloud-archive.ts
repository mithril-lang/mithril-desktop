import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
} from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  AccountArchiveClient,
  type RestoreIntent,
  type ArchiveJournal,
} from "@mithril/workspace/archive-client";
import type { ArchiveSource } from "@mithril/workspace/portable-archive";
import type { CloudWorkspace } from "./cloud-workspace";
import { replaceArchiveDestination } from "./archive-save";

/** Disk-backed bounded reads; a whole account never crosses renderer IPC. */
export async function fileArchiveSource(
  path: string,
  check: () => void,
): Promise<{ source: ArchiveSource; close(): Promise<void> }> {
  const handle = await open(path, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || !Number.isSafeInteger(stat.size))
      throw Error("Invalid archive file");
    const source: ArchiveSource = {
      size: stat.size,
      slice(start, end) {
        return {
          async arrayBuffer() {
            check();
            if (
              !Number.isSafeInteger(start) ||
              !Number.isSafeInteger(end) ||
              start < 0 ||
              end < start ||
              end > stat.size ||
              end - start > 8 * 1024 * 1024
            )
              throw Error("Invalid archive slice");
            const bytes = new Uint8Array(end - start);
            let offset = 0;
            while (offset < bytes.length) {
              check();
              const read = await handle.read(
                bytes,
                offset,
                bytes.length - offset,
                start + offset,
              );
              if (!read.bytesRead) throw Error("Truncated archive");
              offset += read.bytesRead;
            }
            check();
            return bytes.buffer;
          },
        };
      },
    };
    return { source, close: () => handle.close() };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export function diskArchiveJournal(
  directory: string,
  check: () => void,
): ArchiveJournal {
  const legacyPath = (key: string): string =>
    join(directory, createHash("sha256").update(key).digest("hex") + ".json");
  const withDatabase = <T>(action: (db: DatabaseSync) => T): T => {
    check();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, "journal.sqlite");
    const fd = openSync(path, "a", 0o600);
    closeSync(fd);
    const db = new DatabaseSync(path);
    try {
      db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS archive_intents(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;",
      );
      check();
      return action(db);
    } finally {
      db.close();
    }
  };
  return {
    get(key) {
      const value = withDatabase((db) =>
        db.prepare("SELECT value FROM archive_intents WHERE key=?").get(key),
      );
      check();
      if (value) {
        if (
          typeof value.value !== "string" ||
          Buffer.byteLength(value.value, "utf8") > 16384
        )
          throw Error("Invalid archive journal");
        return value.value;
      }
      // Previously retained JSON intentions remain available until a confirmed write supersedes them.
      try {
        const info = statSync(legacyPath(key));
        if (!info.isFile() || info.size > 16384)
          throw Error("Invalid archive journal");
        return readFileSync(legacyPath(key), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    set(key, value) {
      if (Buffer.byteLength(value, "utf8") > 16384)
        throw Error("Invalid archive journal");
      withDatabase((db) => {
        db.exec("BEGIN IMMEDIATE");
        db.prepare(
          "INSERT INTO archive_intents(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        ).run(key, value);
        check();
        db.exec("COMMIT");
      });
    },
    // A durable empty row prevents legacy intentions from reappearing after acknowledgement.
    remove(key) {
      this.set(key, "");
    },
  };
}

interface Dependencies {
  workspace: Pick<
    CloudWorkspace,
    "nativeContext" | "assertNativeContext" | "archiveRequest"
  >;
  directory: string;
  chooseSave(): Promise<string | null>;
  chooseOpen(): Promise<string | null>;
}

// @lat: [[cloud-workspace#Cloud workspace#Native archive file custody]]
export class NativeAccountArchive {
  private busy = false;
  constructor(private deps: Dependencies) {}
  private async operation<T>(
    owner: unknown,
    action: (
      client: AccountArchiveClient,
      check: () => void,
      temporary: string,
    ) => Promise<T>,
  ): Promise<T> {
    if (typeof owner !== "string" || !owner || this.busy)
      throw Error("Archive operation unavailable");
    this.busy = true;
    let temporary: string | null = null;
    const resources: Array<() => Promise<void>> = [];
    try {
      const context = await this.deps.workspace.nativeContext();
      if (context.userId !== owner) throw Error("Archive account changed");
      const check = (): void =>
        this.deps.workspace.assertNativeContext(context);
      check();
      mkdirSync(this.deps.directory, { recursive: true, mode: 0o700 });
      temporary = await mkdtemp(join(this.deps.directory, "transfer-"));
      const client = new AccountArchiveClient(
        owner,
        diskArchiveJournal(join(this.deps.directory, "journal"), check),
        async (path, init) => {
          check();
          const response = await this.deps.workspace.archiveRequest(path, init);
          check();
          return {
            ok: response.ok,
            json: async () => {
              const reader = response.body?.getReader();
              const parts: Uint8Array[] = [];
              let size = 0;
              try {
                if (reader)
                  for (;;) {
                    check();
                    const { done, value } = await reader.read();
                    if (done) break;
                    size += value.length;
                    if (size > 65536) throw Error("Archive receipt too large");
                    parts.push(value);
                  }
              } finally {
                await reader?.cancel().catch(() => {});
              }
              check();
              const bytes = Buffer.concat(parts);
              return JSON.parse(bytes.toString("utf8")) as unknown;
            },
            blob: async () => {
              const target = join(temporary!, randomUUID() + ".tar");
              const fd = await open(target, "wx", 0o600),
                reader = response.body?.getReader();
              try {
                if (!reader) throw Error("Missing archive bytes");
                for (;;) {
                  check();
                  const { done, value } = await reader.read();
                  if (done) break;
                  for (let offset = 0; offset < value.length; ) {
                    check();
                    const write = await fd.write(
                      value,
                      offset,
                      value.length - offset,
                    );
                    if (!write.bytesWritten)
                      throw Error("Archive write failed");
                    offset += write.bytesWritten;
                  }
                }
                await fd.sync();
                check();
              } finally {
                await fd.close();
                await reader?.cancel().catch(() => {});
              }
              const opened = await fileArchiveSource(target, check);
              resources.push(opened.close);
              return opened.source;
            },
          };
        },
        () => {
          try {
            check();
            return owner;
          } catch {
            return null;
          }
        },
      );
      return await action(client, check, temporary);
    } finally {
      for (const close of resources) await close().catch(() => {});
      try {
        if (temporary) await rm(temporary, { recursive: true, force: true });
      } finally {
        this.busy = false;
      }
    }
  }
  pending(owner: unknown): Promise<RestoreIntent | null> {
    return this.operation(owner, async (client) => client.pendingRestore());
  }
  exportAndSave(owner: unknown): Promise<void> {
    return this.operation(owner, async (client, check) => {
      const destination = await this.deps.chooseSave();
      check();
      if (!destination) return;
      const backup = await client.exportBackup();
      check();
      const temporary = join(
        dirname(destination),
        ".mithril-backup-" + randomUUID(),
      );
      const fd = await open(temporary, "wx", 0o600);
      try {
        try {
          for (
            let offset = 0;
            offset < backup.blob.size;
            offset += 1024 * 1024
          ) {
            check();
            const bytes = new Uint8Array(
              await backup.blob
                .slice(offset, Math.min(offset + 1024 * 1024, backup.blob.size))
                .arrayBuffer(),
            );
            for (let written = 0; written < bytes.length; ) {
              const result = await fd.write(
                bytes,
                written,
                bytes.length - written,
              );
              if (!result.bytesWritten) throw Error("Archive save failed");
              written += result.bytesWritten;
            }
          }
          await fd.sync();
          check();
        } finally {
          await fd.close();
        }
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
      try {
        await replaceArchiveDestination(temporary, destination, check);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
      check();
      client.confirmBackupSaved(backup.info);
    });
  }
  chooseAndPrepare(owner: unknown): Promise<RestoreIntent | null> {
    return this.operation(owner, async (client, check, temporary) => {
      const selected = await this.deps.chooseOpen();
      check();
      if (!selected) return client.pendingRestore();
      // Copy the selected file to a private snapshot before validation/upload.
      const opened = await fileArchiveSource(selected, check),
        target = join(temporary, "selected.tar");
      const fd = await open(target, "wx", 0o600).catch(async (error) => {
        await opened.close();
        throw error;
      });
      try {
        for (
          let offset = 0;
          offset < opened.source.size;
          offset += 1024 * 1024
        ) {
          const bytes = new Uint8Array(
            await opened.source
              .slice(offset, Math.min(offset + 1024 * 1024, opened.source.size))
              .arrayBuffer(),
          );
          for (let written = 0; written < bytes.length; ) {
            check();
            const result = await fd.write(
              bytes,
              written,
              bytes.length - written,
            );
            if (!result.bytesWritten) throw Error("Archive snapshot failed");
            written += result.bytesWritten;
          }
        }
        await fd.sync();
        check();
      } finally {
        await fd.close();
        await opened.close();
      }
      const snapshot = await fileArchiveSource(target, check);
      try {
        return await client.prepareRestore(snapshot.source);
      } finally {
        await snapshot.close();
      }
    });
  }
  commit(owner: unknown, confirmed: unknown): Promise<void> {
    return this.operation(owner, async (client) => {
      if (confirmed !== true) throw Error("Restore confirmation required");
      await client.commitRestore(true);
    });
  }
}
