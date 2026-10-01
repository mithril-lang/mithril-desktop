import { describe, expect, it } from "vitest";
import {
  dashboardCompletionFailure,
  failIncompleteToolCalls,
} from "./completionFailure";
import type { ChatMessage } from "./types";

describe("dashboard completion failures", () => {
  it("classifies a dropped partial tool as a stream failure and retains its request id", () => {
    // @lat: [[chat-commands#Incomplete streamed tool calls#Structured terminal failure]]
    expect(
      dashboardCompletionFailure({
        status: "error",
        error: "Response remained truncated after 4 continuation attempts",
        error_surface: {
          code: "stream_closed_tool_call",
          request_id: "chat:008af2dd-9ca0-47e8-9930-1c861a88b279",
        },
        dropped_tool_names: ["write_file"],
      }),
    ).toEqual({
      droppedToolNames: ["write_file"],
      requestId: "chat:008af2dd-9ca0-47e8-9930-1c861a88b279",
      message:
        "The provider stream closed before the tool-call arguments (write_file) completed. The incomplete tool call was not executed. Request ID: chat:008af2dd-9ca0-47e8-9930-1c861a88b279.",
    });
  });

  it("marks only matching running calls failed and preserves completed tools", () => {
    // @lat: [[chat-commands#Incomplete streamed tool calls#No partial execution or duplicate completion]]
    const messages: ChatMessage[] = [
      { id: "u", role: "user", content: "create a profile" },
      {
        id: "done",
        kind: "tool_call",
        role: "agent",
        callId: "done-1",
        name: "read_file",
        args: "{}",
        status: "completed",
      },
      {
        id: "partial",
        kind: "tool_call",
        role: "agent",
        callId: "partial-1",
        name: "write_file",
        args: '{"path":"profile.',
        status: "running",
      },
    ];

    const result = failIncompleteToolCalls(messages, ["write_file"]);

    expect(result[1]).toMatchObject({ status: "completed" });
    expect(result[2]).toMatchObject({ status: "failed" });
    expect(result.filter((message) => message.kind === "tool_result")).toEqual(
      [],
    );
  });

  it("keeps ordinary failures and appends a separately supplied request id", () => {
    expect(
      dashboardCompletionFailure({
        error: "Invalid API Key",
        provider_request_id: "req-safe-1",
      }).message,
    ).toBe("Invalid API Key (Request ID: req-safe-1)");
  });
});
