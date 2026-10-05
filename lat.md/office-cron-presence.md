# Cron presence

The Office reads each profile's cron scheduler so a cron-driven bot's day of work — an attempt in flight, a run that failed, the next run — shows on its nameplate and in its details, instead of every bot standing idle.

This fork's fleet is ~90 profiles that each run one daily Hermes cron job and hold no resident gateway. Upstream's rule ([[src/renderer/src/screens/Office/office3d/agents.ts]]: a running Kanban card, else gateway liveness, else idle) drew all of them amber all day, and on 2026-09-22 drew the 57 whose morning run had failed (`screen-route-refused`, an api.kotoba.cloud outage) the same amber as the 25 that had succeeded. Measured that day.

## Reading a profile's cron state

[[src/main/profile-cron.ts#readProfileCronState]] folds each profile's enabled cron jobs into one state.

It reads `<profile>/cron/jobs.json` for the latest run and status, soonest next run, and failed job names. [[src/main/profile-cron.ts#countRunningExecutions]] counts `claimed` / `running` rows in `cron/executions.db` read-only. A profile without a cron directory is `null`; unreadable jobs are zero jobs without throwing. `listProfiles` carries the state as `cron` on local profiles.

## Status rule

[[src/renderer/src/screens/Office/office3d/agents.ts]] maps in-flight, failed, and successful cron jobs to working, error, and idle.

A running Kanban card, or a live gateway when Kanban is unavailable, still wins. Cron speaks only when the prior rule would say idle; profiles without enabled jobs keep the prior rule. The sidebar in [[src/renderer/src/screens/Office/Office.tsx#Office]] shows counts, last run, error, and next run.

## Deferring a restart

Writing a credential can restart a gateway and kill an active cron job; incidental restarts wait for an idle profile.

Hermes reported `Gateway shutdown (<phase>) killed the job's tool subprocess before the run finished.` On 2026-09-22, three profiles lost a daily run this way, one of them twice, while about ten cron jobs were active across the fleet.

[[src/main/gateway-restart-defer.ts#restartGatewayWhenIdle]] holds an **incidental** restart until [[src/main/profile-cron.ts#countRunningExecutions]] reads zero for that profile, polling every 15 s for up to 10 minutes, then restarting anyway — a gateway holding a stale credential is its own failure, and waiting forever would hide it. One deferral per profile, so a burst of env writes queues one restart rather than several. The nine incidental call sites in [[src/main/ipc/register.ts#registerIpcHandlers]] (env writes, model/provider changes, auxiliary config, platform config, this fork's Kotoba Cloud sign-in) route through it; the `restart-gateway` IPC the person triggers from Settings does not — a restart asked for happens when it is asked for. An unreadable `executions.db` reads as idle, so one broken file cannot freeze every future restart.

## Tests

[[src/main/profile-cron.test.ts]] verifies cron-state folding with real temporary files and a sqlite database.

[[src/main/gateway-restart-defer.test.ts]] checks immediate, deferred, capped, coalesced, and independent restarts with injected time and probes. [[src/renderer/src/screens/Office/office3d/agents.test.ts]] checks working, error, idle, Kanban and gateway priority, unchanged non-cron behavior, and re-rendering when cron state changes.

## Abandoned installer work

Agent updates ignore claimed/running cron rows only when their owner PID is confirmed absent. Unknown owners, permission errors, legacy schemas, and pending handoffs remain busy; the ledger is never rewritten by the installer.

[[src/main/gateway-restart-defer.ts#executionOwnerMayBeActive]] checks owners with signal zero. PID reuse conservatively delays an update. The installer waits at most two minutes, then reports a retryable failure without terminating work. Installation UI calls the packaged runtime Mithril Agent while preserving Hermes-compatible paths and APIs.
