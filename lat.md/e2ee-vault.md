# E2EE Vault integration preview

Mithril integrates pinned kagi and kagitaba SDKs through a main-process-only client. This is an integration preview, not an enabled general-user Vault.

## Encrypted transport

[[src/main/kagi-vault-client.ts#KagiVaultClient]] binds ciphertext to owner, vault, item and revision. It uses a fixed HTTPS API, rejects redirects and detects rollback against persisted local revisions.

Only ciphertext leaves Desktop. A response after account switching is refused. Writes require an exact echoed operation and envelope. Unknown write outcomes stop; automatic retries must not create a different operation. Resolve requires an explicit item and key, never bulk injection. Plain server deletion markers are refused until an authenticated encrypted tombstone protocol is integrated.

## Local key custody

[[src/main/kagi-vault-store.ts#writeKagiVaultState]] protects the Vault key and local record index with a real OS keyring. The weaker token-file fallback is not used for Vault keys.

State read-back precedes replacement. Unreadable or account-mismatched state is preserved and refused. The existing SecretsProvider remains synchronous; this client has an async boundary and is not silently inserted into that path.

## Release gates

Device admission, recovery and targeted local execution now have preview UI. General availability still requires independent review and installed-client qualification.

Recovery drills, remote revocation, automatic item discovery and authenticated deletion remain product gates.

The API rollout flag stays off. Qualify exact commits through the approved standalone pipeline and follow kagi SECURITY.md independent review and recovery requirements. Source tests do not prove installed-app or production behavior.

## Native Vault UI

[[src/renderer/src/components/settings/VaultPane.tsx#VaultPane]] lives in Privacy settings. [[src/main/kagi-vault-ipc.ts#registerKagiVaultIpc]] accepts only the trusted main frame and serializes native operations.

Secrets, keys, recovery codes and snapshots never return through settings IPC. Native private dialogs collect values and trusted fingerprints; native file pickers restrict paths. Files are exclusively created with owner-only permissions. Account scopes, active profile and secure-store token are rechecked. Account login does not unlock a Vault.

## Device enrollment and recovery

[[src/main/kagi-vault-controller.ts#KagiVaultController]] transfers complete encrypted snapshots to empty devices. Both devices compare full fingerprints over a trusted channel; requests expire after ten minutes and are consumed once.

X25519 transfers are classical, not kagi's existing PQC actor. Recovery files use an independent random 256-bit code. Restore verifies owner, item authentication and revision floors, refuses overwrite, and transfers no execution grants. Keep code and file separately. A backup cannot detect rollback after its export time. Re-export after changes. Pending writes block export until reconciled. Remote revocation and automatic item discovery remain outside this preview.

## Execution consent

A one-use, ten-minute grant binds an item, exact variable and active local Hermes profile. [[src/main/kagi-vault-runtime.ts#resolveGrantedVaultSecret]] only serves the local gateway's targeted secret.request path.

A second native confirmation identifies the requesting session. Account switching, locking, expiry, cancellation and revocation refuse release. Desktop does not enumerate Vault secrets or inject them into a subprocess environment. The existing Hermes credential-capture handler persists an approved disclosure into profile .env/auth data and may expose it to subprocesses. Native consent explicitly discloses this; grant revocation cannot erase released copies. Rotate issuer credentials when needed.

## Candidate standalone qualification

`scripts/independent-macos/source-cli.mjs` archives exact clean candidates into gad containers under a fixed Node image, then runs offline source recipes without provider/deployment credentials. Existing Developer ID signs CMS receipts.

Receipts bind repository, source archive, SHA, recipe, runtime, owner certificate, logs and compiled artifact hashes. Verification checks the CMS signature against the local owner's certificate and a 24-hour lifetime. Candidate and integrated current-main source checks are separate from native installer/notarization/publication qualification; neither source profile creates publication authority or changes the native current-main guard.
