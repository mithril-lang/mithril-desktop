# E2EE Vault integration preview

Mithril integrates pinned kagi and kagitaba SDKs through a main-process-only client. This is an integration preview, not an enabled general-user Vault.

## Encrypted transport

[[src/main/kagi-vault-client.ts#KagiVaultClient]] binds ciphertext to owner, vault, item and revision. It uses a fixed HTTPS API, rejects redirects and detects rollback against persisted local revisions.

Only ciphertext leaves Desktop. A response after account switching is refused. Writes require an exact echoed operation and envelope. Unknown write outcomes stop; automatic retries must not create a different operation. Resolve requires an explicit item and key, never bulk injection. Plain server deletion markers are refused until an authenticated encrypted tombstone protocol is integrated.

## Local key custody

[[src/main/kagi-vault-store.ts#writeKagiVaultState]] protects the Vault key and local record index with a real OS keyring. The weaker token-file fallback is not used for Vault keys.

State read-back precedes replacement. Unreadable or account-mismatched state is preserved and refused. The existing SecretsProvider remains synchronous; this client has an async boundary and is not silently inserted into that path.

## Release gates

New-device authenticated key transfer, recovery UI, device revocation, listing, deletion UX and execution-consent wiring remain required before enabling the product.

The API rollout flag stays off. Qualify exact commits through the approved standalone pipeline and follow kagi SECURITY.md independent review and recovery requirements. Source tests do not prove installed-app or production behavior.
