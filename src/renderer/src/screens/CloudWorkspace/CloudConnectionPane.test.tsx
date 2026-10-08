import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CloudConnectionPane from "./CloudConnectionPane";
const native = vi.hoisted(() =>
  vi.fn(() => <div>Original execution connection</div>),
);
vi.mock("../../components/settings/SettingsModal", () => ({
  NativeSettingsPane: native,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Canonical cloud connection settings]]
it("uses main-owned account reads and retains original executor settings without mounting them initially", async () => {
  const status = vi.fn(async () => ({ userId: "alice", enabled: true }));
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: { cloudWorkspace: { status } },
  });
  const manage = vi.fn();
  render(
    <CloudConnectionPane
      scope="default:1"
      locale="en"
      onManageAccount={manage}
    />,
  );
  await screen.findByText("Account connected");
  expect(status).toHaveBeenCalledOnce();
  expect(native).not.toHaveBeenCalled();
  expect(manage).not.toHaveBeenCalled();
  expect(screen.getByText("api.mithril.fund")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Manage account" }));
  expect(manage).toHaveBeenCalledOnce();
  const details = screen.getByText("Execution settings").closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await screen.findByText("Original execution connection");
});
