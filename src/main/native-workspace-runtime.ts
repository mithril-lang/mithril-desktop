import { fetchRegistry, listInstalledPluginNames } from "./registry";
import { portableNativeText } from "./native-workspace";
import type { RuntimePluginSummary } from "@mithril/workspace/runtime";
import { app } from "electron";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { NativeWorkspace } from "./native-workspace";
import {
  cloudWorkspace,
  onCloudWorkspaceAccountChanged,
} from "./cloud-workspace-runtime";
import { readMemory, applyMemoryMutation } from "./memory";
import { listProfiles } from "./profiles";
import { getToolsets } from "./tools";
import { listMcpServers } from "./mcp-servers";
import { listInstalledSkills } from "./skills";
import { listBoards, listTasks } from "./kanban";
import { NativeKanbanStore } from "./native-kanban-store";
import { HERMES_HOME } from "./installer";
import { getConnectionConfig, getConfigValue } from "./config";
import { getAppLocale, setAppLocale } from "./locale";
import { APP_LOCALES, type AppLocale } from "../shared/i18n";

/** Created only on an explicit preview. An opaque installation namespace is never sent directly. */
export function importNamespace(): string {
  const file = join(
    app.getPath("userData"),
    "mithril-workspace-import-namespace",
  );
  if (!existsSync(file)) {
    try {
      writeFileSync(file, randomUUID(), { mode: 0o600, flag: "wx" });
    } catch {
      /* another explicit preview may have initialized it */
    }
  }
  const value = readFileSync(file, "utf8").trim();
  if (!/^[a-f0-9-]{36}$/.test(value))
    throw new Error("Native import identity unavailable; no records imported");
  return value;
}

const kanbanStore = new NativeKanbanStore(
  process.env.HERMES_KANBAN_HOME?.trim() || HERMES_HOME,
  process.env.HERMES_KANBAN_BOARD ?? "",
);
function checkedKanbanStore(): NativeKanbanStore {
  if (process.env.HERMES_KANBAN_DB?.trim())
    throw new Error(
      "Custom native Kanban database override requires the existing native screen",
    );
  return kanbanStore;
}
export const nativeWorkspace = new NativeWorkspace({
  mode: () => getConnectionConfig().mode,
  context: () => cloudWorkspace.nativeContext(),
  namespace: importNamespace,
  now: Date.now,
  memory: readMemory,
  ...(process.platform !== "win32"
    ? {
        memoryApply: (
          profile: string,
          mutation: Parameters<typeof applyMemoryMutation>[0],
          expected: Parameters<typeof applyMemoryMutation>[1],
        ) => applyMemoryMutation(mutation, expected, profile),
      }
    : {}),
  provider: (profile) => getConfigValue("memory.provider", profile),
  profiles: listProfiles,
  toolsets: getToolsets,
  servers: listMcpServers,
  skills: listInstalledSkills,
  plugins: async (profile) => {
    const names = listInstalledPluginNames(profile).filter(
      (name) => /^[A-Za-z0-9_-]{1,64}$/.test(name) && portableNativeText(name),
    );
    const catalog = await fetchRegistry();
    const plugins: RuntimePluginSummary[] = names.map((name) => ({
      key: name,
      name,
      description: "",
      version: "",
      installed: true,
      source: "installed",
      deviceRequired: true,
      reason:
        "Installed directory detected. Enabled state and permissions are not inferred; inspect in native Discover.",
    }));
    for (const item of catalog.plugins.filter(
      (item) => item.registry === "mithril",
    )) {
      if (
        !/^[A-Za-z0-9_-]{1,64}(?:[/:][A-Za-z0-9_-]{1,64})?$/.test(item.id) ||
        !portableNativeText(item.name)
      )
        continue;
      const installed = plugins.find((plugin) => plugin.key === item.id);
      const projected: RuntimePluginSummary = {
        key: item.id,
        name: item.name,
        description: portableNativeText(item.description)
          ? item.description
          : "Catalog description excluded; review native source.",
        version: portableNativeText(item.version ?? "")
          ? (item.version ?? "")
          : "",
        installed: Boolean(installed),
        source: "catalog",
        deviceRequired: true,
        reason:
          "Catalog preview only. Installation and device permissions require a separately authorized native flow.",
        ...(item.artifact?.commit && /^[a-f0-9]{40}$/.test(item.artifact.commit)
          ? { catalogRevision: item.artifact.commit }
          : {}),
      };
      if (installed) plugins[plugins.indexOf(installed)] = projected;
      else plugins.push(projected);
    }
    return plugins;
  },
  boards: async (profile) => {
    const result = await listBoards(false, profile);
    if (!result.success)
      throw new Error("Native Kanban boards unavailable; no records imported");
    return result.data ?? [];
  },
  tasks: async (profile) => {
    const result = await listTasks({ profile });
    if (!result.success)
      throw new Error("Native Kanban tasks unavailable; no records imported");
    return result.data ?? [];
  },
  kanbanState: () => checkedKanbanStore().read(),
  kanbanChange: (revision, taskId, change) =>
    checkedKanbanStore().change(revision, taskId, change),
  locale: getAppLocale,
  locales: APP_LOCALES,
  setLocale: (locale) => {
    setAppLocale(locale as AppLocale);
  },
  snapshot: () => cloudWorkspace.getSnapshot(),
  operations: (operations) => cloudWorkspace.applyOperations(operations),
});
onCloudWorkspaceAccountChanged(() => nativeWorkspace.reset());
