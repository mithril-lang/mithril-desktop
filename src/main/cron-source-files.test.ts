// @vitest-environment node
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  readdirSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, expect, it, vi } from "vitest";
const captureRace = vi.hoisted(() => ({
  stats: 0,
  afterRead: null as (() => void) | null,
}));
vi.mock("fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("fs")>();
  return {
    ...original,
    fstatSync: (...args: Parameters<typeof original.fstatSync>) => {
      const result = original.fstatSync(...args);
      captureRace.stats += 1;
      if (captureRace.stats === 2) captureRace.afterRead?.();
      return result;
    },
  };
});
import { captureOriginalCronFile } from "./cron-source-files";
const roots: string[] = [];
afterEach(() => {
  captureRace.stats = 0;
  captureRace.afterRead = null;
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }));
});
it("refuses an in-place source change after the descriptor check without overwriting the newer file", () => {
  const root = fixture({ jobs: [{ id: "original" }] });
  const path = join(root, "cron", "jobs.json");
  const newer = JSON.stringify({ jobs: [{ id: "newer-source" }] });
  captureRace.stats = 0;
  captureRace.afterRead = () => writeFileSync(path, newer);
  expect(() => captureOriginalCronFile(root, "default")).toThrow("changed");
  expect(readFileSync(path, "utf8")).toBe(newer);
});
function fixture(file: unknown): string {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-cron-source-")),
  );
  roots.push(root);
  mkdirSync(join(root, "cron"));
  writeFileSync(join(root, "cron", "jobs.json"), JSON.stringify(file));
  return root;
}
it("captures exact source metadata and versions across independent A-B-A profiles without normalization or writes", () => {
  const job = {
    id: "original",
    schedule: { kind: "once", run_at: "2026-10-08T09:00:00+09:00" },
    model: "original",
    monitor_state: { retained: true },
    future: [null, 1, "value"],
  };
  const file = {
    version: 2,
    jobs: [job],
    original_store_metadata: { retain: true },
  };
  const a = fixture(file),
    b = fixture({ ...file, jobs: [{ ...job, id: "other" }] });
  const before = readFileSync(join(a, "cron", "jobs.json"));
  const first = captureOriginalCronFile(a, "a")!;
  expect(first.file).toEqual(file);
  expect(captureOriginalCronFile(b, "b")!.version).not.toBe(first.version);
  expect(captureOriginalCronFile(a, "a")).toEqual(first);
  expect(readFileSync(join(a, "cron", "jobs.json"))).toEqual(before);
  expect(readdirSync(join(a, "cron"))).toEqual(["jobs.json"]);
  writeFileSync(
    join(a, "cron", "jobs.json"),
    JSON.stringify({ ...file, version: 3 }),
  );
  expect(captureOriginalCronFile(a, "a")!.version).not.toBe(first.version);
});
it("retains the original array file shape and distinguishes a missing file from an empty inventory", () => {
  const root = fixture([{ id: "legacy", unknown: "retain" }]);
  expect(captureOriginalCronFile(root, "default")!.file).toEqual([
    { id: "legacy", unknown: "retain" },
  ]);
  rmSync(join(root, "cron", "jobs.json"));
  expect(captureOriginalCronFile(root, "default")).toBeNull();
  writeFileSync(join(root, "cron", "jobs.json"), '{"jobs":[]}');
  expect(captureOriginalCronFile(root, "default")!.file).toEqual({ jobs: [] });
});
it("captures Windows BOM source metadata without changing its original bytes", () => {
  const file = {
    jobs: [{ id: "windows" }],
    original_metadata: ["日本語", null],
  };
  const root = fixture(file);
  const path = join(root, "cron", "jobs.json");
  writeFileSync(path, "\uFEFF" + JSON.stringify(file));
  const before = readFileSync(path);
  expect(captureOriginalCronFile(root, "default")!.file).toEqual(file);
  expect(readFileSync(path)).toEqual(before);
});
it("refuses malformed rows, duplicate identities and invalid encoding rather than silently dropping data", () => {
  for (const file of [
    { jobs: [{ id: "valid" }, null] },
    { jobs: [{ id: "same" }, { id: "same" }] },
    { jobs: "invalid" },
  ]) {
    const root = fixture(file),
      path = join(root, "cron", "jobs.json"),
      before = readFileSync(path);
    expect(() => captureOriginalCronFile(root, "default")).toThrow();
    expect(readFileSync(path)).toEqual(before);
  }
  const root = fixture({ jobs: [] }),
    path = join(root, "cron", "jobs.json");
  writeFileSync(path, Buffer.from([0x7b, 0xff, 0x7d]));
  expect(() => captureOriginalCronFile(root, "default")).toThrow("encoding");
});
it("refuses linked source files and directories before admitting an inventory", () => {
  const root = fixture({ jobs: [] }),
    other = fixture({ jobs: [{ id: "outside" }] });
  rmSync(join(root, "cron", "jobs.json"));
  symlinkSync(
    join(other, "cron", "jobs.json"),
    join(root, "cron", "jobs.json"),
  );
  expect(() => captureOriginalCronFile(root, "default")).toThrow("Unsafe");
  rmSync(join(root, "cron"), { recursive: true });
  symlinkSync(join(other, "cron"), join(root, "cron"), "dir");
  expect(() => captureOriginalCronFile(root, "default")).toThrow("Unsafe");
});
// @lat: [[cloud-workspace#Cloud workspace#Exact original schedule source restoration (draft)]]
it("retains exact source text with large integers, BOM and CRLF rather than serializing the parsed projection", () => {
  const root = fixture({ jobs: [] });
  const sourceText =
    '\uFEFF{\r\n "jobs": [], "opaqueCounter": 9223372036854775807\r\n}\r\n';
  const path = join(root, "cron", "jobs.json");
  writeFileSync(path, sourceText);
  const first = captureOriginalCronFile(root, "default")!;
  expect(first.sourceText).toBe(sourceText);
  expect(Buffer.from(first.sourceText)).toEqual(readFileSync(path));
});
