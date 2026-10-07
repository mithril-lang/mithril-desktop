import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { originalScheduleReplicationAdmission } from "./original-schedule-replication-admission";
import {
  ensureOriginalScheduleFileContext,
  OriginalScheduleFileRepository,
} from "@mithril/workspace/original-schedule-file";
import {
  OriginalScheduleFileReplica,
  type OriginalScheduleReplicaResult,
  type OriginalScheduleReplicaScope,
} from "@mithril/workspace/original-schedule-file-replica";
import {
  OriginalSchedulePreparationMailbox,
  type OriginalScheduleParser,
} from "@mithril/workspace/original-schedule-preparation";
import { RepositorySync } from "@mithril/workspace/repository-sync";
import type { RepositoryTransport } from "@mithril/workspace/repository";
import type { CapabilityResourceTransport } from "@mithril/workspace/capability-resources";
import {
  BoundOriginalScheduleNativePort,
  type OriginalScheduleNativeBoundary,
} from "./original-schedule-native-port";
import { NativeOriginalScheduleReplicaStore } from "./original-schedule-replica-store";
import { OriginalScheduleDirectoryResources } from "./original-schedule-directory-resources";
import { OriginalScheduleScriptResources } from "./original-schedule-script-resources";
import { OriginalScheduleWorkdirResources } from "./original-schedule-workdir-resources";
import { OriginalScheduleRuntimeBindings } from "./original-schedule-runtime-bindings";
import { OriginalScheduleFileResourceBindings } from "./original-schedule-resource-bindings";
import type {
  OriginalScheduleAgentBinding,
  OriginalScheduleAgentPreparation,
} from "./original-schedule-agent-binding";
import {
  validOriginalScheduleCustodyReceipt,
  type OriginalScheduleCustodyCommand,
  type OriginalScheduleCustodyReceipt,
} from "./original-schedule-custody";

import { OriginalScheduleManualConsumer } from "./original-schedule-manual-consumer";
import type { OriginalManualBinding } from "./original-schedule-manual-journal";
import type {
  OriginalManualCommand,
  OriginalManualResult,
  OriginalManualReceipt,
} from "./original-schedule-manual";
import type {
  OriginalCronRunRequest,
  OriginalCronRunResult,
  OriginalCronInspectResult,
} from "./cron-source-run";

export interface OriginalScheduleReplicationPorts {
  scope: OriginalScheduleReplicaScope;
  home: string;
  stateRoot: string;
  python: string;
  repository: RepositoryTransport;
  resources: CapabilityResourceTransport;
  native: OriginalScheduleNativeBoundary;
  parser: OriginalScheduleParser;
  prepare(
    input: OriginalScheduleAgentPreparation,
  ): Promise<{ bindingDigest: string }>;
  bind(input: OriginalScheduleAgentBinding): Promise<{ bindingDigest: string }>;
  custody(
    command: OriginalScheduleCustodyCommand,
  ): Promise<OriginalScheduleCustodyReceipt>;
  assertActive(): Promise<void>;
}
const sha = (text: string): string =>
  createHash("sha256").update(text).digest("hex");
function managedDirectory(root: string): void {
  for (let path = resolve(root); ; path = dirname(path)) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink())
      throw Error("Unsafe schedule workspace");
    if (dirname(path) === path) break;
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (!lstatSync(root).isDirectory()) throw Error("Unsafe schedule workspace");
}

/** One real main-process coordinator: original bytes/resources, durable outbox and policy binding.
 * It never invokes an occurrence, retries an uncertain custody mutation or publishes device paths.
 */
