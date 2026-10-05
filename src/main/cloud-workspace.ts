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
  readonly files: ProjectFileTransport;
  constructor(private deps: Dependencies) {
    this.files = createProjectFileTransport(async (path, init) => {
      const session = await this.session(),
        generation = this.generation;
      if (
        init?.method === "POST" &&
        !session.scopes.includes(this.deps.writeScope ?? "workspace:write")
      )
        throw new Error("Workspace write scope required");
      const response = await this.deps.fetch(`${this.deps.origin()}${path}`, {
        ...init,
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(60000),
        headers: {
          "x-mithril-workspace-owner": session.userId,
          ...init?.headers,
          authorization: `Bearer ${session.token}`,
        },
      });
      const bytes = await response.arrayBuffer();
      if (
        generation !== this.generation ||
        session.token !== this.deps.token() ||
        session.profile !== this.deps.profile()
      )
        throw new Error("Account changed; file response discarded");
      if (response.status === 401 || response.status === 403) this.reset();
      return new Response(bytes, {
        status: response.status,
        headers: response.headers,
      });
    });
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

  reset(): void {
    this.generation++;
    this.identity = null;
    this.enabled = false;
    this.deps.changed();
  }

  /** Main-process context only. Neither credential fingerprint nor profile is exposed through workspace IPC. */
  async nativeContext(): Promise<{
    userId: string;
    profile: string;
    epoch: number;
    actor: string;
  }> {
    const epoch = this.generation;
    const identity = await this.session();
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

  private async request(
    path: string,
    token: string,
    profile: string,
    body?: unknown,
  ): Promise<unknown> {
    const generation = this.generation;
    if (token !== this.deps.token() || profile !== this.deps.profile()) {
      this.reset();
      throw new Error("Workspace account changed; enable sync again");
    }
    let response: Response;
    try {
      response = await this.deps.fetch(`${this.deps.origin()}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
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
      this.reset();
      throw new Error("Workspace account changed; enable sync again");
    }
    if (response.status === 401 || response.status === 403) {
      this.reset();
      throw new Error("Workspace sign-in expired or access refused");
    }
    if (!response.ok)
      throw new Error(`Workspace request failed (${response.status})`);
    const value: unknown = await response.json().catch(() => null);
    if (generation !== this.generation) {
      throw new Error("Workspace account changed; stale response discarded");
    }
    if (token !== this.deps.token() || profile !== this.deps.profile()) {
      this.reset();
      throw new Error("Workspace account changed; enable sync again");
    }
    return value;
  }

  async status(): Promise<CloudWorkspaceStatus> {
    const token = this.deps.token();
    const profile = this.deps.profile();
    if (!token || !/^mf_[A-Za-z0-9_-]{43}$/.test(token)) {
      if (this.identity) this.reset();
      return { userId: null, enabled: false };
    }
    if (
      this.identity &&
      (token !== this.identity.token || profile !== this.identity.profile)
    )
      this.reset();
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
      this.reset();
      throw new Error("Workspace identity response invalid");
    }
    if (this.identity && this.identity.userId !== me.user.id) this.reset();
    this.identity = { token, profile, userId: me.user.id, scopes: me.scopes };
    if (!me.scopes.includes(this.deps.readScope ?? "workspace:read")) {
      this.reset();
      throw new Error(
        `Cloud connection requires explicit ${this.deps.readScope ?? "workspace:read"} authorization. Existing tokens are never upgraded automatically.`,
      );
    }
    return { userId: me.user.id, enabled: this.enabled };
  }

  async enable(): Promise<CloudWorkspaceStatus> {
    const token = this.deps.token();
    const profile = this.deps.profile();
    if (
      this.identity &&
      (this.identity.token !== token || this.identity.profile !== profile)
    )
      this.reset();
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
      this.reset();
      throw new Error("Workspace owner/schema mismatch");
    }
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
    if (!session.scopes.includes(this.deps.writeScope ?? "workspace:write"))
      throw new Error(
        "Editing requires explicit workspace:write authorization",
      );
    const response = (await this.request(
      "/v1/workspace/operations",
      session.token,
      session.profile,
      { schemaVersion: 1, operations },
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
