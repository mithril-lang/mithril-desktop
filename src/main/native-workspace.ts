import { createHash, randomUUID } from "crypto";
import {
  portableText,
  validateRuntimeOperation,
  type RuntimeSection,
  type RuntimeSnapshot,
  type RuntimeOperation,
  type NativeImportCandidate,
  type NativeImportPreview,
  type NativeImportChoice,
  type WorkspaceRuntimeAdapter,
  type RuntimePluginSummary,
  type RuntimePluginPlan,
} from "@mithril/workspace/runtime";
import {
  validateData,
  type WorkspaceKind,
  type WorkspaceData,
  type WorkspaceOperation,
  type WorkspaceSnapshot,
  type WorkspaceOperationsResponse,
} from "@mithril/workspace/protocol";
import type { MemoryInfo } from "./memory";
import type { ProfileInfo } from "./profiles";
import type { ToolsetInfo } from "./tools";
import type { McpServerInfo } from "./mcp-servers";
import type { InstalledSkill } from "./skills";
import type { KanbanBoard, KanbanTask } from "./kanban";

export interface NativeContext {
  userId: string;
  profile: string;
  epoch: number;
  actor: string;
}
export interface NativeSources {
  mode(): string;
  context(): Promise<NativeContext>;
  namespace(): string;
  now(): number;
  memory(profile: string): MemoryInfo;
  provider(profile: string): string | null;
  profiles(): Promise<ProfileInfo[]>;
  toolsets(profile: string): ToolsetInfo[];
  servers(profile: string): Promise<McpServerInfo[]>;
  skills(profile: string): InstalledSkill[];
  plugins?(profile: string): Promise<RuntimePluginSummary[]>;
  boards(profile: string): Promise<KanbanBoard[]>;
  tasks(profile: string): Promise<KanbanTask[]>;
  locale(): string;
  locales: readonly string[];
  setLocale(locale: string): void;
  snapshot(): Promise<WorkspaceSnapshot>;
  operations(
    operations: WorkspaceOperation[],
  ): Promise<WorkspaceOperationsResponse>;
}
const hash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const OMITTED =
  "[Excluded: sensitive or device-specific text; review in the native screen]";
