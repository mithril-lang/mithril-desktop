import { createHash, randomUUID } from "crypto";
import { portableNativeText, type NativeContext } from "./native-workspace";
import {
  validateImportedMessage,
  type RuntimeSessionImportPreview,
  type NativeSessionImportChoice,
  type ImportedMessage,
  type ChatOperationResponse,
  type ChatSession,
  type ChatModel,
  type ChatOperation,
} from "@mithril/workspace/sessions";

export interface LocalSessionProjection {
  id: string;
  title: string;
  ended: boolean;
  messages: ImportedMessage[];
}
interface Dependencies {
  context(): Promise<NativeContext>;
  namespace(): string;
  now(): number;
  local(profile: string): LocalSessionProjection[];
  models(): Promise<ChatModel[]>;
  sessions(): Promise<ChatSession[]>;
  apply(id: string, operation: ChatOperation): Promise<ChatOperationResponse>;
}
interface Stored {
  context: NativeContext;
  preview: RuntimeSessionImportPreview;
  signature?: string;
  operations?: { id: string; operation: ChatOperation }[];
  results: Map<string, ChatOperationResponse>;
  pending?: Promise<ChatOperationResponse[]>;
}
const same = (a: NativeContext, b: NativeContext): boolean =>
  a.userId === b.userId &&
  a.profile === b.profile &&
  a.actor === b.actor &&
  a.epoch === b.epoch;
const digest = (parts: unknown[]): string =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex");

/** Explicit sanitized projection only; imports never modify or execute the native history. */
export class NativeSessionImport {
  private previews = new Map<string, Stored>();
  constructor(private deps: Dependencies) {}
  reset(): void {
    this.previews.clear();
  }
  async previewNativeSessions(): Promise<RuntimeSessionImportPreview> {
    const context = await this.deps.context();
    const models = await this.deps.models();
    const sessions = await this.deps.sessions();
    if (!same(context, await this.deps.context()))
      throw new Error("Chat account changed; preview discarded");
    const model = models.find((model) => model.available)?.id;
    const preview: RuntimeSessionImportPreview = {
      previewId: randomUUID(),
      userId: context.userId,
      expiresAt: Math.floor(this.deps.now() / 1000) + 300,
      candidates: [],
      excluded: [],
    };
    for (const local of this.deps.local(context.profile).slice(0, 50)) {
      const label = `Local session ${preview.candidates.length + preview.excluded.length + 1}`;
      if (
        !model ||
        !local.ended ||
        !portableNativeText(local.title) ||
        !local.messages.length ||
        local.messages.length > 500 ||
        !local.messages.every(
          (message) =>
            validateImportedMessage(message) &&
            portableNativeText(message.content),
        ) ||
        JSON.stringify(local.messages).length > 900000
      ) {
        preview.excluded.push({
          label,
          reason:
            "Unavailable Mithril model, unfinished history, unsupported content, or nonportable text; retained locally.",
        });
        continue;
      }
      const sourceId = digest([
        this.deps.namespace(),
        context.userId,
        context.profile,
        local.id,
      ]);
      const sessionId = `native_${sourceId}`;
      preview.candidates.push({
        sourceId,
        sessionId,
        title: local.title.slice(0, 512),
        model,
        messages: structuredClone(local.messages),
        existing: sessions.find((session) => session.id === sessionId),
      });
    }
    if (!same(context, await this.deps.context()))
      throw new Error("Chat account changed; preview discarded");
    while (this.previews.size >= 4)
      this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(preview.previewId, {
      context,
      preview,
      results: new Map(),
    });
    return structuredClone(preview);
  }
  async importNativeSessions(
    previewId: string,
    choices: NativeSessionImportChoice[],
  ): Promise<ChatOperationResponse[]> {
    const stored = this.previews.get(previewId);
    if (
      !stored ||
      stored.preview.expiresAt * 1000 <= this.deps.now() ||
      !same(stored.context, await this.deps.context()) ||
      this.previews.get(previewId) !== stored
    )
      throw new Error("Native session preview expired or account changed");
    if (
      !Array.isArray(choices) ||
      choices.length > 50 ||
      new Set(choices.map((choice) => choice?.sourceId)).size !==
        choices.length ||
      !choices.every(
        (choice) =>
          choice &&
          Object.keys(choice).every((key) =>
            ["sourceId", "action", "confirmCopy"].includes(key),
          ) &&
          ["skip", "import", "copy"].includes(choice.action) &&
          (choice.confirmCopy === undefined || choice.confirmCopy === true) &&
          stored.preview.candidates.some(
            (candidate) => candidate.sourceId === choice.sourceId,
          ),
      )
    )
      throw new Error("Invalid native session selection");
    const signature = JSON.stringify(choices);
    if (stored.signature && stored.signature !== signature)
      throw new Error("Create a fresh preview to change a submitted selection");
    if (!stored.operations) {
      const operations: { id: string; operation: ChatOperation }[] = [];
      for (const choice of choices) {
        if (choice.action === "skip") continue;
        const candidate = stored.preview.candidates.find(
          (candidate) => candidate.sourceId === choice.sourceId,
        )!;
        if (choice.action === "import" && candidate.existing)
          throw new Error(
            "Existing cloud history is never overwritten; explicitly confirm a separate copy",
          );
        if (choice.action === "copy" && choice.confirmCopy !== true)
          throw new Error("A separate history copy requires confirmation");
        const id =
          choice.action === "copy"
            ? `copy_${randomUUID()}`
            : candidate.sessionId;
        operations.push({
          id,
          operation: {
            operationId: randomUUID(),
            baseRevision: 0,
            type: "import",
            data: {
              title: candidate.title,
              model: candidate.model,
              messages: candidate.messages,
            },
          },
        });
      }
      stored.operations = operations;
      stored.signature = signature;
    }
    if (stored.pending) return stored.pending;
    stored.pending = (async () => {
      const results: ChatOperationResponse[] = [];
      for (const entry of stored.operations!) {
        if (
          !same(stored.context, await this.deps.context()) ||
          this.previews.get(previewId) !== stored
        )
          throw new Error("Chat account changed; remaining imports discarded");
        let result = stored.results.get(entry.operation.operationId);
        if (!result) {
          result = await this.deps.apply(entry.id, entry.operation);
          if (
            !same(stored.context, await this.deps.context()) ||
            this.previews.get(previewId) !== stored
          )
            throw new Error(
              "Chat account changed; stale import result discarded",
            );
          stored.results.set(entry.operation.operationId, result);
        }
        results.push(result);
      }
      return results;
    })();
    try {
      return await stored.pending;
    } finally {
      stored.pending = undefined;
    }
  }
}
