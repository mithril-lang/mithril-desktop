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
  it("does not access user sessions, models or local history before explicit connection", async () => {
    render(<MithrilChat profile="default" />);
    expect(enable).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(models).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Connect session sync" }),
    );
    await screen.findByRole("button", { name: "New synced chat" });
    expect(enable).toHaveBeenCalledTimes(1);
    expect(models).toHaveBeenCalledTimes(1);
    expect(preview).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(
      screen.getByRole("combobox", { name: /Mithril model/ }),
    ).toHaveTextContent("mithril-model");
  });
  it("clears connected account on main identity change and preserves explicit reconnect", async () => {
    render(<MithrilChat profile="default" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Connect session sync" }),
    );
    await screen.findByRole("button", { name: "New synced chat" });
    changed();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Connect session sync" }),
      ).toBeInTheDocument(),
    );
    expect(apply).not.toHaveBeenCalled();
  });
});
