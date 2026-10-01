# Canonical workspace draft verification

Desktop starts with the shared Mithril D1 Chat. Models and inference use the Mithril API; retained local provider configuration is quarantined from this path. Connection, inventory, history and resume never start inference. Explicit turns additionally require the existing inference authorization. No grants, deploys, releases, paid inference or real data migration were performed.

Canonical source: Fund commit `921bf7665846113748cf054a5055c7768a00ca62`, [paired draft PR317](https://github.com/mithril-lang/mithril-fund/pull/317).

The canonical compiled workspace0.3 artifact includes Web/Desktop Chat and eight portable workspace views, plus explicit native runtime inspection and import. Its SHA256 is `713c22659536873b2e27c08719cde600846f3dc1348194388819e2ef59fea619`. The npm file dependency and SHA512 lock integrity match the artifact; npm verified the lock in an isolated temporary directory. Desktop does not copy shared UI source.

Actual native content, memory limits, installed capabilities, profile state and Kanban sources are inspected through narrow main-process adapters. Office now reuses the canonical city/interior/WASD renderer and local assets. Native action buttons hand off to preserved native Office; other panels also link to existing native screens. Shared Desktop native Memory/configuration writes are explicitly unavailable because the existing file helpers cannot guarantee cross-process Agent locking. The original native editor remains available. Web sandbox runtime support differs and unsupported device/Kanban operations are explicitly reported; this draft does not claim complete browser parity for device execution.

Both portable workspace and session imports require a preview and selected confirmation. Previews bind owner, profile, credential identity and generation, expire, exclude known credential/path patterns and retain only sanitized projections. Native session imports map to a displayed available Mithril model and store completed history without execution. Existing canonical session history is never overwritten; a separate copy requires explicit confirmation. Operation IDs and receipts survive retries in the current window. Local histories and configuration files are never modified by import. Known-pattern filtering still requires human content review.

Phase2 baseline verification (phase3 results below):

- Full Node/web typechecks, ESLint, Electron production build, packaging identity checks and `lat check` pass.
- Full local suite: 2,404 pass; one preexisting `config-health` `MODEL_KEY_MISSING` failure also reproduced on untouched baseline in phase1. The installed Node22 binary is broken; local QA uses Node26 with webstorage disabled. Existing phase1 CI used working Node22 successfully.
- New Desktop transport/import/runtime/stat-only migration/shared-renderer fixtures pass, including dedicated scopes, explicit consent, cached inventory without model probes, checkpoint ownership, stale account responses, default skip, no overwrite, confirmed copy, offline stable-operation-ID retry and CAS conflict.
- Independent review found no remaining actionable Desktop issues after unsafe cross-process native writes were disabled. Reviewer independently confirmed actual dual-adapter local D1 fixture tests (3/3).
- Production dependency audit: zero vulnerabilities.

The coordinated API session/workspace schema and dedicated scope definitions remain draft preparation. Activating persistent grants, deploying migrations, publishing Web or releasing Desktop requires separate authorization. No automatic import or local provider execution is implied by installing this artifact.

Phase3 candidate adds real shared Office rendering, selected plugin handoff plans, remote runtime availability/tool-policy IPC and a private main-only native lease orchestrator. The latter is dependency-injected and fixture tested; no production runner is registered because the current gateway lacks pre-execution hooks and descendant-stop proof. Readiness therefore remains false and the original native screens remain usable. Ephemeral private lease tokens never cross renderer IPC. Runtime backend charges need selected revision-bound consent and tool-call/time limits; unknown rates do not imply a dollar cap.

See the [eight-screen difference and coordinated release matrix](https://github.com/mithril-lang/mithril-fund/blob/921bf7665846113748cf054a5055c7768a00ca62/docs/design/desktop-web-release-plan.md). Migrations0032–0035, the verified sandbox image, exact paired artifact and approved live QA remain separate release prerequisites. No paid QA was performed.

Phase3 final local evidence: full suite2,417 pass plus the same reproduced baseline MODEL_KEY_MISSING failure; packed Office fixtures pass after inline transformation, and the new native lease terminal-race regression also passes separately. Node/web typechecks, production build, packaging checks, lint, lat and production audit succeed. Paired actual Web/Desktop local-D1 fixtures pass5/5, including real transport tool receipts, lost acknowledgement and cross-client cancel. Office browser QA uses a fixture account and blocked external network, with zero POSTs before/after explicit inspection. Source review is independent; no paid execution or production configuration was used.
