# Kotoba Cloud account

This is the legacy account implementation retained during migration. The Mithril Providers page no longer exposes its sign-in controls or IPC routes.

kotoba.cloud authenticates people with a Passkey in the browser and issues personal API tokens (`kc_pat_<principal>.<tokenId>.<mac>`), on `kotoba.cloud/account`. Either way the desktop's account _is_ the token. [[src/main/kotoba-cloud-account.ts#connectKotobaCloud]] rejects anything that is not a `kc_pat_` token before any network call, proves a token against `GET https://kotoba.cloud/v1/billing/status` (the read-only route that accepts a token bearer), and only then writes `KOTOBA_API_KEY` through `setEnvValue` (which puts it in the keychain store, see [[kotoba-cloud-account#Kotoba Cloud account#Token at rest]]) and mirrors the `kotoba` agent provider. [[src/main/kotoba-cloud-account.ts#kotobaCloudAccount]] re-verifies the stored token on every read so a revoked token shows as "no longer valid" rather than as connected; a token without `billing:read` stays connected with the balance shown as unknown, not as zero. [[src/main/kotoba-cloud-account.ts#disconnectKotobaCloud]] empties the key.

Upstream's Hermes One device login (`hermes-account.ts`, `hermesone-provision.ts`, agent sync) remains in the main process and preload but is no longer reachable from the Providers page.

## Token at rest

The token is encrypted with Electron `safeStorage` (the OS keychain) into `kotoba-cloud-token.json` in the profile home — the pattern of `account-store.ts` — by [[src/main/kotoba-cloud-token-store.ts]], and is not written to `.env`.

The store is a primitive; nothing but config.ts and the account module opens it. [[src/main/config.ts#setEnvValue]] routes `KOTOBA_API_KEY` there (an empty value clears both the store and any `.env` line), and [[src/main/config.ts#readEnv]] overlays it when `.env` has no value, so every reader of the profile env — the provider cards, config-health, [[src/main/kotoba-cloud-account.ts#kotobaCloudToken]], agent sync — sees the same key. A plaintext `.env` value wins over the store: the desktop never writes one while the keychain works, so it is newer.

The Hermes agent used to load the key from `.env` itself, so every spawn now carries it in the child env: the gateway ([[src/main/hermes.ts#buildGatewayEnv]]) and TUI gateway ([[src/main/hermes.ts#tuiGatewayEnv]]) copy all of `readEnv`, the CLI chat fallback lists `KOTOBA_API_KEY` among its known keys, and the dashboard, cron and kanban spawns spread [[src/main/config.ts#secureSpawnEnv]].

[[src/main/kotoba-cloud-account.ts#migrateKotobaTokensToKeychain]] runs at `app.whenReady`, before the window (and so before any agent spawn): for each profile with a plaintext token it encrypts it, proves the write by decrypting it back, and only then removes the `.env` line. It is idempotent. When `safeStorage.isEncryptionAvailable()` is false, or the write does not read back, the `.env` copy stays with a warning; the token is never dropped.

## Organization switcher

The old Billing selection remains stored for migration, but the Mithril account card does not present this Kotoba organization switcher.

[[src/main/kotoba-cloud-orgs.ts#fetchKotobaOrgMemberships]] reads `GET https://kotoba.cloud/v1/org/memberships` (bearer PAT, scope `org:read`) and names every non-list answer: 403 → `reconnect` (a token issued before `org:read`; the row says "Reconnect to see organizations" and offers the sign-in modal), 404 → `unavailable` (route not deployed), other failures → `error` with the server's code — so "no organizations" only ever means an empty list. Rows whose handle is not a plain slug are dropped.

The selection persists per profile in the desktop settings ([[src/main/kotoba-cloud-orgs.ts#setKotobaOrgSelection]]); a selection the account no longer belongs to falls back to Personal, but only when the list was actually read. [[src/main/kotoba-cloud-account.ts#kotobaCloudAccount]] then reads `GET /v1/billing/status?org=<handle>`; a 403 `org-role-insufficient` (roles other than owner/admin/billing) keeps the token live with the balance unknown. "Manage on kotoba.cloud" opens [[src/main/kotoba-cloud-orgs.ts#kotobaCloudManageUrl]] — `kotoba.cloud/account`, with `?org=<handle>` for an org, since no `/account/org/<handle>` page is confirmed. Member management stays on the web. Disconnect clears the selection.

## Tests

Two suites: the account and org module against a scripted `fetch`, and the token store end to end on a real profile tree.

[[src/main/kotoba-cloud-account.test.ts]] drives the module with an in-memory env and a scripted `fetch`: the bearer and route it calls, the balance read from `balances[scope=ai].availableMicroUSD`, 401 refused and nothing stored, 403 kept with the balance unknown, a non-token rejected without a request, and re-verification of a stored token turning `live` off when the server says revoked. It also covers the org switcher: memberships read with the bearer, an empty list distinct from `reconnect` (403), `unavailable` (404) and named errors, unsafe handles dropped, the per-profile selection, `?org=` on the balance read, `org-role-insufficient` kept live, and the manage URL.

[[src/main/kotoba-cloud-token-store.test.ts]] runs the real config.ts and store on a temp profile tree with a fake keychain: migration moves the token and removes the `.env` line for every profile, a second run is a no-op, a differing plaintext token replaces the stored one, an unavailable keychain or a write that does not read back keeps the `.env` token with a warning, `setEnvValue` never writes `.env` while `readEnv` and `secureSpawnEnv` carry the key, an empty write clears both places, and a corrupt store reads as no token. `tests/cronjobs.test.ts` checks that a keychain-held token reaches the cron child env.
