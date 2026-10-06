# Original Discover

The original marketplace presentation is shared with Web while native API, translation, Markdown and loading animation stay in the Desktop adapter.

## Shared marketplace

The native wrapper supplies its original API and presentation ports to the compiled Discover component.

[[src/renderer/src/screens/Discover/Discover.tsx#Discover]] supplies the original preload API and native presentation ports to the compiled workspace Discover component. Its original tabs, counts, search, cards, installed markers, detail modal and explicit action handlers use one component body. The canonical catalog and detail contracts are re-exported by `src/shared/registry.ts`; the Discover CSS ships in the same workspace artifact.

The shared package tests check original metadata, installed cards, complete structured and Markdown detail, focus requests, and exact selected item/profile submission. Mounting or refreshing never invokes an installation. Cloud repository/action adapters and final Web integration remain unpublished work; extracting the component does not prove native installation or cloud execution parity.
