import { expect, it } from "vitest";
import {
  validOriginalCronPrepareRequest,
  parseOriginalCronPrepareResult,
} from "./cron-source-prepare";
const request = {
  owner: "alice",
  profile: "default",
  operationId: "prepare",
  timeZone: "Asia/Tokyo",
  input: {
    schedule: "in 30m",
    prompt: "日本語の作業",
    name: "Original",
    deliver: "local",
  },
};
const preparation = {
  ...request,
  job: {
    id: "abcdef123456",
    name: "Original",
    prompt: "日本語の作業",
    deliver: "local",
    enabled: true,
    state: "scheduled",
    schedule: {
      kind: "once",
      run_at: "2026-10-09T09:00:00+09:00",
      display: "original",
    },
    future_metadata: { retained: true },
  },
};
it("accepts the exact original parser preparation and retains complete metadata", () => {
  expect(validOriginalCronPrepareRequest(request)).toBe(true);
  expect(
    parseOriginalCronPrepareResult(
      JSON.stringify({ success: true, preparation }),
      request,
    ),
  ).toEqual({ success: true, preparation });
});
// @lat: [[cloud-workspace#Cloud workspace#Exact original schedule preparation source (draft)]]
it("retains exact prepared source text including opaque integers and refuses a different source", () => {
  const sourceText = JSON.stringify(preparation.job).replace(
    '"future_metadata"',
    '"opaqueCounter":9223372036854775807,"future_metadata"',
  );
  const raw = { ...preparation, job: JSON.parse(sourceText), sourceText };
  expect(
    parseOriginalCronPrepareResult(
      JSON.stringify({ success: true, preparation: raw }),
      request,
    ),
  ).toEqual({ success: true, preparation: raw });
  for (const text of [
    sourceText.replace("Original", "Other"),
    "{broken /private/secret",
    "null",
    '{"id":"other"}',
  ])
    expect(
      parseOriginalCronPrepareResult(
        JSON.stringify({
          success: true,
          preparation: { ...raw, sourceText: text },
        }),
        request,
      ),
    ).toEqual({ success: false, error: "Schedule preparation unavailable" });
});
it("refuses preparations belonging to a different owner, profile, timezone, input or operation", () => {
  for (const changed of [
    { ...preparation, owner: "bob" },
    { ...preparation, profile: "other" },
    { ...preparation, timeZone: "UTC" },
    { ...preparation, operationId: "other" },
    { ...preparation, input: { ...request.input, schedule: "2h" } },
    { ...preparation, job: { ...preparation.job, prompt: "different" } },
    {
      ...preparation,
      job: { ...preparation.job, run_claim: { private: true } },
    },
  ])
    expect(
      parseOriginalCronPrepareResult(
        JSON.stringify({ success: true, preparation: changed }),
        request,
      ).success,
    ).toBe(false);
});
it("refuses extra input authority and reports only static child failures", () => {
  expect(
    validOriginalCronPrepareRequest({
      ...request,
      input: { ...request.input, script: "/private/run.py" },
    } as typeof request),
  ).toBe(false);
  expect(
    validOriginalCronPrepareRequest({ ...request, timeZone: "invalid" }),
  ).toBe(false);
  for (const stdout of [
    "Traceback /private/secret",
    '{"success":false,"error":"/private/secret"}',
    "{}",
  ])
    expect(parseOriginalCronPrepareResult(stdout, request)).toEqual({
      success: false,
      error: "Schedule preparation unavailable",
    });
  expect(
    parseOriginalCronPrepareResult(
      '{"success":false,"error":"timezone"}',
      request,
    ),
  ).toEqual({
    success: false,
    error: "Schedule timezone differs from the original profile",
  });
});
