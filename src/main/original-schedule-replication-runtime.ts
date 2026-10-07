import { readMithrilToken } from "./mithril-token-store";
import { app } from "electron";
import { join } from "node:path";
import {
  cloudWorkspace,
  onCloudWorkspaceAccountChanged,
} from "./cloud-workspace-runtime";
import { getConnectionConfig, getConfigValue } from "./config";
import { getActiveProfileNameSync, profileHome } from "./utils";
import { HERMES_PYTHON } from "./installer";
import { bindRepositorySource } from "./repository-kanban-runtime";
import {
  readOriginalCronSource,
  prepareOriginalCronSource,
  prepareOriginalCronTransition,
  restoreOriginalCronSource,
  prepareOriginalCronExecution,
  bindOriginalCronExecution,
} from "./cronjobs";
import { OriginalScheduleReplication } from "./original-schedule-replication";
import { OriginalScheduleReplicationLoop } from "./original-schedule-replication-loop";

// One lane for the lifecycle poller and original screen operations.
let lane: Promise<void> = Promise.resolve();
function serial<T>(run: () => Promise<T>): Promise<T> {
  const next = lane.then(run);
  lane = next.then(
    () => {},
    () => {},
  );
  return next;
}
async function createEngine(): Promise<OriginalScheduleReplication | null> {
  if (getConnectionConfig().mode !== "local") return null;
  const status = await cloudWorkspace.status();
  if (!status.userId) return null;
  await cloudWorkspace.enable();
  const context = await cloudWorkspace.nativeContext(true);
  const profile = getActiveProfileNameSync() || "default";
  if (context.profile !== profile) throw Error("Schedule profile changed");
  const assertActive = async (): Promise<void> => {
    cloudWorkspace.assertNativeContext(context);
    if (
      getConnectionConfig().mode !== "local" ||
      (getActiveProfileNameSync() || "default") !== profile ||
      (getConfigValue("timezone", profile)?.trim() ||
        Intl.DateTimeFormat().resolvedOptions().timeZone) !== timeZone
    )
      throw Error("Schedule profile changed");
  };
  const stateRoot = join(app.getPath("userData"), "mithril-original-schedules");
  bindRepositorySource(
    join(stateRoot, "source-owners"),
    profile,
    context.userId,
  );
  const timeZone =
    getConfigValue("timezone", profile)?.trim() ||
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new OriginalScheduleReplication({
    scope: { owner: context.userId, profile, timeZone },
    home: profileHome(profile),
    stateRoot,
    python: HERMES_PYTHON,
    repository: {
      page: (collection, after) =>
        cloudWorkspace.repositoryPage(collection, after),
      apply: (edit) => cloudWorkspace.repositoryApply(edit),
      history: (collection, id, before) =>
        cloudWorkspace.repositoryHistory(collection, id, before),
    },
    resources: cloudWorkspace.scheduleResources,
    parser: {
      prepareCreate: async (request) => {
        await assertActive();
        if (
          request.owner !== context.userId ||
          request.profile !== profile ||
          request.timeZone !== timeZone
        )
          throw Error("Schedule preparation identity changed");
        const result = await prepareOriginalCronSource(request);
        await assertActive();
        if (!result.success) throw Error(result.error);
        return result.preparation;
      },
      prepareTransition: async (request) => {
        await assertActive();
        if (
          request.owner !== context.userId ||
          request.profile !== profile ||
          request.timeZone !== timeZone
        )
          throw Error("Schedule preparation identity changed");
        const result = await prepareOriginalCronTransition(request);
        await assertActive();
        if (!result.success) throw Error(result.error);
        return result.preparation;
      },
    },
    native: {
      capture: readOriginalCronSource,
      restore: restoreOriginalCronSource,
    },
    prepare: (input) => prepareOriginalCronExecution(input, assertActive),
    bind: (input) => bindOriginalCronExecution(input, assertActive),
    custody: (command) => cloudWorkspace.originalScheduleCustody(command),
    assertActive,
  });
}

/** Original screen actions use the same authenticated mirror and required Agent policy lane. */
// @lat: [[cloud-workspace#Original Schedules screen mirror (draft)]]
export function runOriginalScheduleScreen<T>(
  profile: string | undefined,
  action: () => Promise<T>,
  kind: "read" | "edit" | "execute",
): Promise<T> {
  const requestedProfile = getActiveProfileNameSync() || "default";
  const requestedToken = readMithrilToken(requestedProfile);
  const checkRequest = (): void => {
    if (
      (getActiveProfileNameSync() || "default") !== requestedProfile ||
      readMithrilToken(requestedProfile) !== requestedToken
    )
      throw Error(
        "Workspace account changed; queued schedule action discarded",
      );
  };
  return serial(async () => {
    checkRequest();
    const engine = await createEngine();
    if (!engine) throw Error("Sign in to your Mithril account first");
    try {
      await engine.assertScreenScope(profile);
      try {
        const before = await engine.sync();
        if (kind !== "read" && before.status !== "synced")
          throw Error("Schedule synchronization requires review");
      } catch (error) {
        if (kind !== "read") throw error;
        // Read the owner-bound original mirror during an outage or conflict.
        // Editing/execution never inherits this read-only recovery path.
      }
      checkRequest();
      await engine.assertScreenScope(profile);
      if (kind === "execute") await engine.assertSelectedExecution();
      const result = await action();
      checkRequest();
      await engine.assertScreenScope(profile);
      if (kind === "edit") {
        // The original write is already committed. Keep its result if network
        // confirmation fails; the durable source/outbox is retried by the lifecycle.
        try {
          await engine.sync();
        } catch {
          await engine.assertScreenScope(profile);
        }
      }
      return result;
    } finally {
      engine.stop();
    }
  });
}

/** Starts after secure profile credentials are registered. API grants remain mandatory. */
// @lat: [[cloud-workspace#Automatic original schedule replication (draft)]]
export function startOriginalScheduleReplication(): () => void {
  const loop = new OriginalScheduleReplicationLoop({
    changed: onCloudWorkspaceAccountChanged,
    create: async () => {
      let stopped = false;
      let engine: OriginalScheduleReplication | null = null;
      return {
        stop: () => {
          stopped = true;
          engine?.stop();
        },
        sync: () =>
          serial(async () => {
            if (stopped) throw Error("Schedule lifecycle stopped");
            engine = await createEngine();
            if (stopped) {
              engine?.stop();
              throw Error("Schedule lifecycle stopped");
            }
            try {
              return (
                (await engine?.sync()) ?? {
                  status: "deferred" as const,
                  reason: "schedule-not-connected",
                }
              );
            } finally {
              engine?.stop();
            }
          }),
      };
    },
  });
  loop.start();
  return () => loop.stop();
}
