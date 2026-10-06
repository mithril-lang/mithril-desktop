import { repositoryFingerprint } from "@mithril/workspace/repository";
import { createHash } from "crypto";
import {
  validateChatOperation,
  type ChatOperation,
} from "@mithril/workspace/sessions";
import type { SessionTransport } from "@mithril/workspace/session-sync";
import {
  archivedHistory,
  validArchivedHistoryItem,
  type ArchivedHistoryItem,
} from "@mithril/workspace/history";
export interface NativeHistorySource {
  id: string;
  title: string;
  model: string;
  items(sessionId: string): Promise<ArchivedHistoryItem[]>;
}
export interface NativeHistoryJournal {
  entries: Record<
    string,
    {
      hashes: Record<string, string>;
      pending: {
        sessionId: string;
        operation: ChatOperation;
        conflicted: boolean;
      } | null;
    }
  >;
}
export interface NativeHistoryPorts {
  context(): Promise<{
    userId: string;
    profile: string;
    epoch: number;
    actor: string;
  }>;
  source(): Promise<NativeHistorySource[]>;
  transport: SessionTransport;
  read(owner: string, profile: string): NativeHistoryJournal;
  write(owner: string, profile: string, journal: NativeHistoryJournal): void;
}
const fingerprint = (item: ArchivedHistoryItem): string =>
  createHash("sha256")
    .update(
      repositoryFingerprint({
        body: item as unknown as import("@mithril/workspace/repository").JsonValue,
        deleted: false,
      }),
    )
    .digest("hex");
export const nativeCloudSessionId = (profile: string, id: string): string =>
  "native_" +
  createHash("sha256")
    .update(JSON.stringify([profile, id]))
    .digest("hex");
