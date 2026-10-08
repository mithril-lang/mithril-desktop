import { expect, it } from "vitest";
import { parseOriginalCronRestoreResult } from "./cron-source-restore";
const request = {
  owner: "alice",
  profile: "default",
  operationId: "restore",
  expectedVersion: null,
  file: { jobs: [] },
};
const receipt = {
  owner: request.owner,
  profile: request.profile,
  operationId: request.operationId,
  version: "a".repeat(64),
};
it("accepts only the original scoped restoration acknowledgement", () => {
  expect(
    parseOriginalCronRestoreResult(
      JSON.stringify({ success: true, receipt }),
      request,
    ),
  ).toEqual({ success: true, receipt });
  for (const changed of [
    { ...receipt, owner: "bob" },
    { ...receipt, profile: "other" },
    { ...receipt, operationId: "another" },
    { ...receipt, version: "not-a-version" },
    { ...receipt, file: "private" },
  ])
    expect(
      parseOriginalCronRestoreResult(
        JSON.stringify({ success: true, receipt: changed }),
        request,
      ).success,
    ).toBe(false);
});
it("reports deferred execution separately and never exposes raw source errors", () => {
  expect(
    parseOriginalCronRestoreResult('{"success":false,"error":"busy"}', request),
  ).toEqual({
    success: false,
    error: "Schedule execution is active; synchronization is deferred",
  });
  for (const value of [
    "Traceback /private/secret",
    '{"success":false,"error":"/private/secret"}',
    "{}",
  ])
    expect(parseOriginalCronRestoreResult(value, request)).toEqual({
      success: false,
      error: "Schedule restoration unavailable",
    });
});
it("checks the exact restored source digest and rejects a receipt for different bytes", async () => {
  const { createHash } = await import("crypto");
  const sourceText =
    '\uFEFF{"jobs":[],"opaqueCounter":9223372036854775807}\r\n';
  const raw = {
    owner: "alice",
    profile: "default",
    operationId: "raw",
    expectedVersion: null,
    sourceText,
  };
  const expected = {
    owner: raw.owner,
    profile: raw.profile,
    operationId: raw.operationId,
    version: createHash("sha256").update(sourceText).digest("hex"),
  };
  expect(
    parseOriginalCronRestoreResult(
      JSON.stringify({ success: true, receipt: expected }),
      raw,
    ),
  ).toEqual({ success: true, receipt: expected });
  expect(
    parseOriginalCronRestoreResult(
      JSON.stringify({
        success: true,
        receipt: { ...expected, version: "a".repeat(64) },
      }),
      raw,
    ).success,
  ).toBe(false);
});
it("admits exactly one bounded source representation without silently granting raw-source IPC", async () => {
  const { validOriginalCronRestoreRequest } =
    await import("./cron-source-restore");
  const raw = {
    owner: "alice",
    profile: "default",
    operationId: "raw",
    expectedVersion: null,
    sourceText: '\uFEFF{"jobs":[]}\r\n',
  };
  expect(validOriginalCronRestoreRequest(raw)).toBe(true);
  expect(validOriginalCronRestoreRequest(request)).toBe(true);
  for (const bad of [
    { ...raw, file: { jobs: [] } },
    { ...raw, sourceText: "\ud800" },
    { ...raw, sourceText: "{}".repeat(11 * 1024 * 1024) },
    { ...raw, sourceText: "{broken" },
    { ...raw, owner: "other/path" },
    { ...raw, extra: true },
  ])
    expect(validOriginalCronRestoreRequest(bad)).toBe(false);
});
