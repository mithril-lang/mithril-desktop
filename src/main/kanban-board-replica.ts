import Database from "better-sqlite3";
import { createHash } from "crypto";
import { execFileSync } from "child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  rmSync,
} from "fs";
import { join, dirname, resolve } from "path";
import schema from "../../tests/fixtures/agent-kanban-schema.sql?raw";
import {
  validBody,
  repositoryFingerprint,
  type JsonValue,
} from "@mithril/workspace/repository";
import type {
  ReplicaWrite,
  ReplicaResult,
} from "@mithril/workspace/replica-sync";
const metadataFields = [
  "description",
  "icon",
  "color",
  "project_id",
  "created_at",
  "archived",
];
function validMetadata(value: Record<string, JsonValue>): boolean {
  return (
    ["description", "icon", "color"].every(
      (k) =>
        !(k in value) ||
        (typeof value[k] === "string" && (value[k] as string).length <= 16384),
    ) &&
    (!("project_id" in value) ||
      value.project_id === null ||
      (typeof value.project_id === "string" &&
        /^[a-zA-Z0-9_-]{1,128}$/.test(value.project_id))) &&
    (!("created_at" in value) ||
      value.created_at === null ||
      (Number.isSafeInteger(value.created_at) &&
        Number(value.created_at) >= 0)) &&
    (!("archived" in value) || typeof value.archived === "boolean")
  );
}
function checked(path: string): void {
  for (let at = resolve(path); ; at = dirname(at)) {
    try {
      if (lstatSync(at).isSymbolicLink())
        throw Error("Unsafe Kanban board storage");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (at === dirname(at)) break;
  }
}
/** Read original display metadata; private execution directories stay outside the projection. */
export function kanbanBoardRecord(
  root: string,
  slug: string,
  tasks: unknown[],
): { body: JsonValue; version: string } {
  const file = join(root, "kanban", "boards", slug, "board.json");
  checked(file);
  let bytes: string | null = null;
  const body: Record<string, JsonValue> = {
    slug,
    name:
      slug
        .replace(/_/g, "-")
        .split("-")
        .filter(Boolean)
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(" ") || slug,
    is_current: false,
    total: 0,
    counts: {},
  };
  if (existsSync(file)) {
    if (!lstatSync(file).isFile() || lstatSync(file).size > 65536)
      throw Error("Unsupported board metadata; source retained");
    bytes = readFileSync(file, "utf8");
    const value = JSON.parse(bytes.replace(/^\uFEFF/, ""));
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some(
        (k) =>
          !["slug", "name", "default_workdir", ...metadataFields].includes(k),
      )
    )
      throw Error("Unsupported board metadata; source retained");
    if (value.name !== undefined) body.name = value.name;
    for (const key of metadataFields) if (key in value) body[key] = value[key];
    if (
      typeof body.name !== "string" ||
      !body.name.trim() ||
      body.name.length > 512 ||
      !validBody(body) ||
      !validMetadata(body)
    )
      throw Error("Invalid board metadata; source retained");
  }
  return {
    body,
    version: createHash("sha256")
      .update(
        JSON.stringify(bytes === null ? [slug, tasks] : [slug, tasks, bytes]),
      )
      .digest("hex"),
  };
}
const publish = String.raw`
import os,sys,ctypes,errno,stat
source,target=sys.argv[1:]
parent=os.path.dirname(source)
if parent!=os.path.dirname(target) or not os.path.basename(source).startswith('.mithril-board-'):raise RuntimeError('Invalid board publication')
flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW
fd=os.open('/',flags)
try:
 for part in os.path.abspath(parent).split('/')[1:]:
  nxt=os.open(part,flags,dir_fd=fd);os.close(fd);fd=nxt
 sf=os.open(os.path.basename(source),flags,dir_fd=fd)
 try:
  for leaf in ('kanban.db','board.json'):
   f=os.open(leaf,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=sf)
   if not stat.S_ISREG(os.fstat(f).st_mode):raise RuntimeError('Invalid staged board file')
   os.fsync(f);os.close(f)
  os.fsync(sf)
  if os.fstat(sf).st_ino != os.stat(os.path.basename(source),dir_fd=fd,follow_symlinks=False).st_ino:raise RuntimeError('Board staging changed')
  lib=ctypes.CDLL(None,use_errno=True)
  if sys.platform=='darwin':fn=lib.renameatx_np;flag=4
  elif sys.platform.startswith('linux'):fn=lib.renameat2;flag=1
  else:raise RuntimeError('Exclusive board publication unavailable')
  fn.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];fn.restype=ctypes.c_int
  if fn(fd,os.fsencode(os.path.basename(source)),fd,os.fsencode(os.path.basename(target)),flag):
   code=ctypes.get_errno()
   if code in (errno.EEXIST,errno.ENOTEMPTY):print('conflict')
   else:raise OSError(code,os.strerror(code))
  else:os.fsync(fd);print('applied')
 finally:os.close(sf)
finally:os.close(fd)
`;
const publishDefault = String.raw`
import os,sys,stat,errno
source,root=sys.argv[1:]
if os.path.dirname(source)!=root or not os.path.basename(source).startswith('.mithril-default-board-'):raise RuntimeError('Invalid default board publication')
flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW
fd=os.open('/',flags)
try:
 for part in os.path.abspath(root).split('/')[1:]:
  nxt=os.open(part,flags,dir_fd=fd);os.close(fd);fd=nxt
 sf=os.open(os.path.basename(source),flags,dir_fd=fd)
 try:
  f=os.open('kanban.db',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=sf)
  try:
   if not stat.S_ISREG(os.fstat(f).st_mode):raise RuntimeError('Invalid default board file')
   os.fsync(f)
   if os.fstat(sf).st_ino!=os.stat(os.path.basename(source),dir_fd=fd,follow_symlinks=False).st_ino:raise RuntimeError('Default staging changed')
   try:os.link('kanban.db','kanban.db',src_dir_fd=sf,dst_dir_fd=fd,follow_symlinks=False)
   except FileExistsError:print('conflict')
   else:os.fsync(fd);print('applied')
  finally:os.close(f)
 finally:os.close(sf)
finally:os.close(fd)
`;
function initializeDefaultBoard(
  root: string,
  userId: string,
  replicaId: string,
  write: ReplicaWrite,
  python: string,
): ReplicaResult {
  const result = (
    status: ReplicaResult["status"],
    record: ReplicaResult["record"] = null,
  ): ReplicaResult => ({ schemaVersion: 1, userId, replicaId, status, record });
  const observed = kanbanBoardRecord(root, "default", []);
  if (
    repositoryFingerprint({ body: observed.body, deleted: false }) !==
    repositoryFingerprint(write.document)
  )
    return result("deferred");
  checked(root);
  const target = join(root, "kanban.db");
  checked(target);
  if (existsSync(target)) return result("conflict");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  checked(root);
  const stage = mkdtempSync(join(root, ".mithril-default-board-"));
  try {
    const accepted = result("applied", {
      collection: "board",
      id: "default",
      body: observed.body,
      deleted: false,
      version: observed.version,
    });
    const db = new Database(join(stage, "kanban.db"));
    try {
      db.exec(schema);
      db.exec(
        "CREATE TABLE mithril_replica_receipts(operation_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL)",
      );
      db.prepare("INSERT INTO mithril_replica_receipts VALUES(?,?,?)").run(
        write.operationId,
        createHash("sha256").update(JSON.stringify(write)).digest("hex"),
        JSON.stringify(accepted),
      );
    } finally {
      db.close();
    }
    if (kanbanBoardRecord(root, "default", []).version !== observed.version)
      return result("conflict");
    const status = execFileSync(
      python,
      ["-I", "-c", publishDefault, stage, root],
      { encoding: "utf8", timeout: 10000 },
    ).trim();
    if (status === "conflict") return result("conflict");
    if (status !== "applied")
      throw Error("Default board publication not confirmed");
    if (kanbanBoardRecord(root, "default", []).version !== observed.version)
      throw Error("Default board metadata changed; receipt retained");
    return accepted;
  } finally {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
  }
}
/** Publish an empty named board, complete schema and retained receipt without running Agent code. */
export function restoreKanbanBoard(
  root: string,
  userId: string,
  replicaId: string,
  write: ReplicaWrite,
  python: string,
): ReplicaResult {
  const result = (
    status: ReplicaResult["status"],
    record: ReplicaResult["record"] = null,
  ): ReplicaResult => ({ schemaVersion: 1, userId, replicaId, status, record });
  const value = write.document.body;
  if (
    write.document.deleted ||
    write.expectedVersion !== null ||
    write.expectedRecord !== null ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    return result("deferred");
  const body = value as Record<string, JsonValue>,
    slug = write.document.id;
  if (
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug) ||
    body.slug !== slug ||
    typeof body.name !== "string" ||
    !body.name.trim() ||
    body.name.length > 512 ||
    body.is_current !== false ||
    body.total !== 0 ||
    JSON.stringify(body.counts) !== "{}" ||
    Object.keys(body).some(
      (k) =>
        ![
          "slug",
          "name",
          "is_current",
          "total",
          "counts",
          ...metadataFields,
        ].includes(k),
    ) ||
    !validBody(body) ||
    !validMetadata(body)
  )
    return result("deferred");
  if (slug === "default")
    return initializeDefaultBoard(root, userId, replicaId, write, python);
  const parent = join(root, "kanban", "boards"),
    target = join(parent, slug);
  checked(parent);
  checked(target);
  if (existsSync(target)) return result("conflict");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  checked(parent);
  const stage = mkdtempSync(join(parent, ".mithril-board-"));
  try {
    const metadata = Object.fromEntries(
      Object.entries(body).filter(
        ([k]) => !["is_current", "total", "counts"].includes(k),
      ),
    );
    const bytes = JSON.stringify(metadata) + "\n";
    writeFileSync(join(stage, "board.json"), bytes, {
      flag: "wx",
      mode: 0o600,
    });
    const version = createHash("sha256")
      .update(JSON.stringify([slug, [], bytes]))
      .digest("hex");
    const accepted = result("applied", {
      collection: "board",
      id: slug,
      body,
      deleted: false,
      version,
    });
    const db = new Database(join(stage, "kanban.db"));
    try {
      db.exec(schema);
      db.exec(
        "CREATE TABLE mithril_replica_receipts(operation_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL)",
      );
      db.prepare("INSERT INTO mithril_replica_receipts VALUES(?,?,?)").run(
        write.operationId,
        createHash("sha256").update(JSON.stringify(write)).digest("hex"),
        JSON.stringify(accepted),
      );
    } finally {
      db.close();
    }
    const file = openSync(join(stage, "kanban.db"), "r");
    try {
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
    const status = execFileSync(python, ["-I", "-c", publish, stage, target], {
      encoding: "utf8",
      timeout: 10000,
    }).trim();
    if (status === "conflict") return result("conflict");
    if (status !== "applied") throw Error("Board publication not confirmed");
    const actual = kanbanBoardRecord(root, slug, []);
    if (
      repositoryFingerprint({ body: actual.body, deleted: false }) !==
        repositoryFingerprint({ body, deleted: false }) ||
      actual.version !== version
    )
      throw Error("Board publication read-back changed; receipt retained");
    return accepted;
  } finally {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
  }
}
