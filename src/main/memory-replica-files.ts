import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, lstatSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { MEMORY_FILE_TRANSACTION } from "./memory-file-lock";
import { parseMemoryLimitsConfig } from "./memory-limits";
import {
  memoryFileId,
  memoryFileKinds,
  validMemoryFile,
  type MemoryFile,
} from "@mithril/workspace/memory-files";
import type {
  ReplicaRecord,
  ReplicaWrite,
  ReplicaResult,
} from "@mithril/workspace/replica-sync";
import type { JsonValue } from "@mithril/workspace/repository";
const paths = {
  memory: ["memories", "MEMORY.md"],
  user: ["memories", "USER.md"],
  soul: ["SOUL.md"],
};
function checked(path: string): void {
  let current = resolve(path);
  for (;;) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw Error("Unsafe Memory storage");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function read(path: string, max = 1048576): string | null {
  checked(path);
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > max)
    throw Error("Unsupported Memory source; original data retained");
  const bytes = readFileSync(path);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes))
    throw Error("Unsupported Memory encoding; original data retained");
  return text;
}
const version = (body: MemoryFile, deleted = false): string =>
  createHash("sha256")
    .update(
      JSON.stringify([
        body.profile,
        body.kind,
        body.content,
        body.charLimit,
        deleted,
      ]),
    )
    .digest("hex");
export function memoryReplicaSnapshot(
  root: string,
  profile: string,
): ReplicaRecord[] {
  checked(root);
  const config = read(join(root, "config.yaml")) ?? "";
  const limits = parseMemoryLimitsConfig(config);
  const rows: ReplicaRecord[] = [];
  for (const kind of memoryFileKinds) {
    const id = memoryFileId(profile, kind),
      content = read(join(root, ...paths[kind]));
    if (content !== null) {
      const body: MemoryFile = {
        format: "mithril-memory-file-v1",
        profile,
        kind,
        content,
        charLimit:
          kind === "soul"
            ? null
            : kind === "memory"
              ? limits.memoryCharLimit
              : limits.userCharLimit,
      };
      if (!validMemoryFile(body))
        throw Error("Memory cannot be synchronized without losing data");
      rows.push({
        collection: "memory",
        id,
        body: body as unknown as JsonValue,
        deleted: false,
        version: version(body),
      });
    } else {
      const marker = read(
        join(root, "memories", `mithril-sync-${kind}.json`),
        2097152,
      );
      if (marker !== null) {
        const state = JSON.parse(marker);
        if (
          state.deleted === true &&
          validMemoryFile(state.body) &&
          state.body.profile === profile &&
          state.body.kind === kind
        )
          rows.push({
            collection: "memory",
            id,
            body: state.body as unknown as JsonValue,
            deleted: true,
            version: version(state.body, true),
          });
      }
    }
  }
  return rows;
}
/** Reuses the exact original MemoryStore lock inode and no-follow directory traversal. */
export const MEMORY_REPLICA_TRANSACTION =
  MEMORY_FILE_TRANSACTION.slice(
    0,
    MEMORY_FILE_TRANSACTION.indexOf("  config=read"),
  ) +
  String.raw`
  target={'memory':'MEMORY.md','user':'USER.md','soul':'SOUL.md'}[p['kind']]
  tfd=hfd if p['kind']=='soul' else dfd
  receipt_name='mithril-receipt-'+p['operationId']+'.json'
  receipt_text=read(receipt_name,dfd,4194304)
  receipt=json.loads(receipt_text) if receipt_text else None
  if receipt:
   if receipt['fingerprint']!=p['fingerprint']:raise ValueError('operation')
   if receipt['state']=='complete':
    print(json.dumps({'success':True}));sys.exit(0)
  def observed():
   safe(target,tfd)
   try:os.stat(named(target,tfd),follow_symlinks=False,**relative(tfd));exists=True
   except FileNotFoundError:exists=False
   return {'exists':exists,'content':read(target,tfd)}
  current=observed();after={'exists':not p['deleted'],'content':p['content'] if not p['deleted'] else ''}
  if receipt is None:
   if current!=p['expected']:raise ValueError('conflict')
   config=read('config.yaml',hfd)
   if hashlib.sha256(config.encode('utf-8')).hexdigest()!=p['configDigest']:raise ValueError('conflict')
   receipt={'fingerprint':p['fingerprint'],'state':'pending','before':current,'after':after}
   write(receipt_name,json.dumps(receipt,ensure_ascii=False))
  if current!=receipt['after']:
   if current!=receipt['before']:raise ValueError('conflict')
   if receipt['after']['exists']:write(target,receipt['after']['content'],tfd)
   else:
    safe(target,tfd)
    try:os.unlink(named(target,tfd),**relative(tfd))
    except FileNotFoundError:pass
    if os.name!='nt':os.fsync(tfd)
  write('mithril-sync-'+p['kind']+'.json',json.dumps({'body':p['body'],'deleted':p['deleted']},ensure_ascii=False))
  receipt['state']='complete';write(receipt_name,json.dumps(receipt,ensure_ascii=False))
 print(json.dumps({'success':True}))
` +
  MEMORY_FILE_TRANSACTION.slice(
    MEMORY_FILE_TRANSACTION.indexOf("except Exception as error:"),
  );

