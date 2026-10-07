import { createProfileResourceTransport } from "@mithril/workspace/profile-resources";
import { createOriginalScheduleResourceTransport } from "@mithril/workspace/original-schedule-resources";
import {
  createTaskAttachmentTransport,
  type TaskAttachmentTransport,
} from "@mithril/workspace/task-attachments";
import {
  createCapabilityResourceTransport,
  type CapabilityResourceTransport,
} from "@mithril/workspace/capability-resources";
import { createDiscoverDocuments } from "@mithril/workspace/discover-documents";
import {
  registryBundleBytes,
  type RegistrySkillBundle,
} from "@mithril/workspace/registry-bundle";
import {
  repositoryCollections,
  createRepositoryTransport,
  validRepositoryEdit,
  validRepositoryPage,
  validRepositoryReceipt,
  validRepositoryHistory,
  type RepositoryCollection,
  type RepositoryEdit,
} from "@mithril/workspace/repository";
import type { TokenBalancesResponse } from "@mithril/workspace/desktop-wallet-types";
import {
  validSecuritySnapshot,
  validSecuritySubmit,
  type SecuritySnapshot,
  type SecuritySubmit,
} from "@mithril/workspace/security";
import {
  validScheduleEdit,
  validCloudSchedule,
  type ScheduleEdit,
  type ScheduleSnapshot,
  type ScheduleResult,
} from "@mithril/workspace/schedules";
import {
  validSidebarOperation,
  validSidebarSnapshot,
  validPlacement,
  type SidebarOperation,
  type SidebarResult,
  type SidebarSnapshot,
} from "@mithril/workspace/sidebar";
import {
  CHUNK_BYTES,
  MAX_MANIFEST_BYTES,
  createProjectFileTransport,
  type ProjectFileTransport,
} from "@mithril/workspace/files";
import {
  validateData,
  validateOperation,
  validId,
  type WorkspaceRecord,
  type WorkspaceOperationsResponse,
  type WorkspaceOperation,
  type WorkspaceSnapshot,
} from "@mithril/workspace/protocol";
import type { CloudWorkspaceStatus } from "../shared/workspace";
import { createHash } from "crypto";
import {
  ORIGINAL_SCHEDULE_CUSTODY_BYTES,
  validOriginalScheduleCustodyCommand,
  validOriginalScheduleCustodyReceipt,
  type OriginalScheduleCustodyCommand,
  type OriginalScheduleCustodyReceipt,
} from "./original-schedule-custody";

import {
  ORIGINAL_MANUAL_BYTES,
  validOriginalManualCommand,
  validOriginalManualResult,
  type OriginalManualCommand,
  type OriginalManualResult,
} from "./original-schedule-manual";

interface Dependencies {
  token(): string | null;
  profile(): string;
  origin(): string;
  fetch: typeof fetch;
  changed(): void;
  readScope?: string;
  writeScope?: string;
}

function validRecord(value: unknown): value is WorkspaceRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as WorkspaceRecord;
  return (
    Object.keys(record).every((key) =>
      ["id", "kind", "revision", "data", "deleted", "updatedAt"].includes(key),
    ) &&
    validId(record.id) &&
    Number.isSafeInteger(record.revision) &&
    record.revision > 0 &&
    typeof record.deleted === "boolean" &&
    Number.isSafeInteger(record.updatedAt) &&
    validateData(record.kind, record.data)
  );
}

