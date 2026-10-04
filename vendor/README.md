# Shared Mithril workspace

`mithril-workspace-0.4.3.tgz` is the compiled npm pack artifact of
[`mithril-lang/mithril-fund/packages/workspace`](https://github.com/mithril-lang/mithril-fund/tree/77d56db1818ec05ed87458e73428c0d440f113dd/packages/workspace),
prepared in [Fund PR387](https://github.com/mithril-lang/mithril-fund/pull/387).
It contains ESM, declarations, CSS, Office models/fonts and upstream licenses.
Desktop consumes this renderer rather than maintaining a copy.

SHA-256: `dfd816c9691d26bccfe9284f8174a87ac4fa3149347499544ba6eb49531df43d`.

This version consumes Desktop-derived ChatSurface, ChatTabs, ChatComposer,
ToolActivity, ChatWelcome and WorkspaceNavigation from the same design-system
revision pinned by both clients. Browser tab closing preserves the durable
session. Platform operations stay adapter-owned.

To update, review the canonical package, build and `npm pack -w
@mithril/workspace`, replace this artifact and update the file dependency and
lock integrity. Run Desktop typechecks, tests, lint, production build and
`lat check`; verify both consumers use the same renderer and protocol.
The archive carries no credentials, consent or deployment operations.
