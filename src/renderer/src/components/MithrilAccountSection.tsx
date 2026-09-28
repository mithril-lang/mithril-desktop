// @lat: [[mithril-migration#Mithril desktop migration#Native Mithril account#Desktop account card]]
import { useEffect, useState } from "react";
import type { MithrilAccount } from "../../../shared/account";
import { useI18n } from "./useI18n";

export default function MithrilAccountSection({ profile }: { profile?: string }): React.JSX.Element {
  const { locale } = useI18n();
  const ja = locale === "ja";
  const label = (en: string, japanese: string) => ja ? japanese : en;
  const issue = (code: string) => {
    switch (code) {
      case "invalid_mithril_token": return label("Use a Mithril token beginning with mf_.", "mf_ で始まる Mithril トークンを入力してください。");
      case "secure_storage_unavailable": return label("Secure storage is unavailable on this device.", "この端末で安全な保存領域を利用できません。");
      case "insufficient_scope": return label("Connected. Balance needs the billing:read scope.", "接続済みです。残高の表示には billing:read 権限が必要です。");
      case "billing_unavailable": return label("Connected. Balance is temporarily unavailable.", "接続済みです。残高を一時的に取得できません。");
      case "ledger_mismatch_or_malformed_balance": return label("Connected. Balance needs verification in the console.", "接続済みです。残高は Console で確認してください。");
      case "unauthenticated": return label("The token is invalid or expired. Create a new one in the console.", "トークンが無効か失効しています。Console で再発行してください。");
      default: return label("Could not verify the Mithril account. Try again in the console.", "Mithril アカウントを確認できません。Console で確認してください。");
    }
  };
  const [account, setAccount] = useState<MithrilAccount | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void window.hermesAPI.getMithrilAccount(profile)
      .then((value) => { if (active) setAccount(value); })
      .catch(() => { if (active) setError("account_unavailable"); });
    return () => { active = false; };
  }, [profile]);

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await window.hermesAPI.connectMithrilAccount(token, profile);
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

  const disconnect = async () => {
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

  return <section className="settings-section" lang={ja ? "ja" : "en"}>
    <h2 className="settings-section-title">{label("Mithril account", "Mithril アカウント")}</h2>
    <p className="settings-section-hint">{label(
      "Create a connection token in the Mithril console, then connect this desktop profile. Inference and hosted sessions are still being migrated.",
      "Mithril Console で接続トークンを発行し、このデスクトップのプロフィールに接続してください。推論とホスト型セッションは移行中です。",
    )}</p>
    {account && <div className="hermes-account-card">
      <span className="hermes-account-avatar hermes-account-avatar-fallback">M</span>
      <span className="hermes-account-meta">
        <span className="hermes-account-name">Mithril</span>
        <span className="hermes-account-email">{account.userId || label("Account unavailable", "アカウントを確認できません")}</span>
        <span className="hermes-account-chips"><span className={`hermes-account-chip ${account.live ? "is-connected" : ""}`}>
          {account.live ? label("Connected", "接続済み") : label("Connection expired", "接続が無効です")}
        </span></span>
        {account.balanceMicroUsd !== null && <span className="hermes-account-email">
          {label("Balance", "残高")}: ${(account.balanceMicroUsd / 1_000_000).toFixed(2)}
        </span>}
        {account.error && <span className="hermes-account-email">{issue(account.error)}</span>}
      </span>
      <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void disconnect()}>
        {label("Disconnect", "接続を解除")}
      </button>
    </div>}
    <form onSubmit={(event) => { void connect(event); }} className="kotoba-signin-form">
      <label className="hermes-account-email" htmlFor="mithril-token">{label("Connection token", "接続トークン")}</label>
      <input id="mithril-token" type="password" autoComplete="off" spellCheck={false} value={token}
        onChange={(event) => setToken(event.target.value)} disabled={busy} placeholder="mf_…" />
      <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !token.trim()}>
        {busy ? label("Checking…", "確認中…") : label("Connect", "接続")}
      </button>
    </form>
    {error && <p role="alert" className="settings-section-hint">{issue(error)}</p>}
    <button type="button" className="btn btn-secondary btn-sm"
      onClick={() => void window.hermesAPI.openExternal("https://console.mithril.fund/account")}>
      {label("Open Mithril Console", "Mithril Console を開く")}
    </button>
  </section>;
}
