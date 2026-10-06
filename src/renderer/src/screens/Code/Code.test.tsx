// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Code from "./Code";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("requires an explicit run and shows verified source and measurements", async () => {
  // @lat: [[mithril-code#Mithril Code#Review and measurements]]
  vi.stubGlobal("crypto", {
    randomUUID: () => "00000000-0000-4000-8000-000000000000",
    subtle: { digest: async () => new ArrayBuffer(32) },
  });
  const call = vi.fn(async () => ({
    ok: true,
    result: {
      format: "mithril.code-project/v1",
      verified: true,
      files: {
        "src/todo/interaction.cljk": "(defn toggle [old] (not old))",
        "src/todo/summary.cljk":
          "(defn remaining [xs] (count (filter false? xs)))",
      },
      logic: {},
      metrics: {
        "verification-passed": true,
        "receipt-id": "synthetic-ui-test",
        timing: { "cli-wall-seconds": 1 },
        "decision-count": 8,
        attempts: 1,
        "input-tokens": { total: 1 },
        "output-tokens": { total: 1 },
        cost: { "api-amount": 0 },
        "receipt-sha256": "fixture",
      },
    },
  }));
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: { codeHarness: call },
  });
  render(<Code profile="owner" locale="en" />);
  expect(call).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Assemble and verify" }));
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Source editor") as HTMLTextAreaElement).value,
    ).toBe("(defn toggle [old] (not old))"),
  );
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith(
    "run",
    "Toggle completion and count unfinished tasks",
    "owner",
  );
});
it("keeps an unknown outcome visible without automatically running again", async () => {
  vi.stubGlobal("crypto", {
    randomUUID: () => "00000000-0000-4000-8000-000000000000",
    subtle: { digest: async () => new ArrayBuffer(32) },
  });
  const call = vi.fn(async () => ({ ok: false, error: "run_outcome_unknown" }));
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: { codeHarness: call },
  });
  render(<Code profile="owner" locale="en" />);
  fireEvent.click(screen.getByRole("button", { name: "Assemble and verify" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Outcome unknown"),
  );
  expect(call).toHaveBeenCalledTimes(1);
});
