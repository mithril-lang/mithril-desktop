import { app } from "electron";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { NativeWorkspace } from "./native-workspace";
import {
  cloudWorkspace,
  onCloudWorkspaceAccountChanged,
} from "./cloud-workspace-runtime";
import { readMemory } from "./memory";
import { listProfiles } from "./profiles";
import { getToolsets } from "./tools";
import { listMcpServers } from "./mcp-servers";
import { listInstalledSkills } from "./skills";
import { listBoards, listTasks } from "./kanban";
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

export const nativeWorkspace = new NativeWorkspace({
  mode: () => getConnectionConfig().mode,
  context: () => cloudWorkspace.nativeContext(),
  namespace: importNamespace,
  now: Date.now,
  memory: readMemory,
  provider: (profile) => getConfigValue("memory.provider", profile),
  profiles: listProfiles,
  toolsets: getToolsets,
  servers: listMcpServers,
  skills: listInstalledSkills,
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
  locale: getAppLocale,
  locales: APP_LOCALES,
  setLocale: (locale) => {
    setAppLocale(locale as AppLocale);
  },
  snapshot: () => cloudWorkspace.getSnapshot(),
  operations: (operations) => cloudWorkspace.applyOperations(operations),
});
onCloudWorkspaceAccountChanged(() => nativeWorkspace.reset());
