/* eslint-disable @typescript-eslint/explicit-function-return-type -- Independent JavaScript CLI. */
import { spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  copyFileSync,
  lstatSync,
  realpathSync,
  existsSync,
  rmSync,
  openSync,
  closeSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  ARCHITECTURES,
  IDENTITY,
  TEAM,
  sha256,
  assertSource,
  notarizationArgs,
  verifySignatureMetadata,
  artifactRecord,
  verifyReceipt,
} from "./core.mjs";

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function run(
  command,
  args,
  { cwd = checkout, env = process.env, timeout = 1800000, output = false } = {},
) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  // Signing tools can include credentials in failures. Do not relay their output.
  if (result.error || result.status !== 0)
    throw Error(`${command} failed (exit ${result.status ?? "unavailable"})`);
  if (output) process.stdout.write(result.stdout);
  return result.stdout + result.stderr;
}
const git = (...args) => run("git", args).trim();
function source() {
  const manifest = JSON.parse(readFileSync(join(checkout, "package.json")));
  const sha = git("rev-parse", "HEAD");
  const remoteMain = git("ls-remote", "origin", "refs/heads/main").split(
    /\s/,
  )[0];
  assertSource({
    sha,
    remoteMain,
    dirty: git("status", "--porcelain"),
    version: manifest.version,
    nodeVersion: process.version,
  });
  const origin = git("remote", "get-url", "origin");
  if (
    !/^(git@github\.com:|https:\/\/github\.com\/)mithril-lang\/mithril-desktop(?:\.git)?$/.test(
      origin,
    )
  )
    throw Error("Unexpected repository origin");
  const lock = JSON.parse(readFileSync(join(checkout, "package-lock.json")));
  if (
    lock.version !== manifest.version ||
    lock.packages[""].version !== manifest.version
  )
    throw Error("Manifest/lock version mismatch");
  return {
    sha,
    version: manifest.version,
    lockSha256: sha256(readFileSync(join(checkout, "package-lock.json"))),
  };
}
function privateState(path) {
  if (!path) throw Error("An external private --state directory is required");
  const state = resolve(path);
  if (state === checkout || state.startsWith(checkout + "/"))
    throw Error("State must be outside the checkout");
  mkdirSync(state, { recursive: true, mode: 0o700 });
  const stat = lstatSync(state);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.mode & 0o077 ||
    stat.uid !== process.getuid()
  )
    throw Error("State must be an owner-only directory");
  if (realpathSync(state) !== state)
    throw Error("State symlinks are forbidden");
  return state;
}
function preflight(arch, requireNotarization = true) {
  if (process.platform !== "darwin" || !ARCHITECTURES.includes(arch))
    throw Error("A native Mac and arm64 or x64 are required");
  const identity = run("security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
  ]);
  if (!identity.includes(IDENTITY))
    throw Error("The required Developer ID signing identity is unavailable");
  run("xcode-select", ["-p"]);
  run("xcrun", ["notarytool", "--version"]);
  if (arch === "x64") run("arch", ["-x86_64", "/usr/bin/true"]);
  if (!requireNotarization) return [];
  const auth = notarizationArgs(process.env);
  // Validates actual credentials and agreement state, without a new submission.
  const history = JSON.parse(
    run(
      "xcrun",
      ["notarytool", "history", ...auth, "--output-format", "json"],
      { timeout: 60000 },
    ),
  );
  if (!Array.isArray(history.history))
    throw Error("Notarization credentials could not be verified");
  return auth;
}
async function qualify(arch, state, identity, packageOnly = false) {
  const auth = preflight(arch, !packageOnly);
  if (existsSync(join(checkout, "dist")))
    throw Error("Use a fresh checkout without prior dist artifacts");
  const env = {
    ...process.env,
    PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
    CSC_NAME: IDENTITY,
    CSC_IDENTITY_AUTO_DISCOVERY: "true",
  };
  // Automatic notarization is disabled only here; manual accepted submission and
  // staple verification below are required before any qualified receipt exists.
  delete env.CSC_LINK;
  for (const args of [
    ["ci"],
    ["run", "audit:prod"],
    ["run", "lint"],
    ["run", "build"],
    ["test"],
    ["run", "check:packaging"],
    ["run", "lat:check"],
  ]) {
    console.log(`npm ${args.join(" ")}`);
    run("npm", args, { env });
  }
  run(process.execPath, ["--test", "scripts/independent-macos/core.test.mjs"], {
    env,
  });
  const cli = join(checkout, "node_modules/electron-builder/out/cli/cli.js");
  run(process.execPath, [cli, "install-app-deps", `--arch=${arch}`], { env });
  run(
    process.execPath,
    [
      cli,
      "--mac",
      "dmg",
      "zip",
      `--${arch}`,
      "--publish",
      "never",
      "-c.mac.notarize=false",
    ],
    { env },
  );
  const app = join(
    checkout,
    arch === "x64" ? "dist/mac/Mithril.app" : "dist/mac-arm64/Mithril.app",
  );
  run("bash", ["scripts/verify-native-module-architecture.sh", arch]);
  run("codesign", ["--verify", "--deep", "--strict", app]);
  verifySignatureMetadata(run("codesign", ["--display", "--verbose=4", app]));
  const format = run("file", [join(app, "Contents/MacOS/Mithril")]);
  if (!format.includes(arch === "x64" ? "x86_64" : "arm64"))
    throw Error("Executable architecture mismatch");
  const names = [
    `mithril-desktop-${identity.version}-${arch}.dmg`,
    `mithril-desktop-${identity.version}-${arch}-mac.zip`,
  ];
  const [dmg, zip] = names.map((name) => join(checkout, "dist", name));
  if (packageOnly) {
    if (source().sha !== identity.sha)
      throw Error("Remote main changed while packaging");
    for (const name of names)
      copyFileSync(join(checkout, "dist", name), join(state, name));
    const result = {
      schemaVersion: 1,
      repository: "mithril-lang/mithril-desktop",
      ...identity,
      arch,
      platform: "darwin",
      team: TEAM,
      status: "signed-only",
      signatureVerified: true,
      notarization: { status: "pending" },
      launchVerified: false,
      artifacts: names.map((name) => artifactRecord(join(state, name))),
      finishedAt: new Date().toISOString(),
      releaseEligible: false,
    };
    writeFileSync(
      join(state, `signed-only-${arch}.json`),
      JSON.stringify(result, null, 2) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const submission = JSON.parse(
    run(
      "xcrun",
      [
        "notarytool",
        "submit",
        zip,
        ...auth,
        "--wait",
        "--output-format",
        "json",
      ],
      { timeout: 1800000 },
    ),
  );
  if (submission.status !== "Accepted")
    throw Error(
      `Notarization did not accept the package (${submission.status || "unknown"})`,
    );
  // The app is stapled before rebuilding ZIP; the DMG has its own accepted submission.
  run("xcrun", ["stapler", "staple", app]);
  const dmgSubmission = JSON.parse(
    run(
      "xcrun",
      [
        "notarytool",
        "submit",
        dmg,
        ...auth,
        "--wait",
        "--output-format",
        "json",
      ],
      { timeout: 1800000 },
    ),
  );
  if (dmgSubmission.status !== "Accepted")
    throw Error("DMG notarization was not accepted");
  run("xcrun", ["stapler", "staple", dmg]);
  run("xcrun", ["stapler", "validate", app]);
  run("xcrun", ["stapler", "validate", dmg]);
  run("codesign", ["--verify", "--deep", "--strict", app]);
  run("spctl", ["--assess", "--type", "execute", "--verbose=4", app]);
  run("spctl", [
    "--assess",
    "--type",
    "open",
    "--context",
    "context:primary-signature",
    "--verbose=4",
    dmg,
  ]);
  run("hdiutil", ["verify", dmg]);
  rmSync(zip);
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
  const launchHome = mkdtempSync(join(tmpdir(), "mithril-independent-launch-"));
  try {
    const { _electron } = await import("playwright");
    const application = await _electron.launch({
      executablePath: join(app, "Contents/MacOS/Mithril"),
      args: [`--user-data-dir=${join(launchHome, "userdata")}`],
      env: {
        PATH: env.PATH,
        HOME: launchHome,
        TMPDIR: launchHome,
        HERMES_HOME: join(launchHome, "profile"),
        LANG: "en_US.UTF-8",
      },
      timeout: 60000,
    });
    try {
      const window = await application.firstWindow();
      await window
        .getByRole("heading", { name: "Welcome to Mithril" })
        .waitFor({ timeout: 60000 });
      await window.screenshot({ path: join(state, `launch-${arch}.png`) });
    } finally {
      await application.close();
    }
  } finally {
    rmSync(launchHome, { recursive: true, force: true });
  }
  // A moving main invalidates qualification; keep bytes but issue no success.
  const current = source();
  if (current.sha !== identity.sha)
    throw Error("Remote main changed while building");
  for (const name of names)
    copyFileSync(join(checkout, "dist", name), join(state, name));
  const receipt = {
    schemaVersion: 1,
    repository: "mithril-lang/mithril-desktop",
    ...identity,
    platform: "darwin",
    arch,
    team: TEAM,
    status: "qualified",
    notarization: {
      id: submission.id,
      status: submission.status,
      dmgId: dmgSubmission.id,
      dmgStatus: dmgSubmission.status,
    },
    signatureVerified: true,
    gatekeeperVerified: true,
    stapleVerified: true,
    launchVerified: true,
    runtime: {
      node: process.version,
      nodeSha256: sha256(readFileSync(process.execPath)),
      electron: JSON.parse(
        readFileSync(join(checkout, "node_modules/electron/package.json")),
      ).version,
      executableSha256: sha256(
        readFileSync(join(app, "Contents/MacOS/Mithril")),
      ),
      nativeSha256: sha256(
        readFileSync(
          join(
            app,
            `Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/darwin-${arch}.node`,
          ),
        ),
      ),
    },
    artifacts: names.map((name) => artifactRecord(join(state, name))),
    finishedAt: new Date().toISOString(),
    releaseEligible: false,
  };
  writeFileSync(
    join(state, `receipt-${arch}.json`),
    JSON.stringify(receipt, null, 2) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  console.log(JSON.stringify(receipt, null, 2));
}
try {
  const [command, ...argv] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (
      !["--arch", "--state"].includes(argv[i]) ||
      !argv[i + 1] ||
      options[argv[i].slice(2)] !== undefined
    )
      throw Error("Expected --arch or --state with a value");
    options[argv[i].slice(2)] = argv[i + 1];
  }
  const identity = source();
  if (command === "preflight") {
    preflight(options.arch);
    console.log(
      JSON.stringify({
        ...identity,
        arch: options.arch,
        status: "ready-to-build",
        releaseEligible: false,
      }),
    );
  } else if (command === "qualify" || command === "package") {
    if (!options.state)
      throw Error("An external private --state directory is required");
    const state = privateState(options.state);
    const fd = openSync(join(state, "run.lock"), "wx", 0o600);
    try {
      await qualify(options.arch, state, identity, command === "package");
    } finally {
      closeSync(fd);
      rmSync(join(state, "run.lock"));
    }
  } else if (command === "verify") {
    const state = privateState(options.state);
    for (const arch of ARCHITECTURES)
      verifyReceipt(
        JSON.parse(readFileSync(join(state, `receipt-${arch}.json`))),
        { ...identity, directory: state },
      );
    console.log(
      JSON.stringify({
        ...identity,
        status: "macos-qualified",
        releaseEligible: false,
        pendingPlatforms: ["windows-x64", "linux-x64", "linux-arm64"],
      }),
    );
  } else
    throw Error(
      "Usage: cli.mjs preflight/package/qualify --arch arm64|x64 [--state PRIVATE_DIRECTORY] | verify --state PRIVATE_DIRECTORY",
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
