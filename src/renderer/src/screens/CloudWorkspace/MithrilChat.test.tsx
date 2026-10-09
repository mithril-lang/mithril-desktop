import {
  act,
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

// @lat: [[cloud-workspace-tests#Chat identity checking]]
it("shows an account check instead of sign-in while identity is unresolved", async () => {
  let complete!: (value: { userId: string; enabled: boolean }) => void;
  vi.mocked(window.hermesAPI.cloudChat.status).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  render(<MithrilChat profile="default" onConnectAccount={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Checking Mithril account…",
  );
  expect(
    screen.queryByRole("button", { name: "Sign in to Mithril" }),
  ).toBeNull();
  expect(list).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
  await act(async () => complete({ userId: "owner", enabled: false }));
  await screen.findByRole("combobox", { name: /Mithril model/ });
  expect(screen.queryByText("Checking Mithril account…")).toBeNull();
  expect(apply).not.toHaveBeenCalled();
  vi.mocked(window.hermesAPI.cloudChat.status).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  act(() => changed());
  expect(screen.getByRole("status")).toHaveTextContent(
    "Checking Mithril account…",
  );
  expect(
    screen.queryByRole("button", { name: "Sign in to Mithril" }),
  ).toBeNull();
  expect(screen.queryByRole("combobox", { name: /Mithril model/ })).toBeNull();
  await act(async () => complete({ userId: "owner", enabled: false }));
  await screen.findByRole("combobox", { name: /Mithril model/ });
  expect(apply).not.toHaveBeenCalled();
});
afterEach(cleanup);

// @lat: [[cloud-workspace-tests#Selected conversation reconnect]]
it("restores the selected conversation after the same checked account reconnects without replay", async () => {
  const session: ChatSession = {
    id: "selection-qa",
    title: "Reconnect selection QA",
    model: "mithril-model",
    revision: 1,
    eventSeq: 0,
    deleted: false,
    activeTurn: null,
  };
  list.mockResolvedValue({
    schemaVersion: 1,
    userId: "owner",
    sessions: [session],
  });
  vi.mocked(window.hermesAPI.cloudChat.events).mockResolvedValue({
    schemaVersion: 1,
    userId: "owner",
    session,
    events: [],
    hasMore: false,
    nextAfter: null,
  });
  try {
    render(<MithrilChat profile="default" />);
    fireEvent.click(
      await screen.findByRole("tab", { name: "Reconnect selection QA" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Reconnect selection QA" }),
      ).toHaveAttribute("aria-selected", "true"),
    );
    act(() => changed());
    await waitFor(() => expect(enable).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Reconnect selection QA" }),
      ).toHaveAttribute("aria-selected", "true"),
    );
    expect(apply).not.toHaveBeenCalled();
  } finally {
    list.mockResolvedValue({ schemaVersion: 1, userId: "owner", sessions: [] });
  }
});

// @lat: [[cloud-workspace-tests#Selected conversation reconnect#New Chat clears remembered selection]]
it("keeps New Chat empty across a same-account reconnect", async () => {
  const session: ChatSession = {
    id: "selection-qa",
    title: "Reconnect selection QA",
    model: "mithril-model",
    revision: 1,
    eventSeq: 0,
    deleted: false,
    activeTurn: null,
  };
  list.mockResolvedValue({
    schemaVersion: 1,
    userId: "owner",
    sessions: [session],
  });
  vi.mocked(window.hermesAPI.cloudChat.events).mockResolvedValue({
    schemaVersion: 1,
    userId: "owner",
    session,
    events: [],
    hasMore: false,
    nextAfter: null,
  });
  try {
    render(<MithrilChat profile="default" initialSessionId="selection-qa" />);
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Reconnect selection QA" }),
      ).toHaveAttribute("aria-selected", "true"),
    );
    fireEvent.click(screen.getByRole("button", { name: "New synced chat" }));
    act(() => changed());
    await waitFor(() => expect(enable).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Reconnect selection QA" }),
      ).toHaveAttribute("aria-selected", "false"),
    );
    expect(apply).not.toHaveBeenCalled();
  } finally {
    list.mockResolvedValue({ schemaVersion: 1, userId: "owner", sessions: [] });
  }
});

// @lat: [[cloud-workspace-tests#Selected conversation reconnect#Different owners do not inherit selection]]
it("does not select the previous owner's session even when another owner has the same ID", async () => {
  const session: ChatSession = {
    id: "selection-qa",
    title: "Reconnect selection QA",
    model: "mithril-model",
    revision: 1,
    eventSeq: 0,
    deleted: false,
    activeTurn: null,
  };
  list.mockResolvedValue({
    schemaVersion: 1,
    userId: "owner",
    sessions: [session],
  });
  vi.mocked(window.hermesAPI.cloudChat.events).mockResolvedValue({
    schemaVersion: 1,
    userId: "owner",
    session,
    events: [],
    hasMore: false,
    nextAfter: null,
  });
  try {
    render(<MithrilChat profile="default" />);
    fireEvent.click(
      await screen.findByRole("tab", { name: "Reconnect selection QA" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Reconnect selection QA" }),
      ).toHaveAttribute("aria-selected", "true"),
    );
    vi.mocked(window.hermesAPI.cloudChat.status).mockResolvedValue({
      userId: "other",
      enabled: false,
    });
    list.mockResolvedValue({
      schemaVersion: 1,
      userId: "other",
      sessions: [session],
    });
    vi.mocked(window.hermesAPI.cloudChat.events).mockClear();
    act(() => changed());
    await waitFor(() => expect(enable).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Reconnect selection QA" }),
      ).toHaveAttribute("aria-selected", "false"),
    );
    expect(window.hermesAPI.cloudChat.events).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  } finally {
    list.mockResolvedValue({ schemaVersion: 1, userId: "owner", sessions: [] });
  }
});
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
    fireEvent.click(screen.getByLabelText("Chat settings"));
    expect(screen.queryByLabelText("Local chat history migration")).toBeNull();
    expect(screen.queryByText("Import local chat history")).toBeNull();
    expect(
      window.hermesAPI.nativeSessionImport.importNativeSessions,
    ).not.toHaveBeenCalled();
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
