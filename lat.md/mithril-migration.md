# Mithril desktop migration

The public `mithril-lang/mithril-desktop` repository contains the Mithril desktop app. Version `0.8.0-preview.1` provides native preview installers for Windows, Linux, Apple silicon, and Intel Macs.

## Repository ownership

This public repository is the canonical Mithril Desktop; the private `mithril-lang/fund-mithril-app` is no longer a release source.

Preserve the upstream MIT license and commit history. Do not push Mithril changes to `legacy` (`cloud-kotoba/org-hermesone-hermes-desktop`).

## Runtime compatibility

A Mithril-branded binary needs Mithril app identity and explicit service boundaries.

The app ID, package name, platform icons, display name, and updater URL point to Mithril. The legacy Kotoba account, agent-sync, wallet-sync and Hermes One device-login modules are deleted, not quarantined: cloud agent sync and cloud wallet IPC return an unavailable result, profile deletion remains local, and startup does not migrate or inject old credentials. A visual rename cannot make old protocols compatible; any future migration must be explicit and separately verified.

## Legacy inference isolation

The Mithril setup and provider screens no longer offer the old Kotoba inference endpoint while the new API lacks chat completions.

The renderer's curated provider and key lists omit Kotoba. [[src/main/agent-config-providers.ts#mirrorFirstPartyAgentProviders]] no longer registers it from a saved legacy token. Existing encrypted tokens and profile files remain available for explicit migration; they are not rewritten as Mithril credentials.

## Mithril API token contract

