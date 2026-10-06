import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import MithrilChat from "./MithrilChat";
const enable = vi.fn(async () => ({ userId: "owner", enabled: true }));
const list = vi.fn(async () => ({
  schemaVersion: 1,
  userId: "owner",
  sessions: [],
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

it("shows failed identity checks and offers account setup without submitting a turn", async () => {
  vi.mocked(window.hermesAPI.cloudChat.status).mockRejectedValueOnce(
    new Error("Access refused"),
  );
  const connect = vi.fn();
  render(<MithrilChat profile="default" onConnectAccount={connect} />);
  await screen.findByText("Access refused");
  fireEvent.click(
    screen.getByRole("button", { name: "Connect Mithril account" }),
  );
  expect(connect).toHaveBeenCalledOnce();
  expect(enable).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
});
