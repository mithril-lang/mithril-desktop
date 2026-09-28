# Mithril Desktop

Mithril Desktop is an Electron client for [Hermes Agent](https://github.com/NousResearch/hermes-agent), adapted from [Hermes Desktop](https://github.com/fathah/hermes-desktop). This repository is a public source preview of the Mithril migration. The upstream MIT license and attribution are retained in [LICENSE](LICENSE).

## Release status

There is **no Mithril Desktop installer or updater feed available yet**. The 0.8.0 source has a Mithril application identity and a separate, encrypted `mf_` account-token path, but legacy account, sync, and inference code remains. `npm run check:packaging` intentionally blocks packaging while those references remain. Do not rename or redistribute old Kotoba installers as Mithril releases.

This repository's inherited release workflows are disabled at the GitHub repository level. A release requires the packaging gate, first-run and account checks, provider and billing checks, supported-platform installation tests, and a verified updater path. The [migration notes](lat.md/mithril-migration.md) record the remaining boundaries.

## Work locally

Use Node.js 22 and npm. From the repository root:

```sh
npm ci
npm run typecheck
npm test
npm run check:packaging
```

The final command is expected to fail until the migration is complete. `npm run dev` starts the local Electron development build. It does not make a release installer.

## Security and contributions

Do not commit credentials, local profiles, signed installers, or release secrets. Do not post exploit details in public issues. The source currently contains inherited legacy integration code; treat the desktop release gate as binding even if a local development build starts.

## License

MIT. See [LICENSE](LICENSE) for the original Hermes Desktop copyright notice.
