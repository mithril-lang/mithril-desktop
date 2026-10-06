import type { IpcMainInvokeEvent } from "electron";
import {
  validCapabilityResourceManifest,
  type CapabilityResourceTransport,
} from "@mithril/workspace/capability-resources";
import { validId } from "@mithril/workspace/protocol";
import { validDigest, CHUNK_BYTES } from "@mithril/workspace/files";

// @lat: [[cloud-workspace#Cloud workspace#Rich repository implementation in progress#Original Skills resource adapter (draft)]]
export function registerCapabilityResourceIPC(
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
    ) => void;
  },
  trusted: (event: IpcMainInvokeEvent) => void,
  resources: CapabilityResourceTransport,
): void {
  function bound(
    event: IpcMainInvokeEvent,
    owner: unknown,
  ): CapabilityResourceTransport {
    trusted(event);
    if (owner === undefined) return resources;
    if (!validId(owner)) throw Error("Invalid Skill resource owner");
    return resources.forOwner(owner);
  }
  ipcMain.handle(
    "capability-resources-get-manifest",
    (event, id, digest, owner) => {
      const transport = bound(event, owner);
      if (!validId(id) || !validDigest(digest))
        throw Error("Invalid Skill resource request");
      return transport.getManifest(id, digest);
    },
  );
  ipcMain.handle(
    "capability-resources-put-manifest",
    (event, manifest, owner) => {
      const transport = bound(event, owner);
      if (!validCapabilityResourceManifest(manifest))
        throw Error("Invalid Skill resource manifest");
      return transport.putManifest(manifest);
    },
  );
  ipcMain.handle(
    "capability-resources-get-chunk",
    (event, id, digest, owner) => {
      const transport = bound(event, owner);
      if (!validId(id) || !validDigest(digest))
        throw Error("Invalid Skill resource request");
      return transport.getChunk(id, digest);
    },
  );
  ipcMain.handle(
    "capability-resources-put-chunk",
    (event, id, bytes, owner) => {
      const transport = bound(event, owner);
      if (
        !validId(id) ||
        !(bytes instanceof Uint8Array) ||
        bytes.length > CHUNK_BYTES
      )
        throw Error("Invalid Skill resource chunk");
      return transport.putChunk(id, bytes);
    },
  );
}
