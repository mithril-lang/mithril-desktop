// @lat: [[mithril-migration#Mithril desktop migration#First-run connect]]
import { useEffect, useRef, useState } from "react";
import OnboardHero from "../../components/common/OnboardHero";
import { ArrowRight, Spinner } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import type { MithrilAccount } from "../../../../shared/account";

const CONSOLE_TOKEN_URL = "https://console.mithril.fund/account";

type Turn = { role: "user" | "assistant"; content: string };

interface MithrilStartProps {
  /** Already connected at launch (a stored mf_ token exists). */
  initiallyConnected: boolean;
  profile?: string;
  /** Optional: continue into the full Hermes agent workspace. */
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
        "Secure storage (OS keychain) is unavailable, so the token was not saved. Unlock or install a keyring (libsecret / KWallet) and try again.",
        "安全な保存領域（OS キーチェーン）を利用できないためトークンを保存しませんでした。キーリングを有効にして再試行してください。",
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
    case "empty_reply":
      return l(
        "The model returned an empty reply.",
        "モデルの応答が空でした。",
      );
    default:
      return l(`Request failed (${code}).`, `失敗しました (${code})。`);
  }
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
  const [turns, setTurns] = useState<Turn[]>([]);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

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
            "Paste a connection token (mf_…) from the Mithril console. It is checked against api.mithril.fund and stored in your OS keychain.",
            "Mithril Console で発行した接続トークン（mf_…）を貼り付けてください。api.mithril.fund で確認し、OS キーチェーンに保存します。",
          )}
        </p>
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
            autoFocus
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
        {error && (
          <p role="alert" className="welcome-remote-error">
            {issueText(error, ja)}
          </p>
        )}
        <div className="onboard-divider">
          <span>{l("no token yet?", "トークンがない場合")}</span>
        </div>
        <div className="onboard-connect-row">
          <button
            type="button"
            className="onboard-btn onboard-btn-glass"
            onClick={() =>
              void window.hermesAPI.openExternal(CONSOLE_TOKEN_URL)
            }
          >
            <span>
              {l(
                "Sign in at auth.mithril.fund and create a token",
                "auth.mithril.fund でサインインしてトークンを発行",
              )}
            </span>
          </button>
        </div>
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
          <span>
            {l(
              "Open agent workspace (optional)",
              "エージェントワークスペースを開く（任意）",
            )}
          </span>
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
