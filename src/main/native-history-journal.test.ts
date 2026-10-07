import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  readNativeHistoryJournal,
  writeNativeHistoryEntry,
} from "./native-history-journal";

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Incremental durable history journal]]
it("retains legacy pending receipts, overlays only changed sessions and isolates account/profile journals", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mithril-journal-")));
  try {
    const legacyPath = join(
      root,
      createHash("sha256")
        .update(JSON.stringify(["alice", "default"]))
        .digest("hex") + ".json",
    );
    const original = JSON.stringify({
      entries: {
        first: {
          hashes: {},
          pending: { operation: { operationId: "retained" } },
        },
        second: { hashes: {}, pending: null },
      },
    });
    writeFileSync(legacyPath, original);
    expect(
      readNativeHistoryJournal(root, "alice", "default").entries.first.pending,
    ).toMatchObject({ operation: { operationId: "retained" } });
    writeNativeHistoryEntry(root, "alice", "default", "first", {
      hashes: {},
      pending: null,
    });
    const directory = join(
      root,
      readdirSync(root).find((name) => name.endsWith(".entries"))!,
    );
    const firstPath = join(directory, readdirSync(directory)[0]);
    const firstBytes = readFileSync(firstPath, "utf8");
    writeNativeHistoryEntry(root, "alice", "default", "third", {
      hashes: { message: "a".repeat(64) },
      pending: null,
    });
    expect(readFileSync(firstPath, "utf8")).toBe(firstBytes);
    expect(readFileSync(legacyPath, "utf8")).toBe(original);
    expect(
      Object.keys(
        readNativeHistoryJournal(root, "alice", "default").entries,
      ).sort(),
    ).toEqual(["first", "second", "third"]);
    expect(
      readNativeHistoryJournal(root, "alice", "default").entries.first.pending,
    ).toBeNull();
    expect(readNativeHistoryJournal(root, "bob", "default").entries).toEqual(
      {},
    );
    expect(readNativeHistoryJournal(root, "alice", "other").entries).toEqual(
      {},
    );
    writeFileSync(join(directory, "interrupted.tmp"), "invalid");
    expect(
      Object.keys(readNativeHistoryJournal(root, "alice", "default").entries),
    ).toHaveLength(3);
    const row = JSON.parse(firstBytes);
    row.owner = "bob";
    writeFileSync(firstPath, JSON.stringify(row));
    expect(() => readNativeHistoryJournal(root, "alice", "default")).toThrow(
      "entry owner",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("refuses symlinked journal roots without reading or modifying their target", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mithril-journal-")));
  try {
    symlinkSync(root, join(root, "link"), "dir");
    expect(() =>
      readNativeHistoryJournal(join(root, "link"), "alice", "default"),
    ).toThrow("Unsafe");
    expect(() =>
      writeNativeHistoryEntry(join(root, "link"), "alice", "default", "first", {
        hashes: {},
        pending: null,
      }),
    ).toThrow("Unsafe");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
