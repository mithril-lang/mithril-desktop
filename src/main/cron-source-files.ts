import { createHash } from "crypto";
import {
  constants,
  lstatSync,
  openSync,
  fstatSync,
  readSync,
  closeSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { validJson, type JsonValue } from "@mithril/workspace/repository";

export interface OriginalCronFile {
  profile: string;
  version: string;
  /** Exact source for whole-file cloud publication; main-process only. */
  sourceText: string;
  file: Record<string, JsonValue> | JsonValue[];
}
function checked(path: string): void {
  for (let current = resolve(path); ; current = dirname(current)) {
    try {
      if (lstatSync(current).isSymbolicLink())
        throw Error("Unsafe schedule source");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (dirname(current) === current) return;
  }
}
/** Main-process capture only. Raw source may contain private runtime bindings; it is not a cloud body.
 * Read one opened inode without repairing, normalizing, uploading or starting any original job.
 */
export function captureOriginalCronFile(
  root: string,
  profile: string,
): OriginalCronFile | null {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(profile))
    throw Error("Invalid schedule profile");
  const path = join(root, "cron", "jobs.json");
  checked(path);
  let fd: number;
  try {
    fd = openSync(
      path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw Error("Schedule source unavailable; original file retained");
  }
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > 20 * 1024 * 1024)
      throw Error("Schedule source requires review; original file retained");
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count)
        throw Error("Schedule source changed; original file retained");
      offset += count;
    }
    const after = fstatSync(fd);
    checked(path);
    const current = lstatSync(path);
    if (
      before.dev !== current.dev ||
      before.ino !== current.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      after.size !== current.size ||
      after.mtimeMs !== current.mtimeMs ||
      after.ctimeMs !== current.ctimeMs
    )
      throw Error("Schedule source changed; original file retained");
    const text = bytes.toString("utf8");
    if (!Buffer.from(text).equals(bytes))
      throw Error("Unsupported schedule encoding; original file retained");
    const file: unknown = JSON.parse(
      text.startsWith("\uFEFF") ? text.slice(1) : text,
    );
    if (!validJson(file) || !file || typeof file !== "object")
      throw Error("Invalid schedule source; original file retained");
    const jobs = Array.isArray(file)
      ? file
      : (file as Record<string, JsonValue>).jobs;
    if (
      !Array.isArray(jobs) ||
      jobs.length > 10000 ||
      jobs.some(
        (job) =>
          !job ||
          typeof job !== "object" ||
          Array.isArray(job) ||
          typeof job.id !== "string" ||
          !job.id,
      ) ||
      new Set(jobs.map((job) => (job as Record<string, JsonValue>).id)).size !==
        jobs.length
    )
      throw Error("Incomplete schedule inventory; original file retained");
    return {
      profile,
      version: createHash("sha256").update(bytes).digest("hex"),
      sourceText: text,
      file: file as OriginalCronFile["file"],
    };
  } finally {
    closeSync(fd);
  }
}
