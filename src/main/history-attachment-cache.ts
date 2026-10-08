import { createHash, randomUUID } from "crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { digestBytes } from "@mithril/workspace/files";
import {
  readHistoryAttachment,
  validHistoryAttachment,
  type HistoryAttachment,
  type HistoryFileTransport,
} from "@mithril/workspace/history";
import type { Attachment } from "../shared/attachments";
function checked(path: string): void {
  let current = resolve(path);
  for (;;) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw Error("Unsafe history storage");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
/** Restore verified account-owned bytes through an atomic private working cache. */
export async function restoreHistoryAttachment(
  root: string,
  owner: string,
  sessionId: string,
  file: HistoryAttachment,
  transport: HistoryFileTransport,
  guard: () => Promise<void>,
): Promise<Attachment> {
  if (!owner || owner.length > 128 || !validHistoryAttachment(file))
    throw Error("Invalid history attachment");
  await guard();
  const directory = join(
    root,
    "attachments",
    createHash("sha256").update(owner).digest("hex"),
  );
  checked(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, file.digest);
  checked(path);
  if (existsSync(path) && !lstatSync(path).isFile())
    throw Error("Invalid cached attachment");
  let bytes: Uint8Array | null = null;
  if (existsSync(path) && lstatSync(path).size === file.size) {
    const cached = readFileSync(path);
    if ((await digestBytes(cached)) === file.digest) bytes = cached;
  }
  if (!bytes) {
    bytes = await readHistoryAttachment(
      transport.forOwner(owner),
      sessionId,
      file,
    );
    await guard();
    // A source account can retire during download; never install its result after retirement.
    checked(path);
    if (existsSync(path) && !lstatSync(path).isFile())
      throw Error("Invalid cached attachment");
    const temporary = join(directory, ".stage-" + randomUUID());
    let fd: number | undefined;
    try {
      fd = openSync(temporary, "wx", 0o600);
      writeFileSync(fd, bytes);
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(temporary, path);
      if (process.platform !== "win32") {
        const dir = openSync(directory, "r");
        try {
          fsyncSync(dir);
        } finally {
          closeSync(dir);
        }
      }
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
  await guard();
  return {
    id: file.id,
    kind: file.kind === "file" ? "path-ref" : file.kind,
    name: file.name,
    mime: file.mime,
    size: file.size,
    ...(file.originalSize ? { originalSize: file.originalSize } : {}),
    ...(file.kind === "image"
      ? {
          dataUrl: `data:${file.mime};base64,${Buffer.from(bytes).toString("base64")}`,
        }
      : file.kind === "text-file"
        ? { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) }
        : { path }),
  };
}
