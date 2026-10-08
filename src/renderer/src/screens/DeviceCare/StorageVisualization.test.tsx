import { describe, expect, it, vi } from "vitest";
import {
  volumeShare,
  layoutTiles,
  storageCategory,
} from "./StorageVisualization";

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
  const group = screen.getAllByRole("button", { name: /projects/ })[0];
  fireEvent.click(group);
  expect(group.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText(en.groupNote)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Trash/ })).toBeNull();
});

// @lat: [[device-care#Disk space visualization#Navigates proportional maps]]
it("preserves area ratios and supports cached hierarchy navigation without cleanup", async () => {
  const nodes = [
    {
      id: "r",
      parentId: null,
      name: "selected",
      kind: "folder" as const,
      logicalBytes: 100,
      allocatedBytes: 512,
      files: 2,
    },
    {
      id: "d",
      parentId: "r",
      name: "projects",
      kind: "folder" as const,
      logicalBytes: 75,
      allocatedBytes: 512,
      files: 1,
    },
    {
      id: "f",
      parentId: "d",
      name: "source.txt",
      kind: "file" as const,
      logicalBytes: 75,
      allocatedBytes: 512,
      files: 1,
    },
    {
      id: "s",
      parentId: "r",
      name: "small.txt",
      kind: "file" as const,
      logicalBytes: 25,
      allocatedBytes: 0,
      files: 1,
    },
  ];
  const tiles = layoutTiles([nodes[1], nodes[3]]);
  expect(tiles[0].width * tiles[0].height).toBeCloseTo(7500);
  expect(tiles[1].width * tiles[1].height).toBeCloseTo(2500);
  expect(storageCategory("/home/.hermes/cache")).toBe("protected");
  expect(storageCategory("/home/project/node_modules/pkg")).toBe(
    "dependencies",
  );
  const { render, screen, fireEvent, cleanup } =
    await import("@testing-library/react");
  cleanup();
  const { default: View } = await import("./StorageVisualization");
  const renew = vi.fn();
  render(
    <View
      report={{
        root: "/selected",
        observedAt: "now",
        status: "complete",
        capacity: 1000,
        freeBytes: 500,
        files: 2,
        logicalBytes: 100,
        allocatedBytes: 512,
        skipped: 0,
        candidates: [],
        largest: [],
        groups: [],
        cleanupScope: false,
        tree: nodes,
      }}
      onAnalyzeNode={renew}
    />,
  );
  fireEvent.click(screen.getAllByRole("button", { name: /projects/ })[0]);
  expect(screen.getByRole("navigation").textContent).toContain("projects");
  expect(
    screen.getAllByRole("button", { name: /source.txt/ }).length,
  ).toBeGreaterThan(0);
  fireEvent.click(
    screen.getByRole("button", { name: "Analyze this folder in detail" }),
  );
  expect(renew).toHaveBeenCalledWith("d");
  fireEvent.click(screen.getByRole("button", { name: "Parent folder" }));
  expect(
    screen.getAllByRole("button", { name: /small.txt/ }).length,
  ).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: /Trash/ })).toBeNull();
});
