import {
  act,
  cleanup,
  render,
  screen,
  fireEvent,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
vi.mock("./components/ThemeProvider", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("./components/FontProvider", () => ({
  FontProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("./components/profile/ProfileModalProvider", () => ({
  ProfileModalProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("./components/settings/SettingsModalProvider", () => ({
  SettingsModalProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("./components/ChatPreferencesProvider", () => ({
  ChatPreferencesProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("./screens/SplashScreen/SplashScreen", () => ({
  default: () => <p>Splash</p>,
}));
vi.mock("./screens/Layout/Layout", () => ({
  default: () => <p>Cloud workspace</p>,
}));
vi.mock("./screens/MithrilStart/MithrilStart", () => ({
  default: ({
    onOpenWorkspace,
    onOpenProtection,
  }: {
    onOpenWorkspace: () => void;
    onOpenProtection?: () => void;
  }) => (
    <>
      <p>Sign in to Mithril</p>
      <button onClick={onOpenWorkspace}>Retry connection</button>
      <button onClick={onOpenProtection}>Open local protection</button>
    </>
  ),
}));
vi.mock("./components/useI18n", () => ({ useI18n: () => ({ locale: "en" }) }));
vi.mock("./screens/CloudWorkspace/EndpointProtection", () => ({
  default: () => <p>Local protection</p>,
}));
vi.mock("./utils/analytics", () => ({ captureScreenView: vi.fn() }));
let accountChanged = (): void => {};
const account = vi.fn(async () => ({ live: true, userId: "alice" }));
const first = vi.fn(async () => ({ connected: true, protection: "keychain" }));
const tunnel = vi.fn(),
  probe = vi.fn(),
  gateway = vi.fn(),
  verify = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  first.mockResolvedValue({ connected: true, protection: "keychain" });
  account.mockResolvedValue({ live: true, userId: "alice" });
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getConnectionConfig: vi.fn(async () => ({
        mode: "ssh",
        connectionId: "retained-device",
        ssh: { host: "legacy.example" },
      })),
      checkInstall: vi.fn(async () => ({
        installed: false,
        activeProfile: "default",
      })),
      getMithrilFirstRunState: first,
      getMithrilAccount: account,
      onCloudWorkspaceAccountChanged: (callback: () => void) => {
        accountChanged = callback;
        return () => {};
      },
      onConnectionConfigChanged: () => () => {},
      startSshTunnel: tunnel,
      testRemoteConnection: probe,
      gatewayStatus: gateway,
      verifyInstall: verify,
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
// @lat: [[cloud-workspace#Cloud workspace#Cloud startup]]
it("opens the cloud workspace without a local installation or a legacy connection probe", async () => {
  render(<App />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3100);
  });
  expect(screen.getByText("Cloud workspace")).toBeInTheDocument();
  for (const method of [tunnel, probe, gateway, verify])
    expect(method).not.toHaveBeenCalled();
});
it("keeps a signed-out user on Mithril sign-in instead of a native installation flow", async () => {
  first.mockResolvedValue({ connected: false, protection: "keychain" });
  render(<App />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3100);
  });
  expect(screen.getByText("Sign in to Mithril")).toBeInTheDocument();
  expect(tunnel).not.toHaveBeenCalled();
});
it("keeps local protection open across focus and cloud account changes without admitting the workspace", async () => {
  first.mockResolvedValue({ connected: false, protection: "keychain" });
  account.mockResolvedValue({ live: false, userId: "" });
  render(<App />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3100);
  });
  await act(async () => {
    fireEvent.click(screen.getByText("Open local protection"));
  });
  expect(screen.getByText("Local protection")).toBeInTheDocument();
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    accountChanged();
  });
  expect(screen.getByText("Local protection")).toBeInTheDocument();
  expect(screen.queryByText("Cloud workspace")).not.toBeInTheDocument();
});
// @lat: [[cloud-workspace-tests#Verified Desktop sign-in gate]]
it("does not mount the app for a stored but revoked credential, including a manual open attempt", async () => {
  account.mockResolvedValue({ live: false, userId: "" });
  render(<App />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3100);
  });
  expect(screen.queryByText("Cloud workspace")).not.toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByText("Retry connection"));
  });
  expect(screen.queryByText("Cloud workspace")).not.toBeInTheDocument();
  expect(screen.getByText("Sign in to Mithril")).toBeInTheDocument();
});
it("closes the workspace after sign-out and admits it again only after account verification", async () => {
  render(<App />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3100);
  });
  expect(screen.getByText("Cloud workspace")).toBeInTheDocument();
  account.mockResolvedValue({ live: false, userId: "" });
  await act(async () => {
    accountChanged();
  });
  expect(screen.queryByText("Cloud workspace")).not.toBeInTheDocument();
  account.mockResolvedValue({ live: true, userId: "alice" });
  await act(async () => {
    fireEvent.click(screen.getByText("Retry connection"));
  });
  expect(screen.getByText("Cloud workspace")).toBeInTheDocument();
});
it("retires an in-flight account check when sign-out replaces its identity", async () => {
  render(<App />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3100);
  });
  let finish!: (value: { live: boolean; userId: string }) => void;
  account.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  account.mockResolvedValue({ live: false, userId: "" });
  await act(async () => {
    accountChanged();
  });
  await act(async () => {
    finish({ live: true, userId: "alice" });
  });
  expect(screen.queryByText("Cloud workspace")).not.toBeInTheDocument();
});
it("does not admit a late startup identity after sign-out during verification", async () => {
  let finish!: (value: { live: boolean; userId: string }) => void;
  account.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<App />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  account.mockResolvedValue({ live: false, userId: "" });
  await act(async () => {
    accountChanged();
  });
  await act(async () => {
    finish({ live: true, userId: "alice" });
    await vi.advanceTimersByTimeAsync(3100);
  });
  expect(screen.queryByText("Cloud workspace")).not.toBeInTheDocument();
  expect(screen.getByText("Sign in to Mithril")).toBeInTheDocument();
});
