import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SOURCE_IMAGE,
  assertCandidate,
  sourceRecipe,
  verifySourcePayload,
} from "./source-core.mjs";
const repository = "mithril-lang/mithril-desktop",
  sha = "a".repeat(40);
test("candidate admission does not weaken exact current-main publication", () => {
  const input = {
    repository,
    sha,
    dirty: "",
    nodeVersion: "v24.19.0",
    mode: "candidate",
    remoteMain: "b".repeat(40),
  };
  assert.doesNotThrow(() => assertCandidate(input));
  for (const change of [
    { dirty: " M source" },
    { nodeVersion: "v26.0.0" },
    { repository: "other/repo" },
    { mode: "current-main" },
  ])
    assert.throws(() => assertCandidate({ ...input, ...change }));
  assert.doesNotThrow(() =>
    assertCandidate({ ...input, mode: "current-main", remoteMain: sha }),
  );
});
test("receipts bind exact source recipe runtime owner freshness and release exclusion", () => {
  const now = 100000,
    expected = {
      repository,
      sha,
      recipe: sourceRecipe(repository),
      nodeSha256: "node",
      owner: "owner",
      mode: "candidate",
      now,
    };
  const payload = {
    schemaVersion: 1,
    image: SOURCE_IMAGE,
    ...expected,
    profile: "desktop-source-v1",
    status: "qualified",
    releaseEligible: false,
    finishedAt: new Date(now).toISOString(),
    artifacts: [],
    sourceArchiveSha256: "c".repeat(64),
  };
  assert.equal(verifySourcePayload(payload, expected), payload);
  for (const change of [
    { sha: "b".repeat(40) },
    { recipe: "other" },
    { mode: "current-main" },
    { owner: "other" },
    { nodeSha256: "other" },
    { releaseEligible: true },
    { finishedAt: new Date(now + 1).toISOString() },
    { status: "failure" },
  ])
    assert.throws(() =>
      verifySourcePayload({ ...payload, ...change }, expected),
    );
  assert.throws(() =>
    verifySourcePayload(payload, { ...expected, now: now + 86400001 }),
  );
});

test("compiled artifact admission rejects traversal, duplicate paths and changed bytes", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createHash } = await import("node:crypto");
  const { importSourceArtifacts } = await import("./source-core.mjs");
  const bytes = Buffer.from("synthetic"),
    file = {
      path: "out/main.js",
      bytes: bytes.length,
      data: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  const root = mkdtempSync(join(tmpdir(), "mithril-source-artifact-test-"));
  try {
    assert.equal(
      importSourceArtifacts([file], join(root, "valid"))[0].sha256,
      file.sha256,
    );
    for (const path of [
      "../escape",
      "/absolute",
      "out/../escape",
      "out\\escape",
    ])
      assert.throws(() =>
        importSourceArtifacts([{ ...file, path }], join(root, "bad")),
      );
    assert.throws(() =>
      importSourceArtifacts(
        [{ ...file, sha256: "0".repeat(64) }],
        join(root, "bad"),
      ),
    );
    assert.throws(() =>
      importSourceArtifacts([file, file], join(root, "duplicate")),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
