import { repositoryFingerprint } from "@mithril/workspace/repository";
import { createHash } from "crypto";
import {
  validateChatOperation,
  type ChatOperation,
  type ChatSession,
  type ChatEvent,
  validateChatSession,
  validateChatEvent,
} from "@mithril/workspace/sessions";
import type { SessionTransport } from "@mithril/workspace/session-sync";
import {
  archivedHistory,
  validArchivedHistoryItem,
  type ArchivedHistoryItem,
} from "@mithril/workspace/history";
export interface NativeTitleConflict {
  sessionId: string;
  native: string;
  cloud: string;
  cloudRevision: number;
}
export interface NativeTitleResolution extends NativeTitleConflict {
  userId: string;
  profile: string;
  choice: "native" | "cloud";
}
export interface NativeHistorySource {
  id: string;
  title: string;
  model: string;
  items(sessionId: string): Promise<ArchivedHistoryItem[]>;
  cache?(sessionId: string, items: ArchivedHistoryItem[]): Promise<void>;
  cacheTitle?(title: string): Promise<string>;
  cacheModel?(model: string): Promise<string>;
}
export interface NativeHistoryJournal {
  entries: Record<
    string,
    {
      hashes: Record<string, string>;
      nativeHashes?: Record<string, string>;
      title?: { native: string; cloud: string };
      model?: { native: string; cloud: string };
      titleConflict?: { native: string; cloud: string };
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
  cacheRemote?(
    session: ChatSession,
    events: ChatEvent[],
    identity: Awaited<ReturnType<NativeHistoryPorts["context"]>>,
  ): Promise<void>;
  hasRemote?(
    session: ChatSession,
    identity: Awaited<ReturnType<NativeHistoryPorts["context"]>>,
  ): Promise<boolean>;
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
    reconstructed: number;
    conflicts: string[];
    titleConflicts: NativeTitleConflict[];
    modelConflicts: NativeTitleConflict[];
    deferred: string[];
  }> | null = null;
  constructor(private ports: NativeHistoryPorts) {}
  run(): Promise<{
    userId: string;
    synced: number;
    reconstructed: number;
    conflicts: string[];
    titleConflicts: NativeTitleConflict[];
    modelConflicts: NativeTitleConflict[];
    deferred: string[];
  }> {
    if (this.running) return this.running;
    this.running = this.pass().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  resolveTitle(
    request: NativeTitleResolution,
  ): Promise<Awaited<ReturnType<NativeHistorySync["run"]>>> {
    return this.resolveMetadata(request, "title");
  }
  resolveModel(
    request: NativeTitleResolution,
  ): Promise<Awaited<ReturnType<NativeHistorySync["run"]>>> {
    return this.resolveMetadata(request, "model");
  }
  private async resolveMetadata(
    request: NativeTitleResolution,
    field: "title" | "model",
  ): Promise<Awaited<ReturnType<NativeHistorySync["run"]>>> {
    if (
      !request ||
      typeof request !== "object" ||
      typeof request.userId !== "string" ||
      typeof request.profile !== "string" ||
      typeof request.sessionId !== "string" ||
      typeof request.native !== "string" ||
      typeof request.cloud !== "string" ||
      request.native.length > (field === "model" ? 256 : 512) ||
      request.cloud.length > (field === "model" ? 256 : 512) ||
      (field === "model" && (!request.native || !request.cloud)) ||
      !Number.isSafeInteger(request.cloudRevision) ||
      request.cloudRevision < 1 ||
      !["native", "cloud"].includes(request.choice)
    )
      throw Error(`Invalid ${field} resolution`);
    // Serialize with background replication; never act on a renderer-supplied owner alone.
    const captured = structuredClone(request);
    while (this.running) await this.running.catch(() => undefined);
    this.running = this.pass({ ...captured, field }).finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async pass(
    resolution?: NativeTitleResolution & { field: "title" | "model" },
  ): Promise<{
    userId: string;
    synced: number;
    reconstructed: number;
    conflicts: string[];
    titleConflicts: NativeTitleConflict[];
    modelConflicts: NativeTitleConflict[];
    deferred: string[];
  }> {
    const identity = await this.ports.context();
    if (
      resolution &&
      (resolution.userId !== identity.userId ||
        resolution.profile !== identity.profile)
    )
      throw Error(`${resolution.field} resolution account changed`);
    let resolved = false;
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
    let source: NativeHistorySource[];
    let sourceFailure: string | null = null;
    try {
      source = await this.ports.source();
    } catch (error) {
      await check();
      if (!this.ports.cacheRemote) throw error;
      source = [];
      sourceFailure =
        error instanceof Error
          ? error.message
          : "Native source unavailable; source retained";
    }
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
    if (
      list.sessions.length > 1000 ||
      list.sessions.some((session) => !validateChatSession(session)) ||
      new Set(list.sessions.map((session) => session.id)).size !==
        list.sessions.length
    )
      throw Error("Invalid cloud session inventory");
    const sessions = new Map(list.sessions.map((s) => [s.id, s]));
    const outcome = {
      userId: identity.userId,
      synced: 0,
      reconstructed: 0,
      conflicts: [] as string[],
      titleConflicts: [] as NativeTitleConflict[],
      modelConflicts: [] as NativeTitleConflict[],
      deferred: sourceFailure ? [sourceFailure] : ([] as string[]),
    };
    for (const native of source) {
      const sid = nativeCloudSessionId(identity.profile, native.id);
      const journal = (state.entries[sid] ??= { hashes: {}, pending: null });
      if (
        !journal ||
        typeof journal.hashes !== "object" ||
        !journal.hashes ||
        Array.isArray(journal.hashes) ||
        (journal.nativeHashes !== undefined &&
          (!journal.nativeHashes ||
            typeof journal.nativeHashes !== "object" ||
            Array.isArray(journal.nativeHashes)))
      )
        throw Error("Invalid history journal");
      if (
        Object.entries({ ...journal.hashes, ...journal.nativeHashes }).some(
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
          !["create", "history", "rename"].includes(
            journal.pending.operation.type,
          ) ||
          typeof journal.pending.conflicted !== "boolean")
      )
        throw Error("Unsafe pending history operation");
      for (const metadata of [journal.title, journal.titleConflict]) {
        if (
          metadata !== undefined &&
          (!metadata ||
            typeof metadata !== "object" ||
            Array.isArray(metadata) ||
            Object.keys(metadata).length !== 2 ||
            typeof metadata.native !== "string" ||
            metadata.native.length > 512 ||
            typeof metadata.cloud !== "string" ||
            metadata.cloud.length > 512)
        )
          throw Error("Invalid title journal");
      }
      if (
        journal.model !== undefined &&
        (!journal.model ||
          typeof journal.model !== "object" ||
          Array.isArray(journal.model) ||
          Object.keys(journal.model).length !== 2 ||
          typeof journal.model.native !== "string" ||
          !journal.model.native ||
          journal.model.native.length > 256 ||
          typeof journal.model.cloud !== "string" ||
          !journal.model.cloud ||
          journal.model.cloud.length > 256)
      )
        throw Error("Invalid model journal");
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
            receipt.schemaVersion !== 1 ||
            receipt.userId !== identity.userId ||
            receipt.operationId !== pending.operation.operationId ||
            !receipt.session ||
            receipt.session.id !== sid ||
            !validateChatSession(receipt.session)
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
          if (pending.operation.type === "history") {
            if (
              receipt.session.revision !== pending.operation.baseRevision + 1 ||
              receipt.session.model !== pending.operation.data.model
            )
              throw Error("Invalid model receipt");
            if (pending.operation.data.items.length === 0)
              journal.model = {
                native: pending.operation.data.model,
                cloud: receipt.session.model,
              };
          }
          if (pending.operation.type === "history")
            for (const item of pending.operation.data.items) {
              journal.hashes[item.id] = fingerprint(item);
              (journal.nativeHashes ??= {})[item.id] = fingerprint(item);
            }
          if (
            pending.operation.type === "rename" ||
            pending.operation.type === "create"
          ) {
            if (
              receipt.session.revision !== pending.operation.baseRevision + 1 ||
              receipt.session.title !== pending.operation.data.title
            )
              throw Error("Invalid title receipt");
            journal.title = {
              native: pending.operation.data.title,
              cloud: receipt.session.title,
            };
            delete journal.titleConflict;
          }
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
          if (!validateChatOperation(operation))
            throw Error(
              "Native history operation cannot be represented; source retained",
            );
          journal.pending = { sessionId: sid, operation, conflicted: false };
          await persist();
          const result = await this.ports.transport.apply(sid, operation);
          await check();
          if (
            result.schemaVersion !== 1 ||
            result.userId !== identity.userId ||
            result.operationId !== operation.operationId ||
            !validateChatSession(result.session) ||
            result.session.id !== sid
          )
            throw Error("Invalid history creation receipt");
          if (result.status !== "accepted") {
            journal.pending.conflicted = true;
            await persist();
            outcome.conflicts.push(sid);
            continue;
          }
          if (result.session.title !== native.title)
            throw Error("Invalid creation title receipt");
          journal.title = { native: native.title, cloud: result.session.title };
          if (result.session.model !== (native.model || "native-history"))
            throw Error("Invalid creation model receipt");
          journal.model = {
            native: native.model || "native-history",
            cloud: result.session.model,
          };
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
        let checkpointIdentity: string | undefined;
        for (let page = 0; ; page++) {
          if (page >= 1000)
            throw Error("Native history exceeds supported page bound");
          const checkpoint = await this.ports.transport.events(sid, after);
          await check();
          if (
            checkpoint.schemaVersion !== 1 ||
            checkpoint.userId !== identity.userId ||
            !validateChatSession(checkpoint.session) ||
            checkpoint.session.id !== sid ||
            !Array.isArray(checkpoint.events) ||
            !checkpoint.events.every(validateChatEvent)
          )
            throw Error("History checkpoint owner mismatch");
          const version = JSON.stringify(checkpoint.session);
          if (
            checkpointIdentity !== undefined &&
            checkpointIdentity !== version
          )
            throw Error("History checkpoint changed during pagination");
          checkpointIdentity = version;
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
        // Three-way title reconciliation uses independent native/cloud baselines.
        // A pending operation always keeps its original ID across lost receipts.
        if (resolution?.field === "title" && resolution.sessionId === sid) {
          if (
            !journal.titleConflict ||
            journal.pending ||
            native.title !== resolution.native ||
            remote.title !== resolution.cloud ||
            remote.revision !== resolution.cloudRevision ||
            journal.titleConflict.native !== resolution.native ||
            journal.titleConflict.cloud !== resolution.cloud
          )
            throw Error("Title conflict changed; review current titles");
          if (resolution.choice === "cloud") {
            if (!native.cacheTitle)
              throw Error("Native title cache unavailable");
            const effective = await native.cacheTitle(remote.title);
            await check();
            if (typeof effective !== "string" || effective.length > 512)
              throw Error("Invalid native title acknowledgement");
            journal.title = { native: effective, cloud: remote.title };
          } else {
            // Rebase only the reviewed metadata choice onto the complete cloud checkpoint.
            journal.title = { native: remote.title, cloud: remote.title };
          }
          delete journal.titleConflict;
          await persist();
          resolved = true;
        }
        if (
          resolved &&
          resolution?.field === "title" &&
          resolution.sessionId === sid &&
          resolution.choice === "cloud"
        ) {
          // The source snapshot predates transactional writeback; do not echo it this pass.
        } else if (!journal.title) {
          if (native.title === remote.title) {
            journal.title = { native: native.title, cloud: remote.title };
            delete journal.titleConflict;
          } else
            journal.titleConflict = {
              native: native.title,
              cloud: remote.title,
            };
        } else {
          const localChanged = native.title !== journal.title.native;
          const remoteChanged = remote.title !== journal.title.cloud;
          if (native.title === remote.title) {
            journal.title = { native: native.title, cloud: remote.title };
            delete journal.titleConflict;
          } else if (localChanged && remoteChanged) {
            journal.titleConflict = {
              native: native.title,
              cloud: remote.title,
            };
          } else if (!journal.titleConflict && localChanged) {
            const operation: ChatOperation = {
              type: "rename",
              operationId: crypto.randomUUID(),
              baseRevision: remote.revision,
              data: { title: native.title },
            };
            if (!validateChatOperation(operation))
              throw Error(
                "Native history operation cannot be represented; source retained",
              );
            journal.pending = { sessionId: sid, operation, conflicted: false };
            await persist();
            const result = await this.ports.transport.apply(sid, operation);
            await check();
            if (
              result.schemaVersion !== 1 ||
              result.userId !== identity.userId ||
              result.operationId !== operation.operationId ||
              !result.session ||
              result.session.id !== sid ||
              !validateChatSession(result.session)
            )
              throw Error("Invalid title receipt");
            if (result.status === "conflict") {
              journal.pending.conflicted = true;
              await persist();
              outcome.conflicts.push(sid);
              continue;
            }
            if (
              result.status !== "accepted" ||
              result.session.revision !== operation.baseRevision + 1 ||
              result.session.title !== operation.data.title
            )
              throw Error("Title operation receipt remains unknown");
            journal.title = {
              native: operation.data.title,
              cloud: result.session.title,
            };
            journal.pending = null;
            remote = result.session;
            sessions.set(sid, remote);
          } else if (!journal.titleConflict && remoteChanged) {
            if (!native.cacheTitle) {
              outcome.deferred.push(`${sid}: Native title cache unavailable`);
            } else {
              const effective = await native.cacheTitle(remote.title);
              await check();
              if (typeof effective !== "string" || effective.length > 512)
                throw Error("Invalid native title acknowledgement");
              journal.title = { native: effective, cloud: remote.title };
            }
          }
        }
        if (journal.titleConflict) {
          journal.titleConflict = { native: native.title, cloud: remote.title };
          outcome.conflicts.push(sid);
          outcome.titleConflicts.push({
            sessionId: sid,
            native: native.title,
            cloud: remote.title,
            cloudRevision: remote.revision,
          });
        }
        // Archived model metadata is independent of execution/provider authorization.
        const model = native.model || "native-history";
        if (typeof model !== "string" || model.length > 256)
          throw Error("Invalid native history model");
        const reportModelConflict = (session: ChatSession): void => {
          outcome.conflicts.push(sid);
          outcome.modelConflicts.push({
            sessionId: sid,
            native: model,
            cloud: session.model,
            cloudRevision: session.revision,
          });
        };
        if (resolution?.field === "model" && resolution.sessionId === sid) {
          const conflicted =
            model !== remote.model &&
            (!journal.model ||
              (model !== journal.model.native &&
                remote.model !== journal.model.cloud));
          if (
            !conflicted ||
            journal.pending ||
            model !== resolution.native ||
            remote.model !== resolution.cloud ||
            remote.revision !== resolution.cloudRevision
          )
            throw Error("Model conflict changed; review current models");
          if (resolution.choice === "cloud") {
            if (!native.cacheModel)
              throw Error("Native model cache unavailable");
            const cached = await native.cacheModel(remote.model);
            await check();
            if (cached !== remote.model)
              throw Error("Invalid native model acknowledgement");
            journal.model = { native: cached, cloud: remote.model };
          } else journal.model = { native: remote.model, cloud: remote.model };
          await persist();
          resolved = true;
        }
        if (
          resolved &&
          resolution?.field === "model" &&
          resolution.sessionId === sid &&
          resolution.choice === "cloud"
        ) {
          // The source snapshot predates CAS writeback; never echo the reviewed old model.
        } else if (model === remote.model)
          journal.model = { native: model, cloud: remote.model };
        else if (!journal.model) reportModelConflict(remote);
        else {
          const localChanged = model !== journal.model.native,
            cloudChanged = remote.model !== journal.model.cloud;
          if (localChanged && cloudChanged) reportModelConflict(remote);
          else if (localChanged) {
            const operation: ChatOperation = {
              type: "history",
              operationId: crypto.randomUUID(),
              baseRevision: remote.revision,
              data: { title: remote.title, model, items: [] },
            };
            if (!validateChatOperation(operation))
              throw Error("Invalid model synchronization operation");
            journal.pending = { sessionId: sid, operation, conflicted: false };
            await persist();
            const receipt = await this.ports.transport.apply(sid, operation);
            await check();
            if (
              receipt.schemaVersion !== 1 ||
              receipt.userId !== identity.userId ||
              receipt.operationId !== operation.operationId ||
              !validateChatSession(receipt.session) ||
              receipt.session.id !== sid
            )
              throw Error("Invalid model receipt");
            if (receipt.status === "conflict") {
              journal.pending.conflicted = true;
              await persist();
              outcome.conflicts.push(sid);
              continue;
            }
            if (
              receipt.status !== "accepted" ||
              receipt.session.revision !== operation.baseRevision + 1 ||
              receipt.session.model !== model ||
              receipt.session.title !== remote.title
            )
              throw Error("Model receipt remains unknown");
            remote = receipt.session;
            sessions.set(sid, remote);
            journal.model = { native: model, cloud: remote.model };
            journal.pending = null;
          } else if (cloudChanged) {
            if (!native.cacheModel)
              outcome.deferred.push(`${sid}: Native model cache unavailable`);
            else {
              const cached = await native.cacheModel(remote.model);
              await check();
              if (cached !== remote.model)
                throw Error("Invalid native model acknowledgement");
              journal.model = { native: cached, cloud: remote.model };
            }
          }
        }
        await persist();
        const stored = new Map(
          archivedHistory(history, true).map((item) => [item.id, item]),
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
        const cache: ArchivedHistoryItem[] = [];
        const nativeHashes = (journal.nativeHashes ??= { ...journal.hashes });
        for (const item of items) {
          const local = fingerprint(item),
            cloud = stored.get(item.id);
          if (cloud && fingerprint(cloud) === local) {
            journal.hashes[item.id] = local;
            nativeHashes[item.id] = local;
            cache.push(cloud);
            continue;
          }
          const localChanged = local !== nativeHashes[item.id];
          const cloudChanged =
            cloud && fingerprint(cloud) !== journal.hashes[item.id];
          if (cloudChanged && !localChanged && native.cache) {
            cache.push(cloud);
            continue;
          }
          if (cloudChanged || (!cloud && journal.hashes[item.id])) {
            outcome.conflicts.push(sid);
            continue;
          }
          if (localChanged) changed.push(item);
          else if (cloud) cache.push(cloud);
        }
        const sourceIds = new Set(items.map((item) => item.id));
        for (const cloud of stored.values()) {
          if (sourceIds.has(cloud.id)) continue;
          if (!nativeHashes[cloud.id]) cache.push(cloud);
          else if (!cloud.deleted) {
            if (fingerprint(cloud) !== journal.hashes[cloud.id])
              outcome.conflicts.push(sid);
            else changed.push({ ...cloud, deleted: true });
          }
        }
        if (native.cache) {
          await native.cache(sid, cache);
          await check();
          for (const item of cache) journal.hashes[item.id] = fingerprint(item);
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
          if (!validateChatOperation(operation))
            throw Error(
              "Native history operation cannot be represented; source retained",
            );
          journal.pending = { sessionId: sid, operation, conflicted: false };
          await persist();
          const result = await this.ports.transport.apply(sid, operation);
          await check();
          if (
            result.schemaVersion !== 1 ||
            result.userId !== identity.userId ||
            result.operationId !== operation.operationId ||
            !validateChatSession(result.session) ||
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
          for (const item of batch) {
            journal.hashes[item.id] = fingerprint(item);
            nativeHashes[item.id] = fingerprint(item);
          }
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
    if (this.ports.cacheRemote) {
      const mapped = new Set(
        source.map((native) =>
          nativeCloudSessionId(identity.profile, native.id),
        ),
      );
      for (const session of sessions.values()) {
        if (mapped.has(session.id)) continue;
        try {
          if (await this.ports.hasRemote?.(session, identity)) {
            await check();
            continue;
          }
          if (session.deleted) {
            await check();
            await this.ports.cacheRemote(session, [], identity);
            await check();
            outcome.reconstructed++;
            continue;
          }
          if (
            session.activeTurn &&
            ["running", "uncertain"].includes(session.activeTurn.status)
          ) {
            outcome.deferred.push(session.id);
            continue;
          }
          const events: ChatEvent[] = [];
          let after = 0;
          let eventBytes = 0;
          for (let page = 0; ; page++) {
            if (page >= 1000)
              throw Error("Cloud history exceeds supported page bound");
            const snapshot = await this.ports.transport.events(
              session.id,
              after,
            );
            await check();
            if (
              snapshot.userId !== identity.userId ||
              snapshot.session.id !== session.id ||
              !validateChatSession(snapshot.session) ||
              snapshot.session.revision !== session.revision ||
              snapshot.session.eventSeq !== session.eventSeq ||
              snapshot.session.title !== session.title ||
              snapshot.session.model !== session.model ||
              snapshot.session.deleted ||
              JSON.stringify(snapshot.session.activeTurn) !==
                JSON.stringify(session.activeTurn)
            )
              throw Error("Cloud history changed during reconstruction");
            let last = after;
            for (const event of snapshot.events) {
              if (
                !validateChatEvent(event) ||
                event.seq !== last + 1 ||
                event.seq > session.eventSeq
              )
                throw Error("Invalid cloud history checkpoint");
              last = event.seq;
              eventBytes += Buffer.byteLength(JSON.stringify(event));
              if (eventBytes > 50 * 1024 * 1024)
                throw Error("Cloud history exceeds supported byte bound");
              events.push(event);
              if (events.length > 20000)
                throw Error("Cloud history exceeds supported event bound");
            }
            if (!snapshot.hasMore) {
              if (last !== session.eventSeq)
                throw Error("Incomplete cloud history checkpoint");
              break;
            }
            if (snapshot.nextAfter !== last || last <= after)
              throw Error("Invalid cloud history cursor");
            after = last;
          }
          await this.ports.cacheRemote(session, events, identity);
          await check();
          outcome.reconstructed++;
        } catch (error) {
          await check();
          outcome.deferred.push(
            `${session.id}: ${error instanceof Error ? error.message : "Cloud history unavailable"}`,
          );
        }
      }
    }
    if (resolution && !resolved)
      throw Error(
        `${resolution.field} conflict changed or unavailable; review current values`,
      );
    return { ...outcome, conflicts: [...new Set(outcome.conflicts)] };
  }
}
