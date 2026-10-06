import { spawnSync } from "child_process";
import type { MemoryLimits } from "./memory-limits";

export type MemoryMutation =
  | { action: "add" | "user" | "raw" | "soul"; content: string }
  | { action: "update"; index: number; content: string }
  | { action: "remove"; index: number };
export interface LockedMemoryInput {
  home: string;
  python: string;
  limits: MemoryLimits;
  configDigest: string;
  mutation: MemoryMutation;
  expected?: { memory?: string; user?: string; soul?: string };
}
/** The lock inode matches Hermes MemoryStore._file_lock, not the replaceable data inode. */
export const MEMORY_FILE_TRANSACTION = String.raw`
import sys,json,os,pathlib,stat,contextlib,uuid,hashlib
try:
 p=json.load(sys.stdin); home=pathlib.Path(p['home']); directory=home/'memories'
 for ancestor in (home,*home.parents,directory):
  if ancestor.is_symlink(): raise ValueError('unsafe')
 def open_dir(path):
  if os.name=='nt': return path
  if not path.is_absolute(): raise ValueError('unsafe')
  flags=os.O_RDONLY|getattr(os,'O_DIRECTORY',0)|getattr(os,'O_NOFOLLOW',0)
  fd=os.open(path.anchor,flags)
  try:
   for part in path.parts[1:]:
    child=os.open(part,flags,dir_fd=fd);os.close(fd);fd=child
   return fd
  except:
   os.close(fd);raise
 def named(name,dfd): return dfd/name if os.name=='nt' else name
 def relative(dfd): return {} if os.name=='nt' else {'dir_fd':dfd}
 def safe(name,dfd):
  try: info=os.stat(named(name,dfd),follow_symlinks=False,**relative(dfd))
  except FileNotFoundError: return
  if not stat.S_ISREG(info.st_mode): raise ValueError('unsafe')
 def read(name,dfd,limit=1048576):
  safe(name,dfd)
  try: fd=os.open(named(name,dfd),os.O_RDONLY|getattr(os,'O_NOFOLLOW',0),**relative(dfd))
  except FileNotFoundError: return ''
  with os.fdopen(fd,'rb') as stream:
   if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode): raise ValueError('unsafe')
   data=stream.read(limit+1)
   if len(data)>limit: raise ValueError('oversize')
   return data.decode('utf-8')
 with contextlib.ExitStack() as stack:
  hfd=open_dir(home)
  if os.name=='nt': directory.mkdir(mode=0o700,parents=True,exist_ok=True);dfd=directory
  else:
   stack.callback(os.close,hfd)
   try: os.mkdir('memories',mode=0o700,dir_fd=hfd)
   except FileExistsError: pass
   dfd=os.open('memories',os.O_RDONLY|getattr(os,'O_DIRECTORY',0)|getattr(os,'O_NOFOLLOW',0),dir_fd=hfd);stack.callback(os.close,dfd)
  def write(name,content,fd_target=dfd):
   safe(name,fd_target);tmp='.desktop-memory-'+uuid.uuid4().hex
   fd=os.open(named(tmp,fd_target),os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0),0o600,**relative(fd_target))
   try:
    with os.fdopen(fd,'w',encoding='utf-8') as stream: stream.write(content);stream.flush();os.fsync(stream.fileno())
    safe(name,fd_target)
    if os.name=='nt': os.replace(named(tmp,fd_target),named(name,fd_target))
    else: os.replace(tmp,name,src_dir_fd=fd_target,dst_dir_fd=fd_target)
    if os.name!='nt': os.fsync(fd_target)
   finally:
    try: os.unlink(named(tmp,fd_target),**relative(fd_target))
    except FileNotFoundError: pass
  for name,lockfd in (('MEMORY.md.lock',dfd),('USER.md.lock',dfd),('SOUL.md.lock',hfd)):
   safe(name,lockfd);flags=os.O_RDWR|os.O_CREAT|getattr(os,'O_NOFOLLOW',0)
   fd=os.open(named(name,lockfd),flags,0o600,**relative(lockfd))
   if not stat.S_ISREG(os.fstat(fd).st_mode): os.close(fd);raise ValueError('unsafe')
   stream=stack.enter_context(os.fdopen(fd,'r+'))
   if os.name=='nt':
    import msvcrt
    stream.seek(0);msvcrt.locking(stream.fileno(),msvcrt.LK_LOCK,1)
   else:
    import fcntl
    fcntl.flock(stream,fcntl.LOCK_EX)
  config=read('config.yaml',hfd)
  if hashlib.sha256(config.encode('utf-8')).hexdigest()!=p['configDigest']: raise ValueError('conflict')
  memory,user,soul=read('MEMORY.md',dfd),read('USER.md',dfd),read('SOUL.md',hfd)
  if any(value!=p.get('expected',{}).get(key,value) for key,value in (('memory',memory),('user',user),('soul',soul))): raise ValueError('conflict')
  op=p['mutation'];action=op['action'];target='SOUL.md' if action=='soul' else ('USER.md' if action=='user' else 'MEMORY.md')
  entries=[x.strip() for x in memory.split('\n§\n') if x.strip()]
  if action=='add': entries.append(op['content'].strip());content='\n§\n'.join(entries)
  elif action in ('update','remove'):
   index=op['index']
   if not isinstance(index,int) or index<0 or index>=len(entries): raise ValueError('entry')
   if action=='update': entries[index]=op['content'].strip()
   else: entries.pop(index)
   content='\n§\n'.join(entries)
  elif action in ('user','raw','soul'): content=op['content']
  else: raise ValueError('operation')
  limit=p['limits']['userCharLimit' if action=='user' else 'memoryCharLimit']
  if action not in ('raw','soul') and len(content)>limit: raise ValueError('limit')
  if len(content.encode('utf-8'))>1048576: raise ValueError('oversize')
  write('desktop-backup-'+uuid.uuid4().hex+'.json',json.dumps({'memory':memory,'user':user,'soul':soul},ensure_ascii=False))
  write(target,content,hfd if action=='soul' else dfd)
 print(json.dumps({'success':True}))
except Exception as error:
 code=str(error) if str(error) in ('conflict','entry','limit','oversize','unsafe','operation') else 'unavailable'
 print(json.dumps({'success':False,'error':code}))
`;