/** Conservative known-pattern guard; explicit human preview is still required for arbitrary authored text. */
export function portableNativeText(value: unknown): value is string {
  return (
    portableText(value) &&
    !/(?:\bAKIA[A-Z0-9]{16}\b|\bBearer\s+\S+|\bmf_session\s*=|(?:file|ssh):\/\/|(?:^|\s|["'=:(])\/(?:[A-Za-z0-9._~-]+\/)+[A-Za-z0-9._~-]*|\b[A-Z]:\\)/im.test(
      value,
    )
  );
}
const text = (value: unknown, max = 16000): string =>
  typeof value === "string" && value.length <= max && portableNativeText(value)
    ? value
    : OMITTED;
const sameContext = (a: NativeContext, b: NativeContext): boolean =>
  a.userId === b.userId &&
  a.profile === b.profile &&
  a.epoch === b.epoch &&
  a.actor === b.actor;
const sections: RuntimeSection[] = [
  "discover",
  "office",
  "kanban",
  "projects",
  "capability",
  "memory",
  "settings",
  "profile",
];

// @lat: [[canonical-chat#Canonical Mithril chat#Native runtime views]]
export class NativeWorkspace implements WorkspaceRuntimeAdapter {
  private previews = new Map<
    string,
    {
      context: NativeContext;
      preview: NativeImportPreview;
      operationIds: Map<string, string>;
      signature?: string;
      completed?: WorkspaceOperationsResponse;
      inFlight?: Promise<WorkspaceOperationsResponse>;
    }
  >();
  private pluginPlans = new Map<
    string,
    { context: NativeContext; plan: RuntimePluginPlan; expiresAt: number }
  >();
  constructor(private sources: NativeSources) {}
  reset(): void {
    this.previews.clear();
    this.pluginPlans.clear();
  }
  private async check(context: NativeContext): Promise<void> {
    if (!sameContext(context, await this.sources.context()))
      throw new Error(
        "Workspace account or profile changed; discard this native preview",
      );
    if (this.sources.mode() !== "local")
      throw new Error(
        "Native workspace inspection requires the selected local connection",
      );
  }
  private revision(
    context: NativeContext,
    section: RuntimeSection,
    value: unknown,
  ): string {
    return hash([
      context.userId,
      context.profile,
      context.actor,
      context.epoch,
      section,
      value,
    ]);
  }

  async inspect(section: RuntimeSection): Promise<RuntimeSnapshot> {
    if (!sections.includes(section))
      throw new Error("Unsupported native section");
    const context = await this.sources.context();
    await this.check(context);
    const base = {
      schemaVersion: 1 as const,
      userId: context.userId,
      source: "desktop" as const,
    };
    if (section === "memory") {
      const memory = this.sources.memory(context.profile);
      const provider = this.sources.provider(context.profile);
      return {
        ...base,
        section,
        revision: this.revision(context, section, memory),
        data: {
          entries: memory.memory.entries.map((entry) => ({
            index: entry.index,
            content: text(entry.content),
            ...(!portableNativeText(entry.content) ? { redacted: true } : {}),
          })),
          userProfile: text(memory.user.content),
          ...(!portableNativeText(memory.user.content)
            ? { userProfileRedacted: true }
            : {}),
          memoryChars: memory.memory.charCount,
          memoryLimit: memory.memory.charLimit,
          userChars: memory.user.charCount,
          userLimit: memory.user.charLimit,
          stats: memory.stats,
          ...(provider && portableNativeText(provider) && provider.length <= 80
            ? { provider }
            : {}),
        },
        unavailable: [
          ...[
            "memory.add",
            "memory.update",
            "memory.remove",
            "memory.user-profile",
          ].map((operation) => ({
            operation,
            reason:
              "Shared native Memory is read-only because an Agent cross-process lock is unavailable. Open native Memory to edit existing data.",
          })),
          {
            operation: "memory.provider",
            reason:
              "Provider configuration and provider network access stay in native Memory.",
          },
          {
            operation: "memory.soul",
            reason: "Agent persona files are not automatically synchronized.",
          },
        ],
      };
    }
    if (section === "profile") {
      const [profiles, memory] = await Promise.all([
        this.sources.profiles(),
        Promise.resolve(this.sources.memory(context.profile)),
      ]);
      await this.check(context);
      const data = {
        profiles: profiles.map((profile) => ({
          id: hash(["profile", profile.id]),
          name: text(profile.name, 512),
          active: profile.id === context.profile,
        })),
        userProfile: text(memory.user.content),
        ...(!portableNativeText(memory.user.content)
          ? { userProfileRedacted: true }
          : {}),
      };
      return {
        ...base,
        section,
        revision: this.revision(context, section, data),
        data,
        unavailable: [
          {
            operation: "profile.delete",
            reason:
              "Local agent deletion, avatars and persona editing require the existing native Profile screen.",
          },
        ],
      };
    }
    if (section === "settings") {
      const data = {
        preferences: [
          {
            key: "locale",
            value: this.sources.locale(),
            options: [...this.sources.locales],
            writable: true,
          },
        ],
      };
      return {
        ...base,
        section,
        revision: this.revision(context, section, data),
        data,
        unavailable: [
          {
            operation: "settings.runtime",
            reason:
              "Model providers, keys, device permissions, spellcheck, updater and connection settings remain in native Settings.",
          },
        ],
      };
    }
    if (section === "capability" || section === "discover") {
      const [servers, skills, plugins] = await Promise.all([
        this.sources.servers(context.profile),
        Promise.resolve(this.sources.skills(context.profile)),
        this.sources.plugins?.(context.profile) ?? Promise.resolve([]),
      ]);
      await this.check(context);
      const safeServers = servers.map((server) => ({
        name: text(server.name, 512),
        enabled: server.enabled,
        transport: ["http", "stdio"].includes(server.transport)
          ? server.transport
          : ("unknown" as const),
      }));
      const safeSkills = skills.map((skill) => ({
        name: text(skill.name, 512),
        description: text(skill.description),
      }));
      if (section === "discover") {
        const data = {
          installedSkills: safeSkills,
          installedServers: safeServers,
          plugins,
        };
        const revision = this.revision(context, section, data);
        const currentPlan = [...this.pluginPlans.values()]
          .reverse()
          .find(
            (stored) =>
              stored.expiresAt > this.sources.now() &&
              sameContext(context, stored.context) &&
              stored.plan.revision === revision,
          );
        return {
          ...base,
          section,
          revision,
          data: {
            ...data,
            ...(currentPlan ? { pluginPlan: currentPlan.plan } : {}),
          },
          unavailable: [
            {
              operation: "discover.install",
              reason:
                "Installation can execute code or grant permissions; use the native reviewed installation flow.",
            },
          ],
        };
      }
      const toolsets = this.sources.toolsets(context.profile).map((tool) => ({
        key: tool.key,
        label: text(tool.label, 512),
        description: text(tool.description),
        enabled: tool.enabled,
      }));
      const data = {
        toolsets,
        servers: safeServers,
        skills: safeSkills,
        plugins,
      };
      const revision = this.revision(context, section, data);
      const currentPlan = [...this.pluginPlans.values()]
        .reverse()
        .find(
          (stored) =>
            stored.expiresAt > this.sources.now() &&
            sameContext(context, stored.context) &&
            stored.plan.revision === revision,
        );
      return {
        ...base,
        section,
        revision,
        data: {
          ...data,
          ...(currentPlan ? { pluginPlan: currentPlan.plan } : {}),
        },
        unavailable: [
          {
            operation: "plugins.install",
            reason:
              "Plugin preview/confirmation records intent only. Native reviewed installation and device permissions are required; nothing is installed here.",
          },
          {
            operation: "capability.toggle",
            reason:
              "Shared native capability configuration is read-only; open native Tools to review permissions and existing configuration.",
          },
          {
            operation: "capability.enable",
            reason:
              "Enabling tools and changing MCP access require the native confirmation flow; this adapter never changes capability configuration.",
          },
          {
            operation: "capability.test",
            reason:
              "MCP test or install executes local or provider actions and is unavailable here.",
          },
        ],
      };
    }
    const tasks = await this.sources.tasks(context.profile);
    await this.check(context);
    if (section === "office") {
      const profiles = await this.sources.profiles();
      await this.check(context);
      const data = {
        agents: profiles.map((profile) => ({
          id: hash(["profile", profile.id]),
          name: text(profile.name, 512),
          status: profile.gatewayRunning ? "running" : "stopped",
        })),
        tasks: tasks
          .filter((task) => task.status === "running")
          .map((task) => ({
            id: hash(["task", task.id]),
            title: text(task.title, 512),
            status: task.status,
            ...(task.assignee ? { assignee: text(task.assignee, 512) } : {}),
          })),
        scene: {
          available: true,
          reason:
            "Open native 3D Office for the existing scene and device runtime controls.",
        },
      };
      return {
        ...base,
        section,
        revision: this.revision(context, section, data),
        data,
        unavailable: [
          {
            operation: "office.execute",
            reason:
              "Agent start, dispatch, world actions and local device operations require native confirmation.",
          },
        ],
      };
    }
    const boards = await this.sources.boards(context.profile);
    await this.check(context);
    const data = {
      boards: boards.map((board) => ({
        id: hash(["board", board.slug]),
        name: text(board.name, 512),
      })),
      tasks: tasks.map((task) => ({
        id: hash(["task", task.id]),
        title: text(task.title, 512),
        body: text(task.body ?? ""),
        status: text(task.status, 80),
        priority: String(task.priority),
        ...(task.assignee ? { assignee: text(task.assignee, 512) } : {}),
      })),
    };
    return {
      ...base,
      section,
      revision: this.revision(context, section, data),
      data,
      unavailable: [
        {
          operation: "kanban.dispatch",
          reason:
            "Dispatch, schedule, reclaim, board changes and execution remain in native Kanban.",
        },
        {
          operation: "projects.files",
          reason:
            "Boards are the native project data source; filesystem project paths are never synchronized.",
        },
      ],
    };
  }

  async apply(operation: RuntimeOperation): Promise<RuntimeSnapshot> {
    if (!validateRuntimeOperation(operation))
      throw new Error("Invalid native operation");
    if (
      operation.action === "plugin.preview" ||
      operation.action === "plugin.confirm-plan"
    ) {
      const context = await this.sources.context();
      let snapshot = await this.inspect("capability");
      if (snapshot.revision !== operation.revision)
        snapshot = await this.inspect("discover");
      await this.check(context);
      if (
        snapshot.revision !== operation.revision ||
        (snapshot.section !== "capability" && snapshot.section !== "discover")
      )
        throw new Error("Plugin state changed; inspect and review again");
      if (
        !snapshot.data.plugins?.some((plugin) => plugin.key === operation.key)
      )
        throw new Error("Unknown plugin; no plan created");
      if (operation.action === "plugin.preview") {
        while (this.pluginPlans.size >= 4)
          this.pluginPlans.delete(this.pluginPlans.keys().next().value!);
        const plan: RuntimePluginPlan = {
          schemaVersion: 1,
          userId: context.userId,
          key: operation.key,
          planId: hash([
            context,
            operation.key,
            operation.revision,
            randomUUID(),
          ]),
          revision: operation.revision,
          status: "preview",
          execution: "device-required",
          steps: [
            "Review the exact plugin source and configuration in native Discover.",
            "Review native device permissions separately; this plan grants no authority.",
            "Run the native reviewed installation flow only after separate authorization; no code is installed by this plan.",
          ],
        };
        this.pluginPlans.set(plan.planId, {
          context,
          plan,
          expiresAt: this.sources.now() + 300000,
        });
      } else {
        const stored = this.pluginPlans.get(operation.planId);
        if (
          !stored ||
          stored.expiresAt <= this.sources.now() ||
          !sameContext(stored.context, context) ||
          stored.plan.key !== operation.key ||
          stored.plan.revision !== operation.revision
        )
          throw new Error(
            "Plugin plan expired or account/state changed; preview again",
          );
        stored.plan = { ...stored.plan, status: "confirmed" };
      }
      return this.inspect(snapshot.section);
    }
    if (operation.action.startsWith("memory."))
      throw new Error(
        "Shared native Memory is read-only: the existing editor must coordinate external Agent writes; no cross-process lock is available here",
      );
    if (operation.action === "capability.toggle")
      throw new Error(
        "Shared native capability configuration is read-only; use native Tools to review permissions and configuration",
      );
    if (
      operation.action !== "settings.set" ||
      operation.key !== "locale" ||
      !this.sources.locales.includes(operation.value)
    )
      throw new Error("This setting requires native Settings");
    const context = await this.sources.context();
    await this.check(context);
    const preferences = {
      preferences: [
        {
          key: "locale",
          value: this.sources.locale(),
          options: [...this.sources.locales],
          writable: true,
        },
      ],
    };
    if (this.revision(context, "settings", preferences) !== operation.revision)
      throw new Error(
        "Native data changed; inspect again before applying this edit",
      );
    this.sources.setLocale(operation.value);
    await this.check(context);
    return this.inspect("settings");
  }

  async previewImport(): Promise<NativeImportPreview> {
    const context = await this.sources.context();
    await this.check(context);
    const cloud = await this.sources.snapshot();
    if (cloud.userId !== context.userId || cloud.schemaVersion !== 1)
      throw new Error("Workspace owner/schema mismatch");
    const [profiles, boards, tasks] = await Promise.all([
      this.sources.profiles(),
      this.sources.boards(context.profile),
      this.sources.tasks(context.profile),
    ]);
    await this.check(context);
    const memory = this.sources.memory(context.profile);
    const candidates: NativeImportCandidate[] = [];
    const excluded: NativeImportPreview["excluded"] = [];
    const namespace = this.sources.namespace();
    const add = (
      kind: WorkspaceKind,
      sourceId: string,
      data: WorkspaceData,
      label: string,
    ): void => {
      if (
        !Object.values(data).every(
          (value) => typeof value === "boolean" || portableNativeText(value),
        ) ||
        !validateData(kind, data)
      ) {
        excluded.push({
          label,
          reason:
            "Sensitive/device-specific text or unsupported fields excluded; nothing uploaded.",
        });
        return;
      }
      const cloudId = `native_${hash([namespace, context.userId, context.profile, kind, sourceId])}`;
      const existing = cloud.records.find((record) => record.id === cloudId);
      candidates.push({
        candidateId: hash([kind, sourceId]),
        kind,
        data,
        cloudId,
        ...(existing ? { existing } : {}),
      });
    };
    const profile = profiles.find((item) => item.id === context.profile);
    if (profile)
      add(
        "profile",
        "profile",
        { displayName: profile.name, bio: memory.user.content },
        "Selected profile",
      );
    memory.memory.entries.forEach((entry) =>
      add(
        "memory",
        `entry:${entry.index}`,
        {
          title: `Memory entry ${entry.index + 1}`,
          content: entry.content,
          scope: "personal",
        },
        `Memory entry ${entry.index + 1}`,
      ),
    );
    boards
      .filter((board) => !board.archived)
      .forEach((board) =>
        add(
          "project",
          `board:${board.slug}`,
          { title: board.name, description: board.description ?? "" },
          "Kanban board",
        ),
      );
    tasks
      .filter((task) => task.status !== "archived")
      .forEach((task) => {
        if (
          !["todo", "done", "running"].includes(task.status) ||
          task.body ||
          task.assignee
        ) {
          excluded.push({
            label: "Kanban task",
            reason:
              "This native task has fields/status not yet representable by the portable schema; inspect native Kanban instead.",
          });
          return;
        }
        add(
          "task",
          `task:${task.id}`,
          {
            title: task.title,
            status: task.status === "running" ? "doing" : task.status,
          },
          "Kanban task",
        );
      });
    add(
      "preferences",
      "locale",
      { locale: this.sources.locale() },
      "Language preference",
    );
    const preview: NativeImportPreview = {
      previewId: randomUUID(),
      userId: context.userId,
      expiresAt: Math.floor(this.sources.now() / 1000) + 300,
      candidates,
      excluded,
    };
    for (const [id, entry] of this.previews)
      if (entry.preview.expiresAt * 1000 <= this.sources.now())
        this.previews.delete(id);
    if (this.previews.size >= 4)
      this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(preview.previewId, {
      context,
      preview,
      operationIds: new Map(),
    });
    return structuredClone(preview);
  }

  async importSelection(
    previewId: string,
    choices: NativeImportChoice[],
  ): Promise<WorkspaceOperationsResponse> {
    const stored = this.previews.get(previewId);
    if (!stored || stored.preview.expiresAt * 1000 <= this.sources.now())
      throw new Error("Native preview expired; inspect again");
    await this.check(stored.context);
    if (
      !Array.isArray(choices) ||
      !choices.length ||
      choices.length > 50 ||
      new Set(choices.map((choice) => choice?.candidateId)).size !==
        choices.length
    )
      throw new Error("Invalid import selection");
    const operations: WorkspaceOperation[] = [];
    for (const choice of choices) {
      if (!choice) throw new Error("Invalid import choice");
      const candidate = stored.preview.candidates.find(
        (item) => item.candidateId === choice.candidateId,
      );
      if (
        !choice ||
        Object.keys(choice).some(
          (key) => !["candidateId", "action", "confirmReplace"].includes(key),
        ) ||
        (choice.confirmReplace !== undefined &&
          choice.confirmReplace !== true) ||
        !candidate ||
        !["create", "replace", "skip"].includes(choice.action)
      )
        throw new Error("Invalid import choice");
      if (choice.action === "skip") continue;
      if (
        choice.action === "replace" &&
        (choice.confirmReplace !== true || !candidate.existing)
      )
        throw new Error("Confirm replacement of the existing cloud revision");
      if (choice.action === "create" && candidate.existing)
        throw new Error(
          "A cloud record already exists; explicitly replace or skip",
        );
      let operationId = stored.operationIds.get(candidate.candidateId);
      if (!operationId) {
        operationId = randomUUID();
        stored.operationIds.set(candidate.candidateId, operationId);
      }
      operations.push({
        operationId,
        id: candidate.cloudId,
        kind: candidate.kind,
        data: candidate.data,
        baseRevision:
          choice.action === "replace" ? candidate.existing!.revision : 0,
        deleted: false,
      });
    }
    const signature = hash(choices);
    if (stored.signature && stored.signature !== signature)
      throw new Error(
        "This preview was already submitted with different choices; preview again",
      );
    stored.signature = signature;
    if (stored.completed) return structuredClone(stored.completed);
    if (stored.inFlight) return stored.inFlight;
    if (!operations.length)
      return { schemaVersion: 1, userId: stored.context.userId, results: [] };
    stored.inFlight = (async () => {
      await this.check(stored.context);
      const response = await this.sources.operations(operations);
      await this.check(stored.context);
      if (
        response.userId !== stored.context.userId ||
        response.schemaVersion !== 1
      )
        throw new Error("Workspace owner/schema mismatch");
      stored.completed = structuredClone(response);
      return response;
    })();
    try {
      return await stored.inFlight;
    } finally {
      stored.inFlight = undefined;
    }
  }
}
