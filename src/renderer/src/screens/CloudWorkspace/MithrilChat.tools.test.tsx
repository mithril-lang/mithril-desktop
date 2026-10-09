import type { NativeChildConsent } from "../../../../shared/workspace";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  ChatOperation,
  ChatOperationResponse,
  ChatSession,
} from "@mithril/workspace/sessions";
import MithrilChat from "./MithrilChat";
const host = vi.hoisted(() => ({ call: vi.fn(), dispose: vi.fn() }));
vi.mock("@mithril/workspace/client-tool-turn", async (original) => ({
  ...(await original<object>()),
  createKuroToolHost: () => host,
}));
const session: ChatSession = {
  id: "s1",
  title: "Existing owned chat",
  model: "model",
  revision: 1,
  eventSeq: 0,
  deleted: false,
  activeTurn: null,
};
let accountChanged: () => void;
let resolveAck: (value: ChatOperationResponse) => void;
let operation: ChatOperation;
let broker: (name: string, args: unknown) => Promise<unknown>;
let signal: AbortSignal;
let resolveExecution: (value: unknown) => void;
const apply = vi.fn();
const step = vi.fn();
const createConsent = vi.fn(),
  pollConsent = vi.fn(),
  reviewConsent = vi.fn(),
  cancelConsent = vi.fn(),
  executeConsent = vi.fn();
let nativeBody: Record<string, unknown>;
const consentId = "b".repeat(64);
function consent(
  state: NativeChildConsent["state"] = "allowed",
): NativeChildConsent {
  return {
    userId: "owner",
    sessionId: "s1",
    requestId: consentId,
    expiresAt: Date.now() + 40000,
    state,
  };
}

