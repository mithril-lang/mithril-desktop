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
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  capabilityResourceManifestBytes,
  validCapabilityResourceManifest,
  type CapabilityResourceManifest,
  type CapabilityResourceTransport,
  validSkillResourcePointer,
  type SkillResourcePointer,
} from "@mithril/workspace/capability-resources";
import { CHUNK_BYTES, MAX_MANIFEST_BYTES } from "@mithril/workspace/files";

/** Data capture only. Directory descriptors prevent source symlinks from escaping the profile. */
const CAPTURE_SKILL_TREE = String.raw`
import sys,json,os,stat,hashlib,contextlib
sys.stdout.reconfigure(encoding='utf-8')
try:
 p=json.load(sys.stdin)
 if os.name=='nt': raise ValueError('unsupported')
 flags=os.O_RDONLY|getattr(os,'O_DIRECTORY',0)|getattr(os,'O_NOFOLLOW',0)
 def open_dir(path):
  if not os.path.isabs(path): raise ValueError('unsafe')
  fd=os.open('/',flags)
  try:
   for part in path.split('/')[1:]:
    if part:
     child=os.open(part,flags,dir_fd=fd);os.close(fd);fd=child
   return fd
  except:os.close(fd);raise
 def sha(data):return hashlib.sha256(data).hexdigest()
 def stamp(info):return (info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns,stat.S_IMODE(info.st_mode))
 def ignored(name):
  import re
  return bool(re.match(r'^(\.git|\.git-credentials|\.npmrc|\.pypirc|\.netrc|\.hg|\.svn|node_modules|\.venv|venv|__pycache__|\.ssh|\.aws|\.azure|\.config|\.mithril-sync-trash)$',name,re.I) or re.match(r'^\.env(?:\.|$)',name,re.I) or re.match(r'^(id_rsa|id_ed25519|credentials|secrets?)(\.|$)',name,re.I) or re.search(r'\.(pem|key|p12|pfx)$',name,re.I) or name.startswith('.mithril-sync-'))
 files=[];total=0;excluded=0;observed={}
 def walk(dfd,prefix,stage,read):
  global total,excluded
  start=os.fstat(dfd);names=sorted(os.listdir(dfd)); entries={}
  for name in names:
   info=os.stat(name,dir_fd=dfd,follow_symlinks=False)
   if stat.S_ISLNK(info.st_mode):raise ValueError('unsafe')
   if ignored(name):
    if read:excluded+=1
    continue
   path=prefix+'/'+name if prefix else name
   if len(path)>1024:raise ValueError('unsupported')
   entries[path]=stamp(info)
   if stat.S_ISDIR(info.st_mode):
    fd=os.open(name,flags,dir_fd=dfd)
    try:walk(fd,path,stage,read)
    finally:os.close(fd)
   elif stat.S_ISREG(info.st_mode):
    if read:
     fd=os.open(name,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0),dir_fd=dfd)
     try:
      before=os.fstat(fd)
      if stamp(before)!=stamp(info):raise ValueError('conflict')
      chunks=[];size=0;markdown=bytearray() if name=='SKILL.md' else None
      while True:
       chunk=os.read(fd,8388608)
       if not chunk:break
       size+=len(chunk)
       if total+size>1073741824:raise ValueError('oversize')
       if markdown is not None:
        markdown.extend(chunk)
        if size>1048576:raise ValueError('oversize')
       digest=sha(chunk);chunks.append(digest)
       try:out=os.open(digest,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0),0o600,dir_fd=stage)
       except FileExistsError:pass
       else:
        with os.fdopen(out,'wb') as stream:stream.write(chunk)
      if markdown is not None:markdown.decode('utf-8')
      if stamp(before)!=stamp(os.fstat(fd)) or stamp(before)!=stamp(os.stat(name,dir_fd=dfd,follow_symlinks=False)):raise ValueError('conflict')
      if size!=before.st_size:raise ValueError('conflict')
      files.append({'path':path,'size':size,'digest':sha(json.dumps({'size':size,'chunks':chunks},separators=(',',':')).encode()),'chunks':chunks,'executable':bool(before.st_mode&0o111)})
      total+=size
      if len(files)>10000:raise ValueError('oversize')
     finally:os.close(fd)
   else:raise ValueError('unsupported')
  if stamp(start)!=stamp(os.fstat(dfd)) or names!=sorted(os.listdir(dfd)):raise ValueError('conflict')
  if read:observed[prefix]=entries
  elif observed.get(prefix)!=entries:raise ValueError('conflict')
 with contextlib.ExitStack() as stack:
  stage=open_dir(p['stage']);stack.callback(os.close,stage)
  parent=open_dir(os.path.dirname(p['root']));stack.callback(os.close,parent)
  name=os.path.basename(p['root'])
  try:root=os.open(name,flags,dir_fd=parent)
  except FileNotFoundError:root=None
  if root is not None:
   stack.callback(os.close,root);initial=os.fstat(root)
   walk(root,'',stage,True);walk(root,'',stage,False)
   if stamp(initial)!=stamp(os.stat(name,dir_fd=parent,follow_symlinks=False)):raise ValueError('conflict')
  print(json.dumps({'manifest':{'version':1,'capabilityId':p['capabilityId'],'files':files},'excluded':excluded},ensure_ascii=False))
except Exception as error:
 code=str(error) if str(error) in ('unsupported','unsafe','oversize','conflict') else 'unavailable'
 print(json.dumps({'error':code}))
`;
function checked(path: string): void {
  let current = resolve(path);
  for (;;) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new Error("Unsafe resource storage");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
export interface SkillResourceCapture {
  manifest: CapabilityResourceManifest;
  digest: string;
  excluded: number;
  readChunk(digest: string): Uint8Array;
  dispose(): void;
}
// @lat: [[cloud-workspace#Cloud workspace#Rich repository implementation in progress#Original Skill directory capture (draft)]]
export function captureSkillResources(
  root: string,
  python: string,
  stateRoot: string,
  capabilityId: string,
): SkillResourceCapture {
  checked(stateRoot);
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  checked(stateRoot);
  const stage = mkdtempSync(join(stateRoot, ".mithril-sync-skill-capture-"));
  const dispose = (): void => rmSync(stage, { recursive: true, force: true });
  try {
    const result = spawnSync(python, ["-I", "-c", CAPTURE_SKILL_TREE], {
      input: JSON.stringify({
        root: resolve(root),
        stage: resolve(stage),
        capabilityId,
      }),
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: MAX_MANIFEST_BYTES + 4096,
      windowsHide: true,
      env:
        process.platform === "win32"
          ? { SystemRoot: process.env.SystemRoot, PYTHONNOUSERSITE: "1" }
          : { PYTHONNOUSERSITE: "1" },
    });
    if (result.status !== 0 || result.error)
      throw new Error("Skill resource capture unavailable; source retained");
    const value = JSON.parse(result.stdout) as {
      error?: unknown;
      manifest?: unknown;
      excluded?: unknown;
    };
    if (
      value.error ||
      !validCapabilityResourceManifest(value.manifest) ||
      value.manifest.capabilityId !== capabilityId ||
      !Number.isSafeInteger(value.excluded) ||
      Number(value.excluded) < 0
    )
      throw new Error(
        "Skill resource source requires review; original files retained",
      );
    const manifest = value.manifest;
    const bytes = capabilityResourceManifestBytes(manifest);
    if (bytes.length > MAX_MANIFEST_BYTES)
      throw new Error("Skill resource manifest too large; source retained");
    return stagedResources(
      stage,
      manifest,
      createHash("sha256").update(bytes).digest("hex"),
      Number(value.excluded),
    );
  } catch (error) {
    dispose();
    throw error;
  }
}
/** Verify a known immutable manifest before skipping repeat uploads; no file is installed or executed. */
export async function publishSkillResources(
  capture: SkillResourceCapture,
  transport: CapabilityResourceTransport,
  guard: () => Promise<void>,
): Promise<string> {
  await guard();
  try {
    const stored = await transport.getManifest(
      capture.manifest.capabilityId,
      capture.digest,
    );
    if (
      Buffer.from(capabilityResourceManifestBytes(stored)).equals(
        Buffer.from(capabilityResourceManifestBytes(capture.manifest)),
      )
    ) {
      await guard();
      return capture.digest;
    }
    throw new Error("Stored Skill resource manifest mismatch");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/request failed \(404\)$/.test(error.message)
    )
      throw error;
  }
  for (const digest of new Set(
    capture.manifest.files.flatMap((file) => file.chunks),
  )) {
    await guard();
    const bytes = capture.readChunk(digest);
    if (
      transport.hasChunk &&
      (await transport.hasChunk(
        capture.manifest.capabilityId,
        digest,
        bytes.length,
      ))
    ) {
      await guard();
      continue;
    }
    await guard();
    const uploaded = await transport.putChunk(
      capture.manifest.capabilityId,
      bytes,
    );
    if (uploaded !== digest)
      throw new Error("Skill resource upload integrity mismatch");
  }
  await guard();
  const digest = await transport.putManifest(capture.manifest);
  await guard();
  if (digest !== capture.digest)
    throw new Error("Skill resource manifest integrity mismatch");
  return digest;
}

