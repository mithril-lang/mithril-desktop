import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const hook = fileURLToPath(
  new URL("./trusted-runner-job-start.sh", import.meta.url),
);
const context = {
  GITHUB_REPOSITORY: "mithril-lang/mithril-desktop",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  GITHUB_WORKFLOW_REF:
    "mithril-lang/mithril-desktop/.github/workflows/self-hosted-mac-smoke.yml@refs/heads/main",
};
for (const [name, override, allowed] of [
  ["main readiness", {}, true],
  [
    "main preview",
    {
      GITHUB_WORKFLOW_REF:
        "mithril-lang/mithril-desktop/.github/workflows/preview-platforms.yml@refs/heads/main",
    },
    true,
  ],
  ["pull request", { GITHUB_EVENT_NAME: "pull_request" }, false],
  ["branch", { GITHUB_REF: "refs/heads/other" }, false],
  ["other repository", { GITHUB_REPOSITORY: "other/repository" }, false],
  ["other workflow", { GITHUB_WORKFLOW_REF: "other/workflow" }, false],
  [
    "missing context",
    Object.fromEntries(Object.keys(context).map((key) => [key, ""])),
    false,
  ],
]) {
  test(`runner admission: ${name}`, () => {
    const result = spawnSync("/bin/bash", [hook], {
      env: { ...context, ...override },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status === 0, allowed);
  });
}
