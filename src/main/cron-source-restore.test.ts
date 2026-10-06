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
