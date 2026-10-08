import { app } from "electron";
import { lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { CloudChat } from "./cloud-chat";
import { CloudWorkspace } from "./cloud-workspace";
import { cloudChat, onCloudChatAccountChanged } from "./cloud-chat-runtime";
import { readCloudAccountToken } from "./mithril-token-store";
import { mithrilApiOrigin } from "./mithril-token";
import { getActiveProfileNameSync } from "./utils";
import { getConnectionConfig } from "./config";
import { HERMES_HOME } from "./installer";
import { profileMetadataInventory } from "./profile-metadata-inventory";
import {
  bindRepositorySource,
  repositorySourceOwned,
} from "./repository-kanban-runtime";
import { WorkspaceReplicationLoop } from "./original-schedule-replication-loop";
import {
  createNativeHistoryRuntime,
  serializeNativeHistory,
  synchronizeNativeHistory,
  resolveNativeHistoryTitle,
  resolveNativeHistoryModel,
  resolveNativeHistoryVisibility,
} from "./native-history-runtime";

import type {
  NativeHistorySync,
  NativeTitleResolution,
} from "./native-history-sync";
type HistoryReport = Awaited<ReturnType<NativeHistorySync["run"]>>;
type ProfileConflict = HistoryReport["titleConflicts"][number] & {
  profile: string;
};
export type AllProfileHistoryReport = Omit<
  HistoryReport,
  "titleConflicts" | "modelConflicts" | "visibilityConflicts"
> & {
  titleConflicts: ProfileConflict[];
  modelConflicts: ProfileConflict[];
  visibilityConflicts: ProfileConflict[];
};

/** Archive all owned original sources without selecting profiles or starting agent work. */
// @lat: [[cloud-workspace#All-profile automatic original history archival (draft)]]
export function startAllProfileHistoryReplication(): () => void {
  const loop = new WorkspaceReplicationLoop({
    changed: onCloudChatAccountChanged,
    create: async () => {
      let stopped = false;
      return {
        stop: () => {
          stopped = true;
        },
        sync: () =>
          synchronizeAllProfileHistories(false, () => {
            if (stopped) throw Error("History archival retired");
          }),
      };
    },
  });
  loop.start();
  return () => loop.stop();
}

async function ownedHistoryContext(retired: () => void): Promise<{
  context: Awaited<ReturnType<typeof cloudChat.auth.nativeContext>>;
  accountGuard: () => void;
  sources: ReturnType<typeof profileMetadataInventory>["sources"];
}> {
  await cloudChat.auth.enable();
  const context = await cloudChat.auth.nativeContext(true);
  const accountGuard = (): void => {
    retired();
    cloudChat.auth.assertNativeContext(context);
    if (getConnectionConfig().mode !== "local")
      throw Error("Original history source changed");
  };
  accountGuard();
  const bindings = join(app.getPath("userData"), "repository-source-owners");
  const inventory = profileMetadataInventory(
    HERMES_HOME,
    bindings,
    context.userId,
    (profile) => bindRepositorySource(bindings, profile, context.userId),
  );
  return { context, accountGuard, sources: inventory.sources };
}

function historyRootStat(
  path: string,
): NonNullable<ReturnType<typeof lstatSync>> | null {
  try {
    return lstatSync(path) ?? null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function ownedHistoryEngine(
  source: ReturnType<typeof profileMetadataInventory>["sources"][number],
  context: Awaited<ReturnType<typeof cloudChat.auth.nativeContext>>,
  accountGuard: () => void,
  cacheUnmappedRemote: boolean,
): Promise<{ engine: NativeHistorySync; guard: () => Promise<void> }> {
  accountGuard();
  if (!source.present && !cacheUnmappedRemote)
    throw Error("Original history source unavailable");
  const before = historyRootStat(source.root);
  const bindings = join(app.getPath("userData"), "repository-source-owners");
  const guard = async (): Promise<void> => {
    accountGuard();
    for (let path = source.root; ; path = dirname(path)) {
      if (historyRootStat(path)?.isSymbolicLink())
        throw Error("Unsafe history source");
      if (dirname(path) === path) break;
    }
    const current = historyRootStat(source.root);
    if (
      (current !== null && !current.isDirectory()) ||
      current?.ino !== before?.ino ||
      current?.dev !== before?.dev ||
      !repositorySourceOwned(bindings, source.profile, context.userId)
    )
      throw Error("History profile owner changed");
  };
  await guard();
  const client = new CloudChat(
    new CloudWorkspace({
      token: () => readCloudAccountToken(getActiveProfileNameSync()),
      profile: () => source.profile,
      origin: mithrilApiOrigin,
      fetch: (input, init) => fetch(input, init),
      changed: () => {},
      readScope: "chat:read",
      writeScope: "chat:write",
    }),
  );
  await client.auth.enable();
  const scoped = await client.auth.nativeContext(true);
  if (scoped.userId !== context.userId || scoped.actor !== context.actor)
    throw Error("History account changed");
  await guard();
  return {
    engine: createNativeHistoryRuntime(client, guard, cacheUnmappedRemote),
    guard,
  };
}

// @lat: [[cloud-workspace#All-profile history review without profile selection]]
export async function synchronizeAllProfileHistories(
  cacheSelectedRemote = true,
  retired: () => void = () => {},
): Promise<AllProfileHistoryReport> {
  if (cacheSelectedRemote && getConnectionConfig().mode !== "local") {
    const context = await cloudChat.auth.nativeContext(true);
    const report = await synchronizeNativeHistory();
    cloudChat.auth.assertNativeContext(context);
    return {
      ...report,
      titleConflicts: report.titleConflicts.map((row) => ({
        ...row,
        profile: context.profile,
      })),
      modelConflicts: report.modelConflicts.map((row) => ({
        ...row,
        profile: context.profile,
      })),
      visibilityConflicts: report.visibilityConflicts.map((row) => ({
        ...row,
        profile: context.profile,
      })),
    };
  }
  return serializeNativeHistory(async () => {
    const { context, accountGuard, sources } =
      await ownedHistoryContext(retired);
    const report: AllProfileHistoryReport = {
      userId: context.userId,
      synced: 0,
      reconstructed: 0,
      conflicts: [],
      titleConflicts: [],
      modelConflicts: [],
      visibilityConflicts: [],
      deferred: [],
    };
    for (const source of sources) {
      if (
        !source.present &&
        !(cacheSelectedRemote && source.profile === context.profile)
      )
        continue;
      accountGuard();
      try {
        const { engine, guard } = await ownedHistoryEngine(
          source,
          context,
          accountGuard,
          cacheSelectedRemote && source.profile === context.profile,
        );
        const result = await engine.run();
        await guard();
        if (result.userId !== context.userId)
          throw Error("History owner changed");
        report.synced += result.synced;
        report.reconstructed += result.reconstructed;
        report.conflicts.push(...result.conflicts);
        report.deferred.push(...result.deferred);
        for (const field of [
          "titleConflicts",
          "modelConflicts",
          "visibilityConflicts",
        ] as const)
          report[field].push(
            ...result[field].map((conflict) => ({
              ...conflict,
              profile: source.profile,
            })),
          );
      } catch {
        accountGuard();
        report.deferred.push("profile:" + source.profile);
      }
    }
    accountGuard();
    return report;
  });
}

// @lat: [[cloud-workspace#All-profile history review without profile selection]]
export async function resolveOwnedProfileHistory(
  request: NativeTitleResolution,
  field: "title" | "model" | "visibility",
): Promise<HistoryReport> {
  if (getConnectionConfig().mode !== "local")
    return field === "title"
      ? resolveNativeHistoryTitle(request)
      : field === "model"
        ? resolveNativeHistoryModel(request)
        : resolveNativeHistoryVisibility(request);
  return serializeNativeHistory(async () => {
    const captured = structuredClone(request);
    const { context, accountGuard, sources } = await ownedHistoryContext(
      () => {},
    );
    if (!captured || captured.userId !== context.userId)
      throw Error("History owner changed");
    const source = sources.find(
      (row) => row.present && row.profile === captured.profile,
    );
    if (!source) throw Error("Owned history profile unavailable");
    const { engine, guard } = await ownedHistoryEngine(
      source,
      context,
      accountGuard,
      false,
    );
    const result = await (field === "title"
      ? engine.resolveTitle(captured)
      : field === "model"
        ? engine.resolveModel(captured)
        : engine.resolveVisibility(captured));
    await guard();
    if (result.userId !== context.userId) throw Error("History owner changed");
    return result;
  });
}