/** Owner-bound archival synchronization never starts inference, tools, or device runs. */
export class NativeHistorySync {
  private running: Promise<{
    userId: string;
    synced: number;
    conflicts: string[];
    deferred: string[];
  }> | null = null;
  constructor(private ports: NativeHistoryPorts) {}
  run(): Promise<{
    userId: string;
    synced: number;
    conflicts: string[];
    deferred: string[];
  }> {
    if (this.running) return this.running;
    this.running = this.pass().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async pass(): Promise<{
    userId: string;
    synced: number;
    conflicts: string[];
    deferred: string[];
  }> {
    const identity = await this.ports.context();
    const check = async (): Promise<void> => {
      if (
        JSON.stringify(identity) !== JSON.stringify(await this.ports.context())
      )
        throw Error("History account changed");
    };
    const state = this.ports.read(identity.userId, identity.profile);
    if (
      !state ||
      typeof state !== "object" ||
      !state.entries ||
      typeof state.entries !== "object" ||
      Array.isArray(state.entries) ||
      Object.keys(state.entries).length > 1000
    )
      throw Error("Invalid history journal");
    const persist = async (): Promise<void> => {
      await check();
      this.ports.write(identity.userId, identity.profile, state);
    };
    const source = await this.ports.source();
    await check();
    if (
      source.length > 1000 ||
      new Set(source.map((s) => s.id)).size !== source.length
    )
      throw Error(
        "Native history exceeds supported session bound; source retained",
      );
    const list = await this.ports.transport.list();
    await check();
    if (list.userId !== identity.userId) throw Error("History owner mismatch");
    const sessions = new Map(list.sessions.map((s) => [s.id, s]));
    const outcome = {
      userId: identity.userId,
      synced: 0,
      conflicts: [] as string[],
      deferred: [] as string[],
    };
    for (const native of source) {
      const sid = nativeCloudSessionId(identity.profile, native.id);
      const journal = (state.entries[sid] ??= { hashes: {}, pending: null });
      if (
        !journal ||
        typeof journal.hashes !== "object" ||
        !journal.hashes ||
        Array.isArray(journal.hashes)
      )
        throw Error("Invalid history journal");
      if (
        Object.entries(journal.hashes).some(
          ([key, value]) =>
            !/^[a-zA-Z0-9_-]{1,128}$/.test(key) ||
            typeof value !== "string" ||
            !/^[a-f0-9]{64}$/.test(value),
        )
      )
        throw Error("Invalid history journal hashes");
      if (
        journal.pending &&
        (journal.pending.sessionId !== sid ||
          !validateChatOperation(journal.pending.operation) ||
          !["create", "history"].includes(journal.pending.operation.type) ||
          typeof journal.pending.conflicted !== "boolean")
      )
        throw Error("Unsafe pending history operation");
      if (journal.pending?.conflicted) {
        outcome.conflicts.push(sid);
        continue;
      }
      try {
        if (journal.pending) {
          const pending = journal.pending;
          if (pending.sessionId !== sid)
            throw Error("Invalid history journal owner");
          let receipt = await this.ports.transport.receipt(
            sid,
            pending.operation.operationId,
          );
          await check();
          if (receipt.userId !== identity.userId)
            throw Error("History receipt owner mismatch");
          if (receipt.status === "unknown")
            receipt = await this.ports.transport.apply(sid, pending.operation);
          await check();
          if (
            receipt.userId !== identity.userId ||
            receipt.operationId !== pending.operation.operationId ||
            !receipt.session ||
            receipt.session.id !== sid
          )
            throw Error("Invalid history receipt");
          if (receipt.status === "conflict") {
            pending.conflicted = true;
            await persist();
            outcome.conflicts.push(sid);
            continue;
          }
          if (receipt.status !== "accepted")
            throw Error("History operation receipt remains unknown");
          if (pending.operation.type === "history")
            for (const item of pending.operation.data.items)
              journal.hashes[item.id] = fingerprint(item);
          sessions.set(sid, receipt.session);
          journal.pending = null;
          await persist();
        }
        let remote = sessions.get(sid);
        if (!remote) {
          const operation: ChatOperation = {
            type: "create",
            operationId: crypto.randomUUID(),
            baseRevision: 0,
            data: {
              title: native.title,
              model: native.model || "native-history",
            },
          };
          journal.pending = { sessionId: sid, operation, conflicted: false };
          await persist();
          const result = await this.ports.transport.apply(sid, operation);
          await check();
          if (
            result.userId !== identity.userId ||
            result.operationId !== operation.operationId ||
            result.session.id !== sid
          )
            throw Error("Invalid history creation receipt");
          if (result.status !== "accepted") {
            journal.pending.conflicted = true;
            await persist();
            outcome.conflicts.push(sid);
            continue;
          }
          remote = result.session;
          sessions.set(sid, remote);
          journal.pending = null;
          await persist();
        }
        if (
          remote.deleted ||
          (remote.activeTurn &&
            ["running", "uncertain"].includes(remote.activeTurn.status))
        ) {
          outcome.deferred.push(sid);
          continue;
        }
        const history = [] as { type: string; data: Record<string, string> }[];
        let after = 0;
        for (let page = 0; ; page++) {
          if (page >= 1000)
            throw Error("Native history exceeds supported page bound");
          const checkpoint = await this.ports.transport.events(sid, after);
          await check();
          if (
            checkpoint.userId !== identity.userId ||
            checkpoint.session.id !== sid
          )
            throw Error("History checkpoint owner mismatch");
          remote = checkpoint.session;
          if (
            remote.deleted ||
            (remote.activeTurn &&
              ["running", "uncertain"].includes(remote.activeTurn.status))
          )
            throw Error("History session became busy");
          let last = after;
          for (const event of checkpoint.events) {
            if (event.seq !== last + 1 || event.seq > remote.eventSeq)
              throw Error("Invalid history checkpoint order");
            last = event.seq;
          }
          if (!checkpoint.hasMore && last !== remote.eventSeq)
            throw Error("Incomplete history checkpoint");
          history.push(...checkpoint.events);
          if (!checkpoint.hasMore) break;
          if (
            checkpoint.nextAfter === null ||
            checkpoint.nextAfter !== last ||
            last <= after
          )
            throw Error("Invalid history checkpoint cursor");
          after = checkpoint.nextAfter;
        }
        const stored = new Map(
          archivedHistory(history).map((item) => [item.id, item]),
        );
        const items = await native.items(sid);
        await check();
        if (
          items.length > 20000 ||
          !items.every(validArchivedHistoryItem) ||
          new Set(items.map((item) => item.id)).size !== items.length
        )
          throw Error(
            "Native history cannot be represented without loss; source retained",
          );
        const changed: ArchivedHistoryItem[] = [];
        for (const item of items) {
          const local = fingerprint(item),
            cloud = stored.get(item.id);
          if (cloud && fingerprint(cloud) === local) {
            journal.hashes[item.id] = local;
            continue;
          }
          if (
            (cloud && fingerprint(cloud) !== journal.hashes[item.id]) ||
            (!cloud && journal.hashes[item.id])
          ) {
            outcome.conflicts.push(sid);
            continue;
          }
          changed.push(item);
        }
        await persist();
        while (changed.length) {
          const batch: ArchivedHistoryItem[] = [];
          while (changed.length && batch.length < 100) {
            if (
              Buffer.byteLength(JSON.stringify([...batch, changed[0]])) > 800000
            )
              break;
            batch.push(changed.shift()!);
          }
          if (!batch.length)
            throw Error(
              "Native history item exceeds supported bound; source retained",
            );
          const operation: ChatOperation = {
            type: "history",
            operationId: crypto.randomUUID(),
            baseRevision: remote.revision,
            data: { title: remote.title, model: remote.model, items: batch },
          };
          journal.pending = { sessionId: sid, operation, conflicted: false };
          await persist();
          const result = await this.ports.transport.apply(sid, operation);
          await check();
          if (
            result.userId !== identity.userId ||
            result.operationId !== operation.operationId ||
            result.session.id !== sid
          )
            throw Error("Invalid history operation receipt");
          if (result.status === "conflict") {
            journal.pending.conflicted = true;
            await persist();
            outcome.conflicts.push(sid);
            break;
          }
          if (result.status !== "accepted")
            throw Error("History operation receipt remains unknown");
          for (const item of batch) journal.hashes[item.id] = fingerprint(item);
          remote = result.session;
          sessions.set(sid, remote);
          journal.pending = null;
          await persist();
          outcome.synced += batch.length;
        }
      } catch (error) {
        await check();
        outcome.deferred.push(
          `${sid}: ${error instanceof Error ? error.message : "History unavailable"}`,
        );
      }
    }
    return { ...outcome, conflicts: [...new Set(outcome.conflicts)] };
  }
}
