import { useEffect, useState, useRef } from "react";
import type {
  VaultAction,
  VaultInput,
  VaultView,
} from "../../../../shared/kagi-vault";

export default function VaultPane(): React.JSX.Element {
  const identityEpoch = useRef(0);
  const [view, setView] = useState<VaultView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [key, setKey] = useState("");
  async function run(action: VaultAction, input?: VaultInput): Promise<void> {
    const epoch = identityEpoch.current;
    setBusy(true);
    setError("");
    try {
      const result = await window.hermesAPI.vault(action, input);
      if (epoch !== identityEpoch.current) return;
      if (result.ok) setView(result.view);
      else setError(result.error);
    } catch {
      setError("Vault service unavailable.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run("status");
    const unsubscribe = window.hermesAPI.onCloudWorkspaceAccountChanged?.(
      () => {
        ++identityEpoch.current;
        setView(null);
        void run("status");
      },
    );
    return () => {
      unsubscribe?.();
    };
  }, []);
  const button = (
    label: string,
    action: VaultAction,
    input?: VaultInput,
  ): React.JSX.Element => (
    <button
      type="button"
      className="rounded border px-3 py-2 text-sm disabled:opacity-50"
      disabled={busy}
      onClick={() => void run(action, input)}
    >
      {label}
    </button>
  );
  return (
    <section aria-label="E2EE Vault" className="space-y-3 border-t p-4">
      <h3 className="font-medium">E2EE Vault — integration preview</h3>
      <p className="text-sm">
        Connect the same Mithril account with vault:read and vault:write scopes.
        Account login and Vault unlock are separate. Your OS keyring protects
        this device’s key; Mithril stores encrypted items.
      </p>
      <p className="text-sm">
        Independent security review is required before general availability.
        Cloud sync may remain disabled during qualification.
      </p>
      <p role="status" className="text-sm">
        {busy
          ? "Vault operation in progress…"
          : `Vault: ${view?.status ?? "unavailable"}`}
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {button("Refresh status", "status")}
        {view?.status === "absent" && button("Create new Vault", "create")}
        {view?.status === "locked" &&
          button("Unlock with OS keyring", "unlock")}
        {view?.status === "unlocked" &&
          button("Lock and revoke grants", "lock")}
      </div>
      {view?.realm === "vault-training-v1" && (
        <p role="status">
          Training Vault — disposable test secrets only. This account expires.
        </p>
      )}
      {view?.status === "unlocked" && (
        <>
          <label className="block text-sm">
            Secret title
            <input
              className="ml-2 rounded border bg-transparent p-2"
              aria-label="Secret title"
              maxLength={256}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Variable name
            <input
              className="ml-2 rounded border bg-transparent p-2"
              aria-label="Variable name"
              maxLength={128}
              placeholder="OPENAI_API_KEY"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <p className="text-sm">
            The value is entered in a separate private native dialog, never in
            chat.
          </p>
          <div className="flex flex-wrap gap-2">
            {button("Add secret", "save", { title, key })}
            {button("Sync known items", "sync")}
            {button("Retry exact pending writes", "retry")}
            {button("Revoke all execution grants", "revoke")}
          </div>
          <p className="text-sm">
            Pending writes: {view.pendingWrites}. Resolve pending writes before
            device transfer or recovery export.
          </p>
          {view.items.map((item) => (
            <div key={item.id} className="space-y-2 rounded border p-3">
              <p>
                {item.title} · {item.key} · revision {item.revision}
                {item.pending ? " · pending write" : ""}
              </p>
              {button(
                item.granted
                  ? "Revoke next-request grant"
                  : "Allow one local agent disclosure",
                item.granted ? "revoke" : "grant",
                { itemId: item.id },
              )}
            </div>
          ))}
          <p className="text-sm">
            Grants expire after ten minutes and apply to one named secret in
            this profile’s local Hermes gateway. A native confirmation
            identifies the requesting session before release. The agent and its
            tools can see a released value.
          </p>
          <h4 className="font-medium">Approve another device</h4>
          <p className="text-sm">
            Open its request file. Compare the FULL request fingerprint directly
            with the new device. Send the encrypted transfer file and compare
            the approving device’s transfer fingerprint on the new device.
            Requests expire after ten minutes.
          </p>
          {button("Approve device request", "approve-device")}
          <h4 className="font-medium">Recovery backup</h4>
          <p className="text-sm">
            Export after important changes. Store the recovery code separately
            from the encrypted file. Neither is uploaded. A lost code cannot be
            reset by Mithril. Recovery restores the export-time snapshot; later
            server rollback cannot be detected from that old backup.
          </p>
          {button("Export encrypted recovery kit", "export-recovery")}
        </>
      )}
      {view?.status === "absent" && (
        <>
          <h4 className="font-medium">Add this device or recover</h4>
          <p className="text-sm">
            Sign in to the same account. Create a request, obtain approval from
            your existing device, then open its encrypted transfer. Keep this
            app open: restarting consumes the request. Alternatively, open your
            recovery file and enter its separately stored code.
          </p>
          <div className="flex flex-wrap gap-2">
            {button("Create device request", "request-device")}
            {button("Complete device approval", "complete-device")}
            {button("Recover from encrypted kit", "recover")}
          </div>
        </>
      )}
      <p className="text-sm">
        Device removal cannot erase secrets already copied. Rotate exposed API
        keys at their issuer. This preview does not offer remote device
        revocation or automatic discovery of newly added items on another
        device.
      </p>
    </section>
  );
}
