# Original Discover

The original marketplace presentation is shared with Web while native API, translation, Markdown and loading animation stay in the Desktop adapter.

## Shared marketplace

The native wrapper supplies its original API and presentation ports to the compiled Discover component.

[[src/renderer/src/screens/Discover/Discover.tsx#Discover]] supplies the original preload API and native presentation ports to the compiled workspace Discover component. Its original tabs, counts, search, cards, installed markers, detail modal and explicit action handlers use one component body. The canonical catalog and detail contracts are re-exported by `src/shared/registry.ts`; the Discover CSS ships in the same workspace artifact.

The shared package tests check original metadata, installed cards, complete structured and Markdown detail, focus requests, and exact selected item/profile submission. Mounting or refreshing never invokes an installation.

The default API workspace route now mounts the same original Discover with repository-backed Skill/MCP data. Public catalog and detail requests pass through trusted main IPC to fixed Mithril API routes; only catalog identity is forwarded, never renderer-supplied URLs or paths. The shared detail builder retains the original structured specification, and Skill Markdown retains its table/newline bytes.

An explicit Skill installation now reads a fixed API source bundle, verifies its complete files and writes owner-scoped immutable R2 chunks/manifests plus a durable repository pointer. [[src/main/cloud-workspace.ts#CloudWorkspace#registrySkill]] keeps credentials in main, checks catalog identity and file digests, and uses a bounded extended deadline for the file bundle. Git binary bytes and executable attributes remain intact; scripts never execute during installation or synchronization. Repeated setup after a lost acknowledgement reads the same operation receipt and does not write another installation. An existing directory with different bytes requires review. Workflow/plugin inventory, other setup kinds and execution ownership remain unfinished and unpublished.
