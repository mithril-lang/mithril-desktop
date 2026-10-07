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
  restoreOriginalCronSource,
  prepareOriginalCronExecution,
  bindOriginalCronExecution,
} from "./cronjobs";
import { OriginalScheduleReplication } from "./original-schedule-replication";
import { OriginalScheduleReplicationLoop } from "./original-schedule-replication-loop";

/** Starts after secure profile credentials are registered. API grants remain mandatory. */
// @lat: [[cloud-workspace#Automatic original schedule replication (draft)]]
export function startOriginalScheduleReplication(): () => void {
  const loop = new OriginalScheduleReplicationLoop({
    changed: onCloudWorkspaceAccountChanged,
    create: async () => {
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
          (getActiveProfileNameSync() || "default") !== profile
        )
          throw Error("Schedule profile changed");
      };
      const stateRoot = join(
        app.getPath("userData"),
        "mithril-original-schedules",
      );
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
        native: {
          capture: readOriginalCronSource,
          restore: restoreOriginalCronSource,
        },
        prepare: (input) => prepareOriginalCronExecution(input, assertActive),
        bind: (input) => bindOriginalCronExecution(input, assertActive),
        custody: (command) => cloudWorkspace.originalScheduleCustody(command),
        assertActive,
      });
    },
  });
  loop.start();
  return () => loop.stop();
}
