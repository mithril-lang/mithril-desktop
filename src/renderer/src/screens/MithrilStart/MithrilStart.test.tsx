import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MithrilStart from "./MithrilStart";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ locale: "en" }),
}));
afterEach(cleanup);

function mount(protection: "keychain" | "reduced"): void {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getMithrilFirstRunState: vi
        .fn()
        .mockResolvedValue({ connected: false, protection }),
      getMithrilAccount: vi.fn().mockResolvedValue(null),
      openExternal: vi.fn(),
    },
  });
  render(
    <MithrilStart initiallyConnected={false} onOpenWorkspace={() => {}} />,
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
