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
  it("updates the actual display locale only after explicit matching-revision selection", async () => {
    const f = fixture();
    let locale = "en";
    f.sources.locales = ["en", "ja"];
    f.sources.locale = () => locale;
    f.sources.setLocale = vi.fn((value) => {
      locale = value;
    });
    const snapshot = await f.native.inspect("settings");
    expect(f.sources.setLocale).not.toHaveBeenCalled();
    await f.native.apply({
      action: "settings.set",
      revision: snapshot.revision,
      key: "locale",
      value: "ja",
    });
    expect(locale).toBe("ja");
    await expect(
      f.native.apply({
        action: "settings.set",
        revision: snapshot.revision,
        key: "locale",
        value: "en",
      }),
    ).rejects.toThrow("changed");
    await expect(
      f.native.apply({
        action: "settings.set",
        revision: snapshot.revision,
        key: "provider",
        value: "other",
      }),
    ).rejects.toThrow("native Settings");
    expect(f.sources.setLocale).toHaveBeenCalledTimes(1);
  });
  it("applies explicitly selected native Memory edits through the locked CAS writer", async () => {
    const f = fixture();
    const apply = vi.fn((_profile, mutation, expected) => {
      expect(expected).toEqual({
        memory: f.memory.memory.content,
        user: "Person",
      });
      f.memory.memory.content = mutation.content;
      f.memory.memory.entries[0].content = mutation.content;
      return { success: true };
    });
    f.sources.memoryApply = apply;
    const snapshot = await f.native.inspect("memory");
    expect(
      snapshot.unavailable.some((item) => item.operation === "memory.update"),
    ).toBe(false);
    await f.native.apply({
      action: "memory.update",
      revision: snapshot.revision,
      index: 0,
      content: "Edited",
    });
    expect(apply).toHaveBeenCalledTimes(1);
    await expect(
      f.native.apply({
        action: "memory.update",
        revision: snapshot.revision,
        index: 0,
        content: "Stale",
      }),
    ).rejects.toThrow("changed");
    expect(apply).toHaveBeenCalledTimes(1);
    const current = await f.native.inspect("memory");
    f.switch();
    await expect(
      f.native.apply({
        action: "memory.remove",
        revision: current.revision,
        index: 0,
        confirm: true,
      }),
    ).rejects.toThrow("changed");
    expect(apply).toHaveBeenCalledTimes(1);
  });
  it("returns the newest plugin intent and expires confirmation without executing", async () => {
    const f = fixture();
    let now = 1000000;
    f.sources.now = () => now;
    f.sources.plugins = async () =>
      ["first", "second"].map((key) => ({
        key,
        name: key,
        description: "Fixture",
        version: "1",
        installed: true,
        source: "installed" as const,
        deviceRequired: true as const,
        reason: "Native review",
      }));
    const snapshot = await f.native.inspect("discover");
    await f.native.apply({
      action: "plugin.preview",
      key: "first",
      revision: snapshot.revision,
    });
    const second = await f.native.apply({
      action: "plugin.preview",
      key: "second",
      revision: snapshot.revision,
    });
    if (second.section !== "discover") throw new Error("discover");
    const plan = second.data.pluginPlan!;
    expect(plan.key).toBe("second");
    now += 300001;
    await expect(
      f.native.apply({
        action: "plugin.confirm-plan",
        key: plan.key,
        revision: plan.revision,
        planId: plan.planId,
        confirm: true,
      }),
    ).rejects.toThrow();
    expect(f.operations).not.toHaveBeenCalled();
    expect(f.sources.setLocale).not.toHaveBeenCalled();
  });
  it("previews actual installed plugins and confirms owner-bound intent without installing or granting", async () => {
    const f = fixture();
    let version = "1";
    f.sources.plugins = async () => [
      {
        key: "demo-plugin",
        name: "Demo plugin",
        description: "Fixture",
        version,
        installed: true,
        source: "installed",
        deviceRequired: true,
        reason: "Native permissions required",
      },
    ];
    const first = await f.native.inspect("capability");
    const preview = await f.native.apply({
      action: "plugin.preview",
      key: "demo-plugin",
      revision: first.revision,
    });
    if (preview.section !== "capability") throw new Error("capability");
    expect(preview.data.plugins?.[0].enabled).toBeUndefined();
    expect(preview.data.pluginPlan?.execution).toBe("device-required");
    const plan = preview.data.pluginPlan!;
    const confirmed = await f.native.apply({
      action: "plugin.confirm-plan",
      key: plan.key,
      revision: plan.revision,
      planId: plan.planId,
      confirm: true,
    });
    if (confirmed.section !== "capability") throw new Error("capability");
    expect(confirmed.data.pluginPlan?.status).toBe("confirmed");
    expect(f.sources.setLocale).not.toHaveBeenCalled();
    expect(f.operations).not.toHaveBeenCalled();
    expect(f.update).not.toHaveBeenCalled();
    version = "2";
    await expect(
      f.native.apply({
        action: "plugin.confirm-plan",
        key: plan.key,
        revision: plan.revision,
        planId: plan.planId,
        confirm: true,
      }),
    ).rejects.toThrow("state changed");
  });
  it("rejects stale-account plugin plans without importing permissions", async () => {
    const f = fixture();
    f.sources.plugins = async () => [
      {
        key: "demo",
        name: "Demo",
        description: "",
        version: "",
        installed: true,
        source: "installed",
        deviceRequired: true,
        reason: "Enabled state unknown",
      },
    ];
    const snapshot = await f.native.inspect("capability");
    const preview = await f.native.apply({
      action: "plugin.preview",
      key: "demo",
      revision: snapshot.revision,
    });
    if (preview.section !== "capability") throw new Error("capability");
    const plan = preview.data.pluginPlan!;
    f.switch();
    await expect(
      f.native.apply({
        action: "plugin.confirm-plan",
        key: plan.key,
        revision: plan.revision,
        planId: plan.planId,
        confirm: true,
      }),
    ).rejects.toThrow("changed");
    expect(f.operations).not.toHaveBeenCalled();
  });
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
