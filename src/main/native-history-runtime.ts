import { applyCloudSessionTitle } from "./native-history-title";
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
import { cloudChat, onCloudChatAccountChanged } from "./cloud-chat-runtime";
import { sessionHistoryItems } from "@mithril/workspace/session-history";
import {
  remoteHistoryStore,
  clearRemoteHistoryStores,
} from "./remote-history-store";
import { getConnectionConfig } from "./config";
import { getDbConnection } from "./db";
import { activeStateDbPath } from "./utils";
import { getSessionMessages, listSessions, type HistoryItem } from "./sessions";
import {
  bindRepositorySource,
  repositorySourceOwned,
} from "./repository-kanban-runtime";
import {
  NativeHistorySync,
  nativeCloudSessionId,
  type NativeHistoryJournal,
} from "./native-history-sync";
import { digestBytes, syncablePath } from "@mithril/workspace/files";
import {
  writeHistoryAttachment,
  type ArchivedHistoryItem,
  type HistoryAttachment,
  readHistoryAttachment,
} from "@mithril/workspace/history";
import {
  nativeHistoryItemId,
  materializeHistoryItem,
  replaceNativeHistoryCache,
  setNativeHistoryCacheOwner,
  clearNativeHistoryCacheOwners,
  replaceRemoteSessionCache,
  remoteSessionCacheRevision,
} from "./native-history-cache";
import type { Attachment } from "../shared/attachments";
onCloudChatAccountChanged(clearNativeHistoryCacheOwners);
onCloudChatAccountChanged(clearRemoteHistoryStores);
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
    const id = nativeHistoryItemId(item);
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
export async function materializeCloudHistory(
  context: Awaited<ReturnType<typeof cloudChat.auth.nativeContext>>,
  sessionId: string,
  cloudItems: ArchivedHistoryItem[],
  items: HistoryItem[] = [],
): Promise<{ source: ArchivedHistoryItem; item: HistoryItem | null }[]> {
  const materialized = [] as {
    source: ArchivedHistoryItem;
    item: HistoryItem | null;
  }[];
  const originals = new Map(
    items.map((item) => [nativeHistoryItemId(item), item]),
  );
  let attachmentBytes = 0;
  for (const value of cloudItems) {
    const localAttachments: Attachment[] = [];
    for (const file of value.deleted ? [] : (value.attachments ?? [])) {
      attachmentBytes += file.size;
      if (attachmentBytes > 50 * 1024 * 1024)
        throw Error("History attachments exceed supported cache bound");
      const directory = join(
        root(),
        "attachments",
        createHash("sha256").update(context.userId).digest("hex"),
      );
      checked(directory);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, file.digest);
      checked(path);
      if (
        existsSync(path) &&
        (!lstatSync(path).isFile() || lstatSync(path).size !== file.size)
      )
        throw Error("Invalid cached attachment");
      const bytes = existsSync(path)
        ? readFileSync(path)
        : await readHistoryAttachment(
            cloudChat.historyFiles.forOwner(context.userId),
            sessionId,
            file,
          );
      if ((await digestBytes(bytes)) !== file.digest)
        throw Error("Cached attachment digest mismatch");
      if (!existsSync(path))
        writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
      localAttachments.push({
        id: file.id,
        kind:
          file.kind === "image"
            ? "image"
            : file.kind === "text-file"
              ? "text-file"
              : "path-ref",
        name: file.name,
        mime: file.mime,
        size: file.size,
        ...(file.originalSize ? { originalSize: file.originalSize } : {}),
        ...(file.kind === "image"
          ? {
              dataUrl: `data:${file.mime};base64,${Buffer.from(bytes).toString("base64")}`,
            }
          : file.kind === "text-file"
            ? {
                text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
              }
            : { path }),
      });
    }
    materialized.push({
      source: value,
      item: materializeHistoryItem(
        value,
        originals.get(value.id),
        localAttachments,
      ),
    });
  }
  return materialized;
}

