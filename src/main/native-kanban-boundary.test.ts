import { describe, it, expect, vi } from "vitest";
import {
  NativeWorkspace,
  type NativeSources,
  type NativeContext,
} from "./native-workspace";
import type { NativeKanbanState } from "./native-kanban-store";
function fixture(): {
  native: NativeWorkspace;
  state: NativeKanbanState;
  sources: NativeSources;
  change: ReturnType<typeof vi.fn>;
  logout: () => void;
} {
  let context: NativeContext = {
    userId: "alice",
    profile: "default",
    actor: "fixtureactor",
    epoch: 1,
  };
  const state: NativeKanbanState = {
    boardSlug: "default",
    revision: "raw1",
    tasks: [
      {
        id: "native-task",
        title: "Title",
        body: "Body",
        status: "todo",
        priority: 1,
        claim_lock: null,
      } as NativeKanbanState["tasks"][number],
    ],
  };
  const change = vi.fn((_revision, _id, changes) => {
    Object.assign(state.tasks[0], changes);
    state.revision = "raw2";
  });
  const sources: NativeSources = {
    mode: () => "local",
    context: async () => context,
    namespace: () => "fixture",
    now: () => 0,
    memory: () => {
      throw Error("unneeded");
    },
    provider: () => null,
    profiles: async () => [],
    toolsets: () => [],
    servers: async () => [],
    skills: () => [],
    boards: async () => [
      {
        slug: "default",
        name: "Actual board",
        is_current: true,
        total: 1,
        counts: { todo: 1 },
        db_path: "/private/native.db",
      },
    ],
    tasks: async () => {
      throw Error("CLI should not run");
    },
    kanbanState: () => state,
    kanbanChange: change,
    locale: () => "en",
    locales: ["en"],
    setLocale: vi.fn(),
    snapshot: async () => {
      throw Error("no cloud");
    },
    operations: async () => {
      throw Error("no cloud");
    },
  };
  return {
    native: new NativeWorkspace(sources),
    state,
    sources,
    change,
    logout: () => {
      context = { ...context, userId: "bob", epoch: 2 };
    },
  };
}
describe("native Kanban owner and projection", () => {
  it("edits only the bound opaque task and returns actual updated native view", async () => {
    const f = fixture();
    const view = await f.native.inspect("kanban");
    if (view.section !== "kanban") throw Error("section");
    expect(JSON.stringify(view)).not.toMatch(/native-task|private|claim_lock/);
    expect(view.data.tasks[0].editable).toBe(true);
    await f.native.apply({
      action: "kanban.task-edit",
      revision: view.revision,
      taskId: view.data.tasks[0].id,
      title: "Changed",
      body: "Body",
      priority: 2,
    });
    expect(f.change).toHaveBeenCalledWith("raw1", "native-task", {
      title: "Changed",
      body: "Body",
      priority: 2,
    });
  });
  it("rejects stale owner/revision, unknown IDs and device-specific original content", async () => {
    const f = fixture();
    const view = await f.native.inspect("kanban");
    if (view.section !== "kanban") throw Error("section");
    const operation = {
      action: "kanban.task-edit" as const,
      revision: view.revision,
      taskId: view.data.tasks[0].id,
      title: "Changed",
      body: "Body",
      priority: 2,
    };
    await expect(
      f.native.apply({ ...operation, taskId: "unknown" }),
    ).rejects.toThrow();
    f.state.tasks[0].body = "/Users/private/config";
    const sensitive = await f.native.inspect("kanban");
    if (sensitive.section !== "kanban") throw Error("section");
    expect(sensitive.data.tasks[0].editable).toBe(false);
    await expect(f.native.apply(operation)).rejects.toThrow();
    f.logout();
    await expect(f.native.apply(operation)).rejects.toThrow();
    expect(f.change).not.toHaveBeenCalled();
  });
  it("rejects context switch while awaiting native board metadata", async () => {
    const f = fixture();
    f.sources.boards = async () => {
      f.logout();
      return [];
    };
    await expect(f.native.inspect("kanban")).rejects.toThrow(/changed/);
    expect(f.change).not.toHaveBeenCalled();
  });
});