export function applyMemoryReplica(
  root: string,
  profile: string,
  userId: string,
  replicaId: string,
  python: string,
  write: ReplicaWrite,
): ReplicaResult {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(write.operationId))
    throw Error("Invalid Memory operation");
  const observed =
    memoryReplicaSnapshot(root, profile).find(
      (row) => row.id === write.document.id,
    ) ?? null;
  const result = (
    status: ReplicaResult["status"],
    record: ReplicaRecord | null = observed,
  ): ReplicaResult => ({ schemaVersion: 1, userId, replicaId, status, record });
  if (
    write.document.collection !== "memory" ||
    !validMemoryFile(write.document.body)
  )
    return result("deferred");
  const body = write.document.body;
  if (
    body.profile !== profile ||
    write.document.id !== memoryFileId(profile, body.kind)
  )
    return result("deferred");
  const config = read(join(root, "config.yaml")) ?? "",
    limits = parseMemoryLimitsConfig(config);
  if (
    body.charLimit !==
    (body.kind === "soul"
      ? null
      : body.kind === "memory"
        ? limits.memoryCharLimit
        : limits.userCharLimit)
  )
    return result("deferred");
  const expected = write.expectedRecord;
  if (
    expected &&
    (!validMemoryFile(expected.body) ||
      expected.body.profile !== profile ||
      expected.body.kind !== body.kind ||
      version(expected.body, expected.deleted) !== write.expectedVersion)
  )
    throw Error("Invalid Memory source version");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([userId, profile, write]))
    .digest("hex");
  const input = {
    home: root,
    kind: body.kind,
    operationId: write.operationId,
    fingerprint,
    configDigest: createHash("sha256").update(config).digest("hex"),
    expected: {
      exists: !!expected && !expected.deleted,
      content:
        expected && !expected.deleted
          ? (expected.body as unknown as MemoryFile).content
          : "",
    },
    content: body.content,
    body,
    deleted: write.document.deleted,
  };
  const execution = spawnSync(
    python,
    ["-I", "-c", MEMORY_REPLICA_TRANSACTION],
    {
      input: JSON.stringify(input),
      encoding: "utf8",
      timeout: 2000,
      maxBuffer: 4096,
      windowsHide: true,
      env:
        globalThis.process.platform === "win32"
          ? {
              SystemRoot: globalThis.process.env.SystemRoot,
              PYTHONNOUSERSITE: "1",
            }
          : { PYTHONNOUSERSITE: "1" },
    },
  );
  if (execution.error || execution.status !== 0) return result("deferred");
  let receipt: { success?: boolean; error?: string };
  try {
    receipt = JSON.parse(execution.stdout);
  } catch {
    return result("deferred");
  }
  if (receipt.success)
    return result("applied", {
      collection: "memory",
      id: write.document.id,
      body: body as unknown as JsonValue,
      deleted: write.document.deleted,
      version: version(body, write.document.deleted),
    });
  if (receipt.error === "conflict")
    return result(
      "conflict",
      memoryReplicaSnapshot(root, profile).find(
        (row) => row.id === write.document.id,
      ) ?? null,
    );
  if (receipt.error === "operation") throw Error("Memory operation was reused");
  return result("deferred");
}
