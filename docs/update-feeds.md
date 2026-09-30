# Update feed naming

electron-builder derives the update channel from the version's prerelease tag, so the feed file names follow from `package.json`:

| Version | Channel | Feed files on the GitHub release |
| --- | --- | --- |
| `0.8.0-preview.N` | `preview` | `preview.yml` (Windows), `preview-mac.yml`, `preview-linux.yml`, `preview-linux-arm64.yml` |
| `0.8.0` (stable) | `latest` | `latest.yml`, `latest-mac.yml`, `latest-linux.yml`, `latest-linux-arm64.yml` |

A preview build requests `preview*.yml`; a stable build requests `latest*.yml`. Both are consistent with what `tests/first-run-mithril.test.ts` pins. Prereleases must stay marked as prerelease on GitHub so stable clients never see them.

## macOS preview feed merge
`preview-platforms.yml` builds Intel Mac only, while Apple silicon installers are usually already on the prerelease. Before `gh release upload --clobber`, the publish job rebuilds `preview-mac.yml` from every `mithril-desktop-<ver>-{x64,arm64}-mac.zip` (and matching `.dmg` when present) in the combined artifact set via `scripts/merge-mac-update-feed.mjs --require-both`. A later Intel publish therefore cannot drop arm64 entries, and an arm64-only feed merged with a new Intel feed keeps both. `tests/merge-mac-update-feed.test.ts` pins that union.

## Known gaps
- The `x86_64.AppImage` has no separate `.blockmap` asset (an embedded block map exists), so differential updates fall back to a full download.
- The workflow and release-asset changes for these need the `workflow` token scope and a Mac for verification; see the release report.

## Signing and notarization
See [windows-signing.md](windows-signing.md) for Windows. macOS builds are Developer ID signed and notarized on a Mac; verify a downloaded DMG with `spctl -a -t open --context context:primary-signature -v <dmg>`, `xcrun stapler validate <dmg>` and `codesign --verify --deep --strict <app>`. These need macOS and cannot be run on Linux.