const nativeHistorySync = new NativeHistorySync({
  hasRemote: async (session, expected) => {
    if (
      JSON.stringify(expected) !==
      JSON.stringify(await cloudChat.auth.nativeContext(true))
    )
      throw Error("History account changed");
    return (
      remoteSessionCacheRevision(
        remoteHistoryStore(expected.userId, expected.profile),
        session.id,
      ) === session.revision
    );
  },
  cacheRemote: async (session, events, expected) => {
    if (
      JSON.stringify(expected) !==
      JSON.stringify(await cloudChat.auth.nativeContext(true))
    )
      throw Error("History account changed");
    const materialized = session.deleted
      ? []
      : await materializeCloudHistory(
          expected,
          session.id,
          sessionHistoryItems(events),
        );
    if (
      JSON.stringify(expected) !==
      JSON.stringify(await cloudChat.auth.nativeContext(true))
    )
      throw Error("History account changed");
    const db = remoteHistoryStore(expected.userId, expected.profile);
    replaceRemoteSessionCache(
      db,
      expected.userId,
      session,
      events,
      materialized.flatMap((row) => (row.item ? [row.item] : [])),
    );
    setNativeHistoryCacheOwner(db.name, expected.userId);
  },
  context: () => cloudChat.auth.nativeContext(true),
  transport: cloudChat,
  read,
  write,
  source: async () => {
    const context = await cloudChat.auth.nativeContext(true);
    if (getConnectionConfig().mode !== "local") return [];
    checked(activeStateDbPath(context.profile));
    const db = getDbConnection(true, context.profile);
    if (!db) return [];
    bindRepositorySource(
      join(app.getPath("userData"), "repository-source-owners"),
      context.profile,
      context.userId,
    );
    const sessions = db.transaction(() =>
      listSessions(1001, 0, context.profile).map((session) => {
        try {
          return {
            session,
            items: getSessionMessages(session.id, context.profile, true),
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
      cacheTitle: async (title) => {
        if (
          JSON.stringify(context) !==
          JSON.stringify(await cloudChat.auth.nativeContext(true))
        )
          throw Error("History account changed");
        const writable = getDbConnection(false, context.profile);
        if (!writable) throw Error("Native history cache unavailable");
        return applyCloudSessionTitle(
          writable,
          session.id,
          session.title,
          title,
        );
      },
      cache: async (sessionId, cloudItems) => {
        if (error) throw Error(error);
        const materialized = await materializeCloudHistory(
          context,
          sessionId,
          cloudItems,
          items,
        );
        if (
          JSON.stringify(context) !==
          JSON.stringify(await cloudChat.auth.nativeContext(true))
        )
          throw Error("History account changed");
        const writable = getDbConnection(false, context.profile);
        if (!writable) throw Error("Native history cache unavailable");
        setNativeHistoryCacheOwner(writable.name, context.userId);
        replaceNativeHistoryCache(
          writable,
          session.id,
          context.userId,
          items,
          () => getSessionMessages(session.id, context.profile, true, writable),
          materialized,
        );
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

/** Read-only inventory for the original sidebar; no migration, file capture or execution. */
export async function nativeHistoryInventory(): Promise<{
  userId: string;
  profile: string;
  rows: Array<{ id: string; sourceId: string; title: string }>;
}> {
  const context = await cloudChat.auth.nativeContext();
  const result = {
    userId: context.userId,
    profile: context.profile,
    rows: [] as Array<{ id: string; sourceId: string; title: string }>,
  };
  if (getConnectionConfig().mode !== "local") return result;
  if (
    !repositorySourceOwned(
      join(app.getPath("userData"), "repository-source-owners"),
      context.profile,
      context.userId,
    )
  )
    return result;
  checked(activeStateDbPath(context.profile));
  const db = getDbConnection(true, context.profile);
  if (!db) return result;
  const sessions = db.transaction(() =>
    listSessions(1001, 0, context.profile),
  )();
  if (sessions.length > 1000)
    throw Error(
      "Source history inventory exceeds supported bound; source retained",
    );
  if (
    JSON.stringify(context) !==
    JSON.stringify(await cloudChat.auth.nativeContext())
  )
    throw Error("History account changed");
  result.rows = sessions.map((session) => ({
    id: nativeCloudSessionId(context.profile, session.id),
    sourceId: session.id,
    title: session.title || "Chat",
  }));
  return result;
}
