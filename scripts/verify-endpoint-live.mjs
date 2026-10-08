import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

// Exercises the built app's real preload/main IPC in an isolated test profile.
// Only native file dialog selections are supplied by the harness.
const root = await realpath(
  await mkdtemp(join(tmpdir(), "mithril-endpoint-live-")),
);
const selected = join(root, "selected");
const userdata = join(root, "userdata");
const hermes = join(root, "hermes");
await Promise.all([selected, userdata, hermes].map((p) => mkdir(p)));
const sample = join(selected, "fixture.php");
await writeFile(sample, "This is inert test text: eval($_POST['fixture'])");
const entry = resolve("out/main/index.js");
const bootstrap = join(root, "bootstrap.cjs");
await writeFile(
  bootstrap,
  `const {app}=require('electron');app.setPath('userData',${JSON.stringify(userdata)});require(${JSON.stringify(entry)});`,
);
const env = { ...process.env, HERMES_HOME: hermes };
for (const name of Object.keys(env)) {
  if (/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)) delete env[name];
}
const application = await electron.launch({
  args: [bootstrap],
  env,
  timeout: 60000,
});
try {
  const page = await application.firstWindow();
  await page
    .getByRole("button", { name: /Protect this device|この端末を保護/ })
    .click({ timeout: 30000 });
  await application.evaluate(
    ({ dialog }, { selected, sample }) => {
      dialog.showOpenDialog = async (...args) => {
        const options = args.at(-1);
        return {
          canceled: false,
          filePaths: [
            options.properties.includes("openDirectory") ? selected : sample,
          ],
        };
      };
    },
    { selected, sample },
  );
  await page
    .getByRole("button", { name: /Choose monitored folder|監視フォルダを選ぶ/ })
    .click();
  await page.getByText(selected, { exact: true }).waitFor();
  await page
    .getByRole("button", { name: /Start monitoring|監視を開始/ })
    .click();
  await page
    .getByRole("button", { name: /Stop monitoring|監視を停止/ })
    .waitFor();
  await page.getByText("php-post-eval", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: /Update definitions|定義を更新/ })
    .click();
  await page.waitForFunction(
    async () => {
      const status = await window.hermesAPI.endpoint.status();
      return status.definitions.source === "signed-update" && status.lastPoll;
    },
    undefined,
    { timeout: 30000 },
  );
  const status = await page.evaluate(() => window.hermesAPI.endpoint.status());
  assert.equal(status.running, true);
  assert.equal(status.definitions.source, "signed-update");
  assert.ok(status.alerts.some((a) => a.rule === "php-post-eval"));
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("button")).every(
      (button) => !button.disabled,
    ),
  );
  const artifact = resolve(process.argv[2] || "/tmp/mithril-endpoint-live.png");
  await page.screenshot({ path: artifact });
  await page
    .getByRole("button", { name: /Stop monitoring|監視を停止/ })
    .click();
  await page
    .getByRole("button", { name: /Start monitoring|監視を開始/ })
    .waitFor();
  assert.equal(
    (await page.evaluate(() => window.hermesAPI.endpoint.status())).running,
    false,
  );
  console.log(
    JSON.stringify({
      verified: true,
      definitions: status.definitions,
      scannedFiles: status.scannedFiles,
      connectionsVisible: status.connections.length,
      alertRules: status.alerts.map((a) => a.rule),
      screenshot: artifact,
    }),
  );
} finally {
  await application.close();
  await rm(root, { recursive: true, force: true });
}
