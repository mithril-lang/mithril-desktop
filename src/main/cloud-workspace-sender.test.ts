import { describe, expect, it } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { assertCloudWorkspaceSender } from "./cloud-workspace-sender";

describe("workspace IPC sender", () => {
  // @lat: [[cloud-workspace-tests#Cloud workspace tests#Trusted renderer]]
  it("rejects another window, remote navigation and subframes before workspace networking", () => {
    const path = "/test/out/renderer/index.html";
    const frame = { url: "file:///test/out/renderer/index.html" };
    const sender = { mainFrame: frame };
    const win = { webContents: sender } as unknown as BrowserWindow;
    const event = {
      sender,
      senderFrame: frame,
    } as unknown as IpcMainInvokeEvent;
    expect(() => assertCloudWorkspaceSender(event, win, path)).not.toThrow();
    expect(() => assertCloudWorkspaceSender(event, null, path)).toThrow(
      "trusted",
    );
    expect(() =>
      assertCloudWorkspaceSender(
        { ...event, sender: {} } as IpcMainInvokeEvent,
        win,
        path,
      ),
    ).toThrow("trusted");
    expect(() =>
      assertCloudWorkspaceSender(
        { ...event, senderFrame: { url: frame.url } } as IpcMainInvokeEvent,
        win,
        path,
      ),
    ).toThrow("trusted");
    frame.url = "https://app.mithril.fund/";
    expect(() => assertCloudWorkspaceSender(event, win, path)).toThrow(
      "trusted",
    );
    frame.url = "http://localhost:5173/";
    expect(() =>
      assertCloudWorkspaceSender(event, win, path, "http://localhost:5173/"),
    ).not.toThrow();
    frame.url = "http://localhost:5174/";
    expect(() =>
      assertCloudWorkspaceSender(event, win, path, "http://localhost:5173/"),
    ).toThrow("trusted");
  });
});
