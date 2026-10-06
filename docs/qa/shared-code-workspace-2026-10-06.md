# Shared Code workspace

Desktop preview.23 consumes the same workspace 0.6.7 Code renderer as App `/code` and Code. It imports the actual Desktop-derived composer, tabs, navigation, surface and receipt components from the pinned design-system; the screen-specific editor/publishing UI is compiled once in workspace.

Profile-scoped Hermes execution remains a fixed child CLI. GitHub publication uses fixed Code GitHub routes through trusted IPC with the screen's transient credential. Unknown outcomes are not retried. Edited source invalidates the saved SHA, and Pages is gated on a saved public repository. CLJK edits do not rebuild logic/WASM. Switching profiles remounts the shared screen.

Local typechecks, focused UI/IPC tests, production build, lint, packaging checks and lat check were run. UI fixtures are explicitly synthetic; they do not qualify actual native paid inference. The companion Fund UI tests exercise generation, editing, captured-head save, Pages request and editing-after-save rejection; actual Chromium exercises generated starter files.

Release and production evidence will be recorded after current-main CI and installers finish.
