import assert from "node:assert/strict";
import { test } from "node:test";
import { checkWorkspaceApi } from "./check-workspace-api.mjs";
test("refuses old API and verifies the fixed no-token health route before installer publication", async () => {
  for (const health of [
    { ok: true },
    { ok: true, sessionInventoryProtocol: "older" },
  ])
    await assert.rejects(
      checkWorkspaceApi(async () => Response.json(health)),
      /must be published/,
    );
  await assert.rejects(
    checkWorkspaceApi(async () =>
      Response.json(
        { ok: true, sessionInventoryProtocol: "chat-inventory-keyset-v1" },
        { status: 503 },
      ),
    ),
    /must be published/,
  );
  await checkWorkspaceApi(async (url, init) => {
    assert.equal(url, "https://api.mithril.fund/health");
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers, undefined);
    return Response.json({
      ok: true,
      sessionInventoryProtocol: "chat-inventory-keyset-v1",
    });
  });
});
