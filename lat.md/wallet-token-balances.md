# Wallet & Token Balances

Profile-scoped Ethereum wallets on Base mainnet, with on-chain token balance reads.

## Wallet Store

Profile wallets are stored per-profile in `wallets.json` alongside profile metadata. Keys and recovery phrases never leave the main process.

[[src/main/wallet-store.ts]] provides create, import, rename, delete, and list operations. Recovery phrases are encrypted via Electron `safeStorage` and stripped by [[src/main/wallet-store.ts#publicWallet]] before any data crosses IPC. The per-profile cap is 10 wallets ([[src/main/wallet-store.ts#MAX_WALLETS_PER_PROFILE]]).

Wallet metadata types are re-exported by [[src/shared/wallets.ts]] from the shared workspace package: `ProfileWallet` (public shape), `WalletMutationResult` (one-time recovery phrase on create/import), and `ImportWalletInput`.

Local **creation/import is being retired** in favour of backend-provisioned wallets. The store's `createWallet`/`importWallet` and their IPC channels are retained for now, but the wallet pane no longer exposes a create/import UI.

## Token Balances

On-chain balance reads for Base mainnet ERC-20 tokens, fetched via ethers v6 `JsonRpcProvider`.

[[src/main/wallet-balances.ts#getTokenBalances]] takes a wallet address and returns a `TokenBalancesResponse` containing native ETH plus all configured ERC-20 token balances. Uses `Promise.allSettled()` so one token RPC failure does not block others — each failed token gets an `error` field.

Each RPC read is wrapped in [[src/main/wallet-balances.ts#withTimeout]] (10s default; ethers v6 has no per-request timeout) so a hung endpoint surfaces as a per-token timeout error instead of a chip that spins forever.

Token metadata (contract address, symbol, decimals) lives in [[src/shared/tokens.ts]] as `BASE_TOKENS`. Currently tracks ETH (native) and $HD (`0xfda75f77a22b4f4b783bbbb21915ef64d149bba3`), both 18 decimals. $H1 is held back for a future release.

### Balance formatting

[[src/shared/tokens.ts#formatTokenBalance]] converts raw BigInt strings to compact form: zero → "0", ≥1M → "1.5M", ≥1K → "10.5K", tiny non-zero → "< 0.0001", otherwise up to 4 significant digits. [[src/shared/tokens.ts#formatTokenBalanceFull]] produces the same without K/M suffixes — used for tooltip display of exact amounts.

### IPC & UI

The `get-token-balances` IPC channel exposes balance reads to the renderer. Balances auto-fetch when the wallet pane loads; previously cached balances display immediately while fresh ones load, then update in place.

Balance data is cached at module level (keyed by wallet address) so it survives tab switches — when the component remounts, it hydrates from the cache instantly and refreshes in the background. Each balance renders as a chip: token icon (only when a known icon is mapped) + symbol label (exactly once) + compact amount (K/M). Hovering a chip shows a native tooltip with the full amount via `formattedFull`. Wallet deletion uses a confirmation modal with red warnings.

## Tests

Vitest test suites for wallet store and balance reads.

- [[src/main/wallet-store.test.ts]] — wallet CRUD, rename/delete, encryption, dedup, caps, and import error distinction (invalid phrase vs. secure-storage failure)
- [[src/main/wallet-balances.test.ts]] — formatTokenBalance edge cases and big-balance precision, `withTimeout`, getTokenBalances with mocked RPC including timeout handling
- [[src/renderer/src/components/profile/ProfileWalletPane.test.tsx]] — balance-chip rendering: one symbol label per token, icon only for known tokens

## Shared original wallet pane (draft)

The original Wallet pane is provided by workspace 0.6.29-schedules.25 and consumed through the Desktop IPC adapter, preserving cards, balances, copying and deletion confirmation.

Visible local/cloud origin badges are removed. Public DTOs share one definition; recovery phrases and encrypted wallet files remain behind the native store. Service-unavailable routes return an error instead of falsely reporting sign-out. Profile replacement retires pending list/sync results. The shared Web adapter reads owner-bound descriptors and balances through the canonical API; installed-update and production parity remain unverified.

## Automatic public wallet replication (draft)

The Desktop startup data loop automatically publishes original public wallet metadata through the canonical workspace repository, with a durable receipt journal and account fencing.

[[src/main/wallet-replication-runtime.ts#startWalletReplication]] connects the existing account lifecycle poller to all owned original profile sources. [[src/main/wallet-source.ts#captureWalletSource]] validates a single file snapshot and strips encrypted recovery phrases; malformed or replaced sources never imply deletion. [[src/main/wallet-replication.ts#WalletReplication]] preserves authored intents before admission, replays lost receipts and retains concurrent conflicts. [[src/main/wallet-repository-store.ts#WalletRepositoryStore]] stores only public records in owner/profile-bound private SQLite files. The existing Wallet IPC invokes [[src/main/wallet-replication-runtime.ts#synchronizeWallets]] without a migration screen.

Remote-only wallets appear as read-only cards in the original pane. Remote metadata writeback to native key records, canonical API balance reads for native cards and signing custody remain separate unfinished work. No live API publication or installed Desktop update is proven by these fixture tests.
