# Mithril desktop migration

The public `mithril-lang/mithril-desktop` repository contains the Mithril desktop app. Version `0.8.0-preview.1` provides native preview installers for Windows, Linux, Apple silicon, and Intel Macs.

## Repository ownership

This public repository starts from a reviewed source snapshot without importing the private migration repository's history. The private `mithril-lang/fund-mithril-app` repository and the old fork remain separate sources for ongoing migration work.

Preserve the upstream MIT license and commit history. Do not push Mithril changes to `legacy` (`cloud-kotoba/org-hermesone-hermes-desktop`).

## Runtime compatibility

A Mithril-branded binary needs Mithril app identity and explicit service boundaries.

The app ID, package name, platform icons, display name, and updater URL point to Mithril. Legacy account, sync, and wallet modules remain only as quarantined migration material. The active main process does not import them: cloud agent sync and cloud wallet IPC return an unavailable result, profile deletion remains local, and startup does not migrate or inject old credentials. A visual rename cannot make old protocols compatible; any future migration must be explicit and separately verified.

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

[[src/main/mithril-token-store.ts]] keeps each profile's Mithril bearer in a separate Electron `safeStorage` encrypted file. It refuses plaintext fallback and never reads the old Kotoba token file.

### Profile isolation

The encrypted Mithril file is scoped to one Hermes profile and can be cleared without reading another profile.

### No plaintext fallback

If Electron cannot encrypt, the new Mithril token is not written to disk.

### Failed replacement

A token replacement that cannot be read back restores the previous encrypted file.

## Native Mithril account

[[src/main/mithril-account.ts#connectMithrilAccount]] verifies the new bearer before storing it. A stored account is rechecked on read so revocation is visible. The provider screen now presents this account path in place of the legacy account card.

### Connect and storage

Only a successfully verified `mf_` token is written to the separate Mithril store.

### Unavailable keychain

If secure storage is unavailable, connecting fails and no plaintext token is saved.

### Revocation on read

Each account read verifies the stored token again, and a revoked token is shown as inactive.

### Desktop account card

[[src/renderer/src/components/MithrilAccountSection.tsx]] connects a profile through IPC and shows the verified identity and balance.

It clears the entered bearer after success. The old Kotoba sign-in and gateway controls, preload methods, and IPC handlers are removed. The unused device grant and hosted gateway modules are gone; legacy agent sync and inference internals remain pending migration. No inference or gateway capability is claimed for this new token.

## Desktop release gate

GitHub Actions remain disabled on this public source repository. The preview is built locally after its packaging, type, signature, and launch checks, then published as a GitHub prerelease with checksums and update metadata.

The inherited stable and beta release jobs also have a source-level false gate; migrate those workflows before intentionally enabling them.

`scripts/check-mithril-packaging.mjs` blocks packaging when an active runtime file contains a legacy origin or credential, or imports one of the quarantined migration modules. The old publisher and release manifest were removed; their history remains in Git.

The main-process service supervisor remains internal. Its three unused renderer IPC handlers were removed because the preload API did not expose them; future service controls need a designed renderer API and authorization boundary.

The preview gate verifies packaging, type safety, the DMG, the app bundle signature, and an Apple silicon launch. It publishes real Mithril bytes with checksums rather than renaming an old artifact. The download page and updater feed must point to those exact verified files.

### Cross-platform preview

The manual preview workflow builds Windows x64, Linux x64/ARM64, and Intel Mac packages on native GitHub runners, then updates the existing prerelease only when every job succeeds.

Windows publishes NSIS and portable executables with `preview.yml`. Each Linux architecture publishes AppImage and Debian packages plus its architecture-specific preview feed. Intel Mac publishes DMG and ZIP packages; both Mac architectures remain manual-update builds while using Developer ID signing and Apple notarization. The publish job preserves existing assets and replaces the consolidated SHA-256 manifest.

## Legacy installation continuity

Changing the Electron app ID, executable, and update feed creates a distinct application identity.

Existing legacy profile data is not automatically imported by the preview. The macOS preview uses Mithril's Developer ID identity and Apple notarization, remains manually installed, and routes update prompts to the download page.
