import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MithrilAccountSection from "./MithrilAccountSection";

vi.mock("./useI18n", () => ({ useI18n: () => ({ locale: "en" }) }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Mithril account card", () => {
  // @lat: [[mithril-migration#Mithril desktop migration#Native Mithril account#Desktop account card]]
  it("connects a profile without retaining the entered bearer in the input", async () => {
    const connect = vi.fn().mockResolvedValue({
      status: "connected",
      protection: "keychain",
      account: {
        userId: "u1",
        accountUrl: "https://console.mithril.fund/account",
        live: true,
        scopes: ["billing:read"],
        balanceMicroUsd: 1_500_000,
      },
    });
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getMithrilAccount: vi.fn().mockResolvedValue(null),
        getMithrilFirstRunState: vi
          .fn()
          .mockResolvedValue({ connected: false, protection: "keychain" }),
        connectMithrilAccount: connect,
        disconnectMithrilAccount: vi.fn().mockResolvedValue({ success: true }),
        onMithrilDeviceCode: vi.fn(() => () => {}),
        openExternal: vi.fn(),
      },
    });
    render(<MithrilAccountSection profile="alice" />);
    const input = screen.getByLabelText("Connection token") as HTMLInputElement;
    fireEvent.change(input, { target: { value: `mf_${"a".repeat(43)}` } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.getByText("u1")).toBeTruthy());
    expect(connect).toHaveBeenCalledWith(`mf_${"a".repeat(43)}`, "alice");
    expect(input.value).toBe("");
    expect(screen.getByText("Balance: $1.50")).toBeTruthy();
    expect(screen.getByText("Signed in")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Approve Chat and Workspace access" }),
    ).toBeTruthy();
  });
});