[[src/main/mithril-token.ts#inspectMithrilToken]] is the first native Mithril account boundary. It proves an `mf_` token against the new API and reads a ledger-consistent balance when permitted.

It never forwards a legacy token or follows redirects with a bearer. The account UI uses this verifier through the native account IPC path.

### Legacy token isolation

A `kc_pat_` credential is refused before any network request to Mithril.

### Identity and balance

A valid Mithril bearer reaches only fixed API URLs, and a consistent D1 ledger balance is shown in micro USD.

### Missing billing scope

A valid token without `billing:read` stays identified, while its balance remains unknown.

### Billing unavailable

If identity succeeds but the billing request fails, the account stays identified and its balance remains unknown.

### Revocation and mismatch

A revoked token is refused, and a ledger mismatch never appears as a trustworthy balance.

## Secure Mithril token storage

[[src/main/mithril-token-store.ts]] encrypts installation account identity and profile-specific native provider credentials separately. Without a system keyring it falls back to a weaker, disclosed AES-256-GCM file. It never writes plaintext or reads the old Kotoba token file.

### Profile isolation

The encrypted Mithril file is scoped to one Hermes profile and can be cleared without reading another profile.

### No plaintext fallback

The new Mithril token is never written to disk as plaintext. With a real keyring (`gnome_libsecret`, `kwallet*`, macOS, Windows) it uses the v1 `safeStorage` format.

### Reduced-protection file fallback

Used when no system keyring is found; weaker than a keyring and disclosed in the UI.

If `safeStorage` is unavailable or reports `basic_text` (Chromium's fixed public key), the token is sealed as v2: AES-256-GCM, key from HKDF-SHA256 over a random 32-byte per-install secret in a 0600 `mithril-install-secret` file under `userData` (outside the profile directory), with a random salt and IV per write. Anyone running as the same OS user can read both files, so this is weaker than a keyring; the connect screen and account card say so and point to gnome-keyring or KWallet. `--password-store=basic` is not used because it protects with a known key. Tampering or a missing secret makes the token unreadable, which reads as disconnected.

### Failed replacement

A token replacement that cannot be read back restores the previous encrypted file.

## Token-only-in-secure-store

The Mithril token exists only in the keychain or the encrypted fallback file; [[src/main/mithril-sync.ts]] no longer copies it into any `.env`.

### No plaintext written

`setEnvValue` refuses to persist an `mf_` value for `MITHRIL_API_KEY`, and a token typed into Providers is verified and stored securely instead.

### Agent env is in-memory

[[src/main/secure-env.ts]] overlays the stored token onto `readEnv` and spawn environments in memory, so the agent and gateway receive it without a file; the renderer only sees a redacted placeholder.

### Startup migration

A leftover `.env` `MITHRIL_API_KEY=` moves into the secure store at startup, then only that line is removed.

Other lines and the file mode are kept, and the file is deleted only if it becomes empty. If the store refuses the token, `.env` is left untouched so nothing is lost.

## Native Mithril account

[[src/main/mithril-account.ts#connectMithrilAccount]] verifies the new bearer before storing it. A stored account is rechecked on read so revocation is visible. The provider screen now presents this account path in place of the legacy account card.

### Connect and storage

Only a successfully verified `mf_` token is written to the separate Mithril store.

### Unavailable keychain

If secure storage is unavailable, connecting fails and no plaintext token is saved.

### Revocation on read

Each account read verifies the stored token again, and a revoked token is shown as inactive.

### Runtime credential refresh

Browser approval, device-code approval, manual provider entry, and disconnect all await one profile-scoped refresh through [[src/main/mithril-runtime-lifecycle.ts#createMithrilRuntimeLifecycle]].

Refused or cancelled flows leave running processes alone. Account mutations serialize across profiles, including the selected native provider refresh, preserving the user's order across slow Connect, repeated Connect, and Disconnect operations.

The refresh waits for active Desktop turns, dashboard turn leases, and profile cron work without a forced timeout, then recreates the profile's gateway and any managed dashboard so their child environment is rebuilt from the secure token store. An unreadable lease or cron database is treated as busy to preserve unknown work. A named profile served by the default gateway multiplexer refreshes its managed dashboard without disrupting the shared gateway, whose process environment cannot represent multiple profile-specific values for the same secret name.

Before each dashboard send, the Desktop compares the requested model with the live session. Hermes's `custom:mithril` and the Desktop's `mithril` are the same provider when the model matches; that already-correct state bypasses `/model` and its separate `slash.exec` worker. A dashboard disconnect clears the process-local runtime session ID while retaining the stored session ID, so reconnect resumes before model inspection.

### Desktop account card

[[src/renderer/src/components/MithrilAccountSection.tsx]] connects a profile through IPC and shows the verified identity and balance.

It clears the entered bearer after success. The old Kotoba sign-in and gateway controls, preload methods, and IPC handlers are removed. The unused device grant and hosted gateway modules are gone; legacy agent sync and inference internals remain pending migration. No inference or gateway capability is claimed for this new token.

## Independent CI adoption

Desktop registers a commit-pinned organization CI controller through `.github/independent-actions.json`; native runtime and publication remain held during initial preparation.

See `.github/INDEPENDENT_CI.md` for the shared entrypoint and its verification scope. This configuration is excluded from the app bundle. It does not qualify a Linux source check as a native installer release or retire existing workflows. Independent activation requires the pinned Electron/native closure, production dependency audit, native platform matrix, macOS signing/notarization/launch, Windows signing, and installer/update verification. Preserve the existing stable/beta false gates and the release requirements below until the equivalent independent native path is verified. The human instruction supersedes the old Actions dispatch requirement in AGENTS.md; neither adapter registration nor a source receipt activates a native publisher.

## Desktop release gate

Jun requires independent CI/CD execution as of 2026-10-09. The inherited Actions preview path is historical; its native checks must be preserved in the independent path before installer publication.

An Apple agreement HTTP403 leaves publication pending; source merge is not installer publication.

The inherited stable and beta release jobs also have a source-level false gate; migrate those workflows before intentionally enabling them.

`scripts/check-mithril-packaging.mjs` blocks packaging when an active runtime file contains a legacy origin or credential, or imports one of the quarantined migration modules. The old publisher and release manifest were removed; their history remains in Git.

The main-process service supervisor remains internal. Its three unused renderer IPC handlers were removed because the preload API did not expose them; future service controls need a designed renderer API and authorization boundary.

The preview gate verifies packaging, type safety, the DMG, the app bundle signature, and an Apple silicon launch. It publishes real Mithril bytes with checksums rather than renaming an old artifact. The download page and updater feed must point to those exact verified files.

### Native self-hosted Mac admission

GitHub Actions can coordinate Tailscale-connected native Mac workers without Kubernetes. A pre-job hook limits repository-scoped workers to designated manual main workflows. Readiness and publication remain separate gates.

Runner admission has seven regression fixtures in PR CI. The headless Mac uses a LaunchDaemon that runs as its ordinary user with a dedicated security audit session (`SessionCreate=true`). See `docs/self-hosted-mac-runner.md`. The readiness workflow checks native macOS and exact source without signing credentials. PR CI cannot use the trusted worker. Existing cross-platform installer gates remain in force until each native platform is migrated.

### Cross-platform preview

The previous manual preview used trusted Mac workers and hosted Windows/Linux runners. Independent publication must retain that platform coverage and wait for every platform to qualify.

Before Node dependency caching, each Mac release job clears skip-worktree flags for every tracked file and restores the complete checkout. The readiness workflow can leave sparse state on this persistent worker; restoring only the manifests would still omit source and vendored dependencies. Both manifests must exist before setup continues.

Windows publishes NSIS and portable executables with `preview.yml`. Each Linux architecture publishes AppImage and Debian packages plus its architecture-specific preview feed. Both Mac architectures publish notarized DMG and ZIP packages. The publish job preserves existing assets and replaces the consolidated SHA-256 manifest.

## Legacy installation continuity

Changing the Electron app ID, executable, and update feed creates a distinct application identity.

Existing legacy profile data is not automatically imported by the preview. The macOS preview uses Mithril's Developer ID identity and Apple notarization, remains manually installed, and routes update prompts to the download page.

## First-run connect

First launch offers browser device sign-in as its primary action. Browser authentication supports passkeys; approval automatically connects Desktop without copying a token. Manual token entry remains an optional fallback.

[[src/renderer/src/screens/MithrilStart/MithrilStart.tsx#MithrilStart]] shows the approval code, browser reopen, waiting, cancellation and retry states. [[src/main/mithril-device-login.ts#startMithrilDeviceLogin]] requests inference, billing:read, Chat read/write and Workspace read/write with explicit browser approval, validates the Console approval URL, and refuses partial grants before replacing encrypted credentials. Workspace scopes require passkey approval. Cancellation during a network response prevents credential persistence.

[[src/main/first-run.ts#mithrilFirstRunState]] reads local storage without blocking offline launch. Successful connection opens the existing connected screen; the native workspace remains an explicit opt-in. Component tests exercise success, refusal, cancellation, retry and fallback without live authentication or inference charges.

### In-app chat

[[src/main/mithril-chat.ts#mithrilChat]] posts to `/v1/chat/completions` with only the stored `mf_` bearer and `max_tokens` of at least 512. It ignores unknown upstream fields and falls back to `reasoning` when `content` is empty.

## Mithril API error surfacing

Chat failures caused by the Mithril API are explained in plain language instead of the raw agent error text.

[[src/shared/mithril-errors.ts#classifyMithrilError]] maps API error codes (`free_tier_exhausted`, `insufficient_credit`, `input_too_large`, token and scope errors, `inference_unavailable`) to a bilingual title and hint. The chat bubble shows them, with an "Open Mithril Console" button when adding credit fixes the problem, and the main process logs one `[mithril-api] chat failed kind=… status=…` line and uses the short title in the OS notification. Unknown errors keep the raw text.

### Classifier never echoes raw errors

The classifier returns only fixed strings, so bearer tokens embedded in an error cannot reach the UI or logs. Covered by `src/shared/mithril-errors.test.ts`.

## Mithril Agent only

Desktop exposes only Mithril Agent for inference, using the fixed Mithril API endpoint and account. Model choices come from its live catalog; old provider credentials and model rows stay stored but cannot appear in the picker.

### Provider routing boundary

[[src/shared/mithril-provider-policy.ts#requireMithrilProvider]] rejects foreign providers and substituted endpoints before Desktop model writes, discovery or chat dispatch. Exact legacy Mithril aliases normalize to the named provider; reads never rewrite stored legacy data.

Settings replaces legacy provider/key/OAuth/credential-pool controls with the Mithril account and model selector. Setup offers only Mithril. Local and remote model libraries are filtered, and session-only choices cannot bypass the provider boundary. Existing generic library helpers remain for legacy data compatibility, not user selection.

## Signed-in authorization status

A valid account is labeled Signed in independently of Chat and Workspace access. Missing explicit scopes open the existing account approval flow; generic transport failure offers retry rather than another sign-in.

Chat shows account verification while its main-process identity read is pending, including a reconnect after invalidation. Until the check resolves, no old-owner Chat is rendered and no sign-in action is offered. Existing refusal, scope approval and network retry behavior remains authoritative.

Shared Chat dependency for this repair is workspace 0.6.24-auth.1, SHA256 `808053fad14f293ef5c5cc325705fee6032993dead6db1a5994e313f51dcf753`. It adds a consumer authorization action label to the original welcome. Native keeps its explicit passkey device flow and distinguishes scoped approval from network retry.

## Shared creation polling package (candidate preview.75)

Desktop pins Workspace `0.6.31-sync.71`, including Fund's creation polling repair, and shows account verification while identity is pending.

The archive SHA256 is `0f68a403ea427a146887c6b048cd9a76e3aadbb02b60387699b577ecd5d91b17`. All 481 archive files match the Fund producer build and the installed candidate dependency byte for byte. Both Desktop type checks, 33 selected Chat/replication tests, Electron compilation and 715 active packaging-file checks pass. Three real Chromium checks cover compiled notices, pinned/project sidebar layout and composer visibility with empty/long transcripts. The dependency overlay used for focused source checks is not a clean installer qualification. Fund integration, exact-main App qualification/publication, native packaging/signing and installed automatic-update verification remain separate release gates. Preview.74's earlier native receipt cannot qualify preview.75.

## Shared file recovery package (candidate preview.76)

Desktop pins Workspace `0.6.31-sync.72` from Fund's merged ProjectFiles repair, retaining the same cloud component and owner/generation fences as Web.

All 481 archive files match the producer and installed candidate dependency. Both typechecks, 16 Chat/folder synchronization tests, Electron compilation and 715 runtime packaging-file checks pass. Chromium verifies notice layout at narrow/wide widths in both themes and composer visibility with empty/long transcripts. Its first invocation lacked the configured browser-cache path; the unchanged checks passed using the existing pinned Chromium revision. This dependency overlay is source qualification only. Preview.75 native receipts cannot qualify preview.76; complete native qualification, public feeds, actual installation and automatic-update read-back remain required.
