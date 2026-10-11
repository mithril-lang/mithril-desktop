import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import VaultPane from "./VaultPane";
import type { VaultView } from "../../../../shared/kagi-vault";
afterEach(cleanup);
function install(view: VaultView): ReturnType<typeof vi.fn> {
  const vault = vi.fn(async () => ({ ok: true, view }));
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: { vault },
  });
  return vault;
}
it("offers empty-device enrollment and recovery through bounded IPC without secret inputs", async () => {
  const vault = install({ status: "absent", pendingWrites: 0, items: [] });
  render(<VaultPane />);
  await screen.findByRole("button", { name: "Create device request" });
  fireEvent.click(
    screen.getByRole("button", { name: "Create device request" }),
  );
  await waitFor(() =>
    expect(vault).toHaveBeenCalledWith("request-device", undefined),
  );
  expect(
    screen.getByRole("button", { name: "Recover from encrypted kit" }),
  ).toBeTruthy();
  expect(screen.queryByLabelText("Secret value")).toBeNull();
});
it("shows item-specific grants and pending writes while keeping values and recovery codes outside the renderer", async () => {
  const vault = install({
    status: "unlocked",
    vaultId: "a".repeat(32),
    pendingWrites: 1,
    items: [
      {
        id: "b".repeat(32),
        title: "Synthetic",
        key: "SYNTHETIC_KEY",
        revision: 1,
        pending: false,
        granted: false,
      },
    ],
  });
  render(<VaultPane />);
  await screen.findByRole("button", {
    name: "Allow one local agent disclosure",
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Allow one local agent disclosure" }),
  );
  await waitFor(() =>
    expect(vault).toHaveBeenCalledWith("grant", { itemId: "b".repeat(32) }),
  );
  expect(screen.getByText(/Pending writes: 1/)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Lock and revoke grants" }),
  ).toBeTruthy();
  expect(screen.queryByLabelText("Recovery code")).toBeNull();
});
