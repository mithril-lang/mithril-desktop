import { afterEach, expect, it, vi } from "vitest";
const service = vi.hoisted(() => ({ run: vi.fn(), status: vi.fn() }));
vi.mock("./code-api", () => ({
  codeServiceRun: service.run,
  codeServiceStatus: service.status,
}));
vi.mock("./utils", () => ({
  profileHome: (profile: string) => {
    if (!["a", "b", "missing"].includes(profile)) throw Error("bad profile");
    return profile;
  },
}));
vi.mock("./code-credential", () => ({
  codeCredential: async (profile: string) =>
    profile === "missing" ? null : "mf_" + profile.repeat(43),
}));
import { codeHarness } from "./code-harness";
import { parseCodeHarnessResponse } from "../shared/code-harness";
afterEach(() => vi.resetAllMocks());

// @lat: [[mithril-code#Mithril Code#Native execution]]
it("authorizes the fixed verifier using only the selected profile without a local CLI", async () => {
  service.status.mockResolvedValue({ ok: true, value: { ready: true } });
  service.run.mockResolvedValue({ ok: false, error: "outcome_unknown" });
  for (const profile of ["a", "b", "a"]) {
    expect(await codeHarness("status", "", profile)).toMatchObject({
      ok: true,
      template: "mithril-app",
    });
    expect(await codeHarness("run", "report", profile)).toEqual({
      ok: false,
      error: "outcome_unknown",
    });
  }
  expect(service.run.mock.calls.map((call) => call[1])).toEqual([
    { provider: "mf_" + "a".repeat(43) },
    { provider: "mf_" + "b".repeat(43) },
    { provider: "mf_" + "a".repeat(43) },
  ]);
  expect(service.run).toHaveBeenCalledTimes(3);
  expect(await codeHarness("run", "", "a")).toEqual({
    ok: false,
    error: "invalid_goal",
  });
  expect(await codeHarness("run", "report", "../foreign")).toEqual({
    ok: false,
    error: "invalid_profile",
  });
  expect(await codeHarness("run", "report", "missing")).toEqual({
    ok: false,
    error: "mithril_connection_required",
  });
  expect(service.run).toHaveBeenCalledTimes(3);
});
it("admits verified language artifacts and rejects unverified output", async () => {
  const source = "(mithril/app-agent)";
  const result = {
    format: "mithril.language-project/v1",
    verified: true,
    files: {
      ".nojekyll": "",
      "README.md": "QA",
      "application.mith": source,
      "artifact.json": "{}",
      "index.html": "<h1>QA</h1>",
    },
    logic: { format: "https://mithril.fund/artifact/app-agent-v1" },
    metrics: { "verification-passed": true },
    receipt: {
      format: "mithril.language-inference-receipt/v1",
      status: "admitted",
      compiler: "https://app.mithril.fund/api/compile",
      source,
    },
  };
  service.run.mockResolvedValue({ ok: true, value: result });
  expect(await codeHarness("run", "report", "a")).toEqual({ ok: true, result });
  service.run.mockResolvedValue({
    ok: true,
    value: { ...result, verified: false },
  });
  expect((await codeHarness("run", "report", "a")).ok).toBe(false);
  expect(
    parseCodeHarnessResponse(
      JSON.stringify({ ok: false, error: "Bearer sensitive-key" }),
    ),
  ).toEqual({ ok: false, error: "invalid_runner_response" });
});
it("keeps overlapping attempts in the same profile from making a second POST", async () => {
  let finish!: (value: unknown) => void;
  service.run.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = codeHarness("run", "report", "a");
  expect(await codeHarness("run", "report", "a")).toEqual({
    ok: false,
    error: "runner_busy",
  });
  finish({ ok: false, error: "outcome_unknown" });
  await first;
  expect(service.run).toHaveBeenCalledOnce();
});
