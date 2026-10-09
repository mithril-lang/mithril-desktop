This directory defines the high-level concepts, business logic, and architecture of this project using markdown. It is managed by [lat.md](https://www.npmjs.com/package/lat.md) — a tool that anchors source code to these definitions. Install the `lat` command with `npm i -g lat.md` and run `lat --help`.

> **Hermes One** is a community-maintained project. This desktop app is a wrapper around **Hermes Agent** — it is **not affiliated with, endorsed by, or supported by Nous Research**. "Hermes One" is the name of this community project; "Hermes"/"Hermes Agent" refer to the upstream agent it builds on.

- [[chat-commands]] — how typed slash commands are routed through the gateway's `slash.exec`/`command.dispatch` pipeline instead of being sent as prompt text.
- [[shared-chat-components]] — React chat components shared with Web App through a separate repo and platform adapters.
- [[discover]] — the original marketplace screen and styles shared by Desktop and Web through platform adapters.
- [[international-investigation]] — planned Registry contract for local evidence work, selective agency exchange and independent authority/receipt boundaries.
- [[chat-input]] — the unified chat composer surface and its theme-aware animated border treatment.
- [[chat-performance]] — how chat rendering stays responsive through contained transcript rows, batched textarea resizing, and fixed-row slash-command virtualization.
- [[chat-experience-preferences]] — user-message Markdown plus persisted completion-sound and native multi-language spell-check preferences.
- [[model-context]] — the per-model context-window override that drives the context gauge and the agent's auto-compaction.
- [[model-selection]] — the session-scoped in-chat model override that switches the model (and provider) for one conversation without touching the global default.
- [[reasoning-effort]] — the composer's Faster⟷Smarter effort control: a draggable `role="slider"` over six ordered levels that stays open until dismissed and commits one `onChange` per real change.
- [[web-preview]] — the in-app split-screen webview and the `partition`-based gate that lets only it load remote HTTPS while staying sandboxed.
- [[code-blocks]] — collapsible long code blocks, and why expansion state is keyed on source position to survive react-markdown's streaming remounts.
- [[loading-indicators]] — the thinking-orbs dotted-orb loaders behind every loading state, and the OrbLoader wrapper that pins dark/light from the Hermes theme registry instead of the library's auto-detection.
- [[window-chrome]] — the browser-style title bar where open-conversation tabs sit on top of the window drag region, clickable while empty space still drags.
- [[desktop-updates]] — GitHub release checks, startup upgrade button behavior, and the Settings auto-upgrade preference.
- [[office-cron-presence]] — cron activity and safe gateway restart timing in the Office.
- [[mithril-migration]] — ownership, service compatibility, and release conditions for moving the old desktop fork into Mithril Fund.
- [[mithril-action-plane]] — the versioned action envelope and bounded Desktop approval projection for the Mithril Agent fork.
- [[device-care]] — endpoint protection and disk maintenance, bounded local jobs, cleanup authority and measured evidence.
- [[desktop-security]] — verified Unix bootstrap execution and safe rendering of runtime provider names.
- [[agent-capabilities]] — capability-based compatibility between the independent desktop and system-installed Hermes Agent, including bounded runtime evidence and update gating.
- [[connections]] — the versioned main-process connection registry, stable active connection identity, and lossless migration from the legacy singleton configuration.
- [[sidebar-navigation]] — the recent-sessions list under the Chat nav item, capped at five with a "Show more" button that opens the full session list in a modal.
- [[context-folder]] — the per-session linked working folder, persisted in a desktop-owned state.db table so a re-opened conversation restores its folder.
- [[main-process]] — the Electron main-process entrypoint, app lifecycle modules, and centralized IPC registry.
- [[service-supervisor]] — Kotoba Desktop as the supervisor of long-running services (former launchd KeepAlive agents): detached spawn, pid-file adoption, throttle + crash-loop backoff, and the launchd double-run guard.
- [[remote-dashboard-oauth]] — direct Remote dashboard browser authentication, main-process cookie isolation, and single-use WebSocket ticket handling.
- [[onboarding]] — the shared cinematic first-run chrome (OnboardHero): aurora backdrop, animated Hermes emblem with the big-centre → fly-up intro, and the Welcome / Install redesign built on it.
- [[provider-setup]] — the first-run provider picker; its top grid mirrors the agent's native `CANONICAL_PROVIDERS` while OpenAI-compatible endpoints route through the Local presets.
- [[kanban]] — the JIRA-style multi-agent board tab; a thin client over the `hermes kanban` CLI with canonical status columns, an archived toggle, and focus/poll refresh.
- [[analytics]] — privacy-first, opt-out usage analytics that POST anonymous events to the in-house Hermes analytics service, keyed by a per-install localStorage UUID; replaces the former PostHog integration.
- [[wallet-token-balances]] — profile-scoped Base mainnet wallets with encrypted recovery phrases, and on-chain ERC-20 token balance reads via ethers v6.
- [[office-3d-traffic]] — the Office tab's backdrop traffic: car-following and junction-yielding simulation, per-model nose orientation, and instanced fleet rendering in a dozen draw calls.
- [[office-3d-interiors]] — enterable office/bank/showroom interiors: per-location conditional mounting (city unmounts while indoors), camera fly-in rig, interactable objects (ATM → wallet, desk → agent, car → spec card), and idle-agent walking trips between buildings.
- [[office-3d-walk-mode]] — GTA-style walk mode: glass roofs over the enterable buildings, the user's own third-person avatar (WASD + chase camera, shared crowd/collision), doorway-driven interior loading, and proximity Press-E interactions.
- [[office-community]] — the shared Community chat panel: rooms per convention-center hall, live presence, a WebSocket relay (or same-device fallback), and strict validation of inbound frames.
- [[shared-office-runtime]] — canonical Desktop/Web Office rendering, authenticated remote-runtime routes and owner-bound plugin intent handoff without installation or permission grants.
- [[office-3d-convention-center]] — the city view's Los Angeles theme: convention-center exterior skin over the office block and the elevated hyperloop line with its scheduled pod.
- [[office-interactions]] — space representatives: interactive bank tellers whose menu runs account status, balances, and account creation against the hermes-one backend for a chosen agent; the extensible pattern for future spaces (showroom sales, building space).
- [[office-world-actions]] — chat-commanded errands: the agent's LLM emits world-action blocks from the office chat, its avatar walks the trip route to the bank/showroom, and the rep modal auto-opens running the requested action on arrival.
- [[mcp-servers]] — add / edit / remove / enable / test MCP servers from the Capabilities → MCP tab; the shared add+edit modal and the in-place atomic `updateMcpServer` upsert (config.yaml locally, gateway REST in Remote/SSH).
- [[scheduled-jobs]] — schedule state normalization across local files, remote API responses, and named SSH profiles.
- [[gateway-multiplex]] — which profiles the live default gateway already serves, so a multiplexed profile reads Running instead of Off and its Start action does not spawn a gateway the CLI refuses.

- [[dashboard-clarify]] — Interactive WebSocket clarification cards and answer delivery tests.
- [[cloud-workspace]] — one shared Web and Desktop workspace renderer with account-bound opt-in and main-process credential isolation.
- [[cloud-workspace-tests]] — consent, scope, owner, offline and account-switch safety tests for the cloud workspace adapter.

- [[canonical-chat]] — default Mithril API-only D1 sessions, explicit native import and native runtime boundaries.

- [[mithril-code]] — profile-scoped System One coding through the Hermes plugin CLI, source review and real execution receipts.

- [[language-typography]] — government-adopted default fonts, language switching and offline script fallbacks.
- [[endpoint-protection]] — local endpoint monitoring, bounded detection and signed definition delivery.

- [[tool-settings]] — selected connection and profile own tool settings, with remote metadata validation and no local fallback.
- [[gateway-tool-schemas]] — ephemeral, attached-turn schema observations use the common SDK hash and remain separate from execution admission and receipts.
- [[owned-tool-calls]] — shared SDK owned calls on an attached idle Chat session, lifecycle fences and actual client wire verification.
- [[tool-attempts]] — explicit attached-dashboard attempt metadata reads, unknown outcomes, bounded lifetime and mounted consumer verification.

- [[provider-memory-target]] — shared provider database, operation, fact and SQLite revision custody before owned execution.
