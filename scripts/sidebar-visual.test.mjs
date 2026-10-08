import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

test("compiled renderer styles preserve original pinned/project sidebar layout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sidebar-visual-"));
  let browser, server;
  try {
    await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: "jsx",
        contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {DesktopSidebarRecentSessions,SidebarPlatform,sidebarTranslator} from '@mithril/workspace/desktop-sidebar';
      const rows=Array.from({length:90},(_,i)=>({id:String(i),title:'Project Files QA — 長いタイトル '.repeat(8),contextFolder:i===1?'project':null}));
      const api=new Proxy({}, {get:()=>async()=>[]});
      const value={api,t:sidebarTranslator(new URLSearchParams(location.search).get('lang')),reportError:()=>{},snapshot:{rows,pinnedIds:['0'],projects:[{path:'project',name:'Project Files QA'}],disabled:false,placementDisabled:false,renameDisabled:false,deleteDisabled:false}};
      createRoot(document.getElementById('root')).render(<SidebarPlatform value={value}><DesktopSidebarRecentSessions open connectionId="qa" activeProfile="qa" currentSessionId={null} loadingSessionIds={new Set()} resumingSessionId={null} onSelect={()=>{}} scrollRootRef={{current:document.querySelector('.history')}}/></SidebarPlatform>);
    `,
      },
      bundle: true,
      format: "esm",
      outfile: join(directory, "sidebar.js"),
    });
    const assets = "out/renderer/assets";
    const css = (
      await Promise.all(
        (await readdir(assets))
          .filter((n) => n.endsWith(".css"))
          .map((n) => readFile(join(assets, n), "utf8")),
      )
    ).join("\n");
    server = createServer(async (req, res) => {
      if (req.url === "/sidebar.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(await readFile(join(directory, "sidebar.js")));
      } else if (req.url === "/styles.css") {
        res.setHeader("Content-Type", "text/css");
        res.end(css);
      } else {
        res.setHeader("Content-Type", "text/html");
        res.end(
          '<link rel="stylesheet" href="/styles.css"><style>body{margin:0}.sidebar{height:100vh;width:256px;display:flex;flex-direction:column}.history{flex:1;min-height:0;overflow:auto}footer{height:56px;flex-shrink:0}</style><aside class="sidebar"><div class="history" id="root"></div><footer>Settings</footer></aside><script type="module" src="/sidebar.js"></script>',
        );
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    browser = await chromium.launch();
    for (const width of [552, 1280])
      for (const lang of ["ja", "en"]) {
        const page = await browser.newPage({
          viewport: { width, height: 576 },
        });
        await page.goto(
          `http://127.0.0.1:${server.address().port}/?lang=${lang}`,
        );
        await page.locator(".sidebar-recent-session-title").first().waitFor();
        const metrics = await page.evaluate(() => ({
          headers: [
            ...document.querySelectorAll(".sidebar-recent-section-toggle"),
          ].map((el) => {
            const label = el.querySelector("span").getBoundingClientRect(),
              icon = el.querySelector("svg").getBoundingClientRect();
            return {
              display: getComputedStyle(el).display,
              delta: Math.abs(
                label.y + label.height / 2 - icon.y - icon.height / 2,
              ),
            };
          }),
          rows: [
            ...document.querySelectorAll(".sidebar-recent-session-title"),
          ].map((el) => getComputedStyle(el).textOverflow),
          overflow: document.documentElement.scrollWidth > innerWidth,
          footer: document.querySelector("footer").getBoundingClientRect()
            .bottom,
        }));
        assert.ok(
          metrics.headers.length >= 3,
          "Pinned, Projects and Chats must render",
        );
        for (const header of metrics.headers) {
          assert.equal(header.display, "flex");
          assert.ok(header.delta < 2, "disclosure and label share one row");
        }
        assert.ok(
          metrics.rows.every((row) => row === "ellipsis"),
          "long titles truncate",
        );
        assert.equal(metrics.overflow, false);
        assert.ok(metrics.footer <= 576, "footer remains reachable");
        const toggle = page.locator(".sidebar-recent-section-toggle").first();
        await toggle.focus();
        await page.keyboard.press("Enter");
        assert.equal(await toggle.getAttribute("aria-expanded"), "false");
        await page.keyboard.press("Enter");
        assert.equal(await toggle.getAttribute("aria-expanded"), "true");
        await page.close();
      }
  } finally {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
