import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import EndpointProtection from "./EndpointProtection";
import type { EndpointStatus } from "../../../../shared/endpoint-protection";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("allows local monitoring without a cloud account and shows a native failure", async () => {
  const status: EndpointStatus = {
    enabled: false,
    running: false,
    folders: [],
    definitions: { version: 1, source: "bundled", expires: null },
    lastPoll: null,
    lastUpdate: null,
    scannedFiles: 0,
    connections: [],
    alerts: [],
    gaps: [],
    updateError: null,
  };
  const api = {
    status: vi.fn().mockResolvedValue(status),
    setEnabled: vi
      .fn()
      .mockResolvedValue({ ...status, enabled: true, running: true }),
    scanFile: vi
      .fn()
      .mockRejectedValue(Error("File exceeds the 2 MiB scan limit")),
    chooseFolder: vi.fn(),
    removeFolder: vi.fn(),
    updateDefinitions: vi.fn(),
  };
  window.hermesAPI = { endpoint: api } as unknown as typeof window.hermesAPI;
  render(<EndpointProtection locale="ja" />);
  fireEvent.click(await screen.findByRole("button", { name: "監視を開始" }));
  await waitFor(() => expect(api.setEnabled).toHaveBeenCalledWith(true));
  await screen.findByRole("button", { name: "監視を停止" });
  fireEvent.click(screen.getByRole("button", { name: "ファイルを検査" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("2 MiB");
});
