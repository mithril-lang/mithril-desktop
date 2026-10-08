import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

// @lat: [[cloud-workspace-tests#Compiled Desktop notice layout]]
test("compiled Desktop CSS keeps long synchronization notices above content", async () => {
  const assets = "out/renderer/assets";
  const files = (await readdir(assets)).filter((name) => name.endsWith(".css"));
  const styles = (
    await Promise.all(files.map((name) => readFile(join(assets, name), "utf8")))
  ).join("\n");
  assert.ok(
    styles.includes(".repository-sync-notice"),
    "build Desktop before visual QA",
  );
  await mkdir("artifacts/layout-visual", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [552, 1280])
      for (const theme of ["dark", "light"]) {
        const page = await browser.newPage({
          viewport: { width, height: 576 },
        });
        try {
          await page.setContent(`<html data-theme="${theme}"><head><style>${styles}</style></head>
          <body><div class="layout-shell" style="height:100vh">
            <aside class="repository-sync-notice" aria-label="Synchronization status"><p>
              You are signed in. Approve Chat and Workspace access with your passkey.
              サインイン済みです。チャットとワークスペースへのアクセスを確認してください。
            </p></aside>
            <div class="layout"><aside class="sidebar" style="width:256px">New Chat</aside>
              <main class="content"><h1>Security diagnostics</h1><button>Refresh ledger</button></main></div>
            <footer class="status-bar">Workspace · api.mithril.fund</footer>
          </div></body></html>`);
          const metrics = await page.evaluate(() => {
            const notice = document
              .querySelector(".repository-sync-notice")
              .getBoundingClientRect();
            const heading = document
              .querySelector("h1")
              .getBoundingClientRect();
            const footer = document
              .querySelector("footer")
              .getBoundingClientRect();
            return {
              noticeBottom: notice.bottom,
              headingTop: heading.top,
              footerBottom: footer.bottom,
              viewportHeight: innerHeight,
              overflow: document.documentElement.scrollWidth > innerWidth,
            };
          });
          assert.ok(
            metrics.noticeBottom <= metrics.headingTop,
            "sync notice must not obscure the page heading",
          );
          assert.ok(
            metrics.footerBottom <= metrics.viewportHeight + 1,
            "footer must remain reachable",
          );
          assert.equal(
            metrics.overflow,
            false,
            "notice must wrap within a narrow window",
          );
          const refresh = page.getByRole("button", { name: "Refresh ledger" });
          assert.equal(
            await refresh.evaluate((button) => {
              const bounds = button.getBoundingClientRect();
              const target = document.elementFromPoint(
                bounds.x + bounds.width / 2,
                bounds.y + bounds.height / 2,
              );
              return target === button || button.contains(target);
            }),
            true,
            "a visible action must not be covered by a notice or another layer",
          );
          await refresh.evaluate((button) => {
            button.addEventListener("click", () => {
              button.dataset.activations = String(
                Number(button.dataset.activations || 0) + 1,
              );
            });
          });
          await refresh.click({ timeout: 2000 });
          assert.equal(await refresh.getAttribute("data-activations"), "1");
          await refresh.focus();
          await page.keyboard.press("Enter");
          assert.equal(await refresh.getAttribute("data-activations"), "2");
          assert.equal(
            await refresh.evaluate(
              (button) => document.activeElement === button,
            ),
            true,
          );
        } finally {
          await page.screenshot({
            path: `artifacts/layout-visual/notice-${width}-${theme}.png`,
            fullPage: true,
          });
          await page.close();
        }
      }
  } finally {
    await browser.close();
  }
});
