import type { Attachment } from "../shared/attachments";
import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  statSync,
  symlinkSync,
} from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { CHUNK_BYTES, digestBytes } from "@mithril/workspace/files";
import {
  writeHistoryAttachment,
  type HistoryFileTransport,
  type HistoryAttachment,
} from "@mithril/workspace/history";
import { restoreHistoryAttachment } from "./history-attachment-cache";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture(): {
  root: string;
  chunks: Map<string, Uint8Array>;
  transport: HistoryFileTransport;
  get: ReturnType<typeof vi.fn<HistoryFileTransport["get"]>>;
  owners: string[];
  guard: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
  const root = mkdtempSync(
    join(realpathSync(tmpdir()), "mithril-history-files-"),
  );
  roots.push(root);
  const chunks = new Map<string, Uint8Array>();
  const get = vi.fn(async (_session: string, digest: string) => {
    const value = chunks.get(digest);
    if (!value) throw Error("Missing owned chunk");
    return value;
  });
  const owners: string[] = [];
  const transport: HistoryFileTransport = {
    forOwner: (owner) => {
      owners.push(owner);
      return transport;
    },
    put: async (_session, bytes) => {
      const digest = await digestBytes(bytes);
      chunks.set(digest, bytes);
      return digest;
    },
    get,
  };
  const guard = vi.fn(async () => {});
  return { root, chunks, transport, get, owners, guard };
}
// @lat: [[cloud-workspace-tests#Complete history attachment cache]]
it("restores all attachments above fifty MiB and reopens verified files without network access", async () => {
  const f = fixture();
  const files: HistoryAttachment[] = [];
  for (let index = 0; index < 3; index++) {
    const bytes = new Uint8Array(18 * 1024 * 1024).fill(index + 1);
    files.push(
      await writeHistoryAttachment(
        f.transport,
        "chat",
        {
          id: `file_${index}`,
          kind: "file",
          name: `file-${index}.pdf`,
          mime: "application/pdf",
          size: bytes.length,
        },
        bytes,
      ),
    );
  }
  const restored: Attachment[] = [];
  for (const file of files)
    restored.push(
      await restoreHistoryAttachment(
        f.root,
        "alice",
        "chat",
        file,
        f.transport,
        f.guard,
      ),
    );
  expect(restored.reduce((size, file) => size + file.size, 0)).toBeGreaterThan(
    50 * 1024 * 1024,
  );
  for (const [index, file] of restored.entries()) {
    expect(file.kind).toBe("path-ref");
    expect(statSync(file.path!).size).toBe(files[index].size);
    expect(await digestBytes(readFileSync(file.path!))).toBe(
      files[index].digest,
    );
    expect(statSync(file.path!).mode & 0o777).toBe(0o600);
  }
  expect(readdirSync(dirname(restored[0].path!))).toHaveLength(3);
  f.get.mockClear();
  for (const file of files)
    await restoreHistoryAttachment(
      f.root,
      "alice",
      "chat",
      file,
      f.transport,
      f.guard,
    );
  expect(f.get).not.toHaveBeenCalled();
  const bob = await restoreHistoryAttachment(
    f.root,
    "bob",
    "chat",
    files[0],
    f.transport,
    f.guard,
  );
  expect(bob.path).not.toBe(restored[0].path);
  expect(f.get).toHaveBeenCalledTimes(Math.ceil(files[0].size / CHUNK_BYTES));
  expect(f.owners).toEqual(["alice", "alice", "alice", "bob"]);
});
// @lat: [[cloud-workspace-tests#Atomic attachment cache recovery]]
it("recovers damaged cached bytes while refusing corrupt downloads and retired owners", async () => {
  const f = fixture(),
    bytes = new TextEncoder().encode("Original evidence");
  const file = await writeHistoryAttachment(
    f.transport,
    "chat",
    {
      id: "evidence",
      kind: "file",
      name: "evidence.pdf",
      mime: "application/pdf",
      size: bytes.length,
    },
    bytes,
  );
  const cached = await restoreHistoryAttachment(
    f.root,
    "alice",
    "chat",
    file,
    f.transport,
    f.guard,
  );
  const damaged = new Uint8Array(bytes.length).fill(1);
  writeFileSync(cached.path!, damaged);
  await restoreHistoryAttachment(
    f.root,
    "alice",
    "chat",
    file,
    f.transport,
    f.guard,
  );
  expect(readFileSync(cached.path!)).toEqual(Buffer.from(bytes));
  writeFileSync(cached.path!, damaged);
  f.get.mockImplementationOnce(async () => damaged);
  await expect(
    restoreHistoryAttachment(
      f.root,
      "alice",
      "chat",
      file,
      f.transport,
      f.guard,
    ),
  ).rejects.toThrow("integrity");
  expect(readFileSync(cached.path!)).toEqual(Buffer.from(damaged));
  let checks = 0;
  await expect(
    restoreHistoryAttachment(
      f.root,
      "alice",
      "chat",
      file,
      f.transport,
      async () => {
        if (++checks === 2) throw Error("Account retired");
      },
    ),
  ).rejects.toThrow("Account retired");
  expect(readFileSync(cached.path!)).toEqual(Buffer.from(damaged));
  expect(readdirSync(dirname(cached.path!))).toEqual([file.digest]);
  await restoreHistoryAttachment(
    f.root,
    "alice",
    "chat",
    file,
    f.transport,
    f.guard,
  );
  expect(readFileSync(cached.path!)).toEqual(Buffer.from(bytes));
});
// @lat: [[cloud-workspace-tests#Attachment cache path integrity]]
it("validates identities before filesystem access and refuses symlinked storage", async () => {
  const f = fixture(),
    bytes = new TextEncoder().encode("hello");
  const file = await writeHistoryAttachment(
    f.transport,
    "chat",
    {
      id: "text",
      kind: "text-file",
      name: "hello.txt",
      mime: "text/plain",
      size: bytes.length,
    },
    bytes,
  );
  await expect(
    restoreHistoryAttachment(
      f.root,
      "alice",
      "chat",
      { ...file, digest: "../outside" },
      f.transport,
      f.guard,
    ),
  ).rejects.toThrow("Invalid history attachment");
  expect(readdirSync(f.root)).toEqual([]);
  const cached = await restoreHistoryAttachment(
    f.root,
    "alice",
    "chat",
    file,
    f.transport,
    f.guard,
  );
  expect(cached.text).toBe("hello");
  const imageBytes = new Uint8Array([1, 2, 3]);
  const image = await writeHistoryAttachment(
    f.transport,
    "chat",
    {
      id: "image",
      kind: "image",
      name: "image.png",
      mime: "image/png",
      size: imageBytes.length,
      originalSize: 10,
    },
    imageBytes,
  );
  const restoredImage = await restoreHistoryAttachment(
    f.root,
    "alice",
    "chat",
    image,
    f.transport,
    f.guard,
  );
  expect(restoredImage.dataUrl).toBe("data:image/png;base64,AQID");
  expect(restoredImage.originalSize).toBe(10);
  const linked = join(f.root, "linked");
  symlinkSync(join(f.root, "attachments"), linked);
  await expect(
    restoreHistoryAttachment(
      linked,
      "alice",
      "chat",
      file,
      f.transport,
      f.guard,
    ),
  ).rejects.toThrow("Unsafe history storage");
});
