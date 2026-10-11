/* eslint-disable @typescript-eslint/explicit-function-return-type -- Node-only fixture tests. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const { checkAsarStorage } = createRequire(import.meta.url)(
  "../build/check-asar-storage.js",
);

test("ASAR storage gate rejects output nesting and accepts compiled runtime", () => {
  const dir = mkdtempSync(join(tmpdir(), "asar-storage-"));
  const p = join(dir, "app.asar");
  const runtime = {
    out: {
      files: { main: { files: { "index.js": { size: 1, offset: "0" } } } },
    },
  };
  const put = (files) => {
    const body = Buffer.from(JSON.stringify({ files }));
    const header = Buffer.alloc(16);
    header.writeUInt32LE(body.length, 12);
    writeFileSync(p, Buffer.concat([header, body]));
  };
  try {
    put(runtime);
    assert.doesNotThrow(() => checkAsarStorage(p));
    for (const name of ["dist", "release", "artifacts"]) {
      put({ ...runtime, [name]: { files: { "Mithril.app": { files: {} } } } });
      assert.throws(() => checkAsarStorage(p), /Build output embedded/);
    }
    put({});
    assert.throws(() => checkAsarStorage(p), /entrypoint missing/);
    writeFileSync(p, Buffer.alloc(3));
    assert.throws(() => checkAsarStorage(p), /Truncated/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
