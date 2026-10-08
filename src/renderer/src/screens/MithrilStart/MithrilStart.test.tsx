import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MithrilStart from "./MithrilStart";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ locale: "en" }),
}));
afterEach(cleanup);

function mount(
  protection: "keychain" | "reduced",
  onOpenWorkspace: () => void = () => {},
): void {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getMithrilFirstRunState: vi
        .fn()
        .mockResolvedValue({ connected: false, protection }),
      getMithrilAccount: vi.fn().mockResolvedValue(null),
      openExternal: vi.fn(),
      onMithrilDeviceCode: vi.fn().mockReturnValue(vi.fn()),
      mithrilDeviceLogin: vi.fn(),
      cancelMithrilDeviceLogin: vi.fn().mockResolvedValue(true),
      connectMithrilAccount: vi.fn(),
    },
  });
  render(
    <MithrilStart
      initiallyConnected={false}
      onOpenWorkspace={onOpenWorkspace}
    />,
  );
}

describe("Mithril first-run storage notice", () => {
  // @lat: [[mithril-migration#Mithril desktop migration#Secure Mithril token storage#Reduced-protection file fallback]]
  it("tells the user when no system keyring was found", async () => {
    mount("reduced");
    const note = await screen.findByTestId("mithril-reduced-protection");
    expect(note.textContent).toMatch(/reduced protection/i);
    expect(note.textContent).toMatch(/no system keyring was found/i);
    expect(note.textContent).toMatch(/gnome-keyring or KWallet/);
  });

  it("stays silent when the OS keychain is available", async () => {
    mount("keychain");
    await waitFor(() =>
      expect(window.hermesAPI.getMithrilFirstRunState).toHaveBeenCalled(),
    );
    expect(screen.queryByTestId("mithril-reduced-protection")).toBeNull();
  });
});

// @lat: [[mithril-migration#Mithril desktop migration#First-run connect]]
describe("first-run browser connection", () => {
  const account = {
    userId: "fixture-user",
    live: true,
    balanceMicroUsd: null,
    accountUrl: "https://console.mithril.fund/account",
    scopes: ["inference"],
  };
  it("connects from a click and moves to the connected screen after approval", async () => {
    const opened = vi.fn();
    mount("keychain", opened);
    let finish!: (
      value: import("../../../../shared/account").MithrilAccountConnectResult,
    ) => void;
    vi.mocked(window.hermesAPI.mithrilDeviceLogin).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect in browser" }));
    expect(window.hermesAPI.mithrilDeviceLogin).toHaveBeenCalledWith(undefined);
    const listener = vi.mocked(window.hermesAPI.onMithrilDeviceCode).mock
      .calls[0][0];
    const info = {
      userCode: "ABCD-EFGH",
      verificationUri: "https://console.mithril.fund/account/device",
      verificationUriComplete:
        "https://console.mithril.fund/account/device?user_code=ABCD-EFGH",
      interval: 5,
      expiresIn: 600,
    };
    const { act } = await import("@testing-library/react");
    act(() => listener(info));
    expect(screen.getByRole("status").textContent).toContain("ABCD-EFGH");
    fireEvent.click(screen.getByRole("button", { name: "Open browser again" }));
    expect(window.hermesAPI.openExternal).toHaveBeenCalledWith(
      info.verificationUriComplete,
    );
    expect(opened).not.toHaveBeenCalled();
    await act(async () =>
      finish({ status: "connected", account, protection: "keychain" }),
    );
    expect(screen.getByText("Connected to Mithril")).toBeTruthy();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(window.hermesAPI.connectMithrilAccount).not.toHaveBeenCalled();
  });
  it.each(["device_expired", "device_denied", "device_start_failed"])(
    "allows retry after %s",
    async (error) => {
      mount("keychain");
      vi.mocked(window.hermesAPI.mithrilDeviceLogin).mockResolvedValue({
        status: "refused",
        error,
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Connect in browser" }),
      );
      await screen.findByRole("alert");
      expect(screen.queryByText("Connected to Mithril")).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "Connect in browser" }),
      );
      await waitFor(() =>
        expect(window.hermesAPI.mithrilDeviceLogin).toHaveBeenCalledTimes(2),
      );
    },
  );
  it("cancels pending login when dismissed and preserves token fallback", async () => {
    mount("keychain");
    vi.mocked(window.hermesAPI.mithrilDeviceLogin).mockReturnValue(
      new Promise(() => {}),
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect in browser" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(window.hermesAPI.cancelMithrilDeviceLogin).toHaveBeenCalledTimes(1);
    cleanup();
    expect(window.hermesAPI.cancelMithrilDeviceLogin).toHaveBeenCalledTimes(2);
    mount("keychain");
    expect(
      screen.getByText("Use a connection token instead").closest("details")
        ?.open,
    ).toBe(false);
  });
});
