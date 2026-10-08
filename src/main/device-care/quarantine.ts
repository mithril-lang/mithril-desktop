import { safeStorage } from "electron";
import { constants } from "fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  statfs,
  unlink,
  writeFile,
} from "fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "path";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "crypto";
import type {
  QuarantineCandidate,
  QuarantineEntry,
  ScanJob,
} from "../../shared/device-care";
import { secureKeyring } from "./vendor";
const MAX = 25 * 1024 * 1024;
function digest(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
function inside(root: string, file: string): boolean {
  const part = relative(root, file);
  return (
    !!part && !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`)
  );
}
async function snapshot(
  path: string,
): Promise<{ bytes: Buffer; identity: string }> {
  if ((await realpath(path)) !== path)
    throw Error("Symbolic links are excluded");
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat();
    const linked = await lstat(path);
    if (
      (await realpath(path)) !== path ||
      linked.dev !== before.dev ||
      linked.ino !== before.ino
    )
      throw Error("File scope changed");
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.size > MAX ||
      (process.getuid && before.uid !== process.getuid())
    )
      throw Error(
        "Only owned regular files up to 25 MiB with one link are eligible",
      );
    const buffer = Buffer.alloc(MAX + 1);
    let count = 0;
    while (count < buffer.length) {
      const read = await handle.read(
        buffer,
        count,
        buffer.length - count,
        null,
      );
      count += read.bytesRead;
      if (!read.bytesRead) break;
    }
    const after = await handle.stat();
    if (
      count > MAX ||
      count !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw Error("File changed while reading");
    return {
      bytes: buffer.subarray(0, count),
      identity: `${before.dev}:${before.ino}:${before.size}:${before.mtimeMs}:${before.ctimeMs}`,
    };
  } finally {
    await handle.close();
  }
}
interface Lease {
  candidate: QuarantineCandidate;
  path: string;
  root: string;
  identity: string;
  expires: number;
}
interface RecordData extends QuarantineEntry {
  key: string;
  iv: string;
  tag: string;
  original: string;
}
async function durableWrite(
  path: string,
  bytes: Buffer | string,
): Promise<void> {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}
async function syncDirectory(path: string): Promise<void> {
  if (process.platform === "win32") return;
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
/** Encrypted local custody, explicitly distinct from Trend Micro's quarantine. */
export class DeviceCareQuarantine {
  private leases = new Map<string, Lease>();
  private vault: string;
  constructor(
    private directory: string,
    private verify: (path: string) => Promise<boolean>,
  ) {
    this.vault = join(directory, "device-care-quarantine");
  }
  private async privateDirectory(): Promise<void> {
    if (!secureKeyring())
      throw Error("An OS-backed keyring is required for quarantine");
    await mkdir(this.vault, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.vault);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (await realpath(this.vault)) !== this.vault ||
      stat.mode & 0o077 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw Error("Quarantine directory is not private");
  }
  async review(job: ScanJob | null): Promise<QuarantineCandidate[]> {
    this.leases.clear();
    if (!job || !["complete", "partial"].includes(job.state)) return [];
    await this.privateDirectory();
    for (const line of job.findings.slice(0, 100)) {
      const delimiter = line.lastIndexOf(": ");
      if (delimiter < 0 || !line.endsWith(" FOUND")) continue;
      const path = line.slice(0, delimiter);
      const signature = line.slice(delimiter + 2, -6);
      // Limits/encryption heuristics are incomplete inspection, not malware proof.
      if (
        !signature ||
        /^Heuristics\.(Limits|Encrypted)/.test(signature) ||
        !inside(job.root, path) ||
        inside(this.directory, path)
      )
        continue;
      try {
        if ((await realpath(job.root)) !== job.root) continue;
        const snap = await snapshot(path);
        const candidate = {
          id: randomUUID(),
          path,
          signature,
          bytes: snap.bytes.length,
          digest: digest(snap.bytes),
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        };
        this.leases.set(candidate.id, {
          candidate,
          path,
          root: job.root,
          identity: snap.identity,
          expires: Date.parse(candidate.expiresAt),
        });
      } catch {
        /* Not eligible; leave original untouched. */
      }
    }
    return [...this.leases.values()].map((lease) => ({ ...lease.candidate }));
  }
  async quarantine(
    id: unknown,
    approve: (item: QuarantineCandidate) => Promise<boolean>,
  ): Promise<QuarantineEntry | null> {
    const lease = typeof id === "string" ? this.leases.get(id) : undefined;
    if (!lease || Date.now() > lease.expires)
      throw Error("Quarantine review is missing or expired");
    this.leases.delete(lease.candidate.id);
    if (!(await approve(lease.candidate))) return null;
    if (Date.now() > lease.expires)
      throw Error("Quarantine review expired during confirmation");
    await this.privateDirectory();
    if ((await realpath(lease.root)) !== lease.root)
      throw Error("Selected folder changed");
    const snap = await snapshot(lease.path);
    if (
      snap.identity !== lease.identity ||
      digest(snap.bytes) !== lease.candidate.digest
    )
      throw Error("File changed; run a new scan and review");
    const space = await statfs(this.vault);
    if (space.bavail * space.bsize < snap.bytes.length * 3 + 100 * 1024 * 1024)
      throw Error("Insufficient space to preserve quarantine safely");
    const directory = join(this.vault, randomUUID());
    await mkdir(directory, { mode: 0o700 });
    const sample = join(directory, "verification.sample");
    await writeFile(sample, snap.bytes, { flag: "wx", mode: 0o600 });
    try {
      if (!(await this.verify(sample)))
        throw Error(
          "ClamAV did not confirm a malware signature in the captured bytes",
        );
    } finally {
      await unlink(sample);
    }
    const key = randomBytes(32),
      iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(lease.candidate.digest));
    const encrypted = Buffer.concat([
      cipher.update(snap.bytes),
      cipher.final(),
    ]);
    await durableWrite(join(directory, "payload.enc"), encrypted);
    const record: RecordData = {
      id: basename(directory),
      name: basename(lease.path),
      signature: lease.candidate.signature,
      bytes: snap.bytes.length,
      digest: lease.candidate.digest,
      createdAt: new Date().toISOString(),
      state: "pending",
      original: lease.path,
      key: safeStorage.encryptString(key.toString("base64")).toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
    await this.save(directory, record);
    // Verify durable ciphertext and key before removing the original from its path.
    const decoded = await this.decrypt(directory, record);
    if (digest(decoded) !== record.digest)
      throw Error("Quarantine verification failed");
    const current = await snapshot(lease.path);
    if (
      current.identity !== lease.identity ||
      digest(current.bytes) !== record.digest ||
      (await realpath(dirname(lease.path))) !== dirname(lease.path)
    )
      throw Error("File changed before quarantine");
    const staged = join(directory, "retained-original");
    await rename(lease.path, staged);
    try {
      const moved = await snapshot(staged);
      // rename updates ctime; bind the original dev/inode plus exact bytes.
      if (
        moved.identity.split(":").slice(0, 2).join(":") !==
          snap.identity.split(":").slice(0, 2).join(":") ||
        digest(moved.bytes) !== record.digest
      )
        throw Error("A substituted file was retained for recovery");
      await chmod(staged, 0o600);
      await unlink(staged);
      record.state = "quarantined";
      await this.save(directory, record);
    } catch {
      record.state = "recovery-required";
      await this.save(directory, record);
      throw Error(
        "Quarantine interrupted; preserved copy and retained original are available in the private vault",
      );
    }
    return this.publicEntry(record);
  }
  private publicEntry(record: RecordData): QuarantineEntry {
    return {
      id: record.id,
      name: record.name,
      signature: record.signature,
      bytes: record.bytes,
      digest: record.digest,
      createdAt: record.createdAt,
      state: record.state,
    };
  }
  private async save(directory: string, record: RecordData): Promise<void> {
    const temporary = join(directory, `${randomUUID()}.json`);
    await durableWrite(temporary, JSON.stringify(record));
    await rename(temporary, join(directory, "entry.json"));
    await syncDirectory(directory);
    await syncDirectory(this.vault);
  }
  private async load(
    id: unknown,
  ): Promise<{ directory: string; record: RecordData }> {
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id))
      throw Error("Invalid quarantine ID");
    await this.privateDirectory();
    const directory = join(this.vault, id);
    if (
      (await realpath(directory)) !== directory ||
      !(await lstat(directory)).isDirectory()
    )
      throw Error("Invalid quarantine directory");
    const record: RecordData = JSON.parse(
      await readFile(join(directory, "entry.json"), "utf8"),
    );
    if (
      record.id !== id ||
      !Number.isInteger(record.bytes) ||
      record.bytes < 0 ||
      record.bytes > MAX ||
      !/^[0-9a-f]{64}$/.test(record.digest)
    )
      throw Error("Invalid quarantine record");
    return { directory, record };
  }
  private async decrypt(
    directory: string,
    record: RecordData,
  ): Promise<Buffer> {
    const payloadPath = join(directory, "payload.enc");
    const stat = await lstat(payloadPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX)
      throw Error("Invalid quarantine payload");
    const key = Buffer.from(
      safeStorage.decryptString(Buffer.from(record.key, "base64")),
      "base64",
    );
    const cipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(record.iv, "base64"),
    );
    cipher.setAAD(Buffer.from(record.digest));
    cipher.setAuthTag(Buffer.from(record.tag, "base64"));
    const bytes = Buffer.concat([
      cipher.update(await readFile(payloadPath)),
      cipher.final(),
    ]);
    if (bytes.length !== record.bytes || digest(bytes) !== record.digest)
      throw Error("Quarantine integrity verification failed");
    return bytes;
  }
  async entries(): Promise<QuarantineEntry[]> {
    try {
      await this.privateDirectory();
    } catch {
      return [];
    }
    const entries: QuarantineEntry[] = [];
    for (const id of (await readdir(this.vault)).slice(0, 1000)) {
      try {
        entries.push(this.publicEntry((await this.load(id)).record));
      } catch {
        /* incomplete pre-move artifact; original not removed */
      }
    }
    return entries.slice(-100);
  }
  async restore(
    id: unknown,
    destination: string,
    approve: (item: QuarantineEntry) => Promise<boolean>,
  ): Promise<boolean> {
    const { directory, record } = await this.load(id);
    if (!["quarantined", "recovery-required", "pending"].includes(record.state))
      throw Error("This entry has already been restored");
    if (!(await approve(this.publicEntry(record)))) return false;
    if (
      (await realpath(dirname(destination))) !== dirname(destination) ||
      inside(this.vault, destination)
    )
      throw Error("Choose a regular destination outside quarantine");
    const bytes = await this.decrypt(directory, record);
    // Exclusive creation refuses overwrite and symlinks. Quarantine copy remains recoverable.
    const file = await open(destination, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    record.state = "restored";
    await this.save(directory, record);
    return true;
  }
}
