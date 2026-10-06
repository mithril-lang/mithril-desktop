import Database from "better-sqlite3";
import { createHash } from "crypto";
import { execFileSync } from "child_process";
import {
  existsSync,
  readdirSync,
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
import { validReplicaRecord } from "@mithril/workspace/replica-sync";
import type {
  ReplicaWrite,
  ReplicaResult,
  ReplicaRecord,
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
    if (Buffer.byteLength(bytes) > 65536) return result("deferred");
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

const publishMetadata = String.raw`
import os,sys,stat
source,target=sys.argv[1:]
parent=os.path.dirname(source)
if parent!=os.path.dirname(target) or not os.path.basename(source).startswith('.mithril-board-metadata-'):raise RuntimeError('Invalid metadata publication')
flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW
fd=os.open('/',flags)
try:
 for part in os.path.abspath(parent).split('/')[1:]:
  nxt=os.open(part,flags,dir_fd=fd);os.close(fd);fd=nxt
 sf=os.open(os.path.basename(source),flags,dir_fd=fd)
 try:
  f=os.open('board.json',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=sf)
  try:
   if not stat.S_ISREG(os.fstat(f).st_mode):raise RuntimeError('Invalid metadata staging')
   os.fsync(f)
   if os.fstat(sf).st_ino!=os.stat(os.path.basename(source),dir_fd=fd,follow_symlinks=False).st_ino:raise RuntimeError('Metadata staging changed')
   try:os.link('board.json',os.path.basename(target),src_dir_fd=sf,dst_dir_fd=fd,follow_symlinks=False)
   except FileExistsError:print('conflict')
   else:os.fsync(fd);print('applied')
  finally:os.close(f)
 finally:os.close(sf)
finally:os.close(fd)
`;
const syncMetadata = String.raw`
import os,sys,stat,hashlib
file,digest=sys.argv[1:]
flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW
fd=os.open('/',flags)
try:
 for part in os.path.abspath(os.path.dirname(file)).split('/')[1:]:
  nxt=os.open(part,flags,dir_fd=fd);os.close(fd);fd=nxt
 f=os.open(os.path.basename(file),os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
 try:
  if not stat.S_ISREG(os.fstat(f).st_mode):raise RuntimeError('Invalid published metadata')
  if hashlib.sha256(os.read(f,65537)).hexdigest()!=digest:raise RuntimeError('Published metadata changed')
  os.fsync(f);os.fsync(fd)
 finally:os.close(f)
finally:os.close(fd)
`;
export function hasPendingKanbanBoard(db: Database.Database): boolean {
  return (
    !!db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='mithril_board_pending'",
      )
      .get() &&
    !!db.prepare("SELECT 1 FROM mithril_board_pending LIMIT 1").get()
  );
}
/** Recover only the durable operation prepared for this board before reading a complete source. */
export function pendingKanbanBoards(root: string): string[] {
  const base = join(root, "kanban", "boards");
  checked(base);
  const slugs = [
    "default",
    ...(existsSync(base) ? requireBoardNames(base) : []),
  ];
  return [...new Set(slugs)].filter((slug) => {
    const file =
      slug === "default"
        ? join(root, "kanban.db")
        : join(base, slug, "kanban.db");
    checked(file);
    if (!existsSync(file)) return false;
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
      return hasPendingKanbanBoard(db);
    } finally {
      db.close();
    }
  });
}
function requireBoardNames(base: string): string[] {
  return readdirSync(base).filter((slug) =>
    /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug),
  );
}
/** Add absent original display metadata with a recoverable receipt, never replace another writer's file. */
export function initializeKanbanBoardMetadata(
  root: string,
  userId: string,
  replicaId: string,
  write: ReplicaWrite,
  python: string,
): ReplicaResult {
  const slug = write.document.id,
    body = write.document.body;
  const result = (
    status: ReplicaResult["status"],
    record: ReplicaRecord | null = null,
  ): ReplicaResult => ({ schemaVersion: 1, userId, replicaId, status, record });
  if (
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug) ||
    write.document.collection !== "board" ||
    write.document.deleted ||
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    body.slug !== slug ||
    typeof body.name !== "string" ||
    !body.name.trim() ||
    body.name.length > 512 ||
    body.is_current !== false ||
    body.total !== 0 ||
    JSON.stringify(body.counts) !== "{}" ||
    !validBody(body) ||
    !validMetadata(body) ||
    Object.keys(body).some(
      (key) =>
        ![
          "slug",
          "name",
          "is_current",
          "total",
          "counts",
          ...metadataFields,
        ].includes(key),
    )
  )
    return result("deferred");
  const dbFile =
    slug === "default"
      ? join(root, "kanban.db")
      : join(root, "kanban", "boards", slug, "kanban.db");
  const parent = join(root, "kanban", "boards", slug),
    file = join(parent, "board.json");
  checked(dbFile);
  checked(file);
  if (!existsSync(dbFile)) return result("deferred");
  const db = new Database(dbFile, { fileMustExist: true });
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(write))
    .digest("hex");
  const desiredBytes =
    JSON.stringify(
      Object.fromEntries(
        Object.entries(body).filter(
          ([key]) => !["is_current", "total", "counts"].includes(key),
        ),
      ),
    ) + "\n";
  if (Buffer.byteLength(desiredBytes) > 65536) return result("deferred");
  type Pending = { fingerprint: string; bytes: string; receipt: string };
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS mithril_board_pending(operation_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,bytes TEXT NOT NULL,receipt TEXT NOT NULL)",
    );
    const pending = db
      .prepare(
        "SELECT fingerprint,bytes,receipt FROM mithril_board_pending WHERE operation_id=?",
      )
      .get(write.operationId) as Pending | undefined;
    let journal: Pending | undefined = pending;
    if (journal && journal.fingerprint !== fingerprint)
      throw Error("Replica operation was reused");
    if (journal) {
      const saved = JSON.parse(journal.receipt) as ReplicaResult;
      if (
        saved.schemaVersion !== 1 ||
        !validReplicaRecord(saved.record) ||
        saved.record.collection !== "board" ||
        saved.record.deleted ||
        repositoryFingerprint({ body: saved.record.body, deleted: false }) !==
          repositoryFingerprint(write.document) ||
        journal.bytes !== desiredBytes ||
        saved.userId !== userId ||
        saved.replicaId !== replicaId ||
        saved.record?.id !== slug ||
        saved.status !== "applied"
      )
        throw Error("Invalid board transaction owner");
    } else {
      if (hasPendingKanbanBoard(db)) return result("deferred");
      const prepared = db
        .transaction(() => {
          const tasks = db.prepare("SELECT * FROM tasks LIMIT 1001").all();
          if (tasks.length > 1000) return result("deferred");
          const observed = kanbanBoardRecord(root, slug, tasks);
          const record: ReplicaRecord = {
            collection: "board",
            id: slug,
            ...observed,
            deleted: false,
          };
          if (existsSync(file)) return result("deferred", record);
          if (
            !write.expectedRecord ||
            write.expectedRecord.collection !== "board" ||
            write.expectedRecord.id !== slug ||
            write.expectedVersion !== observed.version ||
            write.expectedRecord.version !== observed.version ||
            repositoryFingerprint({
              body: write.expectedRecord.body,
              deleted: write.expectedRecord.deleted,
            }) !==
              repositoryFingerprint({ body: observed.body, deleted: false })
          )
            return result("conflict", record);
          const bytes =
            JSON.stringify(
              Object.fromEntries(
                Object.entries(body).filter(
                  ([key]) => !["is_current", "total", "counts"].includes(key),
                ),
              ),
            ) + "\n";
          const accepted = result("applied", {
            collection: "board",
            id: slug,
            body,
            deleted: false,
            version: createHash("sha256")
              .update(JSON.stringify([slug, tasks, bytes]))
              .digest("hex"),
          });
          journal = { fingerprint, bytes, receipt: JSON.stringify(accepted) };
          db.prepare("INSERT INTO mithril_board_pending VALUES(?,?,?,?)").run(
            write.operationId,
            fingerprint,
            bytes,
            journal.receipt,
          );
          return null;
        })
        .immediate();
      if (prepared) return prepared;
    }
    const retained = journal!;
    // The committed preparation survives any interruption between filesystem and SQLite publication.
    return db
      .transaction(() => {
        const tasks = db.prepare("SELECT * FROM tasks LIMIT 1001").all();
        if (tasks.length > 1000) return result("deferred");
        const observed = kanbanBoardRecord(root, slug, tasks);
        const current: ReplicaRecord = {
          collection: "board",
          id: slug,
          ...observed,
          deleted: false,
        };
        const abandon = (): ReplicaResult => {
          db.prepare(
            "DELETE FROM mithril_board_pending WHERE operation_id=?",
          ).run(write.operationId);
          return result("conflict", current);
        };
        if (existsSync(file)) {
          if (readFileSync(file, "utf8") !== retained.bytes) return abandon();
        } else {
          if (observed.version !== write.expectedVersion) return abandon();
          mkdirSync(parent, { recursive: true, mode: 0o700 });
          checked(parent);
          const stage = mkdtempSync(join(parent, ".mithril-board-metadata-"));
          try {
            writeFileSync(join(stage, "board.json"), retained.bytes, {
              flag: "wx",
              mode: 0o600,
            });
            const status = execFileSync(
              python,
              ["-I", "-c", publishMetadata, stage, file],
              { encoding: "utf8", timeout: 10000 },
            ).trim();
            if (status === "conflict") {
              const next = kanbanBoardRecord(root, slug, tasks);
              db.prepare(
                "DELETE FROM mithril_board_pending WHERE operation_id=?",
              ).run(write.operationId);
              return result("conflict", {
                collection: "board",
                id: slug,
                ...next,
                deleted: false,
              });
            }
            if (status !== "applied")
              throw Error("Board metadata publication not confirmed");
          } finally {
            if (existsSync(stage))
              rmSync(stage, { recursive: true, force: true });
          }
        }
        execFileSync(
          python,
          [
            "-I",
            "-c",
            syncMetadata,
            file,
            createHash("sha256").update(retained.bytes).digest("hex"),
          ],
          { encoding: "utf8", timeout: 10000 },
        );
        db.exec(
          "CREATE TABLE IF NOT EXISTS mithril_replica_receipts(operation_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL)",
        );
        db.prepare("INSERT INTO mithril_replica_receipts VALUES(?,?,?)").run(
          write.operationId,
          fingerprint,
          retained.receipt,
        );
        db.prepare(
          "DELETE FROM mithril_board_pending WHERE operation_id=?",
        ).run(write.operationId);
        return JSON.parse(retained.receipt) as ReplicaResult;
      })
      .immediate();
  } finally {
    db.close();
  }
}
