import { afterEach, expect, it, vi } from "vitest";
import { codeApi, codeServiceRun } from "./code-api";
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
  // Explicit service choice is a separate, bounded operation; publication remains GitHub-only.
  expect(await codeServiceRun("", { github: "token" })).toEqual({
    ok: false,
    error: "invalid_goal",
  });
  expect(
    await codeServiceRun("todo", {
      github: "run-token",
      provider: "provider-key",
    }),
  ).toEqual({ ok: true, value: { sha: "a".repeat(40) } });
  expect(fetcher.mock.calls[1]).toMatchObject([
    "https://code.mithril.fund/api/runs",
    {
      method: "POST",
      headers: {
        "x-mithril-token": "provider-key",
      },
      body: expect.any(String),
    },
  ]);
  expect(fetcher.mock.calls[1][1].headers).not.toHaveProperty("authorization");
  expect(
    JSON.parse(fetcher.mock.calls[1][1].body as string).request_id,
  ).toMatch(/^[0-9a-f-]{36}$/);
  fetcher.mockRejectedValueOnce(Error("network"));
  expect(await codeApi("/api/github/commit", {}, { github: "token" })).toEqual({
    ok: false,
    error: "outcome_unknown",
  });
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("recompilation forwards only source and excludes supplied account and GitHub credentials", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({ format: "mithril.language-compilation/v1" }),
  );
  vi.stubGlobal("fetch", fetcher);
  expect(
    await codeApi(
      "/api/compile",
      { source: "(mithril/app-agent)" },
      { github: "private-github", provider: "private-mithril" },
    ),
  ).toMatchObject({ ok: true });
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://code.mithril.fund/api/compile");
  expect(init.headers).not.toHaveProperty("authorization");
  expect(init.headers).not.toHaveProperty("x-mithril-token");
  expect(JSON.parse(String(init.body))).toEqual({
    source: "(mithril/app-agent)",
  });
  expect(
    await codeApi("/api/compile", { source: "x", token: "private" }, {}),
  ).toMatchObject({ ok: false });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
