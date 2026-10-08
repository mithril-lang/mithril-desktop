import { expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  replaceArchiveDestination,
  windowsArchiveMoveScript,
} from "./archive-save";

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Archive destination replacement]]
it("replaces existing saved bytes on the current native platform", async () => {
  const root = await mkdtemp(join(tmpdir(), "mithril-save-"));
  const source = join(root, "temporary.tar"),
    destination = join(root, "日本語 backup.tar");
  try {
    await writeFile(source, "new archive");
    await writeFile(destination, "previous archive");
    const check = vi.fn();
    await replaceArchiveDestination(source, destination, check);
    expect(await readFile(destination, "utf8")).toBe("new archive");
    await expect(readFile(source)).rejects.toMatchObject({ code: "ENOENT" });
    expect(check).toHaveBeenCalledTimes(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("passes Windows paths as data to the fixed write-through replacement", async () => {
  const source = "C:\\backup\\temporary.tar",
    destination = "C:\\backup\\日本語 '$value;.tar";
  const move = vi.fn(async (_input: string): Promise<void> => {}),
    check = vi.fn();
  await replaceArchiveDestination(source, destination, check, "win32", move);
  expect(JSON.parse(move.mock.calls[0][0])).toEqual({ source, destination });
  expect(windowsArchiveMoveScript).toContain(
    "MoveFileExW($paths.source, $paths.destination, 9)",
  );
  expect(windowsArchiveMoveScript).not.toContain(destination);
  expect(check).toHaveBeenCalledTimes(2);
});

it("refuses cross-directory replacement and propagates failed or stale saves", async () => {
  const move = vi.fn(async (_input: string): Promise<void> => {
    throw Error("failed");
  });
  await expect(
    replaceArchiveDestination(
      "C:\\a\\temp",
      "C:\\b\\dest",
      () => {},
      "win32",
      move,
    ),
  ).rejects.toThrow("same-directory");
  expect(move).not.toHaveBeenCalled();
  await expect(
    replaceArchiveDestination(
      "C:\\a\\temp",
      "C:\\a\\dest",
      () => {},
      "win32",
      move,
    ),
  ).rejects.toThrow("failed");
  move.mockImplementation(async () => {});
  let checks = 0;
  await expect(
    replaceArchiveDestination(
      "C:\\a\\temp",
      "C:\\a\\dest",
      () => {
        if (++checks === 2) throw Error("owner changed");
      },
      "win32",
      move,
    ),
  ).rejects.toThrow("owner changed");
});
