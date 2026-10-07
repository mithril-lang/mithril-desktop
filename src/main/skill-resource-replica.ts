import { resourceExclusions, resourceExcluded } from "./resource-exclusions";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  validCapabilityResourceManifest,
  capabilityResourceManifestBytes,
} from "@mithril/workspace/capability-resources";
import type { SkillResourceCapture } from "./skill-resource-snapshot";

const sha = (text: string): string =>
  createHash("sha256").update(text).digest("hex");
function checked(path: string): void {
  let current = resolve(path);
  for (;;) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw Error("Unsafe Skill replica storage");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function ledger(root: string, stateRoot: string): string {
  const path = join(stateRoot, sha(resolve(root)));
  checked(path);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  checked(path);
  return path;
}
/** A partial multi-file transaction must never be published as a new native tree. */
export function assertSkillResourcesReady(
  root: string,
  stateRoot: string,
): void {
  const path = ledger(root, stateRoot);
  for (const name of readdirSync(path)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const file = join(path, name);
    const info = lstatSync(file);
    if (!info.isFile() || info.size > 40 * 1024 * 1024)
      throw Error("Skill resource recovery required");
    const receipt = JSON.parse(readFileSync(file, "utf8")) as {
      state?: unknown;
    };
    if (receipt.state !== "complete")
      throw Error("Skill resource recovery required");
  }
}

/** Identify an unavailable source without pretending that a partial tree was deleted. */
export function hasPendingSkillResources(
  root: string,
  stateRoot: string,
  capabilityId: string,
): boolean {
  const path = ledger(root, stateRoot);
  let pending = false;
  for (const name of readdirSync(path)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const file = join(path, name),
      info = lstatSync(file);
    if (!info.isFile() || info.size > 40 * 1024 * 1024)
      throw Error("Skill resource recovery requires review");
    const receipt = JSON.parse(readFileSync(file, "utf8")) as {
      state?: unknown;
      before?: unknown;
      after?: unknown;
    };
    if (receipt.state === "complete") continue;
    if (
      receipt.state !== "pending" ||
      !validCapabilityResourceManifest(receipt.before) ||
      !validCapabilityResourceManifest(receipt.after) ||
      receipt.before.capabilityId !== capabilityId ||
      receipt.after.capabilityId !== capabilityId
    )
      throw Error("Skill resource recovery requires review");
    pending = true;
  }
  return pending;
}

/** Fixed, isolated data transaction. No Skill interpreter, installer, or tool is invoked. */
const TRANSACTION = String.raw`
import sys,json,os,stat,hashlib,uuid,contextlib,re
if os.name!='nt':import fcntl
sys.stdout.reconfigure(encoding='utf-8')
try:
 p=json.load(sys.stdin)
 if os.name=='nt':raise ValueError('unsupported')
 flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW
 def open_dir(path):
  if not os.path.isabs(path):raise ValueError('unsafe')
  fd=os.open('/',flags)
  try:
   for part in path.split('/')[1:]:
    if part:
     new=os.open(part,flags,dir_fd=fd);os.close(fd);fd=new
   return fd
  except:os.close(fd);raise
 def stamp(i):return (i.st_dev,i.st_ino,i.st_size,i.st_mtime_ns,i.st_ctime_ns,stat.S_IMODE(i.st_mode))
 def ignored(name):
  import re
  return bool(re.match(r'^(\.git|\.git-credentials|\.npmrc|\.pypirc|\.netrc|\.hg|\.svn|node_modules|\.venv|venv|__pycache__|\.ssh|\.aws|\.azure|\.config|\.mithril-sync-trash)$',name,re.I) or re.match(r'^\.env(?:\.|$)',name,re.I) or re.match(r'^(id_rsa|id_ed25519|credentials|secrets?)(\.|$)',name,re.I) or re.search(r'\.(pem|key|p12|pfx)$',name,re.I) or name.startswith(('.mithril-sync-','.mithril-source-')))
 def safe_path(path):
  parts=path.split('/')
  if not parts or any(not x or x in ('.','..') or ignored(x) for x in parts) or any(path==x or path.startswith(x+'/') for x in p['excludedPaths']):raise ValueError('unsafe')
  return parts
 def file_value(name,dfd,backup=None):
  try:info=os.stat(name,dir_fd=dfd,follow_symlinks=False)
  except FileNotFoundError:return None
  if not stat.S_ISREG(info.st_mode):raise ValueError('unsafe')
  fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=dfd)
  try:
   if stamp(info)!=stamp(os.fstat(fd)):raise ValueError('conflict')
   chunks=[];size=0
   while True:
    data=os.read(fd,8388608)
    if not data:break
    size+=len(data)
    if size>1073741824:raise ValueError('oversize')
    chunks.append(hashlib.sha256(data).hexdigest())
    if backup is not None:backup.write(data)
   if stamp(info)!=stamp(os.fstat(fd)) or stamp(info)!=stamp(os.stat(name,dir_fd=dfd,follow_symlinks=False)):raise ValueError('conflict')
   if size!=info.st_size:raise ValueError('conflict')
   digest=hashlib.sha256(json.dumps({'size':size,'chunks':chunks},separators=(',',':')).encode()).hexdigest()
   return {'size':size,'digest':digest,'chunks':chunks,'executable':bool(info.st_mode&0o111)}
  finally:os.close(fd)
 def tree(root):
  result={};size=0
  def walk(fd,prefix):
   nonlocal size
   initial=os.fstat(fd);names=sorted(os.listdir(fd))
   for name in names:
    info=os.stat(name,dir_fd=fd,follow_symlinks=False)
    if stat.S_ISLNK(info.st_mode):raise ValueError('unsafe')
    path=prefix+'/'+name if prefix else name
    if ignored(name) or any(path==x or path.startswith(x+'/') for x in p['excludedPaths']):continue
    if stat.S_ISDIR(info.st_mode):
     child=os.open(name,flags,dir_fd=fd)
     try:walk(child,path)
     finally:os.close(child)
    else:
     value=file_value(name,fd);result[path]=value;size+=value['size']
     if len(result)>10000 or size>1073741824:raise ValueError('oversize')
   if stamp(initial)!=stamp(os.fstat(fd)) or names!=sorted(os.listdir(fd)):raise ValueError('conflict')
  walk(root,'');return result
 def mapping(manifest):return {f['path']:{k:v for k,v in f.items() if k!='path'} for f in manifest['files']}
 def write_json(fd,name,value):
  tmp='.mithril-sync-'+uuid.uuid4().hex
  out=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
  try:
   with os.fdopen(out,'w',encoding='utf-8') as stream:json.dump(value,stream,ensure_ascii=False,separators=(',',':'));stream.flush();os.fsync(stream.fileno())
   os.replace(tmp,name,src_dir_fd=fd,dst_dir_fd=fd);os.fsync(fd)
  finally:
   try:os.unlink(tmp,dir_fd=fd)
   except FileNotFoundError:pass
 def read_json(fd,name):
  try:out=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
  except FileNotFoundError:return None
  with os.fdopen(out,'rb') as stream:
   if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):raise ValueError('unsafe')
   data=stream.read(41943041)
   if len(data)>41943040:raise ValueError('oversize')
   return json.loads(data)
 with contextlib.ExitStack() as stack:
  sfd=open_dir(p['state']);stack.callback(os.close,sfd)
  lock=os.open('.mithril-sync-lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600,dir_fd=sfd)
  if not stat.S_ISREG(os.fstat(lock).st_mode):os.close(lock);raise ValueError('unsafe')
  lockstream=stack.enter_context(os.fdopen(lock,'r+'));fcntl.flock(lock,fcntl.LOCK_EX)
  name=p['operation']+'.json';receipt=read_json(sfd,name)
  if receipt:
   if receipt['fingerprint']!=p['fingerprint']:raise ValueError('operation')
   if receipt['state']=='complete':print(json.dumps({'status':'applied'}));sys.exit(0)
  elif p['recoverOnly']:print(json.dumps({'status':'missing'}));sys.exit(0)
  else:
   for existing in os.listdir(sfd):
    if existing.endswith('.json') and len(existing)==69:
     row=read_json(sfd,existing)
     if row and row['state']!='complete':raise ValueError('pending')
  cache=os.open(p['operation'],flags,dir_fd=sfd);stack.callback(os.close,cache)
  # Every cached target byte is verified before the first source mutation.
  for path,value in mapping(receipt['after'] if receipt else p['after']).items():
   safe_path(path)
   if hashlib.sha256(json.dumps({'size':value['size'],'chunks':value['chunks']},separators=(',',':')).encode()).hexdigest()!=value['digest']:raise ValueError('integrity')
   markdown=bytearray() if path.split('/')[-1]=='SKILL.md' else None
   if markdown is not None and value['size']>1048576:raise ValueError('oversize')
   for index,digest in enumerate(value['chunks']):
    if not re.fullmatch(r'[a-f0-9]{64}',digest):raise ValueError('unsafe')
    fd=os.open(digest,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=cache)
    with os.fdopen(fd,'rb') as stream:
     if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):raise ValueError('unsafe')
     data=stream.read(8388609)
    if len(data)!=min(8388608,value['size']-index*8388608) or hashlib.sha256(data).hexdigest()!=digest:raise ValueError('integrity')
    if markdown is not None:markdown.extend(data)
   if markdown is not None:markdown.decode('utf-8')
  parent=open_dir(os.path.dirname(p['root']));stack.callback(os.close,parent)
  base=os.path.basename(p['root'])
  try:rfd=os.open(base,flags,dir_fd=parent)
  except FileNotFoundError:
   os.mkdir(base,mode=0o700,dir_fd=parent);os.fsync(parent);rfd=os.open(base,flags,dir_fd=parent)
  stack.callback(os.close,rfd);rootstamp=os.fstat(rfd)
  def root_attached():
   info=os.stat(base,dir_fd=parent,follow_symlinks=False)
   if (info.st_dev,info.st_ino)!=(rootstamp.st_dev,rootstamp.st_ino):raise ValueError('conflict')
  if receipt is None:
   before=mapping(p['before']);after=mapping(p['after']);current=tree(rfd);root_attached()
   if current!=before:raise ValueError('conflict')
   receipt={'fingerprint':p['fingerprint'],'state':'pending','before':p['before'],'after':p['after']}
   write_json(sfd,name,receipt)
  before=mapping(receipt['before']);after=mapping(receipt['after']);current=tree(rfd);root_attached()
  for path in set(before)|set(after)|set(current):
   if current.get(path) not in (before.get(path),after.get(path)):raise ValueError('conflict')
  def parent_of(path,create=False):
   parts=safe_path(path);fd=os.dup(rfd)
   try:
    for part in parts[:-1]:
     if create:
      try:os.mkdir(part,mode=0o700,dir_fd=fd);os.fsync(fd)
      except FileExistsError:pass
     child=os.open(part,flags,dir_fd=fd);os.close(fd);fd=child
    return fd,parts[-1]
   except:os.close(fd);raise
  def attached_parent(path,dfd):
   root_attached()
   try:fresh,leaf=parent_of(path)
   except FileNotFoundError:raise ValueError('conflict')
   try:
    a,b=os.fstat(fresh),os.fstat(dfd)
    if (a.st_dev,a.st_ino)!=(b.st_dev,b.st_ino):raise ValueError('conflict')
   finally:os.close(fresh)
  def backup_file(leaf,dfd,path,value):
   name='backup-'+hashlib.sha256(path.encode()).hexdigest()
   stored=file_value(name,cache)
   if stored is not None:
    if any(stored[k]!=value[k] for k in ('size','digest','chunks')):raise ValueError('integrity')
    return
   tmp='.mithril-sync-backup-'+uuid.uuid4().hex
   out=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=cache)
   try:
    with os.fdopen(out,'wb') as stream:
     if file_value(leaf,dfd,stream)!=value:raise ValueError('conflict')
     stream.flush();os.fsync(stream.fileno())
    if file_value(leaf,dfd)!=value:raise ValueError('conflict')
    os.replace(tmp,name,src_dir_fd=cache,dst_dir_fd=cache);os.fsync(cache)
   finally:
    try:os.unlink(tmp,dir_fd=cache)
    except FileNotFoundError:pass
  # Delete old tracked files first, allowing file/directory shape changes.
  for path in sorted(set(before)-set(after),key=lambda x:(-x.count('/'),x)):
   try:dfd,leaf=parent_of(path)
   except FileNotFoundError:continue
   try:
    attached_parent(path,dfd);value=file_value(leaf,dfd)
    if value is None:continue
    if value!=before[path]:raise ValueError('conflict')
    backup_file(leaf,dfd,path,before[path])
    if file_value(leaf,dfd)!=before[path]:raise ValueError('conflict')
    attached_parent(path,dfd)
    os.unlink(leaf,dir_fd=dfd);os.fsync(dfd)
   finally:os.close(dfd)
  def remove_empty(name,dfd):
   child=os.open(name,flags,dir_fd=dfd)
   try:
    for entry in os.listdir(child):
     info=os.stat(entry,dir_fd=child,follow_symlinks=False)
     if not stat.S_ISDIR(info.st_mode):raise ValueError('conflict')
     remove_empty(entry,child)
   finally:os.close(child)
   os.rmdir(name,dir_fd=dfd);os.fsync(dfd)
  for path,value in sorted(after.items()):
   dfd,leaf=parent_of(path,True)
   try:
    attached_parent(path,dfd)
    try:info=os.stat(leaf,dir_fd=dfd,follow_symlinks=False)
    except FileNotFoundError:info=None
    if info and stat.S_ISDIR(info.st_mode):remove_empty(leaf,dfd)
    current=file_value(leaf,dfd)
    if current==value:continue
    if current!=before.get(path):raise ValueError('conflict')
    if current is not None:backup_file(leaf,dfd,path,current)
    tmp='.mithril-sync-'+uuid.uuid4().hex;out=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=dfd)
    try:
     with os.fdopen(out,'wb') as stream:
      for digest in value['chunks']:
       chunk=os.open(digest,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=cache)
       with os.fdopen(chunk,'rb') as source:stream.write(source.read(8388608))
      stream.flush();os.fchmod(stream.fileno(),0o700 if value['executable'] else 0o600);os.fsync(stream.fileno())
     if file_value(tmp,dfd)!=value:raise ValueError('integrity')
     attached_parent(path,dfd)
     if file_value(leaf,dfd)!=current:raise ValueError('conflict')
     os.replace(tmp,leaf,src_dir_fd=dfd,dst_dir_fd=dfd);os.fsync(dfd)
    finally:
     try:os.unlink(tmp,dir_fd=dfd)
     except FileNotFoundError:pass
   finally:os.close(dfd)
  if tree(rfd)!=after:raise ValueError('conflict')
  root_attached();receipt['state']='complete';write_json(sfd,name,receipt)
 print(json.dumps({'status':'applied'}))
except Exception as error:
 code=str(error) if str(error) in ('unsafe','conflict','operation','pending','integrity','oversize','unsupported') else 'unavailable'
 print(json.dumps({'status':'conflict' if code=='conflict' else 'deferred','error':code}))
`;
export type SkillApplyStatus = "applied" | "conflict" | "deferred" | "missing";
function execute(
  root: string,
  python: string,
  state: string,
  operation: string,
  fingerprint: string,
  before?: SkillResourceCapture,
  after?: SkillResourceCapture,
  excludedPaths: readonly string[] = [],
): SkillApplyStatus {
  const execution = spawnSync(python, ["-I", "-c", TRANSACTION], {
    input: JSON.stringify({
      root: resolve(root),
      state,
      operation,
      fingerprint,
      recoverOnly: !before || !after,
      before: before?.manifest,
      after: after?.manifest,
      excludedPaths,
    }),
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 4096,
    windowsHide: true,
    env: {
      PYTHONNOUSERSITE: "1",
      ...(process.platform === "win32"
        ? { SystemRoot: process.env.SystemRoot }
        : {}),
    },
  });
  if (execution.error || execution.status !== 0) return "deferred";
  try {
    const receipt = JSON.parse(execution.stdout) as {
      status?: SkillApplyStatus;
      error?: string;
    };
    if (receipt.error === "operation")
      throw Error("Skill resource operation was reused");
    return ["applied", "conflict", "deferred", "missing"].includes(
      receipt.status ?? "",
    )
      ? receipt.status!
      : "deferred";
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Skill resource operation was reused"
    )
      throw error;
    return "deferred";
  }
}
// @lat: [[cloud-workspace#Cloud workspace#Rich repository implementation in progress#Skill resource file transactions (draft)]]
export function recoverSkillResources(
  root: string,
  python: string,
  stateRoot: string,
  operationId: string,
  fingerprint: string,
): SkillApplyStatus {
  return execute(
    root,
    python,
    ledger(root, stateRoot),
    sha(operationId),
    fingerprint,
  );
}
export function applySkillResources(
  root: string,
  python: string,
  stateRoot: string,
  operationId: string,
  fingerprint: string,
  before: SkillResourceCapture,
  after: SkillResourceCapture,
  excludedPaths: readonly string[] = [],
): SkillApplyStatus {
  const exclusions = resourceExclusions(excludedPaths);
  if (process.platform === "win32") return "deferred";
  for (const capture of [before, after]) {
    if (
      !validCapabilityResourceManifest(capture.manifest) ||
      capture.manifest.files.some((file) =>
        resourceExcluded(file.path, exclusions),
      ) ||
      createHash("sha256")
        .update(capabilityResourceManifestBytes(capture.manifest))
        .digest("hex") !== capture.digest
    )
      throw Error("Invalid Skill resource capture");
  }
  if (before.manifest.capabilityId !== after.manifest.capabilityId)
    throw Error("Skill resource profile mismatch");
  const state = ledger(root, stateRoot),
    operation = sha(operationId),
    cache = join(state, operation);
  checked(cache);
  mkdirSync(cache, { recursive: true, mode: 0o700 });
  checked(cache);
  for (const digest of new Set(
    after.manifest.files.flatMap((file) => file.chunks),
  )) {
    const path = join(cache, digest);
    if (existsSync(path)) continue;
    writeFileSync(path, after.readChunk(digest), {
      mode: 0o600,
      flag: "wx",
      flush: true,
    });
  }
  const cacheFd = openSync(cache, "r");
  try {
    fsyncSync(cacheFd);
  } finally {
    closeSync(cacheFd);
  }
  return execute(
    root,
    python,
    state,
    operation,
    fingerprint,
    before,
    after,
    exclusions,
  );
}
