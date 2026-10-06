import { app } from "electron";
import { createHash, randomUUID } from "crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  fsyncSync,
  closeSync,
  unlinkSync,
} from "fs";
import { dirname, join, resolve, basename } from "path";
import { cloudChat } from "./cloud-chat-runtime";
import { getConnectionConfig } from "./config";
import { getDbConnection } from "./db";
import { activeStateDbPath } from "./utils";
import { getSessionMessages, listSessions, type HistoryItem } from "./sessions";
import { bindRepositorySource } from "./repository-kanban-runtime";
import {
  NativeHistorySync,
  type NativeHistoryJournal,
} from "./native-history-sync";
import { digestBytes, syncablePath } from "@mithril/workspace/files";
import {
  writeHistoryAttachment,
  type ArchivedHistoryItem,
  type HistoryAttachment,
} from "@mithril/workspace/history";
import type { Attachment } from "../shared/attachments";
const root = (): string => join(app.getPath("userData"), "history-replication");
function checked(path: string): void {
  let current = resolve(path);
  for (;;) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw Error("Unsafe history storage");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function journalPath(owner: string, profile: string): string {
  checked(root());
  mkdirSync(root(), { recursive: true, mode: 0o700 });
  const file = join(
    root(),
    createHash("sha256")
      .update(JSON.stringify([owner, profile]))
      .digest("hex") + ".json",
  );
  checked(file);
  return file;
}
function read(owner: string, profile: string): NativeHistoryJournal {
  const file = journalPath(owner, profile);
  if (!existsSync(file)) return { entries: {} };
  if (!lstatSync(file).isFile() || lstatSync(file).size > 64 * 1024 * 1024)
    throw Error("History journal exceeds supported bound; source retained");
  return JSON.parse(readFileSync(file, "utf8"));
}
function write(
  owner: string,
  profile: string,
  state: NativeHistoryJournal,
): void {
  const file = journalPath(owner, profile),
    temp = file + "." + randomUUID() + ".tmp",
    value = JSON.stringify(state);
  if (Buffer.byteLength(value) > 64 * 1024 * 1024)
    throw Error("History journal exceeds supported bound; source retained");
  try {
    writeFileSync(temp, value, { flag: "wx", mode: 0o600 });
    const fd = openSync(temp, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, file);
    if (process.platform !== "win32") {
      const directory = openSync(dirname(file), "r");
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    }
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}
const attachments = new Map<string, HistoryAttachment>();
function attachmentBytes(file: Attachment): Uint8Array {
  if (file.kind === "image" && file.dataUrl) {
    const match =
      /^data:(image\/(?:png|jpeg|gif|webp));base64,([a-zA-Z0-9+/=\s]+)$/.exec(
        file.dataUrl,
      );
    if (!match || match[1] !== file.mime)
      throw Error("Unsupported native image; source retained");
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length > 50 * 1024 * 1024)
      throw Error("Native attachment too large; source retained");
    return bytes;
  }
  if (file.kind === "text-file" && typeof file.text === "string")
    return Buffer.from(file.text, "utf8");
  if (file.kind === "path-ref" && file.path) {
    checked(file.path);
    if (
      !syncablePath(basename(file.path)) ||
      !lstatSync(file.path).isFile() ||
      lstatSync(file.path).size > 50 * 1024 * 1024
    )
      throw Error("Unsupported native attachment; source retained");
    return readFileSync(file.path);
  }
  throw Error("Native attachment cannot be represented; source retained");
}
async function portableItems(
  context: Awaited<ReturnType<typeof cloudChat.auth.nativeContext>>,
  sessionId: string,
  items: HistoryItem[],
): Promise<ArchivedHistoryItem[]> {
  const output: ArchivedHistoryItem[] = [];
  const owner = context.userId,
    transport = cloudChat.historyFiles.forOwner(owner);
  const files = {
    ...transport,
    put: async (id: string, bytes: Uint8Array): Promise<string> => {
      if (
        JSON.stringify(context) !==
        JSON.stringify(await cloudChat.auth.nativeContext(true))
      )
        throw Error("History account changed");
      return transport.put(id, bytes);
    },
  };
  for (const item of items) {
    const id =
      item.kind +
      "_" +
      item.id +
      (item.kind === "tool_call"
        ? "_" +
          createHash("sha256").update(item.callId).digest("hex").slice(0, 16)
        : "");
    const base = { id, kind: item.kind, timestamp: item.timestamp };
    let value: ArchivedHistoryItem;
    if (item.kind === "reasoning")
      value = {
        ...base,
        kind: item.kind,
        assistantId: "assistant_" + item.assistantId,
        text: item.text,
      };
    else if (item.kind === "tool_call")
      value = {
        ...base,
        kind: item.kind,
        assistantId: "assistant_" + item.assistantId,
        callId: item.callId,
        name: item.name,
        args: item.args,
      };
    else if (item.kind === "tool_result")
      value = {
        ...base,
        kind: item.kind,
        callId: item.callId,
        name: item.name,
        content: item.content,
      };
    else
      value = {
        ...base,
        kind: item.kind,
        content: item.content,
        ...(item.kind === "assistant" && item.error
          ? { error: item.error }
          : {}),
      };
    if ("attachments" in item && item.attachments?.length) {
      value.attachments = [];
      for (const [index, attachment] of item.attachments.entries()) {
        const bytes = attachmentBytes(attachment),
          digest = await digestBytes(bytes),
          attachmentId =
            "attachment_" +
            createHash("sha256")
              .update(JSON.stringify([id, index, attachment.id]))
              .digest("hex");
        const key = JSON.stringify([
          owner,
          sessionId,
          attachmentId,
          digest,
          attachment.name,
          attachment.mime,
        ]);
        let reference = attachments.get(key);
        if (!reference) {
          reference = await writeHistoryAttachment(
            files,
            sessionId,
            {
              id: attachmentId,
              kind: attachment.kind === "path-ref" ? "file" : attachment.kind,
              name: attachment.name,
              mime: attachment.mime,
              size: bytes.length,
              ...(attachment.originalSize
                ? { originalSize: attachment.originalSize }
                : {}),
            },
            bytes,
          );
          attachments.set(key, reference);
          if (attachments.size > 1000)
            attachments.delete(attachments.keys().next().value!);
        }
        value.attachments.push(reference);
      }
    }
    output.push(value);
  }
  return output;
}
export const nativeHistorySync = new NativeHistorySync({
  context: () => cloudChat.auth.nativeContext(true),
  transport: cloudChat,
  read,
  write,
  source: async () => {
    const context = await cloudChat.auth.nativeContext(true);
    if (getConnectionConfig().mode !== "local")
      throw Error("Native history storage unavailable");
    bindRepositorySource(
      join(app.getPath("userData"), "repository-source-owners"),
      context.profile,
      context.userId,
    );
    checked(activeStateDbPath(context.profile));
    const db = getDbConnection(true, context.profile);
    if (!db) return [];
    const sessions = db.transaction(() =>
      listSessions(1001, 0, context.profile).map((session) => {
        try {
          return {
            session,
            items: getSessionMessages(session.id, context.profile),
            error: null,
          };
        } catch {
          return {
            session,
            items: [] as HistoryItem[],
            error: "Native history unavailable; source retained",
          };
        }
      }),
    )();
    return sessions.map(({ session, items, error }) => ({
      id: session.id,
      title: session.title || "Chat",
      model: session.model || "native-history",
      items: (sessionId) => {
        if (error) return Promise.reject(Error(error));
        return portableItems(context, sessionId, items);
      },
    }));
  },
});
export async function synchronizeNativeHistory(): Promise<
  Awaited<ReturnType<typeof nativeHistorySync.run>>
> {
  await cloudChat.auth.enable();
  return nativeHistorySync.run();
}
