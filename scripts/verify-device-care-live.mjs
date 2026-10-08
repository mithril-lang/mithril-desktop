import { build } from "esbuild";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

// No customer files or vendor tenant: real engine + OS keyring in an isolated Electron profile.
const root = await realpath(
  await mkdtemp(join(tmpdir(), "mithril-device-care-adapter-live-")),
);
const entry = join(root, "live.cjs");
const quarantineModule = resolve("src/main/device-care/quarantine.ts");
const protectionModule = resolve("src/main/device-care/protection.ts");
const eicar =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
await build({
  stdin: {
    contents: `
import { app } from 'electron';
import { mkdir, writeFile, readFile, access } from 'fs/promises';
import { join } from 'path';
import assert from 'assert/strict';
import { DeviceCareProtection } from ${JSON.stringify(protectionModule)};
import { DeviceCareQuarantine } from ${JSON.stringify(quarantineModule)};
app.setPath('userData', ${JSON.stringify(join(root, "userdata"))});
app.whenReady().then(async () => {
 const root=${JSON.stringify(join(root, "selected"))}; await mkdir(root);
 const file=join(root,'eicar-test.txt'); await writeFile(file,${JSON.stringify(eicar)});
 const protection=new DeviceCareProtection();
 const status=await protection.status(); assert(status.available);
 await protection.start(root);
 const deadline=Date.now()+120000;
 while(protection.job()?.state==='running' && Date.now()<deadline) await new Promise(r=>setTimeout(r,100));
 const job=protection.job(); assert.equal(job.state,'partial'); assert(job.findings.some(s=>s.includes('Eicar-Test-Signature')));
 const custody=new DeviceCareQuarantine(app.getPath('userData'), path=>protection.verifyCapturedFile(path));
 const [review]=await custody.review(job); assert(review);
 const result=await custody.quarantine(review.id,async()=>true); assert.equal(result.state,'quarantined');
 await assert.rejects(access(file));
 const restored=join(root,'restored.txt'); assert(await custody.restore(result.id,restored,async()=>true));
 assert.equal(await readFile(restored,'utf8'),${JSON.stringify(eicar)});
 console.log(JSON.stringify({schema:'device-care-adapter-live-v1',engine:status.version,signatureDate:status.signatureDate,detected:job.findings.length,quarantined:result.state,restored:true,network:'none',customerFiles:'none'}));
 app.exit(0);
}).catch(error=>{ console.error(error.message); app.exit(1); });
`,
    resolveDir: process.cwd(),
    sourcefile: "device-care-live.ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  outfile: entry,
});
const require = createRequire(import.meta.url);
const executable = require("electron");
const env = { ...process.env };
for (const key of Object.keys(env))
  if (/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)) delete env[key];
try {
  const code = await new Promise((accept, reject) => {
    const child = spawn(executable, [entry], { env, stdio: "inherit" });
    const timeout = setTimeout(() => {
      child.kill();
      reject(Error("Live adapter deadline exceeded"));
    }, 180000);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      accept(code);
    });
  });
  if (code !== 0) throw Error(`Live adapter exited ${code}`);
} finally {
  await rm(root, { recursive: true, force: true });
}
