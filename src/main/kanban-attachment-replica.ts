import {
  attachmentIdentities,
  portableAttachmentRows,
} from "./kanban-attachment-identity";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  lstatSync,
  existsSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import type Database from "better-sqlite3";
import {
  repositoryFingerprint,
  type JsonValue,
} from "@mithril/workspace/repository";
import { CHUNK_BYTES, fileFingerprint } from "@mithril/workspace/files";
import {
  taskAttachmentRecords,
  type TaskAttachment,
  type TaskAttachmentReader,
} from "@mithril/workspace/task-attachments";

function checked(path: string): void {
  for (let current = resolve(path); ; ) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw Error("Unsafe attachment replica storage");
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

/** Only adds immutable inert files. Existing paths are never overwritten or deleted. */
const MATERIALIZE = String.raw`
import sys,json,os,stat,hashlib,contextlib,uuid
sys.stdout.reconfigure(encoding='utf-8')
try:
 p=json.load(sys.stdin)
 if os.name=='nt':raise ValueError('unsupported')
 flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW
 def open_dir(path,create=False):
  if not os.path.isabs(path):raise ValueError('unsafe')
  fd=os.open('/',flags)
  try:
   for part in path.split('/')[1:]:
    if not part:continue
    if part in ('.','..'):raise ValueError('unsafe')
    if create:
     try:os.mkdir(part,0o700,dir_fd=fd);os.fsync(fd)
     except FileExistsError:pass
    child=os.open(part,flags,dir_fd=fd);os.close(fd);fd=child
   return fd
  except:os.close(fd);raise
 def stamp(s):return(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
 def verify(fd,file):
  first=os.fstat(fd)
  if not stat.S_ISREG(first.st_mode) or first.st_size!=file['size']:raise ValueError('conflict')
  for digest in file['chunks']:
   data=os.read(fd,8388608)
   if hashlib.sha256(data).hexdigest()!=digest:raise ValueError('conflict')
  if os.read(fd,1) or stamp(first)!=stamp(os.fstat(fd)):raise ValueError('conflict')
 with contextlib.ExitStack() as stack:
  source=open_dir(p['stage']);stack.callback(os.close,source)
  target=open_dir(p['directory'],True);stack.callback(os.close,target)
  for file in p['files']:
   name=file['name'];temp='.mithril-sync-'+uuid.uuid4().hex
   try:
    existing=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=target)
   except FileNotFoundError:existing=None
   if existing is not None:
    try:verify(existing,file)
    finally:os.close(existing)
    continue
   out=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=target)
   try:
    with os.fdopen(out,'wb') as stream:
     size=0
     for digest in file['chunks']:
      chunk=os.open(digest,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=source)
      try:
       info=os.fstat(chunk)
       if not stat.S_ISREG(info.st_mode) or info.st_size!=min(8388608,file['size']-size):raise ValueError('conflict')
       data=os.read(chunk,8388609)
       if hashlib.sha256(data).hexdigest()!=digest or stamp(info)!=stamp(os.fstat(chunk)):raise ValueError('conflict')
       stream.write(data);size+=len(data)
      finally:os.close(chunk)
     if size!=file['size']:raise ValueError('conflict')
     stream.flush();os.fsync(stream.fileno())
    try:os.link(temp,name,src_dir_fd=target,dst_dir_fd=target,follow_symlinks=False)
    except FileExistsError:pass
    fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=target)
    try:verify(fd,file)
    finally:os.close(fd)
    os.fsync(target)
   finally:
    try:os.unlink(temp,dir_fd=target)
    except FileNotFoundError:pass
 print(json.dumps({'ok':True}))
except Exception:print(json.dumps({'ok':False}))
`;

export interface KanbanAttachmentWriteback {
  apply(
    db: Database.Database,
    current: TaskAttachment[],
    raw: Record<string, unknown>[],
    operationId: string,
  ): void;
  dispose(): void;
}

/** Retain cloud attachment ordering while still including later original-Agent additions. */
export function orderedKanbanAttachments(
  db: Database.Database,
  taskId: string,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const aliases = new Map(
    attachmentIdentities(db, taskId).map((row) => [
      row.native_id,
      row.cloud_id,
    ]),
  );
  if (
    !(
      db.prepare("PRAGMA table_info(mithril_attachment_projection)").all() as {
        name: string;
      }[]
    ).some((r) => r.name === "attachment_ids")
  )
    return rows;
  const marker = db
    .prepare(
      "SELECT attachment_ids FROM mithril_attachment_projection WHERE task_id=?",
    )
    .get(taskId) as { attachment_ids: string } | undefined;
  if (!marker) return rows;
  const ids = JSON.parse(marker.attachment_ids) as unknown;
  if (
    !Array.isArray(ids) ||
    ids.length > 10000 ||
    ids.some((id) => !Number.isSafeInteger(id) || id < 1) ||
    new Set(ids).size !== ids.length
  )
    throw Error("Invalid attachment order marker");
  const rank = new Map(ids.map((id, index) => [id, index]));
  return [...rows].sort(
    (a, b) =>
      (rank.get(aliases.get(Number(a.id)) ?? a.id) ?? ids.length) -
      (rank.get(aliases.get(Number(b.id)) ?? b.id) ?? ids.length),
  );
}

/** Download under an owner-pinned reader before entering the SQLite writer transaction. */
export async function prepareKanbanAttachmentWriteback(
  root: string,
  python: string,
  stateRoot: string,
  documentId: string,
  body: unknown,
  reader: TaskAttachmentReader,
  guard: () => Promise<void>,
): Promise<KanbanAttachmentWriteback> {
  const frozen = structuredClone(body);
  const incoming = taskAttachmentRecords(frozen, documentId);
  const data = frozen as {
    board: string;
    task: { id: string };
    attachments?: unknown;
  };
  if (
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(data.board) ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(data.task.id)
  )
    throw Error("Invalid attachment replica identity");
  checked(stateRoot);
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  checked(stateRoot);
  const stage = mkdtempSync(join(stateRoot, ".mithril-task-restore-"));
  const dispose = (): void => rmSync(stage, { recursive: true, force: true });
  try {
    const downloaded = new Map<string, number>();
    for (const row of incoming) {
      if (
        (await fileFingerprint(row.size, row.resource.chunks)) !==
        row.resource.digest
      )
        throw Error("Invalid attachment file fingerprint");
      for (const [index, digest] of row.resource.chunks.entries()) {
        const size = Math.min(CHUNK_BYTES, row.size - index * CHUNK_BYTES);
        if (downloaded.has(digest)) {
          if (downloaded.get(digest) !== size)
            throw Error("Invalid attachment chunk size");
          continue;
        }
        await guard();
        const bytes = await reader.getChunk(documentId, digest);
        await guard();
        if (
          bytes.length !== size ||
          createHash("sha256").update(bytes).digest("hex") !== digest
        )
          throw Error("Attachment integrity mismatch");
        checked(stage);
        writeFileSync(join(stage, digest), bytes, { flag: "wx", mode: 0o600 });
        downloaded.set(digest, size);
      }
    }
    await guard();
    return {
      dispose,
      apply(db, current, raw, operationId) {
        if (!db.inTransaction)
          throw Error("Attachment restoration requires a writer transaction");
        const columns = (
          db.prepare("PRAGMA table_info(task_attachments)").all() as {
            name: string;
          }[]
        ).map((r) => r.name);
        const fields = [
          "id",
          "task_id",
          "filename",
          "stored_path",
          "content_type",
          "size",
          "uploaded_by",
          "created_at",
        ];
        if (
          columns.length !== fields.length ||
          fields.some((f) => !columns.includes(f))
        )
          throw Error("Unsupported attachment schema");
        const same = (a: unknown, b: unknown): boolean =>
          repositoryFingerprint({ body: a as JsonValue, deleted: false }) ===
          repositoryFingerprint({ body: b as JsonValue, deleted: false });
        const aliases = attachmentIdentities(db, data.task.id);
        const portableRaw = portableAttachmentRows(db, data.task.id, raw);
        if (
          raw.length !== current.length ||
          portableRaw.some((row) => !current.some((old) => old.id === row.id))
        )
          throw Error("Attachment source changed");
        const nativeIds = new Map(
          aliases.map((row) => [row.cloud_id, row.native_id]),
        );
        const nativeId = (id: number): number => nativeIds.get(id) ?? id;
        const maximum = db
          .prepare("SELECT MAX(id) AS id FROM task_attachments")
          .get() as { id: number | null };
        if (maximum.id !== null && !Number.isSafeInteger(maximum.id))
          throw Error("Invalid attachment source ID");
        let next =
          Math.max(maximum.id ?? 0, ...incoming.map((row) => row.id)) + 1;
        const mappings: { cloud: number; native: number }[] = [];
        for (const row of incoming) {
          if (nativeIds.has(row.id)) continue;
          const collision = db
            .prepare("SELECT task_id FROM task_attachments WHERE id=?")
            .get(row.id) as { task_id: string } | undefined;
          if (
            collision &&
            (collision.task_id !== data.task.id ||
              aliases.some((alias) => alias.native_id === row.id))
          ) {
            if (!Number.isSafeInteger(next))
              throw Error("Attachment ID capacity exceeded");
            nativeIds.set(row.id, next);
            mappings.push({ cloud: row.id, native: next++ });
          }
        }
        const changed = incoming.filter(
          (row) => !current.some((old) => same(old, row)),
        );
        const directory =
          data.board === "default"
            ? join(root, "kanban", "attachments", data.task.id)
            : join(
                root,
                "kanban",
                "boards",
                data.board,
                "attachments",
                data.task.id,
              );
        const name = (row: TaskAttachment): string =>
          `mithril-${row.id}-${row.resource.digest}.bin`;
        if (changed.length) {
          const result = spawnSync(python, ["-I", "-c", MATERIALIZE], {
            input: JSON.stringify({
              stage,
              directory: resolve(directory),
              files: changed.map((row) => ({
                name: name(row),
                size: row.size,
                chunks: row.resource.chunks,
              })),
            }),
            encoding: "utf8",
            timeout: 60000,
            maxBuffer: 4096,
          });
          if (
            result.error ||
            result.status !== 0 ||
            !JSON.parse(result.stdout).ok
          )
            throw Error(
              "Attachment restoration unavailable; original files retained",
            );
        }
        db.exec(
          "CREATE TABLE IF NOT EXISTS mithril_attachment_history(operation_id TEXT NOT NULL,attachment_id INTEGER NOT NULL,original_row TEXT NOT NULL,PRIMARY KEY(operation_id,attachment_id))",
        );
        db.exec(
          "CREATE TABLE IF NOT EXISTS mithril_attachment_projection(task_id TEXT PRIMARY KEY,attachment_ids TEXT NOT NULL DEFAULT '[]')",
        );
        if (
          !(
            db
              .prepare("PRAGMA table_info(mithril_attachment_projection)")
              .all() as { name: string }[]
          ).some((r) => r.name === "attachment_ids")
        )
          db.exec(
            "ALTER TABLE mithril_attachment_projection ADD COLUMN attachment_ids TEXT NOT NULL DEFAULT '[]'",
          );
        if (data.attachments !== undefined)
          db.prepare(
            "INSERT INTO mithril_attachment_projection(task_id,attachment_ids) VALUES(?,?) ON CONFLICT(task_id) DO UPDATE SET attachment_ids=excluded.attachment_ids",
          ).run(data.task.id, JSON.stringify(incoming.map((row) => row.id)));
        else
          db.prepare(
            "DELETE FROM mithril_attachment_projection WHERE task_id=?",
          ).run(data.task.id);
        for (const old of current)
          if (!incoming.some((row) => same(old, row))) {
            const source = raw.find((r) => r.id === nativeId(old.id))!;
            db.prepare(
              "INSERT INTO mithril_attachment_history VALUES(?,?,?)",
            ).run(operationId, old.id, JSON.stringify(source));
            db.prepare(
              "DELETE FROM task_attachments WHERE id=? AND task_id=?",
            ).run(nativeId(old.id), data.task.id);
            if (
              !incoming.some((row) => row.id === old.id) &&
              aliases.some((alias) => alias.cloud_id === old.id)
            )
              db.prepare(
                "DELETE FROM mithril_attachment_ids WHERE task_id=? AND cloud_id=?",
              ).run(data.task.id, old.id);
          }
        for (const row of changed)
          db.prepare(
            "INSERT INTO task_attachments(id,task_id,filename,stored_path,content_type,size,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
          ).run(
            nativeId(row.id),
            row.task_id,
            row.filename,
            resolve(directory, name(row)),
            row.content_type,
            row.size,
            row.uploaded_by,
            row.created_at,
          );
        if (mappings.length) {
          db.exec(
            "CREATE TABLE IF NOT EXISTS mithril_attachment_ids(task_id TEXT NOT NULL,cloud_id INTEGER NOT NULL,native_id INTEGER NOT NULL,PRIMARY KEY(task_id,cloud_id),UNIQUE(native_id))",
          );
          for (const row of mappings)
            db.prepare("INSERT INTO mithril_attachment_ids VALUES(?,?,?)").run(
              data.task.id,
              row.cloud,
              row.native,
            );
        }
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
