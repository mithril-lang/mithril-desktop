// @lat: [[mithril-migration#Mithril desktop migration#First-run connect]]
import { useEffect, useRef, useState } from "react";
import OnboardHero from "../../components/common/OnboardHero";
import { ArrowRight, Spinner } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import type {
  MithrilAccount,
  MithrilDeviceCode,
  MithrilStorageProtection,
} from "../../../../shared/account";

const CONSOLE_TOKEN_URL = "https://console.mithril.fund/account";

type Turn = { role: "user" | "assistant"; content: string };

interface MithrilStartProps {
  /** Already connected at launch (a stored mf_ token exists). */
  initiallyConnected: boolean;
  profile?: string;
  /** Optional: continue into the shared API-backed workspace. */
  onOpenWorkspace: () => void;
}

export function issueText(code: string, ja: boolean): string {
  const l = (en: string, jp: string): string => (ja ? jp : en);
  switch (code) {
    case "invalid_mithril_token":
      return l(
        "That is not a Mithril token. It starts with mf_.",
        "Mithril トークンではありません。mf_ で始まる値を入力してください。",
      );
    case "secure_storage_unavailable":
      return l(
        "The token could not be saved: neither the OS keychain nor the app's encrypted token file is writable. Check that your user data folder is writable, or install and unlock a keyring (libsecret / KWallet), then try again.",
        "トークンを保存できませんでした。OS キーチェーンもアプリの暗号化ファイルも利用できません。ユーザーデータフォルダの書き込み権限を確認するか、キーリング（libsecret / KWallet）を有効にして再試行してください。",
      );
    case "unauthenticated":
      return l(
        "The token is invalid or revoked. Create a new one in the console.",
        "トークンが無効か失効しています。Console で再発行してください。",
      );
    case "mithril_api_unavailable":
      return l(
        "Could not reach api.mithril.fund. Check your network and retry.",
        "api.mithril.fund に接続できません。ネットワークを確認してください。",
      );
    case "device_denied":
      return l(
        "Sign-in was denied. Try again.",
        "接続が拒否されました。もう一度お試しください。",
      );
    case "device_expired":
      return l(
        "The code expired. Try again.",
        "コードの有効期限が切れました。再試行してください。",
      );
    case "device_cancelled":
      return l("Sign-in cancelled.", "接続を中止しました。");
    case "device_in_progress":
      return l("Another sign-in is in progress.", "別の接続操作が進行中です。");
    case "device_unavailable":
      return l(
        "Browser sign-in is unavailable. Try again or use a connection token.",
        "ブラウザー接続を利用できません。再試行するか、接続トークンを使用してください。",
      );
    case "device_start_failed":
      return l(
        "Could not start browser sign-in. Check your network and retry.",
        "接続を開始できません。ネットワークを確認して再試行してください。",
      );
    case "empty_reply":
      return l(
        "The model returned an empty reply.",
        "モデルの応答が空でした。",
      );
    case "reasoning_budget_exhausted":
      return l(
        "The model used its reply budget on internal reasoning and returned no text. Try a shorter question, or try again.",
        "モデルが応答予算を内部推論に使い切り、本文がありませんでした。質問を短くするか、もう一度送ってください。",
      );
    default:
      return l(`Request failed (${code}).`, `失敗しました (${code})。`);
  }
}

/** Shown whenever no system keyring backs the stored token. */
export function reducedProtectionNotice(ja: boolean): string {
  return ja
    ? "システムのキーリングが見つからないため、トークンは保護が弱い方式（アプリ管理の暗号化ファイル）で保存されます。同じ OS ユーザーで動くプログラムからは読み取れる可能性があります。より安全にするには gnome-keyring または KWallet（libsecret）をインストールして有効にし、再接続してください。"
    : "Stored with reduced protection because no system keyring was found. The token is encrypted in an app-managed file, but any program running as your OS user could read it. For stronger protection, install and unlock gnome-keyring or KWallet (libsecret), then reconnect.";
}

