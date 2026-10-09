import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { ChatSession } from "@mithril/workspace/sessions";
import MithrilChat from "./MithrilChat";
const enable = vi.fn(async () => ({ userId: "owner", enabled: true }));
const list = vi.fn(async () => ({
  schemaVersion: 1,
  userId: "owner",
  sessions: [] as ChatSession[],
}));
const models = vi.fn(async () => [{ id: "mithril-model", available: true }]);
const apply = vi.fn();
const preview = vi.fn();
let changed: () => void;
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      cloudChat: {
        gatewaySelection: vi.fn(async (request) => ({
          userId: request.userId,
          sessionId: request.sessionId,
          binding: null,
        })),
        reviewGateway: vi.fn(async () => {}),
        nativeHistoryInventory: vi.fn(async () => ({
          userId: "owner",
          profile: "default",
          rows: [
            {
              id: "native_pending",
              sourceId: "original-pending",
              title: "Original source conversation",
            },
          ],
        })),
        enable,
        status: vi.fn(async () => ({ userId: "owner", enabled: false })),
        legacySnapshot: vi.fn(async () => ({
          policyVersion: 1,
          userId: "owner",
          capturedAt: 1,
          inferenceOrigin: "https://api.mithril.fund",
          legacyAutomaticUse: false,
          configuration: {
            retained: true,
            present: true,
            bytes: 128,
            modifiedAt: 1,
          },
        })),
        list,
        models,
        apply,
        events: vi.fn(),
        receipt: vi.fn(),
        disable: vi.fn(),
      },
      cloudWorkspace: {
        enable: vi.fn(async () => ({ userId: "owner", enabled: true })),
        getSnapshot: vi.fn(async () => ({
          schemaVersion: 1,
          userId: "owner",
          cursor: 0,
          records: [
            {
              id: "project-1",
              kind: "project",
              revision: 1,
              data: { title: "API project" },
              deleted: false,
              updatedAt: 1,
            },
          ],
        })),
        applyOperations: vi.fn(),
        history: vi.fn(),
      },
      nativeSessionImport: {
        previewNativeSessions: preview,
        importNativeSessions: vi.fn(),
      },
      onCloudChatAccountChanged: (callback: () => void) => {
        changed = callback;
        return () => undefined;
      },
    },
  });
});
afterEach(cleanup);
describe("Default shared Mithril Chat", () => {
  // @lat: [[cloud-workspace#Cloud workspace#Shared sidebar history#Read-only cloud sidebar]]
  it("renders shared API sidebar projects without importing local history or issuing chat operations", async () => {
    render(
      <>
        <div id="cloud-session-sidebar" />
        <MithrilChat profile="default" />
      </>,
    );
    await screen.findByText("API project");
    expect(window.hermesAPI.cloudWorkspace.enable).toHaveBeenCalled();
    expect(
      window.hermesAPI.cloudWorkspace.applyOperations,
    ).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
  });
  it("automatically reads a checked cloud account without using local history or issuing operations", async () => {
    render(<MithrilChat profile="default" />);
    await screen.findByRole("combobox", { name: /Mithril model/ });
    expect(enable).toHaveBeenCalledTimes(1);
    expect(window.hermesAPI.cloudChat.legacySnapshot).not.toHaveBeenCalled();
    expect(models).toHaveBeenCalledTimes(1);
    expect(preview).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(
      screen.getByRole("combobox", { name: /Mithril model/ }),
    ).toHaveTextContent("mithril-model");
  });
  it("does not replay operations after an account change", async () => {
    render(<MithrilChat profile="default" />);
    await screen.findByRole("combobox", { name: /Mithril model/ });
    changed();
    await waitFor(() => expect(enable).toHaveBeenCalledTimes(2));
    expect(apply).not.toHaveBeenCalled();
  });
});

