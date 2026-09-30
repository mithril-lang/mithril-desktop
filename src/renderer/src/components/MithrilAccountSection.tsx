// @lat: [[mithril-migration#Mithril desktop migration#Native Mithril account#Desktop account card]]
import { useEffect, useState } from "react";
import type { MithrilAccount } from "../../../shared/account";
import { useI18n } from "./useI18n";

export default function MithrilAccountSection({
  profile,
}: {
  profile?: string;
}): React.JSX.Element {
  const { locale } = useI18n();
  const ja = locale === "ja";
  const label = (en: string, japanese: string): string => (ja ? japanese : en);
  const issue = (code: string): string => {
    switch (code) {
      case "invalid_mithril_token":
        return label(
          "Use a Mithril token beginning with mf_.",
          "mf_ で始まる Mithril トークンを入力してください。",
        );
      case "secure_storage_unavailable":
        return label(
          "Secure storage is unavailable on this device.",
          "この端末で安全な保存領域を利用できません。",
        );
      case "insufficient_scope":
        return label(
          "Connected. Balance needs the billing:read scope.",
          "接続済みです。残高の表示には billing:read 権限が必要です。",
        );
      case "billing_unavailable":
        return label(
          "Connected. Balance is temporarily unavailable.",
          "接続済みです。残高を一時的に取得できません。",
        );
      case "ledger_mismatch_or_malformed_balance":
        return label(
          "Connected. Balance needs verification in the console.",
          "接続済みです。残高は Console で確認してください。",
        );
      case "device_denied":
        return label(
          "Sign-in was denied in the browser.",
          "ブラウザで拒否されました。",
        );
      case "device_expired":
        return label(
          "The code expired. Try again.",
          "コードの有効期限が切れました。もう一度お試しください。",
        );
      case "device_cancelled":
        return label("Sign-in cancelled.", "サインインを中止しました。");
      case "device_in_progress":
        return label(
          "Another sign-in is already in progress.",
          "別のサインインが進行中です。",
        );
      case "device_unavailable":
        return label(
          "Device sign-in is not available yet. Paste a token instead.",
          "デバイスサインインはまだ利用できません。トークンを貼り付けてください。",
        );
      case "device_start_failed":
        return label(
          "Could not start sign-in. Check your connection.",
          "サインインを開始できません。接続を確認してください。",
        );
      case "unauthenticated":
        return label(
          "The token is invalid or expired. Create a new one in the console.",
          "トークンが無効か失効しています。Console で再発行してください。",
        );
      default:
        return label(
          "Could not verify the Mithril account. Try again in the console.",
          "Mithril アカウントを確認できません。Console で確認してください。",
        );
    }
  };
  const [account, setAccount] = useState<MithrilAccount | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [protection, setProtection] = useState<"keychain" | "reduced">(
    "keychain",
  );
  const [deviceCode, setDeviceCode] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.hermesAPI
      .getMithrilAccount(profile)
      .then((value) => {
        if (active) setAccount(value);
      })
      .catch(() => {
        if (active) setError("account_unavailable");
      });
    return () => {
      active = false;
    };
  }, [profile]);

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
  }, [profile, account]);

  const connect = async (event: React.FormEvent): Promise<void> => {
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
        setAccount(result.account);
        setToken("");
      } else {
        setError(result.error);
      }
    } catch {
      setError("account_unavailable");
    } finally {
      setBusy(false);
    }
  };

  useEffect(
    () =>
      window.hermesAPI.onMithrilDeviceCode((info) =>
        setDeviceCode(info.userCode),
      ),
    [],
  );

  const deviceLogin = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await window.hermesAPI.mithrilDeviceLogin(profile);
      if (result.status === "connected") setAccount(result.account);
      else setError(result.error);
    } catch {
      setError("account_unavailable");
    } finally {
      setDeviceCode(null);
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      await window.hermesAPI.disconnectMithrilAccount(profile);
      setAccount(null);
      setToken("");
    } catch {
      setError("account_unavailable");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section" lang={ja ? "ja" : "en"}>
      <h2 className="settings-section-title">
        {label("Mithril account", "Mithril アカウント")}
      </h2>
      <p className="settings-section-hint">
        {label(
          "Create a connection token in the Mithril console, then connect this desktop profile. Inference and hosted sessions are still being migrated.",
          "Mithril Console で接続トークンを発行し、このデスクトップのプロフィールに接続してください。推論とホスト型セッションは移行中です。",
        )}
      </p>
      {protection === "reduced" && (
        <p
          role="note"
          className="settings-section-hint"
          data-testid="mithril-reduced-protection"
        >
          {ja
            ? "システムのキーリングが見つからないため、トークンは保護が弱い方式（アプリ管理の暗号化ファイル）で保存されます。gnome-keyring または KWallet を有効にして再接続すると強化されます。"
            : "Stored with reduced protection because no system keyring was found. Install and unlock gnome-keyring or KWallet, then reconnect for stronger protection."}
        </p>
      )}
      {account && (
        <div className="hermes-account-card">
          <span className="hermes-account-avatar hermes-account-avatar-fallback">
            M
          </span>
          <span className="hermes-account-meta">
            <span className="hermes-account-name">Mithril</span>
            <span className="hermes-account-email">
              {account.userId ||
                label("Account unavailable", "アカウントを確認できません")}
            </span>
            <span className="hermes-account-chips">
              <span
                className={`hermes-account-chip ${account.live ? "is-connected" : ""}`}
              >
                {account.live
                  ? label("Connected", "接続済み")
                  : label("Connection expired", "接続が無効です")}
              </span>
            </span>
            {account.balanceMicroUsd !== null && (
              <span className="hermes-account-email">
                {label("Balance", "残高")}: $
                {(account.balanceMicroUsd / 1_000_000).toFixed(2)}
              </span>
            )}
            {account.error && (
              <span className="hermes-account-email">
                {issue(account.error)}
              </span>
            )}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => void disconnect()}
          >
            {label("Disconnect", "接続を解除")}
          </button>
        </div>
      )}
      <div className="mithril-signin-form">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() => void deviceLogin()}
        >
          {label("Sign in with browser", "ブラウザでサインイン")}
        </button>
        {deviceCode && (
          <>
            <span className="hermes-account-email">
              {label(
                "Confirm this code in the browser",
                "ブラウザでこのコードを確認",
              )}
              : <strong>{deviceCode}</strong>
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void window.hermesAPI.cancelMithrilDeviceLogin()}
            >
              {label("Cancel", "キャンセル")}
            </button>
          </>
        )}
      </div>
      <form
        onSubmit={(event) => {
          void connect(event);
        }}
        className="mithril-signin-form"
      >
        <label className="hermes-account-email" htmlFor="mithril-token">
          {label("Connection token", "接続トークン")}
        </label>
        <input
          id="mithril-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          disabled={busy}
          placeholder="mf_…"
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={busy || !token.trim()}
        >
          {busy ? label("Checking…", "確認中…") : label("Connect", "接続")}
        </button>
      </form>
      {error && (
        <p role="alert" className="settings-section-hint">
          {issue(error)}
        </p>
      )}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() =>
          void window.hermesAPI.openExternal(
            "https://console.mithril.fund/account",
          )
        }
      >
        {label("Open Mithril Console", "Mithril Console を開く")}
      </button>
    </section>
  );
}