function stagedResources(
  stage: string,
  manifest: CapabilityResourceManifest,
  digest: string,
  excluded: number,
): SkillResourceCapture {
  const dispose = (): void => rmSync(stage, { recursive: true, force: true });
  const allowed = new Set(manifest.files.flatMap((file) => file.chunks));
  return {
    manifest,
    excluded,
    digest,
    dispose,
    readChunk(digest) {
      if (!allowed.has(digest))
        throw new Error("Unknown captured resource chunk");
      checked(stage);
      const path = join(stage, digest);
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const buffer = Buffer.alloc(CHUNK_BYTES + 1);
        let size = 0;
        for (;;) {
          const count = readSync(fd, buffer, size, buffer.length - size, size);
          size += count;
          if (size > CHUNK_BYTES)
            throw new Error("Captured resource chunk too large");
          if (!count) break;
        }
        const data = buffer.subarray(0, size);
        if (createHash("sha256").update(data).digest("hex") !== digest)
          throw new Error("Captured resource chunk changed; source retained");
        return new Uint8Array(data);
      } finally {
        closeSync(fd);
      }
    },
  };
}

// @lat: [[cloud-workspace#Cloud workspace#Rich repository implementation in progress#Verified Skill resource download (draft)]]
export async function downloadSkillResources(
  pointer: SkillResourcePointer,
  transport: CapabilityResourceTransport,
  stateRoot: string,
  guard: () => Promise<void>,
): Promise<SkillResourceCapture> {
  if (!validSkillResourcePointer(pointer))
    throw new Error("Invalid Skill resource pointer");
  await guard();
  const manifest = await transport.getManifest(
    pointer.capabilityId,
    pointer.manifest,
  );
  await guard();
  if (
    !validCapabilityResourceManifest(manifest) ||
    manifest.capabilityId !== pointer.capabilityId ||
    createHash("sha256")
      .update(capabilityResourceManifestBytes(manifest))
      .digest("hex") !== pointer.manifest
  )
    throw new Error("Skill resource manifest integrity mismatch");
  checked(stateRoot);
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  checked(stateRoot);
  const stage = mkdtempSync(join(stateRoot, ".mithril-sync-skill-download-"));
  const capture = stagedResources(stage, manifest, pointer.manifest, 0);
  try {
    const downloaded = new Set<string>();
    for (const file of manifest.files) {
      let size = 0;
      for (let index = 0; index < file.chunks.length; index++) {
        const digest = file.chunks[index];
        await guard();
        if (!downloaded.has(digest)) {
          const bytes = await transport.getChunk(pointer.capabilityId, digest);
          await guard();
          if (
            bytes.length > CHUNK_BYTES ||
            createHash("sha256").update(bytes).digest("hex") !== digest
          )
            throw new Error("Skill resource chunk integrity mismatch");
          checked(stage);
          writeFileSync(join(stage, digest), bytes, {
            mode: 0o600,
            flag: "wx",
          });
          downloaded.add(digest);
        }
        const bytes = capture.readChunk(digest);
        if (
          bytes.length !==
          Math.min(CHUNK_BYTES, file.size - index * CHUNK_BYTES)
        )
          throw new Error("Skill resource chunk size mismatch");
        size += bytes.length;
      }
      if (
        size !== file.size ||
        createHash("sha256")
          .update(JSON.stringify({ size, chunks: file.chunks }))
          .digest("hex") !== file.digest
      )
        throw new Error("Skill resource file integrity mismatch");
    }
    await guard();
    return capture;
  } catch (error) {
    capture.dispose();
    throw error;
  }
}