// @lat: [[cloud-workspace-tests#New Chat before sign-in]]
it("shows failed identity checks and offers account setup without submitting a turn", async () => {
  vi.mocked(window.hermesAPI.cloudChat.status).mockRejectedValueOnce(
    new Error(
      "Cloud connection requires explicit chat:read authorization. Existing tokens are never upgraded automatically.",
    ),
  );
  const connect = vi.fn();
  render(<MithrilChat profile="default" onConnectAccount={connect} />);
  await screen.findByText(
    "You are signed in. Approve Chat and Workspace access with your passkey.",
  );
  expect(
    screen.queryByText("Existing tokens are never upgraded automatically."),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Approve access" }));
  expect(connect).toHaveBeenCalledOnce();
  expect(enable).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
});

// @lat: [[cloud-workspace-tests#Cloud sidebar original view and durable metadata]]
it("renders the original shared history row and context menu through canonical cloud data without native cache reads", async () => {
  list.mockResolvedValue({
    schemaVersion: 1,
    userId: "owner",
    sessions: [
      {
        id: "cloud-chat",
        title: "Cloud original row",
        model: "mithril-model",
        revision: 1,
        eventSeq: 0,
        deleted: false,
        activeTurn: null,
      },
    ],
  });
  try {
    render(
      <>
        <div id="cloud-session-sidebar" />
        <MithrilChat profile="default" />
      </>,
    );
    const row = await within(
      document.getElementById("cloud-session-sidebar")!,
    ).findByText("Cloud original row");
    expect(row.closest(".sidebar-recent-session")).not.toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Options" }));
    await screen.findByRole("menuitem", {
      name: "Copy session ID",
    });
    expect(apply).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
  } finally {
    list.mockResolvedValue({ schemaVersion: 1, userId: "owner", sessions: [] });
  }
});

// @lat: [[cloud-workspace-tests#Owner-bound source sidebar selection]]
it("opens an unarchived source from the same shared sidebar without starting cloud inference", async () => {
  const select = vi.fn();
  render(
    <>
      <div id="cloud-session-sidebar" />
      <MithrilChat profile="default" onSourceHistorySelect={select} />
    </>,
  );
  fireEvent.click(await screen.findByText("Original source conversation"));
  expect(select).toHaveBeenCalledWith("original-pending");
  expect(apply).not.toHaveBeenCalled();
  expect(preview).not.toHaveBeenCalled();
});

it("keeps source history readable when the model provider is unavailable", async () => {
  models.mockRejectedValueOnce(Error("Provider overloaded"));
  const select = vi.fn();
  render(
    <>
      <div id="cloud-session-sidebar" />
      <MithrilChat profile="default" onSourceHistorySelect={select} />
    </>,
  );
  await screen.findByText("Models unavailable: Provider overloaded");
  fireEvent.click(
    screen.getByRole("button", { name: "Retry model inventory" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: /Mithril model/ }),
    ).toHaveTextContent("mithril-model"),
  );

  fireEvent.click(await screen.findByText("Original source conversation"));
  expect(select).toHaveBeenCalledWith("original-pending");
  expect(apply).not.toHaveBeenCalled();
});

// @lat: [[cloud-workspace-tests#Signed-in scoped authorization recovery]]
it("retries transient failures without asking for another sign-in", async () => {
  vi.mocked(window.hermesAPI.cloudChat.status).mockRejectedValueOnce(
    Error("Network unavailable"),
  );
  const connect = vi.fn();
  render(<MithrilChat profile="default" onConnectAccount={connect} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Retry connection" }),
  );
  await screen.findByRole("combobox", { name: /Mithril model/ });
  expect(connect).not.toHaveBeenCalled();
});

// @lat: [[mithril-code#Mithril Code#Native tool connection Chat mounting]]
it("mounts selection review for the actual selected Chat and removes it when hidden", async () => {
  const view = render(
    <MithrilChat profile="default" initialSessionId="selected-chat" />,
  );
  await screen.findByText("No Hermes conversation is selected.");
  expect(window.hermesAPI.cloudChat.gatewaySelection).toHaveBeenCalledWith({
    userId: "owner",
    profile: "default",
    sessionId: "selected-chat",
  });
  expect(window.hermesAPI.cloudChat.reviewGateway).not.toHaveBeenCalled();
  view.rerender(
    <MithrilChat
      profile="default"
      initialSessionId="selected-chat"
      visible={false}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Review tool connection in browser" }),
  ).toBeNull();
});