function ack(): ChatOperationResponse {
  return {
    schemaVersion: 1,
    userId: "owner",
    operationId: operation.operationId,
    status: "accepted",
    session: {
      ...session,
      revision: 2,
      activeTurn: {
        id: operation.operationId,
        status: "running",
        leaseExpiresAt: Date.now() + 60000,
        phase: "tool_wait",
      },
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  host.call.mockImplementation((_call, capturedSignal, capturedBroker) => {
    signal = capturedSignal;
    broker = capturedBroker;
    return new Promise((resolve) => {
      resolveExecution = resolve;
    });
  });
  createConsent.mockImplementation(async (_scope, body) => {
    nativeBody = body;
    return consent();
  });
  pollConsent.mockImplementation(async () => consent());
  reviewConsent.mockResolvedValue(undefined);
  cancelConsent.mockResolvedValue(undefined);
  executeConsent.mockImplementation(async () =>
    step("s1", { ...nativeBody, action: "child" }),
  );
  apply.mockImplementation((_sid, op) => {
    operation = op;
    return new Promise<ChatOperationResponse>((resolve) => {
      resolveAck = resolve;
    });
  });
  step.mockImplementation(async (_sid, body) =>
    body.action === "child"
      ? {
          phase: "child_result",
          round: body.round,
          calls: [],
          childResult: {
            id: body.childId,
            receipt: {},
            result: "owned",
            files: {},
          },
        }
      : body.action === "next" && body.round === 0
        ? {
            phase: "tools_wait",
            round: 0,
            childTools: ["read_file"],
            calls: [
              { id: "parent", function: { name: "js", arguments: "{}" } },
            ],
          }
        : { phase: "completed", round: 1, calls: [] },
  );
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      cloudChat: {
        status: vi.fn(async () => ({ userId: "owner", enabled: true })),
        enable: vi.fn(async () => ({ userId: "owner", enabled: true })),
        disable: vi.fn(),
        list: vi.fn(async () => ({
          schemaVersion: 1,
          userId: "owner",
          sessions: [session],
        })),
        events: vi.fn(async () => ({
          schemaVersion: 1,
          userId: "owner",
          session,
          events: [],
          hasMore: false,
          nextAfter: null,
        })),
        receipt: vi.fn(async (_sid, operationId) => ({
          schemaVersion: 1,
          userId: "owner",
          operationId,
          status: "unknown",
          session: null,
        })),
        models: vi.fn(async () => [{ id: "model", available: true }]),
        apply,
        browserStep: step,
        createNativeChildConsent: createConsent,
        pollNativeChildConsent: pollConsent,
        reviewNativeChildConsent: reviewConsent,
        cancelNativeChildConsent: cancelConsent,
        executeNativeChildConsent: executeConsent,
      },
      cloudWorkspace: {},
      onCloudChatAccountChanged: (callback: () => void) => {
        accountChanged = callback;
        return () => {};
      },
    },
  });
});
afterEach(cleanup);
async function submit(): Promise<void> {
  const input = await screen.findByPlaceholderText("Ask anything");
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Mithril model" })).toHaveValue(
      "model",
    ),
  );
  fireEvent.change(input, { target: { value: "Use the tool" } });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Send session message" }),
    ).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Send session message" }));
  await act(async () => {});
  await waitFor(() => expect(apply).toHaveBeenCalledOnce());
  expect(operation.type).toBe("browser_turn");
}
const retirements = [
  "hidden",
  "account",
  "profile",
  "session",
  "unmount",
] as const;
// @lat: [[cloud-workspace-tests#Mounted Browser acknowledgement retirement]]
it.each(retirements)(
  "does not start the real runner for an acknowledgement after %s",
  async (retirement) => {
    const view = render(
      <MithrilChat profile="default" initialSessionId="s1" />,
    );
    await submit();
    if (retirement === "unmount") view.unmount();
    else if (retirement === "account") act(() => accountChanged());
    else
      view.rerender(
        <MithrilChat
          profile={retirement === "profile" ? "other" : "default"}
          initialSessionId={retirement === "session" ? "s2" : "s1"}
          visible={retirement !== "hidden"}
        />,
      );
    await act(async () => {
      resolveAck(ack());
    });
    expect(step).not.toHaveBeenCalled();
    expect(host.call).not.toHaveBeenCalled();
  },
);
// @lat: [[cloud-workspace-tests#Mounted Browser execution retirement]]
it.each(retirements)(
  "aborts active real runner and retained child authority after %s",
  async (retirement) => {
    const view = render(
      <MithrilChat profile="default" initialSessionId="s1" />,
    );
    await submit();
    await act(async () => {
      resolveAck(ack());
    });
    await waitFor(() => expect(host.call).toHaveBeenCalledOnce());
    if (retirement === "unmount") view.unmount();
    else if (retirement === "account") act(() => accountChanged());
    else
      view.rerender(
        <MithrilChat
          profile={retirement === "profile" ? "other" : "default"}
          initialSessionId={retirement === "session" ? "s2" : "s1"}
          visible={retirement !== "hidden"}
        />,
      );
    expect(signal.aborted).toBe(true);
    const before = step.mock.calls.length;
    await expect(broker("read_file", { path: "owned.txt" })).rejects.toThrow();
    await act(async () => {
      resolveExecution({
        id: "parent",
        receipt: {},
        result: "late",
        files: {},
      });
    });
    expect(step).toHaveBeenCalledTimes(before);
    expect(host.dispose).toHaveBeenCalledOnce();
  },
);

// @lat: [[cloud-workspace-tests#Mounted Browser current child completion]]
it("keeps current child dispatch and parent result working exactly once", async () => {
  render(<MithrilChat profile="default" initialSessionId="s1" />);
  await submit();
  await act(async () => {
    resolveAck(ack());
  });
  await waitFor(() => expect(host.call).toHaveBeenCalledOnce());
  expect(signal.aborted).toBe(false);
  await expect(
    broker("read_file", { path: "owned.txt" }),
  ).resolves.toMatchObject({ result: "owned" });
  await act(async () => {
    resolveExecution({ id: "parent", receipt: {}, result: "done", files: {} });
  });
  await waitFor(() => expect(host.dispose).toHaveBeenCalledOnce());
  expect(step.mock.calls.map((call) => call[1].action)).toEqual([
    "next",
    "child",
    "result",
    "next",
  ]);
  const before = step.mock.calls.length;
  await expect(broker("read_file", {})).rejects.toThrow();
  expect(step).toHaveBeenCalledTimes(before);
});
// @lat: [[cloud-workspace-tests#Mounted Browser selected conversation retirement]]
it("retires active child authority when the actual shared UI opens a new conversation", async () => {
  render(<MithrilChat profile="default" initialSessionId="s1" />);
  await submit();
  await act(async () => {
    resolveAck(ack());
  });
  await waitFor(() => expect(host.call).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "New synced chat" }));
  await waitFor(() => expect(signal.aborted).toBe(true));
  const before = step.mock.calls.length;
  await expect(broker("read_file", {})).rejects.toThrow();
  await act(async () => {
    resolveExecution({ id: "parent", receipt: {}, result: "late", files: {} });
  });
  expect(step).toHaveBeenCalledTimes(before);
});

