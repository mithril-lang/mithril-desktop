import { expect, it } from "vitest";
import {
  validOriginalCronTransitionRequest,
  parseOriginalCronTransitionResult,
} from "./cron-source-transition";
const source = {
  id: "original-job",
  name: "Original",
  prompt: "作業",
  enabled: false,
  state: "paused",
  schedule: { kind: "interval", minutes: 120, display: "2h" },
  repeat: { times: null, completed: 7 },
  next_run_at: "2000-01-01T00:00:00Z",
  skills: [" one ", "one"],
  future: { keep: true },
};
const request = {
  owner: "alice",
  profile: "default",
  operationId: "resume",
  timeZone: "UTC",
  action: "resume" as const,
  source,
};
const preparation = {
  ...request,
  job: {
    ...source,
    state: "scheduled",
    enabled: true,
    skills: ["one"],
    skill: "one",
  },
};
it("accepts only request-bound original lifecycle changes while retaining overdue occurrence and metadata", () => {
  expect(validOriginalCronTransitionRequest(request)).toBe(true);
  expect(
    parseOriginalCronTransitionResult(
      JSON.stringify({ success: true, preparation }),
      request,
    ),
  ).toEqual({ success: true, preparation });
});
it("refuses stale identity, authored changes, counter loss and claim authority", () => {
  for (const changed of [
    { ...preparation, owner: "bob" },
    { ...preparation, operationId: "other" },
    { ...preparation, source: { ...source, prompt: "different" } },
    {
      ...preparation,
      job: { ...preparation.job, repeat: { times: null, completed: 0 } },
    },
    { ...preparation, job: { ...preparation.job, future: null } },
    { ...preparation, job: { ...preparation.job, skill: "other" } },
  ])
    expect(
      parseOriginalCronTransitionResult(
        JSON.stringify({ success: true, preparation: changed }),
        request,
      ).success,
    ).toBe(false);
  expect(
    validOriginalCronTransitionRequest({
      ...request,
      source: { ...source, run_claim: { token: "busy" } },
    }),
  ).toBe(false);
  expect(
    parseOriginalCronTransitionResult("Traceback /private/secret", request),
  ).toEqual({ success: false, error: "Schedule transition unavailable" });
});
