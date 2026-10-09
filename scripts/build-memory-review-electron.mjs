import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const destination = process.argv[2];
if (!destination?.startsWith("/")) throw Error("absolute task output required");
await mkdir(destination, { recursive: true });
for (const [entry, name] of [
  ["scripts/memory-review-electron-main.mjs", "main.cjs"],
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
await build({
  entryPoints: [resolve("scripts/memory-review-electron-renderer.tsx")],
  outfile: resolve(destination, "renderer.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  // Match Vite's absent opt-in event log setting in this standalone fixture.
  define: { "import.meta.env.VITE_HERMES_DESKTOP_DASHBOARD_EVENT_LOG": '"0"' },
});
await writeFile(
  resolve(destination, "index.html"),
  '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><div id="root"></div><script type="module" src="renderer.js"></script>',
);
