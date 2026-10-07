import { beforeEach, describe, expect, it, vi } from "vitest";
import { mithrilChat, parseChatReply } from "./mithril-chat";
import { readCloudAccountToken } from "./mithril-token-store";

vi.mock("./mithril-token-store", () => ({ readCloudAccountToken: vi.fn() }));
const token = `mf_${"a".repeat(43)}`;
const reply = (status: number, body: unknown): Response =>
  ({ status, json: async () => body }) as Response;
beforeEach(() => vi.clearAllMocks());

describe("Mithril in-app chat", () => {
  // @lat: [[mithril-migration#Mithril desktop migration#First-run connect#In-app chat]]
  it("posts to api.mithril.fund with the stored mf_ bearer and max_tokens >= 4096", async () => {
    vi.mocked(readCloudAccountToken).mockReturnValue(token);
    const fetcher = vi.fn().mockResolvedValue(
      reply(200, {
        model: "qwen/qwen3.8-27b",
        upstream: { ignored: true },
        choices: [{ message: { content: " hello ", reasoning: "hm" } }],
      }),
    );
    const result = await mithrilChat(
      [{ role: "user", content: "hi" }],
      "p",
      fetcher as typeof fetch,
    );
    expect(result).toMatchObject({ ok: true, text: "hello" });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.mithril.fund/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${token}`,
    );
    expect(JSON.parse(init.body as string).max_tokens).toBeGreaterThanOrEqual(
      4096,
    );
  });

  it("retries once with a larger budget when reasoning_budget_exhausted leaves content empty", async () => {
    vi.mocked(readCloudAccountToken).mockReturnValue(token);
    const empty = {
      status: 200,
      headers: new Headers({
        "x-mithril-notice": "reasoning_budget_exhausted",
      }),
      json: async () => ({
        model: "qwen/qwen3.8-27b",
        choices: [{ message: { content: "" }, finish_reason: "length" }],
      }),
    } as Response;
    const recovered = reply(200, {
      model: "qwen/qwen3.8-27b",
      choices: [{ message: { content: "ok after retry" } }],
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(recovered);
    expect(
      await mithrilChat(
        [{ role: "user", content: "hi" }],
        "p",
        fetcher as typeof fetch,
      ),
    ).toMatchObject({ ok: true, text: "ok after retry" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse((fetcher.mock.calls[0]![1] as RequestInit).body as string)
        .max_tokens,
    ).toBe(262144);
    expect(
      JSON.parse((fetcher.mock.calls[1]![1] as RequestInit).body as string)
        .max_tokens,
    ).toBe(262144);
  });

  it("surfaces reasoning_budget_exhausted instead of a silent empty reply after a failed recovery", async () => {
    vi.mocked(readCloudAccountToken).mockReturnValue(token);
    const empty = {
      status: 200,
      headers: new Headers({
        "x-mithril-notice": "reasoning_budget_exhausted",
      }),
      json: async () => ({
        choices: [{ message: { content: "" }, finish_reason: "length" }],
      }),
    } as Response;
    const fetcher = vi.fn().mockResolvedValue(empty);
    expect(
      await mithrilChat(
        [{ role: "user", content: "hi" }],
        "p",
        fetcher as typeof fetch,
      ),
    ).toEqual({ ok: false, error: "reasoning_budget_exhausted" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("refuses to call the API without a stored token", async () => {
    vi.mocked(readCloudAccountToken).mockReturnValue(null);
    const fetcher = vi.fn();
    expect(
      await mithrilChat([{ role: "user", content: "hi" }], "p", fetcher),
    ).toEqual({ ok: false, error: "not_connected" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("tolerates reasoning-only replies and reports empty ones", () => {
    expect(
      parseChatReply({
        choices: [{ message: { content: "", reasoning: "r" } }],
      }),
    ).toMatchObject({ ok: true, text: "r" });
    expect(parseChatReply({ choices: [{ message: { content: "" } }] })).toEqual(
      {
        ok: false,
        error: "empty_reply",
      },
    );
    expect(parseChatReply(null)).toEqual({ ok: false, error: "empty_reply" });
  });

  it("surfaces the API error code without leaking exception text", async () => {
    vi.mocked(readCloudAccountToken).mockReturnValue(token);
    const f401 = vi
      .fn()
      .mockResolvedValue(reply(401, { error: { code: "unauthenticated" } }));
    expect(
      await mithrilChat([{ role: "user", content: "x" }], "p", f401),
    ).toEqual({ ok: false, error: "unauthenticated" });
    const boom = vi.fn().mockRejectedValue(new Error(`Bearer ${token}`));
    expect(
      await mithrilChat([{ role: "user", content: "x" }], "p", boom),
    ).toEqual({ ok: false, error: "mithril_api_unavailable" });
  });
});
