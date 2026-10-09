import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Chat composer remains inside the viewport]]
test("production Chat keeps its composer visible with empty and long transcripts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mithril-chat-viewport-"));
  const artifacts = "artifacts/chat-viewport";
  await mkdir(artifacts, { recursive: true });
  let browser, server;
  try {
    await build({
      entryPoints: ["scripts/fixtures/chat-viewport.tsx"],
      bundle: true,
      outdir: directory,
      jsx: "automatic",
      loader: {
        ".svg": "dataurl",
        ".png": "dataurl",
        ".woff": "dataurl",
        ".woff2": "dataurl",
        ".ttf": "dataurl",
      },
    });
    const nativeCss = (
      await readFile("src/renderer/src/assets/main.css", "utf8")
    ).replace(/^@import[^;]+;/gm, "");
    server = createServer(async (request, response) => {
      const path = new URL(request.url, "http://localhost").pathname;
      if (["/chat-viewport.js", "/chat-viewport.css"].includes(path)) {
        response.setHeader(
          "Content-Type",
          path.endsWith(".js") ? "text/javascript" : "text/css",
        );
        response.end(await readFile(join(directory, path.slice(1))));
      } else {
        response.setHeader("Content-Type", "text/html");
        response.end(
          `<html data-theme="dark"><head><style>${nativeCss}html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}</style><link rel="stylesheet" href="/chat-viewport.css"></head><body><div id="root"></div><script type="module" src="/chat-viewport.js"></script></body></html>`,
        );
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    browser = await chromium.launch({ headless: true });
    for (const [width, height] of [
      [552, 576],
      [1280, 720],
    ])
      for (const count of [0, 80]) {
        const page = await browser.newPage({ viewport: { width, height } });
        await page.goto(
          `http://127.0.0.1:${server.address().port}/?count=${count}`,
        );
        await page.getByRole("combobox", { name: "Mithril model" }).waitFor();
        if (count)
          await page
            .getByText("Viewport message 80.", { exact: false })
            .waitFor();
        const metrics = await page.evaluate(() => {
          const transcript = document.querySelector(".session-conversation");
          const composer = document
            .querySelector(".session-composer-area")
            .getBoundingClientRect();
          const footer = document
            .querySelector(".status-bar")
            .getBoundingClientRect();
          return {
            composerTop: composer.top,
            composerBottom: composer.bottom,
            footerTop: footer.top,
            footerBottom: footer.bottom,
            transcriptHeight: transcript.clientHeight,
            transcriptScroll: transcript.scrollHeight,
            overflow:
              document.documentElement.scrollHeight > innerHeight ||
              document.documentElement.scrollWidth > innerWidth,
          };
        });
        await page.screenshot({
          path: join(artifacts, `${width}-${height}-${count}.png`),
        });
        assert.ok(
          metrics.composerTop >= 0 &&
            metrics.composerBottom <= metrics.footerTop + 1,
          "entire composer must fit above the Desktop status strip",
        );
        assert.ok(
          metrics.footerBottom <= height + 1,
          "status strip must remain visible",
        );
        assert.equal(
          metrics.overflow,
          false,
          "conversation must not scroll the entire app",
        );
        if (count)
          assert.ok(
            metrics.transcriptScroll > metrics.transcriptHeight,
            "long history must scroll inside the transcript",
          );
        await page.close();
      }
  } finally {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
