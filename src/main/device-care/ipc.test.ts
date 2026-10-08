// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  home: "",
  dialog: vi.fn(),
  skill: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { getPath: () => mocks.home, on: vi.fn() },
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(name, handler),
  },
  dialog: { showOpenDialog: mocks.dialog, showMessageBox: vi.fn() },
  shell: { trashItem: vi.fn() },
}));
vi.mock("../locale", () => ({ getAppLocale: () => "en" }));
vi.mock("./storage-skill", () => ({ installedStorageSkill: mocks.skill }));
import { registerDeviceCareIpc } from "./ipc";
import { DeviceCareStorage } from "./storage";
import type { BrowserWindow } from "electron";

describe("device-care main-process admission", () => {
  let window: BrowserWindow;
  let event: { sender: object; senderFrame: object };
  beforeEach(async () => {
    mocks.home = await mkdtemp(join(tmpdir(), "device-care-ipc-"));
    mocks.handlers.clear();
    mocks.dialog.mockReset();
    mocks.skill.mockReset();
    const frame = {};
    const sender = { mainFrame: frame };
    window = {
      isDestroyed: () => false,
      webContents: sender,
    } as unknown as BrowserWindow;
    event = { sender, senderFrame: frame };
    registerDeviceCareIpc(() => window);
  });
  // @lat: [[device-care#Desktop cleanup Skill#Runs audit before native review]]
  it("runs only the installed native workflow and starts without mutation authority", async () => {
    const run = mocks.handlers.get("device-care-run-storage-skill")!;
    expect(() => run({ ...event, senderFrame: {} }, "default")).toThrow(
      "Untrusted",
    );
    mocks.skill.mockResolvedValue(null);
    await expect(run(event, "default")).rejects.toThrow("Install");
    mocks.skill.mockResolvedValue({
      name: "mithril-diskspace-management",
      version: "1.3.0",
    });
    const spy = vi
      .spyOn(DeviceCareStorage.prototype, "analyze")
      .mockResolvedValue({
        root: "/fixed-native-temp",
        status: "complete",
        observedAt: new Date().toISOString(),
        files: 0,
        logicalBytes: 0,
        candidates: [],
        cleanupScope: true,
        groups: [],
        largest: [],
        allocatedBytes: 0,
        capacity: null,
        freeBytes: null,
        skipped: 0,
      } as Awaited<ReturnType<DeviceCareStorage["analyze"]>>);
    try {
      expect(await run(event, "default")).toMatchObject({
        workflow: {
          version: "1.3.0",
          state: "nothing-eligible",
          cleanupScope: "desktop-generated-media",
        },
      });
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining("hermes-desktop-media"),
        true,
      );
      expect(mocks.dialog).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
  afterEach(async () => {
    await rm(mocks.home, { recursive: true, force: true });
  });
  // @lat: [[device-care#Implementation verification#Rejects untrusted callers]]
  it("rejects other windows and embedded frames before status or filesystem access", () => {
    const status = mocks.handlers.get("device-care-status")!;
    expect(() => status({ ...event, sender: {} })).toThrow("Untrusted");
    expect(() => status({ ...event, senderFrame: {} })).toThrow("Untrusted");
  });
  // @lat: [[device-care#Implementation verification#Requires native folder selection]]
  it("rejects renderer paths and treats a cancelled native picker as no analysis", async () => {
    const analyze = mocks.handlers.get("device-care-analyze")!;
    await expect(analyze(event, "/Users/private-data")).rejects.toThrow(
      "Invalid storage scope",
    );
    await expect(
      mocks.handlers.get("device-care-analyze-node")!(
        event,
        "/Users/private-data",
      ),
    ).rejects.toThrow();
    expect(mocks.dialog).not.toHaveBeenCalled();
    mocks.dialog.mockResolvedValue({ canceled: true, filePaths: [] });
    await expect(analyze(event, "folder")).resolves.toBeNull();
    expect(await mocks.handlers.get("device-care-history")!(event)).toEqual([]);
  });
});
