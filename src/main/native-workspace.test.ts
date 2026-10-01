import { describe, it, expect, vi } from "vitest";
import {
  NativeWorkspace,
  type NativeSources,
  type NativeContext,
} from "./native-workspace";
import type { WorkspaceOperationsResponse } from "@mithril/workspace/protocol";
function fixture(): {
  native: NativeWorkspace;
  sources: NativeSources;
  memory: ReturnType<NativeSources["memory"]>;
  update: ReturnType<typeof vi.fn>;
  operations: ReturnType<typeof vi.fn>;
  switch: () => void;
} {
  let context: NativeContext = {
    userId: "a",
    profile: "default",
    actor: "tokenhash",
    epoch: 1,
  };
  const memory = {
    memory: {
      content: "Remember",
      exists: true,
      lastModified: 1,
      entries: [
        { index: 0, content: "Remember" },
        { index: 1, content: "/Users/private/credential" },
      ],
      charCount: 8,
      charLimit: 2200,
    },
    user: {
      content: "Person",
      exists: true,
      lastModified: 1,
      charCount: 6,
      charLimit: 1300,
    },
    stats: { totalSessions: 2, totalMessages: 4 },
  };
  const update = vi.fn((index, content) => {
    memory.memory.entries[index].content = content;
    return { success: true };
  });
  const operations = vi.fn(
    async (ops) =>
      ({
        schemaVersion: 1,
        userId: "a",
        results: ops.map((op) => ({
          operationId: op.operationId,
          status: "accepted",
          record: {
            id: op.id,
            kind: op.kind,
            revision: 1,
            data: op.data,
            deleted: false,
            updatedAt: 1,
          },
        })),
      }) as WorkspaceOperationsResponse,
  );
  const sources: NativeSources = {
    mode: () => "local",
    context: async () => context,
    namespace: () => "fixture",
    now: () => 1000000,
    memory: () => memory,
    provider: () => "local",
    profiles: async () => [],
    toolsets: () => [],
    servers: async () => [],
    skills: () => [],
    boards: async () => [],
    tasks: async () => [],
    locale: () => "en",
    locales: ["en"],
    setLocale: vi.fn(),
    snapshot: async () => ({
      schemaVersion: 1,
      userId: "a",
      cursor: 0,
      records: [],
    }),
    operations,
  };
  return {
    native: new NativeWorkspace(sources),
    sources,
    memory,
    update,
    operations,
    switch: () => {
      context = { ...context, userId: "b", epoch: 2 };
    },
  };
}
describe("Native workspace boundary", () => {
  it("shows actual memory with limits while excluding paths and unsafe edits", async () => {
    const f = fixture();
    const snapshot = await f.native.inspect("memory");
    expect(snapshot.section).toBe("memory");
    expect(JSON.stringify(snapshot)).not.toContain("/Users/private");
    if (snapshot.section !== "memory") throw new Error("memory");
    expect(snapshot.data.memoryLimit).toBe(2200);
    expect(snapshot.data.entries[1].redacted).toBe(true);
    await expect(
      f.native.apply({
        action: "memory.update",
        revision: snapshot.revision,
        index: 1,
        content: "Replacement",
      }),
    ).rejects.toThrow("read-only");
    expect(f.update).not.toHaveBeenCalled();
  });
  it("refuses every shared native memory write without a cross-process Agent lock", async () => {
    const f = fixture();
    const snapshot = await f.native.inspect("memory");
    f.memory.memory.entries[0].content = "Changed by native runtime";
    await expect(
      f.native.apply({
        action: "memory.update",
        revision: snapshot.revision,
        index: 0,
        content: "Lost update",
      }),
    ).rejects.toThrow("read-only");
    expect(f.update).not.toHaveBeenCalled();
    expect(f.memory.memory.entries[0].content).toBe(
      "Changed by native runtime",
    );
  });
  it("preview is opt-in and selected portable import never writes local memory", async () => {
    const f = fixture();
    const p = await f.native.previewImport();
    expect(f.operations).not.toHaveBeenCalled();
    expect(JSON.stringify(p)).not.toContain("/Users/private");
    const candidate = p.candidates.find(
      (candidate) => candidate.kind === "memory",
    )!;
    await f.native.importSelection(p.previewId, [
      { candidateId: candidate.candidateId, action: "create" },
    ]);
    expect(f.operations).toHaveBeenCalledTimes(1);
    expect(f.update).not.toHaveBeenCalled();
    expect(f.memory.memory.entries).toHaveLength(2);
  });
  it("rejects owner/profile/token epoch changes between preview and import", async () => {
    const f = fixture();
    const p = await f.native.previewImport();
    f.switch();
    await expect(f.native.importSelection(p.previewId, [])).rejects.toThrow(
      "changed",
    );
    expect(f.operations).not.toHaveBeenCalled();
  });
});
