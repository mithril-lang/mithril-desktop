# Mithril desktop migration

The public `mithril-lang/mithril-desktop` repository is a source preview of the future Mithril desktop app. Version 0.8.0 has staged package identity, but its account and inference runtime is still a legacy baseline.

## Repository ownership

This public repository starts from a reviewed source snapshot without importing the private migration repository's history. The private `mithril-lang/fund-mithril-app` repository and the old fork remain separate sources for ongoing migration work.

Preserve the upstream MIT license and commit history. Do not push Mithril changes to `legacy` (`cloud-kotoba/org-hermesone-hermes-desktop`).

## Runtime compatibility

A Mithril-branded binary needs Mithril app identity and working Mithril login, provider, billing, organization, and sandbox routes.

The app ID, package name, platform icons, display name, and unpublished updater URL now point to Mithril. The runtime still uses `kotoba.cloud`, `api.kotoba.cloud`, `app.kotoba.cloud`, `KOTOBA_API_KEY`, and `kc_pat_` credentials. A visual rename cannot make these protocols compatible. Implement and verify token migration explicitly; never send a legacy token to a new origin by changing a URL alone.

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

Keep GitHub Actions disabled on this public source repository and publish no binary or updater feed until the desktop and website cutover gates pass.

`scripts/check-mithril-packaging.mjs` blocks every npm packaging command while legacy runtime origins or credentials remain. The old origin-plane publisher and release manifest were removed from this repository; their history remains in Git. The new update feed has no published files yet.

The main-process service supervisor remains internal. Its three unused renderer IPC handlers were removed because the preload API did not expose them; future service controls need a designed renderer API and authorization boundary.

Verify packaging, first run, sign-in, provider, billing, sandbox, upgrade, and supported platforms. Rebuild installers from Mithril source and publish real bytes with checksums; do not rename the old `kotoba-desktop` artifacts. Coordinate with `mithril-lang/mithril-fund` so its `app.mithril.fund` route, 39 public sites, and 22 locales pass its cutover gate before the app/site release.

## Legacy installation continuity

Changing the Electron app ID, executable, and update feed creates a distinct application identity.

Determine whether existing profile data can be imported safely, and retain an explicit path for users of the old installed app. Signed macOS upgrades need a Developer ID identity; the imported fork's macOS artifacts were ad-hoc signed and require manual installation. Keep release notes accurate about that limit.
