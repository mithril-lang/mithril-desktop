import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  realpathSync,
  mkdirSync,
  symlinkSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
const fixture = vi.hoisted(() => ({ root: "" }));
vi.mock("electron", () => ({ app: { getPath: () => fixture.root } }));
import {
  remoteHistoryStore,
  currentRemoteHistoryStore,
  clearRemoteHistoryStores,
} from "./remote-history-store";
import {
  clearNativeHistoryCacheOwners,
  replaceRemoteSessionCache,
  readRemoteSessionCache,
} from "./native-history-cache";
afterEach(() => {
  clearRemoteHistoryStores();
  clearNativeHistoryCacheOwners();
  if (fixture.root) rmSync(fixture.root, { recursive: true, force: true });
});
// @lat: [[cloud-workspace-tests#Remote-only chat reconstruction]]
it("opens a private owner-bound working copy without an Agent database and reopens original records after restart", () => {
  fixture.root = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-remote-cache-")),
  );
  const db = remoteHistoryStore("alice", "default");
  const session = {
    id: "browser",
    title: "Original title",
    model: "mock",
    revision: 1,
    eventSeq: 0,
    deleted: false,
    activeTurn: null,
  };
  replaceRemoteSessionCache(db, "alice", session, [], []);
  expect(currentRemoteHistoryStore("default")).toBe(db);
  expect(readdirSync(fixture.root)).toEqual(["workspace-history-cache"]);
  if (process.platform !== "win32")
    expect(statSync(db.name).mode & 0o777).toBe(0o600);
  clearRemoteHistoryStores();
  expect(currentRemoteHistoryStore("default")).toBeNull();
  const reopened = remoteHistoryStore("alice", "default");
  expect(readRemoteSessionCache(reopened, "browser")?.session).toEqual(session);
  const bob = remoteHistoryStore("bob", "default");
  expect(readRemoteSessionCache(bob, "browser")).toBeNull();
  expect(db.open).toBe(false);
  expect(
    readRemoteSessionCache(remoteHistoryStore("alice", "default"), "browser")
      ?.session,
  ).toEqual(session);
});

// @lat: [[cloud-workspace-tests#Remote-only chat reconstruction]]
it.skipIf(process.platform === "win32")(
  "refuses redirected cache storage without opening or modifying the target",
  () => {
    fixture.root = realpathSync(
      mkdtempSync(join(tmpdir(), "mithril-remote-cache-")),
    );
    const target = join(fixture.root, "retained");
    mkdirSync(target);
    symlinkSync(target, join(fixture.root, "workspace-history-cache"));
    expect(() => remoteHistoryStore("alice", "default")).toThrow(
      "Unsafe remote history storage",
    );
    expect(readdirSync(target)).toEqual([]);
    expect(currentRemoteHistoryStore("default")).toBeNull();
  },
);
