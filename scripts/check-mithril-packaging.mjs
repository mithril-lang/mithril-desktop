/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const files = [];
for (const dir of ["src/main", "src/renderer", "src/shared"]) {
  const walk = (at) => {
    for (const entry of readdirSync(join(root, at), { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (
        [".ts", ".tsx", ".css", ".html"].includes(extname(path)) &&
        !/\.(test|spec)\.[jt]sx?$/.test(path)
      )
        files.push(path);
    }
  };
  walk(dir);
}

const forbidden =
  /kotoba\.cloud|app\.kotoba\.cloud|api\.kotoba\.cloud|KOTOBA_API_KEY|kc_pat_|Kotoba Cloud|["'`]Kotoba["'`]|\*\*Kotoba:/i;
const failures = [];
const quarantined = new Set();
for (const path of files) {
  if (quarantined.has(path)) continue;
  const lines = readFileSync(join(root, path), "utf8").split("\n");
  lines.forEach((line, index) => {
    if (forbidden.test(line)) failures.push(`${path}:${index + 1}`);
    for (const legacyPath of path.startsWith("src/main/") ? quarantined : []) {
      const moduleName = legacyPath
        .replace(/^src\/main\//, "")
        .replace(/\.ts$/, "");
      if (
        new RegExp(
          `(?:from\\s+|import\\s*\\()["'][^"']*${moduleName}["']`,
        ).test(line)
      ) {
        failures.push(`runtime import: ${path}:${index + 1}`);
      }
    }
  });
}

const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const builder = readFileSync(join(root, "electron-builder.yml"), "utf8");
for (const output of ["dist", "release", "artifacts"]) {
  if (!builder.includes(`"!${output}/**"`))
    failures.push(`missing build output exclusion: ${output}`);
}
const devFeed = readFileSync(join(root, "dev-app-update.yml"), "utf8");
if (
  metadata.name !== "mithril-desktop" ||
  !/^appId: fund\.mithril\.desktop$/m.test(builder)
)
  failures.push("package identity");
if (!/^productName: Mithril$/m.test(builder)) failures.push("display name");
if (
  !/url: https:\/\/app\.mithril\.fund\/download\//.test(builder) ||
  !/url: https:\/\/app\.mithril\.fund\/download\//.test(devFeed)
)
  failures.push("updater feed");
for (const path of [
  "build/icon.png",
  "build/icon.icns",
  "build/icon.ico",
  "resources/icon.png",
]) {
  if (!existsSync(join(root, path))) failures.push(path);
}
for (const path of ["kotoba.app.edn", "scripts/publish-release.cljk"]) {
  if (existsSync(join(root, path))) failures.push(`legacy publisher: ${path}`);
}

if (failures.length) {
  console.error(
    `Mithril packaging blocked: ${failures.length} unresolved legacy reference(s).`,
  );
  for (const failure of failures.slice(0, 15)) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Mithril packaging identity and ${files.length - quarantined.size} active runtime files checked.`,
  );
}