// @lat: [[cloud-workspace#Cloud workspace#Main process boundary]]
export class CloudWorkspace {
  private identity: {
    token: string;
    profile: string;
    userId: string;
    scopes: string[];
  } | null = null;
  private enabled = false;
  private generation = 0;
  readonly taskAttachments: TaskAttachmentTransport;
  readonly files: ProjectFileTransport;
  readonly capabilityResources: CapabilityResourceTransport;
  readonly scheduleResources: CapabilityResourceTransport;
  readonly profileResources: CapabilityResourceTransport;
  constructor(private deps: Dependencies) {
    this.profileResources = createProfileResourceTransport((path, init) =>
      this.authorizedBinaryRequest(path, init),
    );
    this.taskAttachments = createTaskAttachmentTransport((path, init) =>
      this.authorizedBinaryRequest(path, init),
    );
    this.scheduleResources = createOriginalScheduleResourceTransport(
      (path, init) => this.authorizedBinaryRequest(path, init),
    );
    this.capabilityResources = createCapabilityResourceTransport((path, init) =>
      this.authorizedBinaryRequest(path, init),
    );
    this.files = createProjectFileTransport((path, init) =>
      this.authorizedBinaryRequest(path, init),
    );
  }
  /** Owner/generation-checked bytes for fixed file routes; credentials stay in main. */
  async authorizedBinaryRequest(
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    if (
      !/^\/v1\/(?:workspace\/files(?:\/|$)|workspace\/resources\/(?:capability|task|schedule|profile)\/[a-zA-Z0-9_-]{1,128}\/(?:chunks|manifests)(?:\/[a-f0-9]{64})?$|chat\/sessions\/[a-zA-Z0-9_-]{1,128}\/attachments\/chunks(?:\/[a-f0-9]{64})?$)/.test(
        path,
      ) ||
      (!["GET", "POST"].includes(init?.method ?? "GET") &&
        !(
          init?.method === "HEAD" &&
          /^\/v1\/workspace\/resources\/(?:capability|task|schedule|profile)\/[a-zA-Z0-9_-]{1,128}\/chunks\/[a-f0-9]{64}$/.test(
            path,
          )
        ))
    )
      throw Error("Unsupported binary route");
    if (
      /^\/v1\/workspace\/resources\/task\//.test(path) &&
      !/^\/v1\/workspace\/resources\/task\/[a-zA-Z0-9_-]{1,100}\/chunks(?:\/[a-f0-9]{64})?$/.test(
        path,
      )
    )
      throw Error("Unsupported task attachment route");
    if (
      /^\/v1\/workspace\/resources\/schedule\//.test(path) &&
      !/^\/v1\/workspace\/resources\/schedule\/schedule-source-[a-f0-9]{64}\/(?:chunks|manifests)(?:\/[a-f0-9]{64})?$/.test(
        path,
      )
    )
      throw Error("Unsupported schedule resource route");
    if (
      /^\/v1\/workspace\/resources\/profile\//.test(path) &&
      !/^\/v1\/workspace\/resources\/profile\/profile-metadata-[a-f0-9]{64}\/(?:chunks|manifests)(?:\/[a-f0-9]{64})?$/.test(
        path,
      )
    )
      throw Error("Unsupported profile resource route");
    const session = await this.session(),
      generation = this.generation;
    if (
      init?.method === "POST" &&
      !session.scopes.includes(this.deps.writeScope ?? "workspace:write")
    )
      throw new Error("Workspace write scope required");
    const headers = new Headers(init?.headers);
    const requestedOwner = headers.get("x-mithril-workspace-owner");
    if (requestedOwner !== null && requestedOwner !== session.userId)
      throw new Error("Workspace owner changed; file request rejected");
    headers.set("x-mithril-workspace-owner", session.userId);
    headers.set("authorization", `Bearer ${session.token}`);
    const response = await this.deps.fetch(`${this.deps.origin()}${path}`, {
      ...init,
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(60000),
      headers,
    });
    const limit = /\/manifests(?:\/|$)/.test(path)
      ? MAX_MANIFEST_BYTES
      : CHUNK_BYTES;
    if (Number(response.headers.get("content-length") ?? 0) > limit)
      throw new Error("File response too large");
    const reader = response.body?.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      if (reader)
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > limit) throw new Error("File response too large");
          parts.push(value);
        }
    } finally {
      await reader?.cancel().catch(() => {});
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    if (
      generation !== this.generation ||
      session.token !== this.deps.token() ||
      session.profile !== this.deps.profile()
    )
      throw new Error("Account changed; file response discarded");
    if (response.status === 401 || response.status === 403) this.reset(false);
    return new Response(bytes, {
      status: response.status,
      headers: response.headers,
    });
  }

  // @lat: [[cloud-workspace#Cloud workspace#Canonical catalog]]
  readonly discoverDocuments = createDiscoverDocuments((path) =>
    this.deps.fetch(`${this.deps.origin()}${path}`, {
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(60000),
      headers: { accept: "application/json" },
    }),
  );

  // @lat: [[discover#Original Discover#Shared marketplace]]
  async registrySkill(
    item: import("@mithril/workspace/desktop-discover").RegistryItem,
  ): Promise<RegistrySkillBundle> {
    if (
      !item ||
      !["hermes", "mithril"].includes(item.registry ?? "") ||
      typeof item.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(item.id)
    )
      throw Error("Invalid registry entry");
    const session = await this.session();
    const bundle = (await this.request(
      `/v1/discover/bundle/${item.registry}/${item.id}`,
      session.token,
      session.profile,
      undefined,
      60000,
    )) as RegistrySkillBundle;
    if (bundle?.source !== item.registry || bundle.id !== item.id)
      throw Error("Registry selection changed");
    await registryBundleBytes(bundle);
    return bundle;
  }

  // @lat: [[cloud-workspace#Cloud workspace#Canonical catalog]]
  async catalog(): Promise<import("@mithril/workspace/react").DiscoverItem[]> {
    const response = await this.deps.fetch(
      `${this.deps.origin()}/v1/discover/catalog`,
      {
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: { accept: "application/json" },
      },
    );
    if (!response.ok) throw new Error("Catalog unavailable");
    const value: unknown = await response.json();
    if (!Array.isArray(value) || value.length > 2000)
      throw new Error("Invalid catalog");
    return value;
  }

  reset(explicitIdentityChange = true): void {
    const notify =
      explicitIdentityChange || this.identity !== null || this.enabled;
    this.generation++;
    this.identity = null;
    this.enabled = false;
    if (notify) this.deps.changed();
  }

  /** Main-process context only. Credential fingerprints and epochs never leave main; fixed snapshots may include the profile identity. */
  async nativeContext(write = false): Promise<{
    userId: string;
    profile: string;
    epoch: number;
    actor: string;
  }> {
    const epoch = this.generation;
    const identity = await this.session();
    if (
      write &&
      !identity.scopes.includes(this.deps.writeScope ?? "workspace:write")
    )
      throw Error(
        "Native replica writes require workspace:write authorization",
      );
    if (
      epoch !== this.generation ||
      identity.token !== this.deps.token() ||
      identity.profile !== this.deps.profile()
    )
      throw new Error(
        "Workspace account changed; stale native context discarded",
      );
    return {
      userId: identity.userId,
      profile: identity.profile,
      epoch: this.generation,
      actor: createHash("sha256").update(identity.token).digest("hex"),
    };
  }

  /** Cheap main-only guard between I/O stages; reauthentication stays at operation boundaries. */
  assertNativeContext(context: {
    userId: string;
    profile: string;
    epoch: number;
    actor: string;
  }): void {
    const identity = this.identity;
    if (
      !this.enabled ||
      !identity ||
      context.epoch !== this.generation ||
      context.userId !== identity.userId ||
      context.profile !== identity.profile ||
      identity.token !== this.deps.token() ||
      identity.profile !== this.deps.profile() ||
      context.actor !==
        createHash("sha256").update(identity.token).digest("hex")
    )
      throw Error("Workspace account changed; stale native context discarded");
  }

  private async request(
    path: string,
    token: string,
    profile: string,
    body?: unknown,
    timeoutMs = 15000,
    responseLimit?: number,
    expectedOwner?: string,
  ): Promise<unknown> {
    const generation = this.generation;
    if (token !== this.deps.token() || profile !== this.deps.profile()) {
      this.reset(false);
      throw new Error("Workspace account changed; enable sync again");
    }
    let response: Response;
    try {
      response = await this.deps.fetch(`${this.deps.origin()}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(expectedOwner === undefined
            ? {}
            : { "x-mithril-workspace-owner": expectedOwner }),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new Error(
        "Workspace network unavailable; reconnect to check pending changes",
      );
    }
    if (generation !== this.generation) {
      throw new Error("Workspace account changed; stale response discarded");
    }
    if (token !== this.deps.token() || profile !== this.deps.profile()) {
      this.reset(false);
      throw new Error("Workspace account changed; enable sync again");
    }
    if (response.status === 401 || response.status === 403) {
      this.reset(false);
      throw new Error("Workspace sign-in expired or access refused");
    }
    if (!response.ok)
      throw new Error(`Workspace request failed (${response.status})`);
    let value: unknown;
    if (responseLimit !== undefined) {
      if (Number(response.headers.get("content-length") ?? 0) > responseLimit) {
        await response.body?.cancel().catch(() => {});
        throw Error("Schedule execution receipt unconfirmed");
      }
      const reader = response.body?.getReader();
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        if (reader)
          for (;;) {
            const { done, value: part } = await reader.read();
            if (done) break;
            size += part.length;
            if (size > responseLimit)
              throw Error("Schedule execution receipt unconfirmed");
            parts.push(part);
          }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const part of parts) {
          bytes.set(part, offset);
          offset += part.length;
        }
        value = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
      } catch {
        throw Error("Schedule execution receipt unconfirmed");
      } finally {
        await reader?.cancel().catch(() => {});
      }
    } else value = await response.json().catch(() => null);
    if (generation !== this.generation) {
      throw new Error("Workspace account changed; stale response discarded");
    }
    if (token !== this.deps.token() || profile !== this.deps.profile()) {
      this.reset(false);
      throw new Error("Workspace account changed; enable sync again");
    }
    return value;
  }

  async status(): Promise<CloudWorkspaceStatus> {
    const token = this.deps.token();
    const profile = this.deps.profile();
    if (!token || !/^mf_[A-Za-z0-9_-]{43}$/.test(token)) {
      if (this.identity) this.reset(false);
      return { userId: null, enabled: false };
    }
    if (
      this.identity &&
      (token !== this.identity.token || profile !== this.identity.profile)
    )
      this.reset(false);
    const generation = this.generation;
    const me = (await this.request("/v1/me", token, profile)) as {
      user?: { id?: unknown };
      via?: unknown;
      scopes?: unknown;
    } | null;
    if (generation !== this.generation)
      throw new Error("Workspace account changed; stale response discarded");
    if (
      me?.via !== "api_token" ||
      typeof me.user?.id !== "string" ||
      !me.user.id ||
      !Array.isArray(me.scopes) ||
      !me.scopes.every((scope) => typeof scope === "string")
    ) {
      this.reset(false);
      throw new Error("Workspace identity response invalid");
    }
    if (this.identity && this.identity.userId !== me.user.id) this.reset(false);
    if (!me.scopes.includes(this.deps.readScope ?? "workspace:read")) {
      this.reset(false);
      throw new Error(
        `Cloud connection requires explicit ${this.deps.readScope ?? "workspace:read"} authorization. Existing tokens are never upgraded automatically.`,
      );
    }
    this.identity = { token, profile, userId: me.user.id, scopes: me.scopes };
    return { userId: me.user.id, enabled: this.enabled };
  }

  async enable(): Promise<CloudWorkspaceStatus> {
    const token = this.deps.token();
    const profile = this.deps.profile();
    if (
      this.identity &&
      (this.identity.token !== token || this.identity.profile !== profile)
    )
      this.reset(false);
    const generation = this.generation;
    const status = await this.status();
    if (
      generation !== this.generation ||
      token !== this.deps.token() ||
      profile !== this.deps.profile()
    )
      throw new Error("Workspace account changed; enable sync again");
    if (!status.userId)
      throw new Error("Sign in to your Mithril account first");
    if (
      !this.identity?.scopes.includes(this.deps.writeScope ?? "workspace:write")
    )
      throw new Error(
        `Cloud connection requires explicit ${this.deps.writeScope ?? "workspace:write"} authorization. Existing tokens are never upgraded automatically.`,
      );
    this.enabled = true;
    return { ...status, enabled: true };
  }

  private async session(): Promise<NonNullable<CloudWorkspace["identity"]>> {
    const generation = this.generation;
    await this.status();
    if (generation !== this.generation)
      throw new Error("Workspace account changed; stale response discarded");
    if (!this.enabled || !this.identity)
      throw new Error("Enable Cloud Workspace sync before accessing user data");
    return this.identity;
  }

  private checkOwner(
    value: { schemaVersion?: unknown; userId?: unknown },
    userId: string,
    generation: number,
  ): void {
    if (generation !== this.generation)
      throw new Error("Workspace account changed; stale response discarded");
    if (value?.schemaVersion !== 1 || value?.userId !== userId) {
      this.reset(false);
      throw new Error("Workspace owner/schema mismatch");
    }
  }

  async repositoryPage(
    collection: RepositoryCollection,
    after?: string,
  ): Promise<import("@mithril/workspace/repository").RepositoryPage> {
    if (
      !repositoryCollections.includes(collection) ||
      (after !== undefined && !validId(after))
    )
      throw Error("Invalid repository page");
    const { value } = await this.authorizedRequest(
      `/v1/workspace/repository/${collection}${after ? `?after=${encodeURIComponent(after)}` : ""}`,
      undefined,
      collection === "chat" ? "chat:read" : undefined,
    );
    if (!validRepositoryPage(value, collection, after))
      throw Error("Invalid repository page");
    return value;
  }

  /** Public balances use the same fixed route and validator as the Web consumer. */
  async walletBalances(id: string): Promise<TokenBalancesResponse> {
    if (!/^wallet-[a-f0-9]{64}$/.test(id))
      throw Error("Invalid wallet identity");
    const session = await this.session();
    const transport = createRepositoryTransport(async (path) => {
      if (path !== `/v1/workspace/wallets/${id}/balances`)
        throw Error("Invalid wallet route");
      const value = await this.request(path, session.token, session.profile);
      return new Response(JSON.stringify(value), {
        headers: { "content-type": "application/json" },
      });
    });
    return transport.walletBalances!(id);
  }
  async repositoryHistory(
    collection: RepositoryCollection,
    id: string,
    before = 0,
  ): Promise<import("@mithril/workspace/repository").RepositoryHistory> {
    if (
      !repositoryCollections.includes(collection) ||
      !validId(id) ||
      id.length > 100 ||
      !Number.isSafeInteger(before) ||
      before < 0
    )
      throw Error("Invalid repository history");
    const { value } = await this.authorizedRequest(
      `/v1/workspace/repository/${collection}/${encodeURIComponent(id)}/history${before ? `?before=${before}` : ""}`,
      undefined,
      collection === "chat" ? "chat:read" : undefined,
    );
    if (!validRepositoryHistory(value, collection, id, before))
      throw Error("Invalid repository history");
    return value;
  }
  async repositoryApply(
    edit: RepositoryEdit,
  ): Promise<import("@mithril/workspace/repository").RepositoryReceipt> {
    if (!validRepositoryEdit(edit)) throw Error("Invalid repository edit");
    const { value } = await this.authorizedRequest(
      `/v1/workspace/repository/${edit.collection}`,
      edit,
      edit.collection === "chat" ? "chat:write" : undefined,
    );
    if (!validRepositoryReceipt(value, edit))
      throw Error("Invalid repository receipt");
    return value;
  }

  /** Main-only authenticated transport; callers expose only fixed, schema-checked routes. */
  async authorizedRequest(
    path: string,
    body?: unknown,
    extraScope?: string | readonly string[],
  ): Promise<{ value: unknown; userId: string }> {
    const session = await this.session();
    const generation = this.generation;
    if (
      body !== undefined &&
      !session.scopes.includes(this.deps.writeScope ?? "workspace:write")
    )
      throw new Error("Explicit write authorization required");
    for (const scope of typeof extraScope === "string"
      ? [extraScope]
      : (extraScope ?? [])) {
      if (!session.scopes.includes(scope))
        throw new Error(`Explicit ${scope} authorization required`);
    }
    const value = await this.request(
      path,
      session.token,
      session.profile,
      body,
    );
    this.checkOwner(
      value as { schemaVersion?: unknown; userId?: unknown },
      session.userId,
      generation,
    );
    return { value, userId: session.userId };
  }

  // @lat: [[cloud-workspace#Cloud workspace#Security diagnostics]]
  async getSecurity(): Promise<SecuritySnapshot> {
    const { value } = await this.authorizedRequest(
      "/v1/security",
      undefined,
      "security:read",
    );
    if (!validSecuritySnapshot(value))
      throw Error("Security snapshot rejected");
    return value;
  }
  async submitSecurity(operation: SecuritySubmit): Promise<SecuritySnapshot> {
    if (!validSecuritySubmit(operation))
      throw Error("Invalid security operation");
    const { value } = await this.authorizedRequest(
      "/v1/security",
      operation,
      "security:run",
    );
    if (!validSecuritySnapshot(value))
      throw Error("Security snapshot rejected");
    return value;
  }
  async getSchedules(): Promise<ScheduleSnapshot> {
    const { value } = await this.authorizedRequest("/v1/schedules");
    const snapshot = value as ScheduleSnapshot;
    if (
      !Array.isArray(snapshot.schedules) ||
      snapshot.schedules.length > 100 ||
      !snapshot.schedules.every(validCloudSchedule)
    )
      throw Error("Schedule snapshot rejected");
    return snapshot;
  }
  /** Main-only original schedule custody. No renderer IPC, scope upgrade or mutation retry. */
  // @lat: [[cloud-workspace#Original schedule main execution transport (draft)]]
  async originalScheduleCustody(
    command: OriginalScheduleCustodyCommand,
    context?: Parameters<CloudWorkspace["assertNativeContext"]>[0],
  ): Promise<OriginalScheduleCustodyReceipt> {
    if (
      !validOriginalScheduleCustodyCommand(command) ||
      (!context && command.profile !== this.deps.profile())
    )
      throw Error("Invalid original schedule execution command");
    if (context) this.assertNativeContext(context);
    const request = structuredClone(command);
    if (
      new TextEncoder().encode(JSON.stringify(request)).length >
      ORIGINAL_SCHEDULE_CUSTODY_BYTES
    )
      throw Error("Invalid original schedule execution command");
    const session = await this.session();
    if (context) this.assertNativeContext(context);
    if (
      context
        ? session.userId !== context.userId
        : session.profile !== request.profile
    )
      throw Error("Workspace account changed; schedule request discarded");
    if (
      !["workspace:write", "chat:write", "inference"].every((scope) =>
        session.scopes.includes(scope),
      )
    )
      throw Error("Original schedule execution authorization required");
    const value = await this.request(
      "/v1/schedules/original/execution",
      session.token,
      session.profile,
      request,
      15000,
      ORIGINAL_SCHEDULE_CUSTODY_BYTES,
    );
    if (context) this.assertNativeContext(context);
    if (!validOriginalScheduleCustodyReceipt(value, session.userId, request))
      throw Error("Schedule execution receipt unconfirmed");
    return value;
  }
  /** Main-only manual consumer; never retries a lost take or invents an executor. */
  // @lat: [[cloud-workspace#Original manual main consumer transport (draft)]]
  async originalScheduleManual(
    command: OriginalManualCommand,
    context?: Parameters<CloudWorkspace["assertNativeContext"]>[0],
  ): Promise<OriginalManualResult> {
    if (
      !validOriginalManualCommand(command) ||
      (!context && command.profile !== this.deps.profile())
    )
      throw Error("Invalid original manual execution command");
    if (context) this.assertNativeContext(context);
    const input = structuredClone(command);
    const session = await this.session();
    if (context) this.assertNativeContext(context);
    if (
      context
        ? session.userId !== context.userId
        : session.profile !== input.profile
    )
      throw Error("Workspace account changed; schedule request discarded");
    if (
      !["workspace:write", "chat:write", "inference"].every((scope) =>
        session.scopes.includes(scope),
      )
    )
      throw Error("Original schedule execution authorization required");
    const value = await this.request(
      "/v1/schedules/original/manual",
      session.token,
      session.profile,
      input,
      15000,
      ORIGINAL_MANUAL_BYTES,
    );
    if (context) this.assertNativeContext(context);
    if (!validOriginalManualResult(value, session.userId, input))
      throw Error("Schedule execution receipt unconfirmed");
    return value;
  }
  async applySchedule(operation: ScheduleEdit): Promise<ScheduleResult> {
    if (!validScheduleEdit(operation)) throw Error("Invalid schedule edit");
    const { value } = await this.authorizedRequest("/v1/schedules", operation, [
      "chat:write",
      "inference",
    ]);
    const result = value as ScheduleResult;
    if (
      result.operationId !== operation.operationId ||
      !["accepted", "conflict"].includes(result.status) ||
      (result.schedule !== null && !validCloudSchedule(result.schedule))
    )
      throw Error("Schedule receipt rejected");
    return result;
  }
  async getSidebar(): Promise<SidebarSnapshot> {
    const { value, userId } = await this.authorizedRequest(
      "/v1/workspace/sidebar",
    );
    if (!validSidebarSnapshot(value as SidebarSnapshot, userId))
      throw new Error("Sidebar owner/schema mismatch");
    return value as SidebarSnapshot;
  }
  async applySidebar(operation: SidebarOperation): Promise<SidebarResult> {
    if (!validSidebarOperation(operation))
      throw new Error("Invalid sidebar operation");
    let response: { value: unknown; userId: string };
    try {
      response = await this.authorizedRequest(
        "/v1/workspace/sidebar",
        operation,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        /Workspace request failed \((400|409)\)/.test(error.message)
      )
        throw new Error(
          "[sidebar-rejected] Review the current chat and project.",
        );
      throw error;
    }
    const { value, userId } = response;
    const result = value as SidebarResult;
    if (
      result.userId !== userId ||
      result.operationId !== operation.operationId ||
      !["accepted", "conflict"].includes(result.status) ||
      (result.placement !== null &&
        (!validPlacement(result.placement) ||
          result.placement.chatId !== operation.chatId))
    )
      throw new Error("Sidebar receipt mismatch");
    return result;
  }
  async getSnapshot(): Promise<WorkspaceSnapshot> {
    const session = await this.session();
    const generation = this.generation;
    const snapshot = (await this.request(
      "/v1/workspace?files=1",
      session.token,
      session.profile,
    )) as WorkspaceSnapshot;
    this.checkOwner(snapshot, session.userId, generation);
    if (
      !Number.isSafeInteger(snapshot.cursor) ||
      !Array.isArray(snapshot.records) ||
      !snapshot.records.every(validRecord)
    )
      throw new Error("Workspace snapshot invalid");
    return snapshot;
  }

  async applyOperations(
    operations: WorkspaceOperation[],
    expectedOwner?: string,
  ): Promise<WorkspaceOperationsResponse> {
    if (
      !Array.isArray(operations) ||
      operations.length < 1 ||
      operations.length > 50 ||
      !operations.every(validateOperation) ||
      new Set(operations.map((op) => op.operationId)).size !== operations.length
    )
      throw new Error("Unsupported workspace operations");
    const session = await this.session();
    const generation = this.generation;
    if (expectedOwner !== undefined && expectedOwner !== session.userId)
      throw new Error("Workspace owner changed; saved changes were not sent");
    if (!session.scopes.includes(this.deps.writeScope ?? "workspace:write"))
      throw new Error(
        "Editing requires explicit workspace:write authorization",
      );
    const response = (await this.request(
      "/v1/workspace/operations",
      session.token,
      session.profile,
      { schemaVersion: 1, operations },
      15000,
      undefined,
      session.userId,
    )) as WorkspaceOperationsResponse;
    this.checkOwner(response, session.userId, generation);
    if (
      !Array.isArray(response.results) ||
      response.results.length !== operations.length ||
      new Set(response.results.map((result) => result.operationId)).size !==
        operations.length ||
      !response.results.every(
        (result) =>
          operations.some((op) => op.operationId === result.operationId) &&
          ["accepted", "conflict"].includes(result.status) &&
          (result.record === null ||
            (validRecord(result.record) &&
              operations.some(
                (op) =>
                  op.operationId === result.operationId &&
                  op.id === result.record!.id &&
                  op.kind === result.record!.kind,
              ))),
      )
    )
      throw new Error("Workspace operation response invalid");
    return response;
  }

  async history(
    id: string,
    offset = 0,
  ): Promise<{
    schemaVersion: 1;
    userId: string;
    records: WorkspaceRecord[];
    hasMore: boolean;
    nextOffset: number | null;
  }> {
    if (!validId(id)) throw new Error("Invalid workspace record ID");
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
      throw new Error("Invalid workspace history offset");
    const session = await this.session();
    const generation = this.generation;
    const response = (await this.request(
      `/v1/workspace/history/${encodeURIComponent(id)}?offset=${offset}`,
      session.token,
      session.profile,
    )) as {
      schemaVersion: 1;
      userId: string;
      records: WorkspaceRecord[];
      hasMore: boolean;
      nextOffset: number | null;
    };
    this.checkOwner(response, session.userId, generation);
    if (
      !response ||
      !Array.isArray(response.records) ||
      !response.records.every(
        (record) => validRecord(record) && record.id === id,
      )
    )
      throw new Error("Workspace history invalid");
    if (
      typeof response.hasMore !== "boolean" ||
      (response.hasMore
        ? !Number.isSafeInteger(response.nextOffset) ||
          response.nextOffset! <= offset
        : response.nextOffset !== null)
    )
      throw new Error("Workspace history pagination invalid");
    return response;
  }
}
