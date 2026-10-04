import { act, cleanup, render, screen } from "@testing-library/react";
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
  default: () => <p>Sign in to Mithril</p>,
}));
vi.mock("./utils/analytics", () => ({ captureScreenView: vi.fn() }));
const first = vi.fn(async () => ({ connected: true, protection: "keychain" }));
const tunnel = vi.fn(),
  probe = vi.fn(),
  gateway = vi.fn(),
  verify = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  first.mockResolvedValue({ connected: true, protection: "keychain" });
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
