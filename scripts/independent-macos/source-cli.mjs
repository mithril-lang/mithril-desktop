/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { spawn, spawnSync } from "node:child_process";
import { X509Certificate, randomBytes } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  lstatSync,
  realpathSync,
  existsSync,
  openSync,
  closeSync,
  createReadStream,
  copyFileSync,
  chmodSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { hostname } from "node:os";
import { fileURLToPath } from "node:url";
import { sha256, IDENTITY, verifySignatureMetadata } from "./core.mjs";
import {
  SOURCE_PROFILES,
  SOURCE_IMAGE,
  importSourceArtifacts,
  sourceRecipe,
  assertCandidate,
  sourceInventory,
  verifySourcePayload,
} from "./source-core.mjs";
const runner = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function run(command, args, cwd, env, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 1800000,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0)
    throw Error(`${command} failed (exit ${result.status ?? "unavailable"})`);
  return result.stdout;
}
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
async function docker(args, fd, input = null, capture = false) {
  const command = ["docker", ...args].map(quote).join(" ");
  return new Promise((resolvePromise, reject) => {
    const child = spawn("/usr/bin/ssh", ["gad", command], {
      stdio: [
        input ? "pipe" : "ignore",
        capture ? "pipe" : (fd ?? "ignore"),
        fd ?? "ignore",
      ],
      env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME },
    });
    const chunks = [];
    let size = 0;
    let inputError = null;
    if (capture)
      child.stdout.on("data", (chunk) => {
        size += chunk.length;
        if (size > 128 * 1024 * 1024) {
          inputError = Error("Artifact export too large");
          child.kill();
        } else chunks.push(chunk);
      });
    const timer = setTimeout(() => {
      inputError = Error("Isolated source stage timed out");
      child.kill();
    }, 1800000);
    if (input) {
      const stream = createReadStream(input);
      stream.on("error", (error) => {
        inputError = error;
        child.kill();
      });
      child.stdin.on("error", (error) => {
        inputError = error;
      });
      stream.pipe(child.stdin);
    }
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code || inputError)
        reject(
          Error(
            "Isolated source stage failed; inspect the private qualification log",
          ),
        );
      else
        resolvePromise(capture ? Buffer.concat(chunks).toString("utf8") : "");
    });
  });
}
function privateDirectory(path) {
  const directory = resolve(path);
  if (directory === runner || directory.startsWith(runner + "/"))
    throw Error("External state required");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const s = lstatSync(directory);
  if (
    !s.isDirectory() ||
    s.isSymbolicLink() ||
    s.mode & 0o077 ||
    s.uid !== process.getuid() ||
    realpathSync(directory) !== directory
  )
    throw Error("Owner-only real state directory required");
  return directory;
}
function repository(checkout) {
  const origin = run("git", ["remote", "get-url", "origin"], checkout).trim();
  const match =
    /^(?:https:\/\/github.com\/|git@github.com:)((?:mithril-lang\/mithril-desktop|kotoba-lang\/kagi|kotoba-lang\/kagitaba))(?:\.git)?$/.exec(
      origin,
    );
  if (!match) throw Error("Unsupported repository origin");
  return match[1];
}
function ownerCertificate() {
  return new X509Certificate(
    run(
      "/usr/bin/security",
      ["find-certificate", "-c", IDENTITY, "-p"],
      runner,
    ),
  ).fingerprint256;
}
function verify(receiptPath, identity, state) {
  const temp = mkdtempSync(join(state, "verify-"));
  try {
    if (
      !receiptPath.endsWith(".receipt.bundle") ||
      !receiptPath.startsWith(state + "/") ||
      !lstatSync(receiptPath).isDirectory() ||
      realpathSync(receiptPath) !== receiptPath
    )
      throw Error("Receipt must be an owner-state signed bundle");
    run(
      "/usr/bin/codesign",
      ["--verify", "--deep", "--strict", receiptPath],
      runner,
    );
    const metadata = spawnSync(
      "/usr/bin/codesign",
      ["--display", "--verbose=4", receiptPath],
      { encoding: "utf8" },
    );
    if (metadata.status !== 0)
      throw Error("Receipt signing metadata unavailable");
    verifySignatureMetadata(metadata.stderr);
    const prefix = join(temp, "signer-");
    run(
      "/usr/bin/codesign",
      ["--display", `--extract-certificates=${prefix}`, receiptPath],
      runner,
    );
    if (
      new X509Certificate(readFileSync(prefix + "0")).fingerprint256 !==
      ownerCertificate()
    )
      throw Error("Receipt signer differs from configured owner");
    const decoded = join(receiptPath, "Contents/Resources/receipt.json");
    const payload = verifySourcePayload(
      JSON.parse(readFileSync(decoded)),
      identity,
    );
    if (
      sha256(
        readFileSync(receiptPath.replace(/\.receipt\.bundle$/, ".log")),
      ) !== payload.logSha256
    )
      throw Error("Qualification log changed");
    const artifactPath = receiptPath.replace(
      /\.receipt\.bundle$/,
      ".artifacts",
    );
    if (
      JSON.stringify(sourceInventory(artifactPath)) !==
      JSON.stringify(payload.artifacts)
    )
      throw Error("Qualified source artifact hashes changed");
    return payload;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
try {
  const [command, ...args] = process.argv.slice(2),
    opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      !["--checkout", "--state", "--mode", "--receipt"].includes(args[i]) ||
      !args[i + 1] ||
      opts[args[i]]
    )
      throw Error("Invalid source qualification arguments");
    opts[args[i]] = args[i + 1];
  }
  if (process.platform !== "darwin" || !/^v24\./.test(process.version))
    throw Error("Local Mac with qualified Node 24 required");
  if (run("git", ["status", "--porcelain"], runner).trim())
    throw Error("Commit the source controller before qualification");
  const checkout = realpathSync(resolve(opts["--checkout"] || runner));
  const state = privateDirectory(opts["--state"]);
  if (state === checkout || state.startsWith(checkout + "/"))
    throw Error("State must be external to source");
  const repo = repository(checkout),
    sha = run("git", ["rev-parse", "HEAD"], checkout).trim(),
    mode = opts["--mode"] || "candidate";
  const remoteMain = run(
    "git",
    ["ls-remote", "origin", "refs/heads/main"],
    checkout,
  ).split(/\s/)[0];
  const dirty = run("git", ["status", "--porcelain"], checkout).trim();
  assertCandidate({
    repository: repo,
    sha,
    dirty,
    nodeVersion: process.version,
    mode,
    remoteMain,
  });
  const identity = {
    repository: repo,
    sha,
    recipe: sourceRecipe(repo),
    nodeSha256: sha256(readFileSync(process.execPath)),
    owner: `${hostname()}\n${ownerCertificate()}`,
  };
  if (command === "verify") {
    const payload = verify(resolve(opts["--receipt"]), identity, state);
    console.log(
      JSON.stringify({
        repository: repo,
        sha,
        status: payload.status,
        mode: payload.mode,
        releaseEligible: false,
      }),
    );
  } else if (command === "qualify") {
    const temp = mkdtempSync(join(state, "source-")),
      id = `${repo.split("/")[1]}-${sha.slice(0, 12)}-${Date.now()}`;
    const receipt = join(state, id + ".receipt.bundle"),
      log = join(state, id + ".log"),
      artifactPath = join(state, id + ".artifacts");
    const archive = join(temp, "source.tar");
    const volume = "mithril-source-" + randomBytes(12).toString("hex");
    let volumeCreated = false;
    const fd = openSync(log, "wx", 0o600);
    try {
      run("git", ["archive", sha, "--output", archive], checkout);
      const sourceArchiveSha256 = sha256(readFileSync(archive));
      await docker(["volume", "create", volume], fd);
      volumeCreated = true;
      const base = [
        "run",
        "--rm",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--cpus=2",
        "--memory=4g",
        "--pids-limit=256",
        "--mount",
        `type=volume,src=${volume},dst=/work`,
        "--mount",
        "type=volume,src=mithril-ci-npm-cache,dst=/npm-cache",
        "--tmpfs",
        "/tmp:rw,exec,size=1g",
        "--workdir",
        "/work",
        "--env",
        "HOME=/tmp",
        "--env",
        "NPM_CONFIG_CACHE=/npm-cache",
        "--env",
        "CI=true",
      ];
      const setup =
        "tar --no-same-owner --no-same-permissions -xf - -C /work && git config --global url.https://github.com/.insteadOf ssh://git@github.com/ && " +
        (SOURCE_PROFILES[repo].setup ?? [])
          .map(([bin, argv]) => [bin, ...argv].map(quote).join(" "))
          .join(" && ");
      const setupScript = setup.endsWith(" && ") ? setup.slice(0, -4) : setup;
      console.log(`${repo}: isolated dependency setup on gad`);
      await docker(
        [
          ...base,
          "-i",
          "--network=bridge",
          SOURCE_IMAGE,
          "bash",
          "-o",
          "pipefail",
          "-eu",
          "-c",
          setupScript,
        ],
        fd,
        archive,
      );
      for (const [binary, argv] of SOURCE_PROFILES[repo].commands) {
        console.log(`${repo}: offline ${binary} ${argv.join(" ")}`);
        await docker(
          [...base, "--network=none", SOURCE_IMAGE, binary, ...argv],
          fd,
        );
      }
      mkdirSync(artifactPath, { mode: 0o700 });
      if (repo === "mithril-lang/mithril-desktop") {
        const exportCode = `const fs=require('fs'),p=require('path'),c=require('crypto'),files=[];function walk(at){for(const name of fs.readdirSync(at).sort()){const path=p.join(at,name),s=fs.lstatSync(path);if(s.isSymbolicLink())throw Error('Artifact symlink');if(s.isDirectory())walk(path);else if(s.isFile()){const b=fs.readFileSync(path);files.push({path,bytes:b.length,sha256:c.createHash('sha256').update(b).digest('hex'),data:b.toString('base64')});}}}walk('out');process.stdout.write(JSON.stringify(files));`;
        const result = await docker(
          [...base, "--network=none", SOURCE_IMAGE, "node", "-e", exportCode],
          fd,
          null,
          true,
        );
        importSourceArtifacts(JSON.parse(result), artifactPath);
      }
      if (
        run("git", ["rev-parse", "HEAD"], checkout).trim() !== sha ||
        run("git", ["status", "--porcelain"], checkout).trim() ||
        (mode === "current-main" &&
          run(
            "git",
            ["ls-remote", "origin", "refs/heads/main"],
            checkout,
          ).split(/\s/)[0] !== sha)
      )
        throw Error("Source changed while qualifying");
      const payload = {
        schemaVersion: 1,
        ...identity,
        image: SOURCE_IMAGE,
        profile: SOURCE_PROFILES[repo].name,
        mode,
        status: "qualified",
        releaseEligible: false,
        sourceArchiveSha256,
        lockSha256: existsSync(join(checkout, "package-lock.json"))
          ? sha256(readFileSync(join(checkout, "package-lock.json")))
          : null,
        artifacts: sourceInventory(artifactPath),
        logSha256: sha256(readFileSync(log)),
        finishedAt: new Date().toISOString(),
      };
      // A code-signed resource bundle seals the JSON using the already approved
      // native codesign owner; no new private key or keychain ACL is introduced.
      const contents = join(receipt, "Contents");
      mkdirSync(join(contents, "MacOS"), { recursive: true, mode: 0o700 });
      mkdirSync(join(contents, "Resources"), { mode: 0o700 });
      copyFileSync("/usr/bin/true", join(contents, "MacOS/attestation"));
      chmodSync(join(contents, "MacOS/attestation"), 0o700);
      writeFileSync(
        join(contents, "Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>fund.mithril.source-receipt</string><key>CFBundleExecutable</key><string>attestation</string><key>CFBundlePackageType</key><string>BNDL</string><key>CFBundleVersion</key><string>1</string></dict></plist>`,
        { mode: 0o600 },
      );
      writeFileSync(
        join(contents, "Resources/receipt.json"),
        JSON.stringify(payload),
        { mode: 0o600 },
      );
      run(
        "/usr/bin/codesign",
        [
          "--force",
          "--sign",
          IDENTITY,
          "--options",
          "runtime",
          "--timestamp",
          receipt,
        ],
        runner,
        undefined,
        { timeout: 60000 },
      );
      verify(receipt, identity, state);
      console.log(
        JSON.stringify({
          repository: repo,
          sha,
          status: "qualified",
          receipt,
          log,
          releaseEligible: false,
        }),
      );
    } finally {
      closeSync(fd);
      if (volumeCreated)
        await docker(["volume", "rm", volume], null).catch(() => {});
      rmSync(temp, { recursive: true, force: true });
    }
  } else
    throw Error(
      "Use qualify or verify --checkout SOURCE --state PRIVATE_DIRECTORY --mode candidate|current-main [--receipt FILE]",
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
