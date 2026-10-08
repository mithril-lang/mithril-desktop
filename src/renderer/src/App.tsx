import { useState, useEffect, useCallback, useRef } from "react";
import { Toaster } from "react-hot-toast";
import { ThemeProvider } from "./components/ThemeProvider";
import { FontProvider } from "./components/FontProvider";
import { ProfileModalProvider } from "./components/profile/ProfileModalProvider";
import { SettingsModalProvider } from "./components/settings/SettingsModalProvider";
import { ChatPreferencesProvider } from "./components/ChatPreferencesProvider";
import ErrorBoundary from "./components/ErrorBoundary";
import Welcome from "./screens/Welcome/Welcome";
import MithrilStart from "./screens/MithrilStart/MithrilStart";
import Install from "./screens/Install/Install";
import Setup from "./screens/Setup/Setup";
import Layout from "./screens/Layout/Layout";
import SplashScreen from "./screens/SplashScreen/SplashScreen";
import { captureScreenView } from "./utils/analytics";

type Screen =
  | "splash"
  | "mithril"
  | "welcome"
  | "installing"
  | "setup"
  | "main";

// Minimum time the splash stays visible so the background video plays
// through. Gateway / config checks happen during this window.
const SPLASH_MIN_MS = 3000;

function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>("splash");
  const [installError, setInstallError] = useState<string | null>(null);
  const [connectionMode, setConnectionMode] = useState<
    "local" | "remote" | "ssh"
  >("local");
  const [connectionId, setConnectionId] = useState("");
  // Soft warning: install files exist but the deep `verifyInstall` probe
  // failed (e.g. slow Python startup, restricted network). We surface this
  // as a dismissible banner instead of bouncing the user back to Welcome,
  // which previously trapped restricted-network users in a reinstall
  // loop on every launch (#130).
  const [verifyWarning, setVerifyWarning] = useState(false);
  const [splashStatus, setSplashStatus] = useState<string | undefined>(
    undefined,
  );
  const [setupProfile, setSetupProfile] = useState<string | undefined>(
    undefined,
  );
  // Account admission requires API verification, not merely a stored token.
  const [mithrilConnected, setMithrilConnected] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const accountCheck = useRef(0);
  const isMac = window.electron?.process?.platform === "darwin";
  // Bumped on every runInstallCheck so a superseded run (e.g. the user hit
  // "Switch to local mode" while an SSH tunnel attempt was still in flight)
  // can't clobber the newer run's screen transition.
  const runIdRef = useRef(0);

  const runInstallCheck = useCallback(async () => {
    const myRun = ++runIdRef.current;
    const startedAt = Date.now();
    let next: Screen = "mithril";
    const error: string | null = null;
    let nextSetupProfile = "default";
    try {
      setSplashStatus("Checking Mithril account…");
      // Preserve device configuration, but normal cloud startup never starts a
      // legacy SSH tunnel, probes its server, or requires a local agent install.
      const conn = await window.hermesAPI.getConnectionConfig();
      setConnectionMode(conn.mode);
      setConnectionId(conn.connectionId);
      const status = await window.hermesAPI.checkInstall().catch(() => null);
      nextSetupProfile = status?.activeProfile || "default";
      const first =
        await window.hermesAPI.getMithrilFirstRunState(nextSetupProfile);
      const account = first.connected
        ? await window.hermesAPI.getMithrilAccount(nextSetupProfile)
        : null;
      if (myRun !== runIdRef.current) return;
      const verified = !!account?.live && !!account.userId;
      setAuthenticated(verified);
      setMithrilConnected(verified);
      next = verified ? "main" : "mithril";
    } catch {
      next = "mithril";
    }

    // Abandoned by a newer run (the user switched modes mid-connect) — leave
    // all screen/status state to that run.
    if (myRun !== runIdRef.current) return;

    setSplashStatus(undefined);
    if (error) setInstallError(error);

    const elapsed = Date.now() - startedAt;
    const wait = Math.max(0, SPLASH_MIN_MS - elapsed);
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    if (myRun !== runIdRef.current) return;
    setSetupProfile(nextSetupProfile);
    setScreen(next);
  }, []);

  useEffect(() => {
    runInstallCheck();
  }, [runInstallCheck]);

  useEffect(
    () =>
      window.hermesAPI.onConnectionConfigChanged((connection) => {
        setConnectionMode(connection.mode);
        setConnectionId(connection.connectionId);
      }),
    [],
  );

  // Track screen views for analytics
  useEffect(() => {
    captureScreenView(screen);
  }, [screen]);

  const handleSplashFinished = useCallback(() => {
    /* splash transition is driven by the install check, not a timer */
  }, []);

  function handleInstallComplete(): void {
    setInstallError(null);
    setScreen("setup");
  }

  const openWorkspace = useCallback(async (): Promise<void> => {
    const attempt = ++accountCheck.current;
    const account = await window.hermesAPI
      .getMithrilAccount(setupProfile)
      .catch(() => null);
    if (attempt !== accountCheck.current) return;
    const verified = !!account?.live && !!account.userId;
    setAuthenticated(verified);
    setMithrilConnected(verified);
    setScreen(verified ? "main" : "mithril");
  }, [setupProfile]);

  useEffect(() => {
    const checks = accountCheck;
    let checking = false;
    const changed = (): void => {
      runIdRef.current++;
      accountCheck.current++;
      setAuthenticated(false);
      setMithrilConnected(false);
      void openWorkspace();
    };
    const check = (): void => {
      if (checking || screen === "splash") return;
      checking = true;
      void openWorkspace().finally(() => {
        checking = false;
      });
    };
    const stop = window.hermesAPI.onCloudWorkspaceAccountChanged(changed);
    const timer = screen === "main" ? setInterval(check, 60_000) : undefined;
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    return () => {
      checks.current++;
      stop();
      if (timer !== undefined) clearInterval(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
    };
  }, [screen, openWorkspace]);

  async function openDeviceRuntime(): Promise<void> {
    // Explicit opt-in to the local Hermes agent runtime (large download).
    const status = await window.hermesAPI.checkInstall().catch(() => null);
    if (!status?.installed) setScreen("welcome");
    else setScreen(status.hasApiKey ? "main" : "setup");
  }

  function handleInstallFailed(error: string): void {
    setInstallError(error);
    setScreen("welcome");
  }

  function handleRetryInstall(): void {
    setInstallError(null);
    setScreen("installing");
  }

  function handleRecheck(): void {
    setInstallError(null);
    setScreen("splash");
    runInstallCheck();
  }

  async function handleSwitchToLocal(): Promise<void> {
    // Tear down any in-flight SSH tunnel so a hung connect attempt doesn't keep
    // running (or race the local recheck) after we switch.
    await window.hermesAPI.stopSshTunnel().catch(() => undefined);
    await window.hermesAPI.setConnectionConfig("local", "", "");
    setConnectionMode("local");
    handleRecheck();
  }

  function handleVerifyReinstall(): void {
    setVerifyWarning(false);
    setInstallError(null);
    setScreen("installing");
  }

  function handleDismissVerifyWarning(): void {
    setVerifyWarning(false);
  }

  function renderScreen(): React.JSX.Element {
    if (screen !== "splash" && screen !== "mithril" && !authenticated)
      return (
        <MithrilStart
          initiallyConnected={false}
          profile={setupProfile}
          onOpenWorkspace={() => void openWorkspace()}
        />
      );
    switch (screen) {
      case "splash":
        return (
          <SplashScreen
            onFinished={handleSplashFinished}
            status={splashStatus}
            onSwitchToLocal={
              connectionMode !== "local" ? handleSwitchToLocal : undefined
            }
          />
        );
      case "mithril":
        return (
          <MithrilStart
            initiallyConnected={mithrilConnected}
            profile={setupProfile}
            onOpenWorkspace={() => void openWorkspace()}
          />
        );
      case "welcome":
        return (
          <Welcome
            error={installError}
            connectionMode={connectionMode}
            onStart={handleRetryInstall}
            onRecheck={handleRecheck}
            onSwitchToLocal={handleSwitchToLocal}
          />
        );
      case "installing":
        return (
          <Install
            onComplete={handleInstallComplete}
            onFailed={handleInstallFailed}
            onCancel={() => setScreen("welcome")}
          />
        );
      case "setup":
        return (
          <Setup
            onComplete={() => setScreen("main")}
            profile={setupProfile}
            verifyWarning={verifyWarning}
            onReinstall={handleVerifyReinstall}
            onDismissVerifyWarning={handleDismissVerifyWarning}
          />
        );
      case "main":
        return (
          <Layout
            connectionId={connectionId}
            onOpenDeviceRuntime={() => void openDeviceRuntime()}
            verifyWarning={verifyWarning}
            onReinstall={handleVerifyReinstall}
            onDismissVerifyWarning={handleDismissVerifyWarning}
          />
        );
    }
  }

  return (
    <ThemeProvider>
      <FontProvider>
        <ChatPreferencesProvider>
          <ProfileModalProvider key={authenticated ? "verified" : "signed-out"}>
            <SettingsModalProvider>
              <ErrorBoundary>
                <div
                  className={`app${isMac ? " is-mac" : ""}${
                    isMac && screen === "main" ? " shell-vibrant" : ""
                  }`}
                >
                  {isMac && <div className="drag-region" />}
                  <div className="app-content">{renderScreen()}</div>
                </div>
                <Toaster
                  position="bottom-right"
                  reverseOrder={false}
                  toastOptions={{
                    style: {
                      background: "var(--bg-elevated)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-bright)",
                      fontSize: 13,
                    },
                  }}
                />
              </ErrorBoundary>
            </SettingsModalProvider>
          </ProfileModalProvider>
        </ChatPreferencesProvider>
      </FontProvider>
    </ThemeProvider>
  );
}

export default App;
