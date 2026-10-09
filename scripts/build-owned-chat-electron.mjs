import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const destination = process.argv[2];
if (!destination || !destination.startsWith("/"))
  throw Error("absolute task output directory required");
await mkdir(destination, { recursive: true });
for (const [entry, name] of [
  ["scripts/owned-chat-electron-main.mjs", "main.cjs"],
  ["src/preload/index.ts", "preload.cjs"],
]) {
  await build({
    entryPoints: [resolve(entry)],
    outfile: resolve(destination, name),
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    target: "node24",
  });
}
