import { expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import type { TaskAttachmentReader } from "@mithril/workspace/task-attachments";
import { registerTaskAttachmentIPC } from "./task-attachment-ipc";

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Task attachment download IPC]]
it("only exposes owner-pinned read-only chunks to trusted renderer senders", () => {
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  >();
  const getChunk = vi.fn(),
    forOwner = vi.fn(),
    trusted = vi.fn();
  const resources: TaskAttachmentReader = { getChunk, forOwner };
  forOwner.mockReturnValue(resources);
  registerTaskAttachmentIPC(
    {
      handle: (name, handler) => {
        handlers.set(name, handler);
      },
    },
    trusted,
    resources,
  );
  expect([...handlers.keys()]).toEqual(["task-attachments-get-chunk"]);
  const read = handlers.get("task-attachments-get-chunk")!,
    event = {} as IpcMainInvokeEvent,
    digest = "a".repeat(64);
  read(event, "original-task", digest, "alice");
  expect(forOwner).toHaveBeenCalledWith("alice");
  expect(getChunk).toHaveBeenCalledWith("original-task", digest);
  getChunk.mockClear();
  forOwner.mockClear();
  for (const args of [
    ["../task", digest, "alice"],
    ["task", "wrong", "alice"],
    ["task", digest],
    ["task", digest, {}],
  ]) {
    expect(() => read(event, ...args)).toThrow("Invalid task attachment");
  }
  expect(getChunk).not.toHaveBeenCalled();
  expect(forOwner).not.toHaveBeenCalled();
  trusted.mockImplementation(() => {
    throw Error("untrusted");
  });
  expect(() => read(event, "task", digest, "alice")).toThrow("untrusted");
  expect(forOwner).not.toHaveBeenCalled();
});
