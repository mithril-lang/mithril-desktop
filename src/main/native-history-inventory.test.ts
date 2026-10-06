import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  owned: vi.fn(),
  list: vi.fn(),
  mode: vi.fn(),
  enable: vi.fn(),
  messages: vi.fn(),
  bind: vi.fn(),
}));
vi.mock("electron", () => ({ app: { getPath: () => "/unused" } }));
vi.mock("./cloud-chat-runtime", () => ({
  cloudChat: { auth: { nativeContext: mocks.context, enable: mocks.enable } },
  onCloudChatAccountChanged: () => {},
}));
vi.mock("./config", () => ({ getConnectionConfig: mocks.mode }));
vi.mock("./utils", () => ({ activeStateDbPath: () => "/unused/state.db" }));
vi.mock("./db", () => ({
  getDbConnection: () => ({ transaction: (read: () => unknown) => read }),
}));
vi.mock("./sessions", () => ({
  listSessions: mocks.list,
  getSessionMessages: mocks.messages,
}));
vi.mock("./repository-kanban-runtime", () => ({
  repositorySourceOwned: mocks.owned,
  bindRepositorySource: mocks.bind,
}));
vi.mock("./remote-history-store", () => ({
  remoteHistoryStore: vi.fn(),
  clearRemoteHistoryStores: vi.fn(),
}));
import { nativeHistoryInventory } from "./native-history-runtime";
import { nativeCloudSessionId } from "./native-history-sync";
const identity = {
  userId: "alice",
  profile: "default",
  epoch: 1,
  actor: "desktop",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue(identity);
  mocks.mode.mockReturnValue({ mode: "local" });
  mocks.owned.mockReturnValue(true);
  mocks.list.mockReturnValue([{ id: "original", title: "Original history" }]);
});
// @lat: [[cloud-workspace-tests#Read-only source inventory]]
it("returns deterministic IDs only for the checked owner without capturing or adopting source data", async () => {
  expect(await nativeHistoryInventory()).toEqual({
    userId: "alice",
    profile: "default",
    rows: [
      {
        id: nativeCloudSessionId("default", "original"),
        sourceId: "original",
        title: "Original history",
      },
    ],
  });
  expect(mocks.list).toHaveBeenCalledWith(1001, 0, "default");
  expect(mocks.context.mock.calls.every((args) => args.length === 0)).toBe(
    true,
  );
  expect(mocks.messages).not.toHaveBeenCalled();
  expect(mocks.bind).not.toHaveBeenCalled();
  expect(mocks.enable).not.toHaveBeenCalled();
});
it("does not expose an unbound or remote profile", async () => {
  mocks.owned.mockReturnValue(false);
  expect((await nativeHistoryInventory()).rows).toEqual([]);
  expect(mocks.list).not.toHaveBeenCalled();
  mocks.owned.mockReturnValue(true);
  mocks.mode.mockReturnValue({ mode: "ssh" });
  expect((await nativeHistoryInventory()).rows).toEqual([]);
  expect(mocks.list).not.toHaveBeenCalled();
});
it("rejects a different bound account", async () => {
  mocks.owned.mockImplementation(() => {
    throw Error("another account");
  });
  await expect(nativeHistoryInventory()).rejects.toThrow("another account");
  expect(mocks.list).not.toHaveBeenCalled();
});
it("discards inventory when account context changes during the read", async () => {
  mocks.context
    .mockResolvedValueOnce(identity)
    .mockResolvedValue({ ...identity, userId: "bob", epoch: 2 });
  await expect(nativeHistoryInventory()).rejects.toThrow("account changed");
});
it("refuses a truncated inventory instead of hiding the rest of the original histories", async () => {
  mocks.list.mockReturnValue(
    Array.from({ length: 1001 }, (_, i) => ({
      id: String(i),
      title: "Original",
    })),
  );
  await expect(nativeHistoryInventory()).rejects.toThrow("supported bound");
});
