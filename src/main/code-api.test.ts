import { afterEach, expect, it, vi } from "vitest";
import { codeApi } from "./code-api";
afterEach(() => vi.unstubAllGlobals());
it("permits only fixed GitHub routes, forwards transient credentials and returns an uncertain write without retry", async () => {
  // @lat: [[mithril-code#Mithril Code#GitHub publication]]
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) =>
    Response.json({ sha: "a".repeat(40) }),
  );
  vi.stubGlobal("fetch", fetcher);
  expect(
    await codeApi(
      "https://other.example/api/github/commit",
      {},
      { github: "token" },
    ),
  ).toEqual({ ok: false, error: "invalid_action" });
  expect(await codeApi("/api/runs", {}, { github: "token" })).toEqual({
    ok: false,
    error: "invalid_action",
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    await codeApi(
      "/api/github/commit",
      { expected_sha: "b".repeat(40) },
      { github: "transient-token" },
    ),
  ).toEqual({ ok: true, value: { sha: "a".repeat(40) } });
  expect(fetcher.mock.calls[0]).toMatchObject([
    "https://code.mithril.fund/api/github/commit",
    {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: "Bearer transient-token",
        origin: "https://code.mithril.fund",
      },
    },
  ]);
  fetcher.mockRejectedValueOnce(Error("network"));
  expect(await codeApi("/api/github/commit", {}, { github: "token" })).toEqual({
    ok: false,
    error: "outcome_unknown",
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
