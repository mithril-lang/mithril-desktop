import { readMithrilToken } from "./mithril-token-store";
import { app } from "electron";
import { dirname, join } from "node:path";
import { lstatSync } from "node:fs";
import {
  profileMetadataInventory,
  type ProfileMetadataSource,
} from "./profile-metadata-inventory";
import {
  cloudWorkspace,
  onCloudWorkspaceAccountChanged,
} from "./cloud-workspace-runtime";
import { getConnectionConfig, getConfigValue } from "./config";
import { getActiveProfileNameSync, profileHome } from "./utils";
import { HERMES_PYTHON, HERMES_HOME } from "./installer";
import {
  bindRepositorySource,
  repositorySourceOwned,
} from "./repository-kanban-runtime";
import {
  readOriginalCronSource,
  prepareOriginalCronSource,
  prepareOriginalCronTransition,
  restoreOriginalCronSource,
  prepareOriginalCronExecution,
  bindOriginalCronExecution,
  runOriginalCronSource,
  inspectOriginalCronSource,
} from "./cronjobs";
import { OriginalScheduleReplication } from "./original-schedule-replication";
import type { OriginalScheduleManualConsumer } from "./original-schedule-manual-consumer";
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
async function authenticatedContext(): Promise<Awaited<
  ReturnType<typeof cloudWorkspace.nativeContext>
> | null> {
  if (getConnectionConfig().mode !== "local") return null;
  const status = await cloudWorkspace.status();
  if (!status.userId) return null;
  await cloudWorkspace.enable();
  const context = await cloudWorkspace.nativeContext(true);
  if (context.profile !== (getActiveProfileNameSync() || "default"))
    throw Error("Schedule profile changed");
  return context;
}
async function createEngine(
  original?: ProfileMetadataSource,
  captured?: Awaited<ReturnType<typeof cloudWorkspace.nativeContext>>,
): Promise<OriginalScheduleReplication | null> {
  const context = captured ?? (await authenticatedContext());
  if (!context) return null;
  cloudWorkspace.assertNativeContext(context);
  const selectedProfile = context.profile;
  const profile = original?.profile ?? selectedProfile;
  const home = original?.root ?? profileHome(profile);
  const directory = original ? lstatSync(home) : null;
  if (
    original &&
    (!original.present ||
      !directory?.isDirectory() ||
      directory.isSymbolicLink())
  )
    throw Error("Schedule profile unavailable");
  const assertActive = async (): Promise<void> => {
    cloudWorkspace.assertNativeContext(context);
    if (
      getConnectionConfig().mode !== "local" ||
      (getActiveProfileNameSync() || "default") !== selectedProfile ||
      (getConfigValue("timezone", profile)?.trim() ||
        Intl.DateTimeFormat().resolvedOptions().timeZone) !== timeZone
    )
      throw Error("Schedule profile changed");
    if (directory) {
      for (let path = home; ; path = dirname(path)) {
        if (lstatSync(path).isSymbolicLink())
          throw Error("Unsafe schedule profile directory");
        if (dirname(path) === path) break;
      }
      if (
        !repositorySourceOwned(
          join(app.getPath("userData"), "repository-source-owners"),
          profile,
          context.userId,
        )
      )
        throw Error("Schedule profile owner changed");
      const current = lstatSync(home);
      if (
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        current.ino !== directory.ino ||
        current.dev !== directory.dev
      )
        throw Error("Schedule profile directory changed");
    }
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
    home,
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
    custody: async (command) => {
      await assertActive();
      if (command.profile !== profile)
        throw Error("Schedule custody profile changed");
      const result = await cloudWorkspace.originalScheduleCustody(
        command,
        original ? context : undefined,
      );
      await assertActive();
      return result;
    },
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
            const context = await authenticatedContext();
            if (!context)
              return {
                status: "deferred" as const,
                reason: "schedule-not-connected",
              };
            const bindings = join(
              app.getPath("userData"),
              "repository-source-owners",
            );
            const inventory = profileMetadataInventory(
              HERMES_HOME,
              bindings,
              context.userId,
              (profile) =>
                bindRepositorySource(bindings, profile, context.userId),
            );
            let incomplete = inventory.warnings.length > 0;
            for (const source of inventory.sources) {
              if (!source.present) continue;
              cloudWorkspace.assertNativeContext(context);
              if (stopped) throw Error("Schedule lifecycle stopped");
              try {
                engine = await createEngine(source, context);
                if (stopped) throw Error("Schedule lifecycle stopped");
                if ((await engine?.sync())?.status !== "synced")
                  incomplete = true;
              } catch {
                cloudWorkspace.assertNativeContext(context);
                if (stopped) throw Error("Schedule lifecycle stopped");
                incomplete = true;
              } finally {
                engine?.stop();
                engine = null;
              }
            }
            return incomplete ||
              !inventory.sources.some((source) => source.present)
              ? {
                  status: "deferred" as const,
                  reason: "schedule-profiles-unconfirmed",
                }
              : { status: "synced" as const };
          }),
      };
    },
  });
  // A separate lifecycle keeps long Agent work out of the replication poller.
  const manual = new OriginalScheduleReplicationLoop({
    changed: onCloudWorkspaceAccountChanged,
    create: async () => {
      let stopped = false;
      let engine: OriginalScheduleReplication | null = null;
      let consumer: OriginalScheduleManualConsumer | null = null;
      return {
        stop: () => {
          stopped = true;
          consumer?.stop();
          engine?.stop();
        },
        sync: async () => {
          engine = await serial(createEngine);
          if (stopped) {
            engine?.stop();
            throw Error("Manual schedule lifecycle stopped");
          }
          if (!engine)
            return {
              status: "deferred" as const,
              reason: "schedule-not-connected",
            };
          const active = engine;
          consumer = active.manualConsumer({
            command: (command) =>
              cloudWorkspace.originalScheduleManual(command),
            run: (request) =>
              runOriginalCronSource(request, () =>
                active.assertScreenScope(request.profile),
              ),
            inspect: (request) =>
              inspectOriginalCronSource(request, () =>
                active.assertScreenScope(request.profile),
              ),
            serialize: serial,
          });
          try {
            await consumer.poll();
            return { status: "synced" as const };
          } finally {
            // Original output/counters are ordinary data on the existing outbox.
            if (!stopped) await serial(() => active.sync()).catch(() => {});
            active.stop();
          }
        },
      };
    },
  });
  loop.start();
  manual.start();
  return () => {
    manual.stop();
    loop.stop();
  };
}
