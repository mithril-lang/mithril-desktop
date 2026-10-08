import { afterEach, expect, it, vi } from "vitest";
import {
  ToolAttemptReader,
  parseToolAttemptPage,
  type AttemptAuthority,
} from "./toolAttemptReader";
const row = {
  attempt_id: "attempt-1",
  parent_call_id: "parent",
  tool_name: "write_file",
  state: "running",
  terminal: false,
};
const page = {
  protocol: "hermes-tool-attempts-v1",
  coverage: "exact-session-metadata-only",
  available: true,
  attempts: [row],
  next_cursor: null,
};
afterEach(() => vi.useRealTimers());

// @lat: [[tool-attempts#Test specifications#Metadata boundaries]]
it("rejects malformed/unbounded metadata and retains only display fields", () => {
  expect(
    parseToolAttemptPage({ ...page, attempts: [{ ...row, result: "private" }] })
      .attempts,
  ).toEqual([
    {
      attempt_id: "attempt-1",
      tool_name: "write_file",
      state: "running",
      terminal: false,
    },
  ]);
  for (const bad of [
    { ...page, attempts: [row, row] },
    { ...page, attempts: Array(101).fill(row) },
    { ...page, attempts: [{ ...row, terminal: true }] },
    { ...page, available: false },
    { ...page, protocol: "old" },
    { ...page, next_cursor: "../foreign" },
    { ...page, result: "x".repeat(2_000_001) },
  ])
    expect(() => parseToolAttemptPage(bad)).toThrow();
});

// @lat: [[tool-attempts#Test specifications#Retired and bounded reads]]
it("uses only existing authority, rejects retired replies and bounds reads without replay", async () => {
  vi.useFakeTimers();
  const request = vi.fn().mockResolvedValue(page);
  let owner: AttemptAuthority | null = null;
  const reader = new ToolAttemptReader(() => owner);
  await reader.read();
  expect(request).not.toHaveBeenCalled();
  owner = {
    client: { connected: true, request },
    sessionId: "owned",
    generation: 1,
  };
  await reader.read();
  expect(reader.snapshot().status).toBe("ready");
  expect(request).toHaveBeenLastCalledWith("tools.attempts", {
    session_id: "owned",
    limit: 50,
  });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(reader.snapshot().status).toBe("unknown");
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const old = reader.read();
  owner = { ...owner, sessionId: "replacement", generation: 2 };
  finish(page);
  await old;
  expect(reader.snapshot().page).toBeNull();
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const timed = reader.read();
  await vi.advanceTimersByTimeAsync(3_000);
  expect(reader.snapshot().status).toBe("unknown");
  finish(page);
  await timed;
  expect(reader.snapshot().page).toBeNull();
  expect(request).toHaveBeenCalledTimes(3);
  reader.invalidate();
});