function MithrilStart({
  initiallyConnected,
  profile,
  onOpenWorkspace,
}: MithrilStartProps): React.JSX.Element {
  const { locale } = useI18n();
  const ja = locale === "ja";
  const l = (en: string, jp: string): string => (ja ? jp : en);
  const [connected, setConnected] = useState(initiallyConnected);
  const [account, setAccount] = useState<MithrilAccount | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deviceCode, setDeviceCode] = useState<MithrilDeviceCode | null>(null);
  const deviceAttempt = useRef<object | null>(null);

  useEffect(() => {
    const unsubscribe = window.hermesAPI.onMithrilDeviceCode((info) => {
      if (deviceAttempt.current) setDeviceCode(info);
    });
    return () => {
      unsubscribe();
      if (deviceAttempt.current) {
        deviceAttempt.current = null;
        void window.hermesAPI.cancelMithrilDeviceLogin();
      }
    };
  }, [profile]);

  async function browserConnect(): Promise<void> {
    if (busy || deviceAttempt.current) return;
    const attempt = {};
    deviceAttempt.current = attempt;
    setBusy(true);
    setError("");
    try {
      const result = await window.hermesAPI.mithrilDeviceLogin(profile);
      if (deviceAttempt.current !== attempt) return;
      if (result.status === "connected") {
        setAccount(result.account);
        setProtection(result.protection);
        setConnected(true);
        setToken("");
      } else setError(result.error);
    } catch {
      if (deviceAttempt.current === attempt) setError("device_start_failed");
    } finally {
      if (deviceAttempt.current === attempt) {
        deviceAttempt.current = null;
        setDeviceCode(null);
        setBusy(false);
      }
    }
  }
  const [protection, setProtection] =
    useState<MithrilStorageProtection>("keychain");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void window.hermesAPI
      .getMithrilFirstRunState(profile)
      .then((state) => {
        if (active && state.protection) setProtection(state.protection);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [profile]);

  useEffect(() => {
    if (!connected) return;
    let active = true;
    void window.hermesAPI
      .getMithrilAccount(profile)
      .then((a) => {
        if (active) setAccount(a);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [connected, profile]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [turns, sending]);

  async function connect(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await window.hermesAPI.connectMithrilAccount(
        token,
        profile,
      );
      if (result.status === "connected") {
        setToken("");
        setAccount(result.account);
        setProtection(result.protection);
        setConnected(true);
      } else {
        setError(result.error);
      }
    } catch {
      setError("mithril_api_unavailable");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(): Promise<void> {
    await window.hermesAPI.disconnectMithrilAccount(profile).catch(() => null);
    setConnected(false);
    setAccount(null);
    setTurns([]);
  }

  async function send(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const content = prompt.trim();
    if (!content || sending) return;
    const next: Turn[] = [...turns, { role: "user", content }];
    setTurns(next);
    setPrompt("");
    setSending(true);
    setError("");
    try {
      const result = await window.hermesAPI.mithrilChat(next, profile);
      if (result.ok) {
        setTurns([...next, { role: "assistant", content: result.text }]);
      } else {
        setError(result.error);
      }
    } catch {
      setError("mithril_api_unavailable");
    } finally {
      setSending(false);
    }
  }

  if (!connected) {
    return (
      <OnboardHero
        intro
        eyebrow="MITHRIL"
        title={l("Connect your Mithril account", "Mithril アカウントに接続")}
      >
        <p className="onboard-subtitle">
          {l(
            "Connect in your browser. Sign in with your passkey or existing Mithril account, then approve this device. Desktop connects automatically after approval.",
            "ブラウザーで passkey または Mithril アカウントでサインインし、この端末を承認してください。承認後、Desktop が自動で接続します。",
          )}
        </p>
        {protection === "reduced" && (
          <p
            role="note"
            className="onboard-subtitle"
            data-testid="mithril-reduced-protection"
          >
            {reducedProtectionNotice(ja)}
          </p>
        )}
        <div className="onboard-cta-row">
          <button
            type="button"
            className="onboard-btn onboard-btn-primary"
            disabled={busy}
            onClick={() => void browserConnect()}
          >
            <span>
              {busy
                ? l("Waiting for connection…", "接続を待っています…")
                : l("Connect in browser", "ブラウザーで接続")}
            </span>
            {busy ? (
              <Spinner size={16} className="animate-spin" />
            ) : (
              <ArrowRight size={17} />
            )}
          </button>
        </div>
        {busy && deviceAttempt.current && (
          <div role="status" className="onboard-subtitle">
            {deviceCode ? (
              <>
                <p>
                  {l(
                    "Approve this code in your browser:",
                    "ブラウザーでこのコードを確認して承認してください：",
                  )}{" "}
                  <strong>{deviceCode.userCode}</strong>
                </p>
                <button
                  type="button"
                  className="onboard-btn onboard-btn-glass"
                  onClick={() =>
                    void window.hermesAPI.openExternal(
                      deviceCode.verificationUriComplete,
                    )
                  }
                >
                  {l("Open browser again", "ブラウザーをもう一度開く")}
                </button>
              </>
            ) : (
              <p>{l("Opening browser…", "ブラウザーを開いています…")}</p>
            )}
            <button
              type="button"
              className="onboard-btn onboard-btn-glass"
              onClick={() => void window.hermesAPI.cancelMithrilDeviceLogin()}
            >
              {l("Cancel", "キャンセル")}
            </button>
          </div>
        )}
        <details>
          <summary>
            {l("Use a connection token instead", "接続トークンを使用する")}
          </summary>
          <form
            onSubmit={(e) => void connect(e)}
            className="onboard-cta-row"
            data-testid="mithril-connect-form"
          >
            <input
              id="mithril-first-run-token"
              aria-label={l("Connection token", "接続トークン")}
              type="password"
              autoComplete="off"
              spellCheck={false}
              className="welcome-remote-input"
              placeholder="mf_…"
              value={token}
              disabled={busy}
              onChange={(e) => setToken(e.target.value)}
            />
            <button
              type="submit"
              className="onboard-btn onboard-btn-primary"
              disabled={busy || !token.trim()}
            >
              <span>
                {busy ? l("Checking…", "確認中…") : l("Connect", "接続")}
              </span>
              {busy ? (
                <Spinner size={16} className="animate-spin" />
              ) : (
                <ArrowRight size={17} />
              )}
            </button>
          </form>
        </details>
        {error && (
          <p role="alert" className="welcome-remote-error">
            {issueText(error, ja)}
          </p>
        )}
        <button
          type="button"
          className="onboard-btn onboard-btn-glass"
          onClick={() => void window.hermesAPI.openExternal(CONSOLE_TOKEN_URL)}
        >
          {l("Open Mithril Console", "Mithril Console を開く")}
        </button>
      </OnboardHero>
    );
  }

  return (
    <OnboardHero
      wide
      eyebrow="MITHRIL"
      title={l("Connected to Mithril", "Mithril に接続しました")}
    >
      <p className="onboard-subtitle" data-testid="mithril-account-line">
        {account?.live === false
          ? l(
              "Connection expired — reconnect.",
              "接続が無効です。再接続してください。",
            )
          : `${l("Account", "アカウント")}: ${account?.userId ?? "…"}`}
        {account?.balanceMicroUsd != null &&
          ` · ${l("Balance", "残高")} $${(account.balanceMicroUsd / 1_000_000).toFixed(2)}`}
      </p>
      {protection === "reduced" && (
        <p
          role="note"
          className="onboard-subtitle"
          data-testid="mithril-reduced-protection"
        >
          {reducedProtectionNotice(ja)}
        </p>
      )}
      <div
        ref={logRef}
        className="onboard-terminal"
        data-selectable
        data-testid="mithril-chat-log"
        style={{ textAlign: "left", whiteSpace: "pre-wrap" }}
      >
        {turns.length === 0 && (
          <span style={{ opacity: 0.6 }}>
            {l(
              "Say something — the reply comes from api.mithril.fund.",
              "メッセージを送信してください。返信は api.mithril.fund から届きます。",
            )}
          </span>
        )}
        {turns.map((t, i) => (
          <div key={i} data-role={t.role}>
            <strong>
              {t.role === "user" ? l("You", "あなた") : "Mithril"}:{" "}
            </strong>
            {t.content}
          </div>
        ))}
        {sending && <div style={{ opacity: 0.6 }}>…</div>}
      </div>
      {error && (
        <p role="alert" className="welcome-remote-error">
          {issueText(error, ja)}
        </p>
      )}
      <form
        onSubmit={(e) => void send(e)}
        className="onboard-cta-row"
        data-testid="mithril-chat-form"
      >
        <input
          aria-label={l("Message", "メッセージ")}
          className="welcome-remote-input"
          value={prompt}
          disabled={sending}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={l("Ask Mithril…", "Mithril に質問…")}
        />
        <button
          type="submit"
          className="onboard-btn onboard-btn-primary"
          disabled={sending || !prompt.trim()}
        >
          <span>{l("Send", "送信")}</span>
          <ArrowRight size={17} />
        </button>
      </form>
      <div className="onboard-connect-row">
        <button
          type="button"
          className="onboard-btn onboard-btn-glass"
          onClick={onOpenWorkspace}
        >
          <span>{l("Open workspace", "Workspace を開く")}</span>
        </button>
        <button
          type="button"
          className="onboard-btn onboard-btn-glass"
          onClick={() => void disconnect()}
        >
          <span>{l("Disconnect", "接続を解除")}</span>
        </button>
      </div>
    </OnboardHero>
  );
}

export default MithrilStart;
