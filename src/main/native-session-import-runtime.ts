import {
  NativeSessionImport,
  type LocalSessionProjection,
} from "./native-session-import";
import { cloudChat, onCloudChatAccountChanged } from "./cloud-chat-runtime";
import { importNamespace } from "./native-workspace-runtime";
import { listSessions } from "./sessions";
import { getDbConnection } from "./db";
import { getConnectionConfig } from "./config";

function localProjection(profile: string): LocalSessionProjection[] {
  if (getConnectionConfig().mode !== "local")
    throw new Error(
      "Native import requires explicit local connection; no remote history is scanned",
    );
  const db = getDbConnection(true, profile);
  if (!db) return [];
  try {
    return listSessions(50, 0, profile).map((session) => {
      // No images, attachments, provider configuration, paths, or runnable tool calls are read.
      const rows = db
        .prepare(
          "SELECT role, content, tool_call_id FROM messages WHERE session_id = ? AND role IN ('user','assistant','tool') ORDER BY timestamp,id LIMIT 501",
        )
        .all(session.id) as {
        role: "user" | "assistant" | "tool";
        content: string;
        tool_call_id: string | null;
      }[];
      return {
        id: session.id,
        title: session.title || "Imported local history",
        ended:
          session.endedAt !== null &&
          rows.every(
            (row) =>
              typeof row.content === "string" &&
              !row.content.includes("\u0000"),
          ),
        messages: rows.map((row) =>
          row.role === "tool"
            ? {
                role: row.role,
                content: row.content,
                toolCallId: row.tool_call_id || undefined,
                state: "completed" as const,
              }
            : { role: row.role, content: row.content },
        ),
      };
    });
  } catch {
    throw new Error(
      "Local history projection unavailable; all local files retained",
    );
  }
}
export const nativeSessionImport = new NativeSessionImport({
  context: () => cloudChat.auth.nativeContext(),
  namespace: importNamespace,
  now: Date.now,
  local: localProjection,
  models: () => cloudChat.models(),
  sessions: async () => (await cloudChat.list()).sessions,
  apply: (id, operation) => cloudChat.apply(id, operation),
});
onCloudChatAccountChanged(() => nativeSessionImport.reset());
