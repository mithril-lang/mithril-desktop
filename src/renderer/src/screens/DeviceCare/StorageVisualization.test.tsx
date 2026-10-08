import { describe, expect, it, vi } from "vitest";
import { volumeShare } from "./StorageVisualization";

vi.mock("../../components/useI18n", async () => {
  const { default: en } =
    await import("../../../../shared/i18n/locales/en/device-care");
  return {
    useI18n: () => ({
      t: (key: string) => en[key.replace("deviceCare.", "") as keyof typeof en],
    }),
  };
});

// @lat: [[device-care#Disk space visualization#Reports valid volume shares]]
describe("whole-volume shares", () => {
  it("uses available volume bytes and refuses invalid capacities", () => {
    expect(volumeShare(1000, 250)).toBe(0.75);
    expect(volumeShare(1000, 1000)).toBe(0);
    for (const [capacity, free] of [
      [null, 0],
      [0, 0],
      [100, null],
      [100, 101],
      [100, -1],
      [NaN, 0],
      [Infinity, 0],
    ]) {
      expect(volumeShare(capacity, free)).toBeNull();
    }
  });
});

it("keeps volume and partial folder measures distinct and exposes group details", async () => {
  const { render, screen, fireEvent } = await import("@testing-library/react");
  const { default: StorageVisualization } =
    await import("./StorageVisualization");
  const { default: en } =
    await import("../../../../shared/i18n/locales/en/device-care");
  const report = {
    root: "/selected",
    observedAt: "2026-10-08T00:00:00Z",
    status: "partial" as const,
    capacity: 10000,
    freeBytes: 2000,
    files: 2,
    logicalBytes: 100,
    allocatedBytes: 512,
    skipped: 1,
    cleanupScope: false,
    candidates: [],
    largest: [],
    groups: [
      {
        name: "projects",
        kind: "folder" as const,
        logicalBytes: 100,
        allocatedBytes: 512,
        files: 2,
      },
    ],
  };
  render(<StorageVisualization report={report} />);
  expect(screen.getByRole("img", { name: /80.0%/ })).toBeTruthy();
  expect(screen.getByText(en.partialMap)).toBeTruthy();
  const group = screen.getByRole("button", { name: /projects/ });
  fireEvent.click(group);
  expect(group.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText(en.groupNote)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Trash/ })).toBeNull();
});
