# Mithril Desktop

Mithril Desktop is an Electron client for [Hermes Agent](https://github.com/NousResearch/hermes-agent), adapted from [Hermes Desktop](https://github.com/fathah/hermes-desktop). The upstream MIT license and attribution are retained in [LICENSE](LICENSE).

## Release status

`0.8.0-preview.1` is the first public Mithril Desktop preview. Native packages are available for Windows x64, Linux x64/ARM64, and Apple silicon/Intel Macs. Download the correct package from [app.mithril.fund/download](https://app.mithril.fund/download/?lang=en) or the repository's GitHub prerelease.

The macOS preview is signed with Mithril's Developer ID Application identity and notarized by Apple, so Gatekeeper can verify it normally. Legacy cloud agent sync and wallet services are disabled; local Hermes Agent setup, profiles, chat, and the native Mithril account path remain available. See the [migration notes](lat.md/mithril-migration.md) for the exact boundary.

## Work locally

Use Node.js 22 and npm. From the repository root:

```sh
npm ci
npm run typecheck
npm test
npm run check:packaging
```

`npm run dev` starts the local Electron development build. Platform packages are published by the manually dispatched `Publish Preview Platforms` workflow, which builds on native Windows, Linux, and macOS runners and adds artifacts only after every package inspection passes.

## Security and contributions

Do not commit credentials, local profiles, installers, or release secrets. Do not post exploit details in public issues. Quarantined legacy migration modules remain in source history and may not be imported by the active runtime; the packaging gate enforces that boundary.

## License

MIT. See [LICENSE](LICENSE) for the original Hermes Desktop copyright notice.
