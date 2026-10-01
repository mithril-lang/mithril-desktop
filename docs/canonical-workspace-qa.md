# Canonical workspace draft verification

Desktop starts with the shared Mithril D1 Chat. Models and inference use the Mithril API; retained local provider configuration is quarantined from this path. Connection, inventory, history and resume never start inference. Explicit turns additionally require the existing inference authorization. No grants, deploys, releases, paid inference or real data migration were performed.

The canonical compiled workspace0.2 artifact includes Web/Desktop Chat and eight portable workspace views, plus explicit native runtime inspection and import. Its SHA256 is `171c37a0f8d8d9713fab13d73f808c58eb9f5cdfb09e83e16193b33c68b0d107`. The npm file dependency and SHA512 lock integrity match the artifact; npm verified the lock in an isolated temporary directory. Desktop does not copy shared UI source.

Actual native content, memory limits, installed capabilities, profile state and Kanban sources are inspected through narrow main-process adapters. Links open existing native 3D Office and other screens. Shared Desktop native Memory/configuration writes are explicitly unavailable because the existing file helpers cannot guarantee cross-process Agent locking. The original native editor remains available. Web sandbox runtime support differs and unsupported Office/3D/Kanban operations are explicitly reported; this draft does not claim complete browser parity for device execution.

Both portable workspace and session imports require a preview and selected confirmation. Previews bind owner, profile, credential identity and generation, expire, exclude known credential/path patterns and retain only sanitized projections. Native session imports map to a displayed available Mithril model and store completed history without execution. Existing canonical session history is never overwritten; a separate copy requires explicit confirmation. Operation IDs and receipts survive retries in the current window. Local histories and configuration files are never modified by import. Known-pattern filtering still requires human content review.

Final verification on the frozen artifact:

- Full Node/web typechecks, ESLint, Electron production build, packaging identity checks and `lat check` pass.
- Full local suite: 2,404 pass; one preexisting `config-health` `MODEL_KEY_MISSING` failure also reproduced on untouched baseline in phase1. The installed Node22 binary is broken; local QA uses Node26 with webstorage disabled. Existing phase1 CI used working Node22 successfully.
- New Desktop transport/import/runtime/stat-only migration/shared-renderer fixtures pass, including dedicated scopes, explicit consent, cached inventory without model probes, checkpoint ownership, stale account responses, default skip, no overwrite, confirmed copy, offline stable-operation-ID retry and CAS conflict.
- Independent review found no remaining actionable Desktop issues after unsafe cross-process native writes were disabled. Reviewer independently confirmed actual dual-adapter local D1 fixture tests (3/3).
- Production dependency audit: zero vulnerabilities.

The coordinated API session/workspace schema and dedicated scope definitions remain draft preparation. Activating persistent grants, deploying migrations, publishing Web or releasing Desktop requires separate authorization. No automatic import or local provider execution is implied by installing this artifact.