// @lat: [[mithril-code#Mithril Code#Mounted native approval release]]
it("shows a pending exact call, requires an explicit browser review, then releases the real runner child once", async () => {
  let allowed = false;
  const expiry = Date.now() + 40000;
  const pending = (): NativeChildConsent => ({
    ...consent(allowed ? "allowed" : "pending"),
    expiresAt: expiry,
  });
  createConsent.mockImplementation(async (_scope, body) => {
    nativeBody = body;
    return pending();
  });
  pollConsent.mockImplementation(async () => pending());
  reviewConsent.mockImplementation(async () => {
    allowed = true;
  });
  render(<MithrilChat profile="default" initialSessionId="s1" />);
  await submit();
  await act(async () => {
    resolveAck(ack());
  });
  await waitFor(() => expect(host.call).toHaveBeenCalledOnce());
  const child = broker("read_file", { path: "owned.txt" });
  expect(
    await screen.findByText("Waiting for approval of read_file."),
  ).toBeInTheDocument();
  expect(executeConsent).not.toHaveBeenCalled();
  expect(reviewConsent).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Review call in browser" }),
  );
  await expect(child).resolves.toMatchObject({ result: "owned" });
  expect(createConsent).toHaveBeenCalledWith(
    { userId: "owner", profile: "default", sessionId: "s1" },
    expect.objectContaining({
      parentCallId: "parent",
      name: "read_file",
      args: { path: "owned.txt" },
    }),
  );
  expect(reviewConsent).toHaveBeenCalledOnce();
  expect(executeConsent).toHaveBeenCalledOnce();
  expect(cancelConsent).not.toHaveBeenCalled();
  await act(async () => {
    resolveExecution({ id: "parent", receipt: {}, result: "done", files: {} });
  });
});
// @lat: [[mithril-code#Mithril Code#Mounted native approval withdrawal]]
it.each(["cancel", ...retirements])(
  "withdraws pending native consent without effects after %s",
  async (retirement) => {
    const expiry = Date.now() + 40000;
    createConsent.mockImplementation(async () => ({
      ...consent("pending"),
      expiresAt: expiry,
    }));
    pollConsent.mockImplementation(async () => ({
      ...consent("pending"),
      expiresAt: expiry,
    }));
    const view = render(
      <MithrilChat profile="default" initialSessionId="s1" />,
    );
    await submit();
    await act(async () => {
      resolveAck(ack());
    });
    await waitFor(() => expect(host.call).toHaveBeenCalledOnce());
    const child = broker("read_file", { path: "owned.txt" });
    const rejected = expect(child).rejects.toThrow();
    await screen.findByText("Waiting for approval of read_file.");
    if (retirement === "cancel")
      fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
    else if (retirement === "unmount") view.unmount();
    else if (retirement === "account") act(() => accountChanged());
    else
      view.rerender(
        <MithrilChat
          profile={retirement === "profile" ? "other" : "default"}
          initialSessionId={retirement === "session" ? "s2" : "s1"}
          visible={retirement !== "hidden"}
        />,
      );
    await rejected;
    await waitFor(() => expect(cancelConsent).toHaveBeenCalledOnce());
    expect(executeConsent).not.toHaveBeenCalled();
    await act(async () => {
      resolveExecution({
        id: "parent",
        receipt: {},
        result: "late",
        files: {},
      });
    });
  },
);
