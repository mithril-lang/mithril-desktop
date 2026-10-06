import type { IpcMainInvokeEvent } from "electron";
import type { TaskAttachmentReader } from "@mithril/workspace/task-attachments";
import { validTaskResourceId } from "@mithril/workspace/task-attachments";
import { validDigest } from "@mithril/workspace/files";

// @lat: [[cloud-workspace#Cloud workspace#Kanban attachment downloads (draft)]]
export function registerTaskAttachmentIPC(
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
    ) => void;
  },
  trusted: (event: IpcMainInvokeEvent) => void,
  resources: TaskAttachmentReader,
): void {
  ipcMain.handle(
    "task-attachments-get-chunk",
    (event, taskId, digest, owner) => {
      trusted(event);
      if (typeof owner !== "string" || !owner || owner.length > 128)
        throw Error("Invalid task attachment owner");
      if (!validTaskResourceId(taskId) || !validDigest(digest))
        throw Error("Invalid task attachment request");
      return resources.forOwner(owner).getChunk(taskId, digest);
    },
  );
}
