import type { IpcMainInvokeEvent } from "electron";
import type { TaskAttachmentTransport } from "@mithril/workspace/task-attachments";
import { validTaskResourceId } from "@mithril/workspace/task-attachments";
import { CHUNK_BYTES, validDigest } from "@mithril/workspace/files";

// @lat: [[cloud-workspace#Cloud workspace#Kanban attachment downloads (draft)]]
export function registerTaskAttachmentIPC(
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
    ) => void;
  },
  trusted: (event: IpcMainInvokeEvent) => void,
  resources: TaskAttachmentTransport,
): void {
  function bound(
    event: IpcMainInvokeEvent,
    taskId: unknown,
    owner: unknown,
  ): TaskAttachmentTransport {
    trusted(event);
    if (typeof owner !== "string" || !owner || owner.length > 128)
      throw Error("Invalid task attachment owner");
    if (!validTaskResourceId(taskId))
      throw Error("Invalid task attachment request");
    return resources.forOwner(owner);
  }
  ipcMain.handle(
    "task-attachments-get-chunk",
    (event, taskId, digest, owner) => {
      const transport = bound(event, taskId, owner);
      if (!validDigest(digest)) throw Error("Invalid task attachment request");
      return transport.getChunk(taskId as string, digest);
    },
  );
  ipcMain.handle(
    "task-attachments-has-chunk",
    (event, taskId, digest, size, owner) => {
      const transport = bound(event, taskId, owner);
      if (
        !validDigest(digest) ||
        typeof size !== "number" ||
        !Number.isSafeInteger(size) ||
        size < 1 ||
        size > CHUNK_BYTES
      )
        throw Error("Invalid task attachment metadata");
      return transport.hasChunk(taskId as string, digest, size);
    },
  );
  ipcMain.handle(
    "task-attachments-put-chunk",
    (event, taskId, bytes, owner) => {
      const transport = bound(event, taskId, owner);
      if (
        !(bytes instanceof Uint8Array) ||
        !bytes.length ||
        bytes.length > CHUNK_BYTES
      )
        throw Error("Invalid task attachment bytes");
      return transport.putChunk(taskId as string, bytes);
    },
  );
}
