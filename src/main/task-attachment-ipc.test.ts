import { expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import type { TaskAttachmentTransport } from "@mithril/workspace/task-attachments";
import { registerTaskAttachmentIPC } from "./task-attachment-ipc";

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Task attachment download IPC]]
it("only exposes owner-pinned bounded chunk operations to trusted renderer senders", () => {
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  >();
  const getChunk = vi.fn(),
    hasChunk = vi.fn(),
    putChunk = vi.fn(),
    forOwner = vi.fn(),
    trusted = vi.fn();
  const resources: TaskAttachmentTransport = {
    getChunk,
    hasChunk,
    putChunk,
    forOwner,
  };
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
  expect([...handlers.keys()]).toEqual([
    "task-attachments-get-chunk",
    "task-attachments-has-chunk",
    "task-attachments-put-chunk",
  ]);
  const read = handlers.get("task-attachments-get-chunk")!,
    head = handlers.get("task-attachments-has-chunk")!,
    put = handlers.get("task-attachments-put-chunk")!,
    event = {} as IpcMainInvokeEvent,
    digest = "a".repeat(64);
  read(event, "original-task", digest, "alice");
  head(event, "original-task", digest, 2, "alice");
  put(event, "original-task", new Uint8Array([0, 255]), "alice");
  expect(forOwner).toHaveBeenCalledWith("alice");
  expect(getChunk).toHaveBeenCalledWith("original-task", digest);
  expect(hasChunk).toHaveBeenCalledWith("original-task", digest, 2);
  expect(putChunk).toHaveBeenCalledWith(
    "original-task",
    new Uint8Array([0, 255]),
  );
  getChunk.mockClear();
  hasChunk.mockClear();
  putChunk.mockClear();
  forOwner.mockClear();
  for (const args of [
    ["../task", digest, "alice"],
    ["task", "wrong", "alice"],
    ["task", digest],
    ["task", digest, {}],
  ])
    expect(() => read(event, ...args)).toThrow("Invalid task attachment");
  for (const size of [0, -1, 8388609, NaN, "2"])
    expect(() => head(event, "task", digest, size, "alice")).toThrow(
      "metadata",
    );
  for (const bytes of [
    new Uint8Array(),
    new Uint8Array(8388609),
    new ArrayBuffer(2),
    [1, 2],
  ])
    expect(() => put(event, "task", bytes, "alice")).toThrow("bytes");
  expect(getChunk).not.toHaveBeenCalled();
  expect(hasChunk).not.toHaveBeenCalled();
  expect(putChunk).not.toHaveBeenCalled();
  forOwner.mockClear();
  trusted.mockImplementation(() => {
    throw Error("untrusted");
  });
  expect(() => read(event, "task", digest, "alice")).toThrow("untrusted");
  expect(() => put(event, "task", new Uint8Array([1]), "alice")).toThrow(
    "untrusted",
  );
  expect(forOwner).not.toHaveBeenCalled();
});