/** Fixed interpreter, isolated environment, stdin only. Neither paths nor contents enter IPC errors. */
export function mutateMemoryFiles(input: LockedMemoryInput): {
  success: boolean;
  error?: string;
} {
  const result = spawnSync(
    input.python,
    ["-I", "-c", MEMORY_FILE_TRANSACTION],
    {
      input: JSON.stringify(input),
      encoding: "utf8",
      timeout: 2000,
      maxBuffer: 4096,
      windowsHide: true,
      env:
        process.platform === "win32"
          ? { SystemRoot: process.env.SystemRoot, PYTHONNOUSERSITE: "1" }
          : { PYTHONNOUSERSITE: "1" },
    },
  );
  if (result.error || result.status !== 0)
    return {
      success: false,
      error: "Memory lock unavailable or timed out; nothing was retried",
    };
  try {
    const value = JSON.parse(result.stdout) as {
      success?: unknown;
      error?: unknown;
    };
    if (value.success === true) return { success: true };
    const errors: Record<string, string> = {
      conflict: "Memory changed; inspect again before editing",
      entry: "Entry not found",
      limit: "Memory character limit exceeded",
      oversize: "Memory content too large",
      unsafe: "Memory storage unavailable",
      operation: "Unsupported memory operation",
    };
    return {
      success: false,
      error: errors[String(value.error)] ?? "Memory storage unavailable",
    };
  } catch {
    return { success: false, error: "Memory storage unavailable" };
  }
}
