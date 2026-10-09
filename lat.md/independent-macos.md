# Independent macOS qualification

Desktop's native Mac qualification runs directly on a trusted Mac with Node 24, the existing Developer ID keychain identity and explicit Apple notarization credentials. GitHub Actions is not its execution owner.

The entrypoint is `scripts/independent-macos/cli.mjs`. Its preflight requires a clean current remote main, matching package/lock versions, the expected signing identity, Command Line Tools, authenticated notary history and Rosetta for x64. Credentials are supplied as private local key paths or an existing notarytool profile, never printed or copied into source.

## Native package verification

Build/test children receive only the necessary host environment and no inherited provider or notarization credentials; Vitest runs directly with two workers so npm's four-worker default cannot add a conflicting flag.

Qualification builds and tests locked source, packages each Mac architecture, verifies the SQLite native module and executable architecture, and checks the Developer ID chain, hardened runtime and secure timestamp.

The `package` command can prepare signed-only artifacts when notarization credentials are unavailable. Its pending receipt cannot pass qualification or release verification.

Each ZIP and DMG requires an actual Accepted Apple submission. The app and DMG are stapled and validated, Gatekeeper and disk-image inspection must pass, and the final ZIP is rebuilt from the stapled app. A temporary empty profile verifies the packaged login window and captures a screenshot without importing the user's profile or launching a configured agent.

The disk image explicitly enables Developer ID signing with `dmg.sign: true`. The preview.73 qualification stopped because its stapled DMG had no usable signature, although the app passed Gatekeeper. Preview.74 must pass the same unchanged native Gatekeeper checks before qualification can succeed.

## Receipt validation

A success receipt binds source, version, dependency lock, runtime hashes, Apple submission and final artifact hashes to completed native signature, staple, Gatekeeper and launch checks.

`scripts/independent-macos/core.test.mjs` rejects stale or mismatched sources, unqualified signatures, unsafe credential paths, incomplete or rejected notarization, missing launch proof and modified artifact bytes. Verification requires both arm64 and x64 receipts from current main. Receipts remain private operator evidence and cannot independently authorize publication.

## Remaining release platforms

Apple qualification is separate from the complete Windows/Linux release matrix. The organization adapter stays runtime-required and release-held until the remaining native hosts, Windows signing and installer/update read-back are qualified.

The CLI always emits `releaseEligible: false`, does not dispatch Actions and has no upload/publish command. Existing artifacts and preview tags remain unchanged while qualification is incomplete.
