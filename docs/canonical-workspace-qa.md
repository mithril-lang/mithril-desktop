# Canonical workspace draft verification

Desktop starts with the shared Mithril D1 Chat. Models and inference use the Mithril API; retained local provider configuration is quarantined from this path. Connection, inventory, history and resume never start inference. Explicit turns additionally require the existing inference authorization. No grants, deploys, releases, paid inference or real data migration were performed.

Canonical source: Fund commit `893ae441dae67d8fb6806e92a5f041e33279a152`, [paired draft PR317](https://github.com/mithril-lang/mithril-fund/pull/317).

The canonical compiled workspace0.3.1 artifact includes Web/Desktop Chat and eight portable workspace views, plus explicit native runtime inspection and import. Its SHA256 is `04324f87f3e7dbff3ec596e40c2809305eaee42c3c2eedcb35545c055bcdb7a5`. The npm file dependency and SHA512 lock integrity match the artifact; npm verified the lock in an isolated temporary directory. Desktop does not copy shared UI source.

Actual native content, memory limits, installed capabilities, profile state and Kanban sources are inspected through narrow main-process adapters. Office reuses the canonical city/interior/WASD renderer and local assets. Native action buttons hand off to preserved native Office. POSIX native Memory edits now share Hermes file locks and compare the captured raw snapshot under lock; native editors use the same protocol. Shared Windows Memory editing stays unavailable pending equivalent directory-handle safety, while native byte-lock editing remains. Capability configuration, grants and installation retain their native reviewed flows. This draft does not claim complete browser parity for device execution.

Both portable workspace and session imports require a preview and selected confirmation. Previews bind owner, profile, credential identity and generation, expire, exclude known credential/path patterns and retain only sanitized projections. Native session imports map to a displayed available Mithril model and store completed history without execution. Existing canonical session history is never overwritten; a separate copy requires explicit confirmation. Operation IDs and receipts survive retries in the current window. Local histories and configuration files are never modified by import. Known-pattern filtering still requires human content review.

Phase2 baseline verification (phase3 results below):

- Full Node/web typechecks, ESLint, Electron production build, packaging identity checks and `lat check` pass.
- Full local suite: 2,404 pass; one preexisting `config-health` `MODEL_KEY_MISSING` failure also reproduced on untouched baseline in phase1. The installed Node22 binary is broken; local QA uses Node26 with webstorage disabled. Existing phase1 CI used working Node22 successfully.
- New Desktop transport/import/runtime/stat-only migration/shared-renderer fixtures pass, including dedicated scopes, explicit consent, cached inventory without model probes, checkpoint ownership, stale account responses, default skip, no overwrite, confirmed copy, offline stable-operation-ID retry and CAS conflict.
- Independent review found no remaining actionable Desktop issues after unsafe cross-process native writes were disabled. Reviewer independently confirmed actual dual-adapter local D1 fixture tests (3/3).
- Production dependency audit: zero vulnerabilities.

The coordinated API session/workspace schema and dedicated scope definitions remain draft preparation. Activating persistent grants, deploying migrations, publishing Web or releasing Desktop requires separate authorization. No automatic import or local provider execution is implied by installing this artifact.

Phase3 candidate adds real shared Office rendering, selected plugin handoff plans, remote runtime availability/tool-policy IPC and a private main-only native lease orchestrator. The latter is dependency-injected and fixture tested; no production runner is registered because the current gateway lacks pre-execution hooks and descendant-stop proof. Readiness therefore remains false and the original native screens remain usable. Ephemeral private lease tokens never cross renderer IPC. Runtime backend charges need selected revision-bound consent and tool-call/time limits; unknown rates do not imply a dollar cap.

See the [eight-screen difference and coordinated release matrix](https://github.com/mithril-lang/mithril-fund/blob/893ae441dae67d8fb6806e92a5f041e33279a152/docs/design/desktop-web-release-plan.md). Migrations0032–0035, the verified sandbox image, exact paired artifact and approved live QA remain separate release prerequisites. No paid QA was performed.

Phase3 final local evidence: full suite2,417 pass plus the same reproduced baseline MODEL_KEY_MISSING failure; packed Office fixtures pass after inline transformation, and the new native lease terminal-race regression also passes separately. Node/web typechecks, production build, packaging checks, lint, lat and production audit succeed. Paired actual Web/Desktop local-D1 fixtures pass5/5, including real transport tool receipts, lost acknowledgement and cross-client cancel. Office browser QA uses a fixture account and blocked external network, with zero POSTs before/after explicit inspection. Source review is independent; no paid execution or production configuration was used.

Phase4 adds actual current-board task title/body/priority editing with SQLite full-row CAS and atomic native edited/reprioritized events. It never changes assignment, lifecycle, dispatch or archive. POSIX shared/native Memory writers now share exact Hermes locks, anchored no-follow file operations, captured original content and config fingerprint checks. Existing native editors/ProfileModal capture their base before editing. Unsupported Windows shared editing remains explicit, while the native byte-lock path is preserved.

Both existing desktop.json writer paths compare the original document under a short-lived exclusive lock before atomic replacement; locale global state changes only after persistence succeeds. A writer crash can leave the lock. Recovery requires closing all Desktop instances before removing only the stale desktop.json.desktop-lock; no automatic unlock risks concurrent writes. No startup or single-instance restriction was added.

The actual native runner remains blocked by current Mac process containment, not a missing paid-QA budget. See [guarded native runner conditions](guarded-native-runner-conditions.md) for concrete upstream/runtime and proof requirements. Web Kanban plugin REST exists, but authenticated atomic revisions/schema and sandbox global-board durability are not verified; this candidate does not enable those writes.

Phase4 final local validation: Desktop2438 pass with only the previously reproduced local Node26 config-health baseline failure; types, lint, lat, production build and packaging pass. Web706, shared35, API runtime9 and actual dual-adapter5 pass. Independent Desktop25 and RuntimePanel8 pass with no remaining material review finding. Vendor0.3.1 and installed dist match exactly.


2026-10-09 candidate: original Settings Data uses the same execution-review UI/controller as Web. IPC exposes fixed, validated owner-scoped history/review routes; the secure-store bearer remains in main. Durable decisions retain ID, generation, effect and note after a lost acknowledgement. Original outcomes remain unknown; a review never starts work. Actual authenticated installed UI and production API/D1 qualification remain pending.

Preview.69 consumes shared schedules.62. All473 producer/archive/installed dependency files match; SHA256 `e3be2735d76d6b7fcff6194beee9835b304ccdb3898e21075114bd80876fc3fa`. Native main/Data90 tests, node/renderer types, build, packaging711 runtime files, affected lint and lat pass. The actual installed /Applications app remains a separate gate; this candidate is not released or installed.
