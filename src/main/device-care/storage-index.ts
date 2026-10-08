import { watch, type FSWatcher, type Stats } from "fs";
import {
  lstat,
  opendir,
  mkdir,
  readFile,
  writeFile,
  rename,
} from "fs/promises";
import { basename, dirname, isAbsolute } from "path";
import { randomUUID } from "crypto";

export interface StorageCursor {
  read(): Promise<{ name: string } | null>;
  close(): Promise<void>;
}
interface DirectoryRecord {
  signature: string;
  names: string[];
  stats: Map<string, Stats>;
  checkedAt: number;
  generation: number;
}
export interface StorageIndexStats {
  reusedDirectories: number;
  enumeratedDirectories: number;
  reusedFiles: number;
  checkedFiles: number;
  changedDuringAnalysis: boolean;
  maxAgeSeconds: number;
}
const signature = (s: Stats): string =>
  `${s.dev}:${s.ino}:${s.mtimeMs}:${s.ctimeMs}`;

/** Listings survive restart; file metadata only has a bounded, live watcher lease. */
export class StorageIndex {
  private directories = new Map<string, DirectoryRecord>();
  private watchers = new Map<string, FSWatcher>();
  private watcherIdentities = new Map<string, string>();
  private generations = new Map<string, number>();
  private trusted = new Set<string>();
  private loaded = false;
  private counters!: StorageIndexStats;
  private startingGeneration = 0;
  private globalGeneration = 0;
  private force = false;
  constructor(
    private readonly file: string,
    private readonly maxAgeMs = 60000,
    private readonly watcherLimit = 256,
  ) {}

  async begin(force = false): Promise<void> {
    this.force = force;
    this.trusted.clear();
    this.counters = {
      reusedDirectories: 0,
      enumeratedDirectories: 0,
      reusedFiles: 0,
      checkedFiles: 0,
      changedDuringAnalysis: false,
      maxAgeSeconds: this.maxAgeMs / 1000,
    };
    this.startingGeneration = this.globalGeneration;
    if (this.loaded) return;
    this.loaded = true;
    try {
      const info = await lstat(this.file);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size > 4 * 1024 * 1024
      )
        return;
      const value = JSON.parse(await readFile(this.file, "utf8"));
      if (value.version !== 1 || !Array.isArray(value.directories)) return;
      let count = 0;
      for (const d of value.directories.slice(0, 2000)) {
        if (
          typeof d.path !== "string" ||
          !isAbsolute(d.path) ||
          typeof d.signature !== "string" ||
          !Array.isArray(d.names) ||
          !d.names.every(
            (n: unknown) =>
              typeof n === "string" &&
              n !== "." &&
              n !== ".." &&
              n.length > 0 &&
              !/[\\/\0]/.test(n),
          )
        )
          continue;
        count += d.names.length;
        if (count > 20000) break;
        this.directories.set(d.path, {
          signature: d.signature,
          names: d.names,
          stats: new Map(),
          checkedAt: 0,
          generation: -1,
        });
      }
    } catch {
      /* Missing/corrupt indexes are an ordinary cold start. */
    }
  }

  private monitor(path: string, current: Stats): void {
    const key = `${current.dev}:${current.ino}`;
    if (this.watchers.has(path) && this.watcherIdentities.get(path) !== key) {
      this.watchers.get(path)?.close();
      this.watchers.delete(path);
      this.watcherIdentities.delete(path);
    }
    if (this.watchers.has(path) || this.watchers.size >= this.watcherLimit)
      return;
    const invalidate = (): void => {
      this.globalGeneration++;
      this.generations.set(path, (this.generations.get(path) || 0) + 1);
      this.trusted.delete(path);
      this.directories.delete(path);
    };
    try {
      const watcher = watch(path, { persistent: false }, invalidate);
      watcher.on("error", () => {
        invalidate();
        watcher.close();
        this.watchers.delete(path);
        this.watcherIdentities.delete(path);
      });
      this.watchers.set(path, watcher);
      this.watcherIdentities.set(path, key);
    } catch {
      /* Without a watcher every child gets a fresh lstat. */
    }
  }

  async openDirectory(path: string, current: Stats): Promise<StorageCursor> {
    const previous = this.directories.get(path);
    if (previous && previous.signature !== signature(current)) {
      this.watchers.get(path)?.close();
      this.watchers.delete(path);
    }
    this.monitor(path, current);
    const generation = this.generations.get(path) || 0;
    const cached = this.directories.get(path);
    const valid = !this.force && cached?.signature === signature(current);
    if (valid) {
      this.counters.reusedDirectories++;
      if (
        this.watchers.has(path) &&
        cached.generation === generation &&
        Date.now() - cached.checkedAt < this.maxAgeMs
      )
        this.trusted.add(path);
      // Revalidated children replace expired/unwatched metadata in this record.
      if (!this.trusted.has(path)) {
        cached.stats.clear();
        cached.checkedAt = Date.now();
        cached.generation = generation;
      }
      let position = 0;
      return {
        read: async () =>
          position < cached.names.length
            ? { name: cached.names[position++] }
            : null,
        close: async () => {},
      };
    }
    this.counters.enumeratedDirectories++;
    const cursor = await opendir(path);
    const record: DirectoryRecord = {
      signature: signature(current),
      names: [],
      stats: new Map(),
      checkedAt: Date.now(),
      generation,
    };
    this.directories.set(path, record);
    let exhausted = false;
    return {
      read: async () => {
        const next = await cursor.read();
        if (next) record.names.push(next.name);
        else exhausted = true;
        return next;
      },
      close: async () => {
        await cursor.close();
        if (!exhausted || generation !== (this.generations.get(path) || 0))
          this.directories.delete(path);
      },
    };
  }

  async stat(path: string): Promise<Stats> {
    const parent = dirname(path);
    const record = this.directories.get(parent);
    const cached = this.trusted.has(parent)
      ? record?.stats.get(basename(path))
      : null;
    if (
      cached?.isFile() &&
      cached.nlink === 1 &&
      record &&
      Date.now() - record.checkedAt < this.maxAgeMs
    ) {
      this.counters.reusedFiles++;
      return cached;
    }
    this.counters.checkedFiles++;
    const current = await lstat(path);
    record?.stats.set(basename(path), current);
    return current;
  }

  async finish(): Promise<StorageIndexStats> {
    this.counters.changedDuringAnalysis =
      this.globalGeneration !== this.startingGeneration;
    // Keep index growth bounded; eviction also releases native watcher resources.
    let entries = 0;
    for (const [path, d] of [...this.directories].reverse()) {
      entries += d.names.length + 1;
      if (entries > 20000 || this.directories.size > 2000) {
        this.directories.delete(path);
        this.watchers.get(path)?.close();
        this.watchers.delete(path);
        this.watcherIdentities.delete(path);
      }
    }
    try {
      const body = JSON.stringify({
        version: 1,
        directories: [...this.directories].map(([path, d]) => ({
          path,
          signature: d.signature,
          names: d.names,
        })),
      });
      if (Buffer.byteLength(body) <= 4 * 1024 * 1024) {
        await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
        const temporary = `${this.file}.${randomUUID()}.tmp`;
        await writeFile(temporary, body, { mode: 0o600, flag: "wx" });
        await rename(temporary, this.file);
      }
    } catch {
      /* Index persistence failure must not fail read-only analysis. */
    }
    return { ...this.counters };
  }

  dispose(): void {
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
    this.watcherIdentities.clear();
    this.directories.clear();
    this.trusted.clear();
  }
}
