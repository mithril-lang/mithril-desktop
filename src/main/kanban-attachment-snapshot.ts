import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  constants,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CHUNK_BYTES } from "@mithril/workspace/files";
import {
  taskAttachmentRecords,
  type TaskAttachment,
  type TaskAttachmentTransport,
} from "@mithril/workspace/task-attachments";

/** Opens only the attachment rows selected in the board's SQLite snapshot. No source traversal or execution. */
const CAPTURE = String.raw`
import sys,json,os,stat,hashlib,contextlib
sys.stdout.reconfigure(encoding='utf-8')
try:
 p=json.load(sys.stdin)
 if os.name=='nt':raise ValueError('unsupported')
 flags=os.O_RDONLY|getattr(os,'O_DIRECTORY',0)|getattr(os,'O_NOFOLLOW',0)
 def open_dir(path):
  if not os.path.isabs(path):raise ValueError('unsafe')
  fd=os.open('/',flags)
  try:
   for part in path.split('/')[1:]:
    if part:
     child=os.open(part,flags,dir_fd=fd);os.close(fd);fd=child
   return fd
  except:os.close(fd);raise
 def stamp(s):return(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
 def sha(b):return hashlib.sha256(b).hexdigest()
 rows=[];total=0
 with contextlib.ExitStack() as stack:
  root=open_dir(p['root']);stack.callback(os.close,root)
  stage=open_dir(p['stage']);stack.callback(os.close,stage)
  for raw in p['rows']:
   path=raw['stored_path']
   if not isinstance(path,str) or os.path.dirname(path)!=p['root']:raise ValueError('unsafe')
   name=os.path.basename(path)
   if not name or name in ('.','..') or '\x00' in name:raise ValueError('unsafe')
   before=os.stat(name,dir_fd=root,follow_symlinks=False)
   if not stat.S_ISREG(before.st_mode) or before.st_size!=raw['size']:raise ValueError('conflict')
   fd=os.open(name,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0),dir_fd=root)
   try:
    if stamp(before)!=stamp(os.fstat(fd)):raise ValueError('conflict')
    chunks=[];size=0
    while True:
     data=os.read(fd,8388608)
     if not data:break
     size+=len(data)
     if total+size>1073741824:raise ValueError('oversize')
     digest=sha(data);chunks.append(digest)
     try:out=os.open(digest,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0),0o600,dir_fd=stage)
     except FileExistsError:pass
     else:
      with os.fdopen(out,'wb') as stream:stream.write(data)
    if size!=raw['size'] or stamp(before)!=stamp(os.fstat(fd)) or stamp(before)!=stamp(os.stat(name,dir_fd=root,follow_symlinks=False)):raise ValueError('conflict')
    total+=size
    resource={'format':'mithril-task-attachment-v1','taskId':p['documentId'],'size':size,'digest':sha(json.dumps({'size':size,'chunks':chunks},separators=(',',':')).encode()),'chunks':chunks}
    rows.append(dict(raw,stored_path=None,resource=resource))
   finally:os.close(fd)
  print(json.dumps({'rows':rows},ensure_ascii=False))
except Exception as error:
 code=str(error) if str(error) in ('unsafe','conflict','oversize','unsupported') else 'unavailable'
 print(json.dumps({'error':code}))
`;
function checked(path: string): void {
  let current = resolve(path);
  for (;;) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw Error("Unsafe attachment storage");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
export type KanbanAttachmentProjection = (
  board: string,
  documentId: string,
  taskId: string,
  rows: Record<string, unknown>[],
) => TaskAttachment[];

// @lat: [[cloud-workspace#Cloud workspace#Original Kanban attachment capture (draft)]]
export function captureKanbanAttachments(
  root: string,
  python: string,
  stateRoot: string,
): {
  project: KanbanAttachmentProjection;
  publish(
    transport: TaskAttachmentTransport,
    guard: () => Promise<void>,
  ): Promise<void>;
  dispose(): void;
} {
  checked(stateRoot);
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  checked(stateRoot);
  const stage = mkdtempSync(join(stateRoot, ".mithril-sync-task-capture-"));
  const tasks = new Map<string, TaskAttachment[]>();
  const readChunk = (digest: string): Uint8Array => {
    if (!/^[a-f0-9]{64}$/.test(digest))
      throw Error("Invalid captured attachment chunk");
    checked(stage);
    const path = join(stage, digest),
      info = lstatSync(path);
    if (!info.isFile() || info.size < 1 || info.size > CHUNK_BYTES)
      throw Error("Invalid captured attachment chunk");
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const bytes = new Uint8Array(info.size);
      let offset = 0;
      while (offset < bytes.length) {
        const count = readSync(
          fd,
          bytes,
          offset,
          bytes.length - offset,
          offset,
        );
        if (!count) throw Error("Captured attachment changed");
        offset += count;
      }
      if (createHash("sha256").update(bytes).digest("hex") !== digest)
        throw Error("Captured attachment changed");
      return bytes;
    } finally {
      closeSync(fd);
    }
  };
  return {
    project(board, documentId, taskId, rows) {
      if (!rows.length) return [];
      if (
        rows.some((row) =>
          Object.keys(row).some(
            (key) =>
              ![
                "id",
                "task_id",
                "filename",
                "stored_path",
                "content_type",
                "size",
                "uploaded_by",
                "created_at",
              ].includes(key),
          ),
        )
      )
        throw Error("Unsupported original attachment fields; source retained");
      if (
        !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(board) ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(taskId)
      )
        throw Error("Invalid original attachment identity");
      const source =
        board === "default"
          ? join(root, "kanban", "attachments", taskId)
          : join(root, "kanban", "boards", board, "attachments", taskId);
      const result = spawnSync(python, ["-I", "-c", CAPTURE], {
        input: JSON.stringify({
          root: resolve(source),
          stage,
          documentId,
          rows,
        }),
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
        env:
          process.platform === "win32"
            ? { SystemRoot: process.env.SystemRoot, PYTHONNOUSERSITE: "1" }
            : { PYTHONNOUSERSITE: "1" },
      });
      if (result.error || result.status !== 0)
        throw Error("Original attachment capture unavailable; files retained");
      const value = JSON.parse(result.stdout) as {
        rows?: unknown;
        error?: unknown;
      };
      if (value.error)
        throw Error(
          "Original attachment capture requires review; files retained",
        );
      const portable = taskAttachmentRecords(
        { task: { id: taskId }, attachments: value.rows },
        documentId,
      );
      if (portable.length !== rows.length)
        throw Error("Incomplete original attachments; files retained");
      tasks.set(documentId, portable);
      return portable;
    },
    async publish(transport, guard) {
      for (const [taskId, rows] of tasks) {
        const sent = new Set<string>();
        for (const row of rows)
          for (const [index, digest] of row.resource.chunks.entries()) {
            if (sent.has(digest)) continue;
            const size = Math.min(CHUNK_BYTES, row.size - index * CHUNK_BYTES);
            await guard();
            const present = await transport.hasChunk(taskId, digest, size);
            await guard();
            if (!present) {
              const bytes = readChunk(digest);
              if (
                bytes.length !== size ||
                (await transport.putChunk(taskId, bytes)) !== digest
              )
                throw Error("Attachment upload integrity mismatch");
              await guard();
            }
            sent.add(digest);
          }
      }
      await guard();
    },
    dispose: () => rmSync(stage, { recursive: true, force: true }),
  };
}
