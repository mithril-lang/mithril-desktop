# Wallet & Token Balances

Profile-scoped Ethereum wallets on Base mainnet, with on-chain token balance reads.

## Wallet Store

Profile wallets are stored per-profile in `wallets.json` alongside profile metadata. Keys and recovery phrases never leave the main process.

[[src/main/wallet-store.ts]] provides create, import, rename, delete, and list operations. Recovery phrases are encrypted via Electron `safeStorage` and stripped by [[src/main/wallet-store.ts#publicWallet]] before any data crosses IPC. The per-profile cap is 10 wallets ([[src/main/wallet-store.ts#MAX_WALLETS_PER_PROFILE]]).

Wallet metadata types are re-exported by [[src/shared/wallets.ts]] from the shared workspace package: `ProfileWallet` (public shape), `WalletMutationResult` (one-time recovery phrase on create/import), and `ImportWalletInput`.

Local **creation/import is being retired** in favour of backend-provisioned wallets. The store's `createWallet`/`importWallet` and their IPC channels are retained for now, but the wallet pane no longer exposes a create/import UI.

## Token Balances

The active Wallet UI reads Base mainnet balances through the canonical Mithril API. The older direct-RPC module remains for historical tests.

The retained [[src/main/wallet-balances.ts#getTokenBalances]] takes a wallet address and returns a `TokenBalancesResponse` containing native ETH plus all configured ERC-20 token balances. It uses `Promise.allSettled()` so one token RPC failure does not block others. The active IPC no longer calls this direct-RPC implementation.

Each RPC read is wrapped in [[src/main/wallet-balances.ts#withTimeout]] (10s default; ethers v6 has no per-request timeout) so a hung endpoint surfaces as a per-token timeout error instead of a chip that spins forever.

Token metadata (contract address, symbol, decimals) lives in [[src/shared/tokens.ts]] as `BASE_TOKENS`. Currently tracks ETH (native) and $HD (`0xfda75f77a22b4f4b783bbbb21915ef64d149bba3`), both 18 decimals. $H1 is held back for a future release.

### Balance formatting

[[src/shared/tokens.ts#formatTokenBalance]] converts raw BigInt strings to compact form: zero → "0", ≥1M → "1.5M", ≥1K → "10.5K", tiny non-zero → "< 0.0001", otherwise up to 4 significant digits. [[src/shared/tokens.ts#formatTokenBalanceFull]] produces the same without K/M suffixes — used for tooltip display of exact amounts.

### IPC & UI

The `get-token-balances` IPC channel exposes canonical API balance reads to the renderer, using the dialog profile to resolve the correct public wallet.

The original Native adapter includes its dialog profile so a different active profile cannot redirect the lookup. Balances auto-fetch when the wallet pane loads; previously cached balances display immediately while fresh ones load, then update in place.

Balance data is cached at module level (keyed by wallet address) so it survives tab switches — when the component remounts, it hydrates from the cache instantly and refreshes in the background. Each balance renders as a chip: token icon (only when a known icon is mapped) + symbol label (exactly once) + compact amount (K/M). Hovering a chip shows a native tooltip with the full amount via `formattedFull`. Wallet deletion uses a confirmation modal with red warnings.

## Tests

Vitest test suites for wallet store and balance reads.

- [[src/main/wallet-store.test.ts]] — wallet CRUD, rename/delete, encryption, dedup, caps, and import error distinction (invalid phrase vs. secure-storage failure)
- [[src/main/wallet-balances.test.ts]] — formatTokenBalance edge cases and big-balance precision, `withTimeout`, getTokenBalances with mocked RPC including timeout handling
- [[src/renderer/src/components/profile/ProfileWalletPane.test.tsx]] — balance-chip rendering: one symbol label per token, icon only for known tokens

## Shared original wallet pane (draft)

The original Wallet pane is provided by workspace 0.6.29-schedules.27 and consumed through the Desktop IPC adapter, preserving cards, balances, copying and deletion confirmation.

Visible local/cloud origin badges are removed. Public DTOs share one definition; recovery phrases and encrypted wallet files remain behind the native store. Service-unavailable routes return an error instead of falsely reporting sign-out. Profile replacement retires pending list/sync results. The shared Web adapter reads owner-bound descriptors and balances through the canonical API; installed-update and production parity remain unverified.

Successful synchronization re-reads the original working copy, including when no remote-only wallets exist. The shared pane deduplicates public identities while retaining native custody controls and rejects late refreshes from a retired profile. The immutable `.26` archive contains 461 matching producer/vendor/installed files; SHA256 is `91cf40247121519ebb4b8e1d26d4957bdaf58894c2a92aebe854424fbb508910`.

## Automatic public wallet replication (draft)

The Desktop startup data loop automatically publishes original public wallet metadata through the canonical workspace repository, with a durable receipt journal and account fencing.

[[src/main/wallet-replication-runtime.ts#startWalletReplication]] connects the existing account lifecycle poller to all owned original profile sources. [[src/main/wallet-source.ts#captureWalletSource]] validates a single file snapshot and strips encrypted recovery phrases; malformed or replaced sources never imply deletion. [[src/main/wallet-replication.ts#WalletReplication]] preserves authored intents before admission, replays lost receipts and retains concurrent conflicts. [[src/main/wallet-repository-store.ts#WalletRepositoryStore]] stores only public records in owner/profile-bound private SQLite files. The existing Wallet IPC invokes [[src/main/wallet-replication-runtime.ts#synchronizeWallets]] without a migration screen.

Remote-only wallets appear as read-only cards in the original pane. Remote names restore through [[src/main/wallet-source.ts#restoreWalletSource]] only when the original source still matches its captured baseline. The atomic private file replacement preserves exact ciphertext and all other records; cloud edits cannot change native address, network or custody provenance. Restart after file restoration adopts the already-observed cloud revision instead of republishing it. Concurrent native/cloud changes remain retained conflicts.

Cloud tombstones do not erase native keys. The canonical active snapshot omits deleted public records, and the shared pane replaces its displayed list instead of merging retained keys back into it. No live API publication or installed Desktop update is proven by these fixture tests.

## Canonical wallet deletion visibility (draft)

Successful canonical snapshots replace the wallet card list in both clients, so retained native key records cannot resurrect deleted public cards.

The shared WalletSyncResult marks complete active snapshots with `authoritative`. Web's repository adapter and Native synchronization set it; the shared pane preserves error handling and profile fencing while accepting empty successful lists. Native binds custody controls only to original records with matching public identity, and keeps remote-only cards read-only. Deletion is represented by the repository tombstone, never by automatic key erasure. The `.27` archive has 461 matching producer/vendor/installed files; SHA256 is `a68570cbdabdf027c647ebf875f01f09a7b8e5c3dac79806f5a15682d311b2f1`.

## Canonical native wallet balance adapter (draft)

The original Wallet pane sends its profile to the Native IPC adapter, which resolves the authenticated account's public descriptor and uses the same fixed API route and response validator as Web.

[[src/main/cloud-wallet-balances.ts#readCloudWalletBalances]] checks owner, profile, stable record identity, pagination and returned address; an unpublished wallet remains unavailable until synchronization succeeds. [[src/main/cloud-workspace.ts#CloudWorkspace#walletBalances]] calls the canonical `/v1/workspace/wallets/:id/balances` route through existing scoped account authentication and shared validation. [[src/main/wallet-replication-runtime.ts#canonicalWalletBalances]] fences account changes. The IPC path no longer calls the direct Base RPC module; that module remains for historical tests. Existing Workspace connection authorization is required and scopes are never upgraded. Fixture results do not prove a live API or installed-client read.
