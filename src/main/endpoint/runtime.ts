import { constants, watch, type FSWatcher } from "node:fs";
import {
  mkdir,
  open,
  opendir,
  realpath,
  readFile,
  rename,
  writeFile,
  stat as fileStat,
  lstat,
} from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { EndpointStatus } from "../../shared/endpoint-protection";
import { DefinitionStore } from "./definitions";
import {
  ConnectionDetector,
  FileChangeDetector,
  scanBytes,
  type Finding,
} from "./detection";
import { collectConnections } from "./sensors";

const FILE_LIMIT = 2 * 1024 * 1024;
export class EndpointRuntime {
  private definitions: DefinitionStore;
  private enabled = false;
  private folders: string[] = [];
  private watchers: FSWatcher[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private detector = new ConnectionDetector();
  private generation = 0;
  private queue = new Map<string, string>();
  private draining = false;
  private fileChanges = new FileChangeDetector();
  private cooldown = new Map<string, number>();
  private scanGaps = new Set<string>();
  private sensorGaps: string[] = [];
  private lastPoll: string | null = null;
  private lastUpdate: string | null = null;
  private updateError: string | null = null;
  private scannedFiles = 0;
  private connections: EndpointStatus["connections"] = [];
  private alerts: EndpointStatus["alerts"] = [];
  constructor(private directory: string) {
    this.definitions = new DefinitionStore(join(directory, "definitions"));
  }
  async initialize(): Promise<void> {
    await this.definitions.load().catch(() => {
      this.updateError =
        "Cached definitions failed verification; using bundled definitions.";
    });
    try {
      const config = JSON.parse(
        await readFile(join(this.directory, "settings.json"), "utf8"),
      );
      if (
        typeof config.enabled !== "boolean" ||
        !Array.isArray(config.folders) ||
        config.folders.length > 8 ||
        config.folders.some(
          (p: unknown) => typeof p !== "string" || !isAbsolute(p),
        )
      )
        throw Error("Invalid settings");
      this.folders = config.folders;
      this.enabled = config.enabled;
      if (this.enabled) await this.start();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        this.addGap("Endpoint settings could not be loaded.");
    }
  }
  status(): EndpointStatus {
    const gaps = [...this.scanGaps, ...this.sensorGaps];
    if (!this.folders.length)
      gaps.push("No folder has been selected for file monitoring.");
    if (
      this.definitions.expires &&
      Date.parse(this.definitions.expires) <= Date.now()
    )
      gaps.push(
        "Definitions have expired; last-known-good rules remain active.",
      );
    return {
      enabled: this.enabled,
      running: !!this.pollTimer,
      folders: [...this.folders],
      definitions: {
        version: this.definitions.pack.version,
        source: this.definitions.source,
        expires: this.definitions.expires,
      },
      lastPoll: this.lastPoll,
      lastUpdate: this.lastUpdate,
      scannedFiles: this.scannedFiles,
      connections: this.connections.slice(0, 100),
      alerts: [...this.alerts],
      gaps,
      updateError: this.updateError,
    };
  }
  async setEnabled(value: boolean): Promise<EndpointStatus> {
    if (typeof value !== "boolean") throw Error("Expected a boolean");
    this.stop();
    this.enabled = value;
    await this.save();
    if (value) await this.start();
    return this.status();
  }
  async addFolder(folder: string): Promise<EndpointStatus> {
    if (this.folders.length >= 8)
      throw Error("Up to eight folders may be monitored");
    const canonical = await realpath(folder);
    if (!(await fileStat(canonical)).isDirectory())
      throw Error("A folder is required");
    if (!this.folders.includes(canonical)) this.folders.push(canonical);
    await this.reconfigure();
    return this.status();
  }
  async removeFolder(folder: string): Promise<EndpointStatus> {
    if (typeof folder !== "string" || !this.folders.includes(folder))
      throw Error("Folder was not selected");
    this.folders = this.folders.filter((p) => p !== folder);
    await this.reconfigure();
    return this.status();
  }
  async scanFile(file: string, root?: string): Promise<EndpointStatus> {
    const actual = await realpath(file);
    if (root && !inside(root, actual))
      throw Error("File resolves outside the selected folder");
    const before = await lstat(actual);
    if (!before.isFile()) throw Error("Only regular files can be scanned");
    if (before.size > FILE_LIMIT)
      throw Error("File exceeds the 2 MiB scan limit");
    const handle = await open(
      actual,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW || 0) |
        (constants.O_NONBLOCK || 0),
    );
    try {
      const stat = await handle.stat();
      if (
        root &&
        (!inside(root, await realpath(actual)) ||
          (await realpath(root)) !== root)
      )
        throw Error("Selected folder scope changed during file access");
      if (!stat.isFile()) throw Error("Only regular files can be scanned");
      if (stat.size > FILE_LIMIT)
        throw Error("File exceeds the 2 MiB scan limit");
      // Read a fixed bound, even if a file grows after stat.
      const bytes = Buffer.alloc(FILE_LIMIT + 1);
      let length = 0;
      for (;;) {
        const r = await handle.read(bytes, length, bytes.length - length, null);
        length += r.bytesRead;
        if (!r.bytesRead || length === bytes.length) break;
      }
      if (length > FILE_LIMIT) throw Error("File grew beyond the scan limit");
      this.scannedFiles++;
      for (const finding of scanBytes(
        bytes.subarray(0, length),
        actual,
        this.definitions.pack,
      ))
        this.record(finding);
    } finally {
      await handle.close();
    }
    return this.status();
  }
  async updateDefinitions(): Promise<EndpointStatus> {
    try {
      await this.definitions.update();
      this.lastUpdate = new Date().toISOString();
      this.updateError = null;
    } catch {
      this.updateError =
        "Definition update failed verification or download; previous rules retained.";
    }
    return this.status();
  }
  stop(): void {
    this.generation++;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.updateTimer) clearInterval(this.updateTimer);
    this.pollTimer = null;
    this.updateTimer = null;
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    this.queue.clear();
    this.detector.reset();
    this.fileChanges.reset();
    this.connections = [];
    this.lastPoll = null;
  }
  private async save(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const filename = join(this.directory, "settings.json");
    await writeFile(
      `${filename}.next`,
      JSON.stringify({ enabled: this.enabled, folders: this.folders }),
      { mode: 0o600 },
    );
    await rename(`${filename}.next`, filename);
  }
  private async reconfigure(): Promise<void> {
    this.stop();
    await this.save();
    if (this.enabled) await this.start();
  }
  private async start(): Promise<void> {
    this.scanGaps.clear();
    this.sensorGaps = [];
    const generation = this.generation;
    for (const root of this.folders) {
      try {
        // Reject a selected root replaced by a symlink between application launches.
        if ((await realpath(root)) !== root)
          throw Error("Selected root changed");
        if (generation !== this.generation) return;
        const watcher = watch(root, { recursive: true }, (_event, filename) => {
          if (generation !== this.generation) return;
          if (!filename) {
            this.addGap("A file notification had no path.");
            return;
          }
          const file = join(root, filename.toString());
          if (!inside(root, file)) {
            this.addGap("An out-of-scope notification was refused.");
            return;
          }
          const now = Date.now();
          const finding = this.fileChanges.evaluate(
            root,
            file,
            this.definitions.pack,
            now,
          );
          if (finding) this.record(finding);
          if (this.queue.size >= 100) {
            this.addGap(
              "File event queue exceeded 100 entries; some events were missed.",
            );
            return;
          }
          this.queue.set(file, root);
          void this.drain();
        });
        watcher.on("error", () => {
          this.addGap(`File watcher failed: ${root}`);
          watcher.close();
        });
        this.watchers.push(watcher);
        void this.seed(root, generation);
      } catch {
        this.addGap(`Folder cannot be monitored: ${root}`);
      }
    }
    if (generation !== this.generation) return;
    this.pollTimer = setInterval(() => void this.poll(), 5000);
    this.pollTimer.unref();
    // Spread update checks across clients and retain rules while offline.
    this.updateTimer = setInterval(
      () => void this.updateDefinitions(),
      3600000 + Math.floor(Math.random() * 300000),
    );
    this.updateTimer.unref();
    void this.poll();
    void this.updateDefinitions();
  }
  private async seed(root: string, generation: number): Promise<void> {
    const directories = [root];
    let count = 0;
    try {
      while (
        directories.length &&
        count < 500 &&
        generation === this.generation
      ) {
        const dir = directories.shift()!;
        for await (const entry of await opendir(dir)) {
          if (generation !== this.generation || count >= 500) break;
          count++;
          const file = join(dir, entry.name);
          if (entry.isDirectory()) directories.push(file);
          else if (entry.isFile()) {
            try {
              await this.scanFile(file, root);
            } catch {
              this.addGap(
                "Some selected-folder files were unreadable or exceeded the scan limit.",
              );
            }
          } else if (entry.isSymbolicLink())
            this.addGap("Symbolic links are excluded from file scans.");
        }
      }
      if (count >= 500)
        this.addGap("Initial folder scan reached its 500-entry limit.");
    } catch {
      this.addGap(`Initial folder scan failed: ${root}`);
    }
  }
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.size) {
        const [file, root] = this.queue.entries().next().value!;
        this.queue.delete(file);
        try {
          await this.scanFile(file, root);
        } catch {
          this.addGap(
            "Some changed files were deleted, unreadable or exceeded the scan limit.",
          );
        }
      }
    } finally {
      this.draining = false;
    }
  }
  private async poll(): Promise<void> {
    if (this.polling || !this.enabled || !this.pollTimer) return;
    this.polling = true;
    const generation = this.generation;
    try {
      const { rows, gaps } = await collectConnections();
      if (generation !== this.generation) return;
      this.connections = rows;
      this.sensorGaps = gaps;
      this.lastPoll = new Date().toISOString();
      for (const finding of this.detector.evaluate(
        rows,
        this.definitions.pack,
        Date.now(),
      ))
        this.record(finding);
    } catch {
      if (generation === this.generation) {
        this.connections = [];
        this.lastPoll = null;
        this.detector.reset();
        this.sensorGaps = [
          "Connection collection failed; network activity is unmeasured.",
        ];
      }
    } finally {
      this.polling = false;
    }
  }
  private addGap(message: string): void {
    if (this.scanGaps.size < 20) this.scanGaps.add(message);
  }
  private record(finding: Finding): void {
    const key = `${finding.rule}:${finding.subject}`;
    const now = Date.now();
    if (now - (this.cooldown.get(key) || 0) < 60000) return;
    if (this.cooldown.size > 1000) this.cooldown.clear();
    this.cooldown.set(key, now);
    this.alerts.unshift({
      id: randomUUID(),
      time: new Date(now).toISOString(),
      ...finding,
    });
    this.alerts = this.alerts.slice(0, 100);
  }
}
export function inside(root: string, file: string): boolean {
  const rel = relative(root, file);
  return (
    !!rel && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`)
  );
}
