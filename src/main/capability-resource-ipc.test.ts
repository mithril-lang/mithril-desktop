import { expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import type { CapabilityResourceTransport } from "@mithril/workspace/capability-resources";
import { registerCapabilityResourceIPC } from "./capability-resource-ipc";
function fixture(): {
  handlers: Map<
    string,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  >;
  trusted: ReturnType<typeof vi.fn>;
  resources: CapabilityResourceTransport;
  getManifest: ReturnType<typeof vi.fn>;
  putChunk: ReturnType<typeof vi.fn>;
  forOwner: ReturnType<typeof vi.fn>;
} {
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  >();
  const trusted = vi.fn();
  const getManifest = vi.fn(),
    putChunk = vi.fn(),
    forOwner = vi.fn();
  const resources: CapabilityResourceTransport = {
    forOwner,
    getManifest,
    putChunk,
    getChunk: vi.fn(),
    putManifest: vi.fn(),
  };
  forOwner.mockReturnValue(resources);
  registerCapabilityResourceIPC(
    {
      handle: (channel, handler) => {
        handlers.set(channel, handler);
      },
    },
    trusted,
    resources,
  );
  return { handlers, trusted, resources, getManifest, putChunk, forOwner };
}
// @lat: [[cloud-workspace-tests#Cloud workspace tests#Original Skills resource IPC]]
it("binds original Skills data requests to main-owned transports after trusted sender checks", () => {
  const f = fixture(),
    event = {} as IpcMainInvokeEvent,
    digest = "a".repeat(64);
  f.handlers.get("capability-resources-get-manifest")!(
    event,
    "capability-default",
    digest,
    "alice",
  );
  expect(f.trusted).toHaveBeenCalledWith(event);
  expect(f.forOwner).toHaveBeenCalledWith("alice");
  expect(f.getManifest).toHaveBeenCalledWith("capability-default", digest);
  const bytes = new Uint8Array([0, 255]);
  f.handlers.get("capability-resources-put-chunk")!(
    event,
    "capability-default",
    bytes,
    "alice",
  );
  expect(f.putChunk).toHaveBeenCalledWith("capability-default", bytes);
  f.trusted.mockImplementation(() => {
    throw Error("untrusted sender");
  });
  f.getManifest.mockClear();
  f.forOwner.mockClear();
  expect(() =>
    f.handlers.get("capability-resources-get-manifest")!(
      event,
      "capability-default",
      digest,
      "alice",
    ),
  ).toThrow("untrusted sender");
  expect(f.forOwner).not.toHaveBeenCalled();
  expect(f.getManifest).not.toHaveBeenCalled();
});
it("refuses oversized chunks, malformed manifests, endpoint-shaped IDs and invalid owner arguments before invoking storage", () => {
  const f = fixture(),
    event = {} as IpcMainInvokeEvent;
  expect(() =>
    f.handlers.get("capability-resources-put-chunk")!(
      event,
      "capability-default",
      new Uint8Array(8388609),
      "alice",
    ),
  ).toThrow("chunk");
  expect(() =>
    f.handlers.get("capability-resources-get-manifest")!(
      event,
      "https://other/path",
      "a".repeat(64),
      "alice",
    ),
  ).toThrow("request");
  expect(() =>
    f.handlers.get("capability-resources-put-manifest")!(
      event,
      {
        version: 1,
        capabilityId: "capability-default",
        files: [{ path: ".env" }],
      },
      "alice",
    ),
  ).toThrow("manifest");
  expect(() =>
    f.handlers.get("capability-resources-get-manifest")!(
      event,
      "capability-default",
      "a".repeat(64),
      { user: "alice" },
    ),
  ).toThrow("owner");
  expect(f.putChunk).not.toHaveBeenCalled();
  expect(f.getManifest).not.toHaveBeenCalled();
  expect(f.resources.putManifest).not.toHaveBeenCalled();
});
