# Desktop store release architecture

Mithril keeps direct desktop distribution and store distribution as separate products with separate signing, update, and submission gates.

## Decision

The notarized macOS DMG/ZIP and Windows NSIS/portable artifacts remain the full local-agent edition. They continue to use the generic Mithril update feed and must not be replaced by Store packages.

The Mac App Store edition will be a sandboxed, cloud-first edition. Electron Builder creates a `mas` package with a Mac App Distribution certificate, provisioning profile, and the entitlements templates under `scripts/store-release/macos/`. Fastlane uploads the resulting `.pkg` to App Store Connect and can separately request review. Upload and review are intentionally separate, and automatic release is disabled.

The Microsoft Store edition uses Electron Builder's AppX/MSIX target after Partner Center assigns the package identity and publisher values. Submission uses Microsoft Store Developer CLI, not Fastlane. `scripts/store-release/windows/publish.ps1` creates a draft by default; `-Commit` is an explicit release action.

## Why Fastlane is platform-specific

Fastlane is useful for Apple's App Store Connect workflow: API-key authentication, `.pkg` upload, build selection, metadata, and review submission. It does not own Microsoft Partner Center submission. Windows therefore uses Microsoft's CLI/API while sharing the same protected CI release boundary.

## Mac App Store blocker

The current full Desktop process launches local Python/Hermes processes, supports SSH and local gateway listeners, and reads agent state outside user-selected files. A Mac App Store app must run inside App Sandbox. Adding the sandbox entitlement alone would produce a package that can build but whose core local-agent behavior fails at runtime.

Before activating `electron-builder --mac mas`, the Store edition must:

1. Default to authenticated cloud/remote transport and compile out local process, SSH, unrestricted filesystem, updater, and self-update entry points.
2. Use only sandbox containers, user-selected file grants, and declared device/network entitlements.
3. Pass login, chat, attachment, camera, microphone, logout, and data-deletion QA from a clean macOS account using `mas-dev`.
4. Receive a distinct App Store Connect bundle ID, Mac App Distribution and Installer Distribution certificates, and matching provisioning profiles.
5. Set `MITHRIL_MAS_CLOUD_ONLY=1` only after that evidence is recorded. The readiness check otherwise blocks upload.

No App Store Connect secret, certificate, provisioning profile, or built package may be committed. File inputs must use absolute paths outside the checkout.

## Microsoft Store gate

Partner Center must first reserve the product and provide the exact Identity Name, Publisher, Publisher Display Name, and Store App ID. Those values must be copied exactly into the future AppX configuration; placeholders are not acceptable because they create packages that cannot be associated with the reserved listing.

After Windows clean-machine install/uninstall testing, run the publishing wrapper without `-Commit` to create or update a draft. Inspect package identity, architectures, listing, privacy disclosures, and certification notes in Partner Center. A protected release job may then run the same command with `-Commit` after action-time approval.

Store packages use Store-managed updates. They do not consume `preview.yml` or the direct-download updater feed.

## Local structural verification

The credential-free check does not build or submit anything:

```sh
node scripts/store-release/check-readiness.mjs
cd scripts/store-release/macos
bundle install
bundle exec fastlane mac verify
```

Release-mode checks fail closed until all external inputs and the MAS cloud-only QA receipt exist:

```sh
node scripts/store-release/check-readiness.mjs --release --macos
node scripts/store-release/check-readiness.mjs --release --windows
```

Actual upload, review, draft submission, and committed submission remain distinct, auditable actions.