// @lat: [[cloud-workspace#Automatic original schedule replication (draft)]]
export class OriginalScheduleReplication {
  private stopped = false;
  private running = false;
  private manualAnchor: OriginalScheduleAgentBinding | null = null;
  private manualCapture:
    | (() => Promise<{ version: string | null; sourceDigest: string | null }>)
    | null = null;
  private replica: OriginalScheduleFileReplica | null = null;
  private repository: RepositorySync | null = null;
  constructor(private readonly ports: OriginalScheduleReplicationPorts) {}
  stop(): void {
    this.stopped = true;
    this.replica?.stop();
    this.repository?.stop();
  }
  private async check(): Promise<void> {
    if (this.stopped) throw Error("Schedule replica identity changed");
    await this.ports.assertActive();
    if (this.stopped) throw Error("Schedule replica identity changed");
  }
  // @lat: [[cloud-workspace#Original Schedules screen mirror (draft)]]
  async assertScreenScope(profile?: string): Promise<void> {
    await this.check();
    if (profile !== undefined && profile !== this.ports.scope.profile)
      throw Error("Schedule profile changed");
  }
  async assertSelectedExecution(): Promise<void> {
    await this.check();
    const command: OriginalScheduleCustodyCommand = {
      action: "status",
      profile: this.ports.scope.profile,
    };
    const authority = await this.ports.custody(command);
    await this.check();
    if (
      !validOriginalScheduleCustodyReceipt(
        authority,
        this.ports.scope.owner,
        command,
      ) ||
      !("selected" in authority) ||
      !authority.selected ||
      authority.revision < 1
    )
      throw Error("Run this schedule on its selected device");
  }
  /** Bind a fresh intent to the same verified resources and native version used by replication. */
  async manualBinding(
    request: OriginalManualReceipt,
    authorityRevision: number,
  ): Promise<OriginalManualBinding> {
    await this.check();
    const anchor = this.manualAnchor,
      capture = this.manualCapture;
    if (
      !anchor ||
      !capture ||
      request.userId !== this.ports.scope.owner ||
      request.profile !== anchor.profile ||
      request.sourceRevision !== anchor.sourceRevision ||
      request.sourceDigest !== anchor.sourceDigest ||
      authorityRevision !== anchor.authorityRevision
    )
      throw Error("Manual schedule source changed");
    await this.assertSelectedExecution();
    const authority = await this.ports.custody({
      action: "status",
      profile: anchor.profile,
    });
    await this.check();
    if (
      !validOriginalScheduleCustodyReceipt(authority, this.ports.scope.owner, {
        action: "status",
        profile: anchor.profile,
      }) ||
      !("selected" in authority) ||
      !authority.selected ||
      authority.revision !== authorityRevision
    )
      throw Error("Manual schedule custody changed");
    const current = await capture();
    await this.check();
    if (
      current.version !== anchor.nativeVersion ||
      current.sourceDigest !== anchor.sourceDigest
    )
      throw Error("Manual schedule resources changed");
    return {
      ...this.ports.scope,
      jobId: request.jobId,
      operationId: request.operationId,
      sourceRevision: anchor.sourceRevision,
      sourceDigest: anchor.sourceDigest,
      authorityRevision,
      nativeVersion: anchor.nativeVersion,
    };
  }
  manualConsumer(ports: {
    command(input: OriginalManualCommand): Promise<OriginalManualResult>;
    run(input: OriginalCronRunRequest): Promise<OriginalCronRunResult>;
    inspect(input: OriginalCronRunRequest): Promise<OriginalCronInspectResult>;
    serialize<T>(action: () => Promise<T>): Promise<T>;
  }): OriginalScheduleManualConsumer {
    return new OriginalScheduleManualConsumer({
      scope: this.ports.scope,
      store: new NativeOriginalScheduleReplicaStore(
        join(this.ports.stateRoot, "schedule-replicas"),
        this.ports.scope,
      ),
      check: () => this.check(),
      command: ports.command,
      run: ports.run,
      inspect: ports.inspect,
      bind: (request, revision) =>
        ports.serialize(async () => {
          const result = await this.sync();
          if (result.status !== "synced")
            throw Error("Manual schedule synchronization unconfirmed");
          return this.manualBinding(request, revision);
        }),
    });
  }
  async sync(): Promise<OriginalScheduleReplicaResult> {
    if (this.running)
      return { status: "deferred", reason: "schedule-replica-busy" };
    this.running = true;
    this.manualAnchor = null;
    this.manualCapture = null;
    const p = this.ports;
    try {
      await this.check();
      const original = p.native.capture(p.scope.profile);
      const store = new NativeOriginalScheduleReplicaStore(
        join(p.stateRoot, "schedule-replicas"),
        p.scope,
      );
      const repository = new RepositorySync(
        p.scope.owner,
        p.repository,
        {
          read: async (owner) => {
            if (owner !== p.scope.owner) throw Error("Schedule owner changed");
            await this.check();
            return store.readRepository(p.scope);
          },
          update: async (owner, change) => {
            if (owner !== p.scope.owner) throw Error("Schedule owner changed");
            await this.check();
            return store.updateRepository(p.scope, change);
          },
        },
        () => {},
        ["schedule"],
      );
      this.repository = repository;
      await store.exclusive(p.scope, async () => {
        await repository.load();
        await ensureOriginalScheduleFileContext(
          repository,
          p.scope.profile,
          p.scope.timeZone,
        );
        await this.check();
        await new OriginalSchedulePreparationMailbox(
          repository,
          p.scope,
        ).processOne({
          prepareCreate: async (request) => {
            await this.check();
            const result = await p.parser.prepareCreate(request);
            await this.check();
            return result;
          },
          prepareTransition: async (request) => {
            await this.check();
            const result = await p.parser.prepareTransition(request);
            await this.check();
            return result;
          },
        });
        await this.check();
      });
      // Required lane precedes either authored restore or executor selection.
      await p.prepare({
        owner: p.scope.owner,
        profile: p.scope.profile,
        nativeVersion: original?.version ?? null,
      });
      await this.check();
      let authority = await p.custody({
        action: "status",
        profile: p.scope.profile,
      });
      if (
        !validOriginalScheduleCustodyReceipt(authority, p.scope.owner, {
          action: "status",
          profile: p.scope.profile,
        }) ||
        !("revision" in authority)
      )
        throw Error("Schedule authority unconfirmed");
      if (authority.revision === 0) {
        // Only initialize an absent authority. Never steal another device's selected lane.
        authority = await p.custody({
          action: "select",
          profile: p.scope.profile,
          expectedRevision: 0,
        });
        if (
          !validOriginalScheduleCustodyReceipt(authority, p.scope.owner, {
            action: "select",
            profile: p.scope.profile,
            expectedRevision: 0,
          }) ||
          !("revision" in authority)
        )
          throw Error("Schedule authority unconfirmed");
      }
      await this.check();
      const authorityRevision = authority.revision;
      const file = new OriginalScheduleFileRepository(
        repository,
        p.scope.profile,
        p.scope.timeZone,
        p.resources,
      );
      const directories = new OriginalScheduleDirectoryResources(
        p.scope,
        p.resources,
        p.python,
        p.stateRoot,
        () => this.check(),
        [
          p.stateRoot,
          ...[
            "jobs.json",
            ".jobs.lock",
            "execution-policy-required.json",
            "execution-bindings.json",
            "executions.db",
            "executions.db-wal",
            "executions.db-shm",
            "executions.db-journal",
          ].map((name) => join(p.home, "cron", name)),
        ],
      );
      const scripts = new OriginalScheduleScriptResources(
        p.scope,
        join(p.home, "scripts"),
        directories,
        () => this.check(),
      );
      const workdirs = new OriginalScheduleWorkdirResources(
        p.scope,
        directories,
        () => this.check(),
        (root, identity) => store.workdirIdentity(root, identity),
      );
      const runtime = new OriginalScheduleRuntimeBindings(
        p.scope,
        p.native,
        {
          assert: originalScheduleReplicationAdmission({
            scope: p.scope,
            authorityRevision,
            check: () => this.check(),
            custody: p.custody,
            source: async (direction) =>
              direction === "capture"
                ? (p.native.capture(p.scope.profile)?.sourceText ?? null)
                : ((await file.read())?.text ?? null),
          }),
        },
        () => this.check(),
      );
      const resources = new OriginalScheduleFileResourceBindings(
        scripts,
        workdirs,
        store,
        runtime,
        async () => {
          managedDirectory(scripts.root);
          return (await directories.capture(scripts.root)).pointer.manifest;
        },
        async (jobId, _manifest, identity) => {
          const captured = p.native.capture(p.scope.profile);
          const rows = captured
            ? Array.isArray(captured.file)
              ? captured.file
              : captured.file.jobs
            : [];
          const row = (Array.isArray(rows) ? rows : []).find(
            (value) =>
              value &&
              typeof value === "object" &&
              !Array.isArray(value) &&
              value.id === jobId,
          );
          const authored =
            row && typeof row === "object" && !Array.isArray(row)
              ? row.workdir
              : null;
          let root: string;
          const retained = identity ? store.workdirRoot(identity) : null;
          if (retained) root = retained;
          else if (typeof authored === "string" && isAbsolute(authored))
            root = resolve(authored);
          else if (typeof authored === "string" && authored.startsWith("~/"))
            root = resolve(homedir(), authored.slice(2));
          else if (
            authored === null ||
            authored === undefined ||
            authored === ""
          ) {
            root = join(
              p.home,
              "workspaces",
              "schedule-" + (identity ?? sha(jobId)),
            );
            managedDirectory(root);
          } else throw Error("Original schedule workdir binding unavailable");
          return {
            root,
            expectedManifest: (await directories.capture(root)).pointer
              .manifest,
          };
        },
        () => this.check(),
      );
      const native = new BoundOriginalScheduleNativePort(
        p.scope,
        p.native,
        resources,
        () => this.check(),
        store,
      );
      const replica = new OriginalScheduleFileReplica(file, native, store);
      this.replica = replica;
      const result = await replica.sync();
      await this.check();
      if (result.status !== "synced") return result;
      // Bind only the confirmed source/current resources. New edits are caught by Agent CAS.
      await store.exclusive(p.scope, async () => {
        const cloud = await file.read();
        const captured = await native.capture();
        await this.check();
        if (!cloud && captured.version === null) return;
        if (
          !cloud ||
          !captured.version ||
          captured.sourceDigest !== sha(cloud.text)
        )
          throw Error("Schedule source changed after synchronization");
        const anchor: OriginalScheduleAgentBinding = {
          owner: p.scope.owner,
          profile: p.scope.profile,
          sourceRevision: cloud.document.revision,
          sourceDigest: captured.sourceDigest,
          nativeVersion: captured.version,
          authorityRevision,
        };
        await p.bind(anchor);
        await this.check();
        this.manualAnchor = anchor;
        // Native capture needs the very same store lock used by resource bindings.
        this.manualCapture = () =>
          store.exclusive(p.scope, () => native.capture());
      });
      return result;
    } finally {
      this.running = false;
      this.replica = null;
      this.repository?.stop();
      this.repository = null;
    }
  }
}
