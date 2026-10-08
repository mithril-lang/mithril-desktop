import { selectedSettingsScope } from "./selected-settings-scope";
import { getToolsets, setToolsetEnabled, type ToolsetInfo } from "./tools";
import { sshGetToolsets, sshSetToolsetEnabled } from "./ssh-remote";
import { remoteDashboardRequestJson } from "./remote-api";

function scopedPath(profile: string, key?: string): string {
  return `/api/tools/toolsets${key ? `/${encodeURIComponent(key)}` : ""}?profile=${encodeURIComponent(profile)}`;
}

function parseToolsets(value: unknown): ToolsetInfo[] {
  if (!Array.isArray(value) || value.length > 256) {
    throw new Error("Invalid remote tool-settings response.");
  }
  const seen = new Set<string>();
  return value.map((row) => {
    if (
      !row ||
      typeof row !== "object" ||
      typeof row.name !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(row.name) ||
      seen.has(row.name) ||
      typeof row.enabled !== "boolean" ||
      typeof row.label !== "string" ||
      row.label.length > 512 ||
      typeof row.description !== "string" ||
      row.description.length > 16384 ||
      (row.platform !== undefined && typeof row.platform !== "string") ||
      (row.configured !== undefined && typeof row.configured !== "boolean") ||
      (row.tools !== undefined &&
        (!Array.isArray(row.tools) ||
          row.tools.length > 1024 ||
          row.tools.some(
            (tool: unknown) =>
              typeof tool !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(tool),
          )))
    ) {
      throw new Error("Invalid remote tool-settings response.");
    }
    seen.add(row.name);
    return {
      key: row.name,
      label: row.label,
      description: row.description,
      enabled: row.enabled,
      platform: row.platform,
      configured: row.configured,
      tools: row.tools,
    };
  });
}

/** The selected connection owns settings; an unavailable remote never falls back locally. */
export async function getSelectedToolsets(
  profile?: string,
): Promise<ToolsetInfo[]> {
  const scope = selectedSettingsScope(profile);
  const conn = scope.connection;
  let result: ToolsetInfo[];
  if (conn.mode === "remote") {
    result = parseToolsets(
      await remoteDashboardRequestJson<unknown>(
        conn,
        scopedPath(scope.profile),
        { timeoutMs: 15_000 },
        scope.profile,
      ),
    );
  } else if (conn.mode === "ssh") {
    if (!conn.ssh?.host)
      throw new Error("SSH tool-settings target is not configured.");
    result = await sshGetToolsets(conn.ssh, scope.profile);
  } else {
    result = getToolsets(scope.profile);
  }
  scope.check();
  return result;
}

export async function setSelectedToolsetEnabled(
  key: string,
  enabled: boolean,
  profile?: string,
): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(key) || typeof enabled !== "boolean") {
    throw new Error("Invalid tool-settings change.");
  }
  const scope = selectedSettingsScope(profile);
  const conn = scope.connection;
  let result: boolean;
  if (conn.mode === "remote") {
    const ack = await remoteDashboardRequestJson<{
      ok?: boolean;
      name?: string;
      enabled?: boolean;
    }>(
      conn,
      scopedPath(scope.profile, key),
      {
        method: "PUT",
        body: { enabled, profile: scope.profile },
        timeoutMs: 15_000,
      },
      scope.profile,
    );
    if (
      !ack ||
      ack.ok !== true ||
      ack.name !== key ||
      ack.enabled !== enabled
    ) {
      throw new Error(
        "Remote tool-settings change has no matching acknowledgement; refresh before retrying.",
      );
    }
    result = true;
  } else if (conn.mode === "ssh") {
    if (!conn.ssh?.host)
      throw new Error("SSH tool-settings target is not configured.");
    result = await sshSetToolsetEnabled(conn.ssh, key, enabled, scope.profile);
  } else {
    result = setToolsetEnabled(key, enabled, scope.profile);
  }
  scope.check();
  return result;
}
