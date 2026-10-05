import { describe, it, expect, vi } from "vitest";
import { NativeSessionImport } from "./native-session-import";
import type { NativeContext } from "./native-workspace";
import type { ChatSession } from "@mithril/workspace/sessions";
function fixture(): {
  importer: NativeSessionImport;
  local: {
    id: string;
    title: string;
    ended: boolean;
    messages: { role: "user" | "assistant"; content: string }[];
  }[];
  apply: ReturnType<typeof vi.fn>;
  switch: () => void;
  existing: (value: ChatSession[]) => void;
} {
  let context: NativeContext = {
    userId: "a",
    profile: "default",
    epoch: 1,
    actor: "token-hash",
  };
  let existing: ChatSession[] = [];
  const local = [
    {
      id: "old",
      title: "History",
      ended: true,
      messages: [
        { role: "user" as const, content: "Question" },
        { role: "assistant" as const, content: "Answer" },
      ],
    },
  ];
  const apply = vi.fn(async (id, operation) => ({
    schemaVersion: 1 as const,
    userId: "a",
    operationId: operation.operationId,
    status: "accepted" as const,
    session: {
      id,
      title: operation.data.title,
      model: operation.data.model,
      revision: 1,
      eventSeq: 2,
      deleted: false,
      activeTurn: null,
    },
  }));
  const importer = new NativeSessionImport({
    context: async () => context,
    namespace: () => "fixture-device",
    now: () => 1000000,
    local: (_profile, offset = 0) => local.slice(offset, offset + 51),
    models: async () => [{ id: "mithril-model", available: true }],
    sessions: async () => existing,
    apply,
  });
  return {
    importer,
    local,
    apply,
    switch: () => {
      context = { ...context, userId: "b", actor: "new-token", epoch: 2 };
      importer.reset();
    },
    existing: (value: ChatSession[]) => {
      existing = value;
    },
  };
}
describe("Explicit non-destructive native session import", () => {
  it("keeps operation IDs on offline retry and surfaces CAS conflicts without changing source", async () => {
    const f = fixture();
    const p = await f.importer.previewNativeSessions();
    const choices = [
      { sourceId: p.candidates[0].sourceId, action: "import" as const },
    ];
    f.apply.mockRejectedValueOnce(new Error("offline"));
    await expect(
      f.importer.importNativeSessions(p.previewId, choices),
    ).rejects.toThrow("offline");
    const first = f.apply.mock.calls[0][1];
    f.apply.mockResolvedValueOnce({
      schemaVersion: 1,
      userId: "a",
      operationId: first.operationId,
      status: "conflict",
      session: {
        id: p.candidates[0].sessionId,
        title: "Existing",
        model: "mithril-model",
        revision: 9,
        eventSeq: 4,
        deleted: false,
        activeTurn: null,
      },
    });
    expect(
      (await f.importer.importNativeSessions(p.previewId, choices))[0].status,
    ).toBe("conflict");
    expect(f.apply.mock.calls[1][1].operationId).toBe(first.operationId);
    expect(f.local[0].messages).toHaveLength(2);
  });
  it("discards a late old-account import receipt instead of populating the new account", async () => {
    const f = fixture();
    const p = await f.importer.previewNativeSessions();
    let resolve!: (value: unknown) => void;
    f.apply.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = f.importer.importNativeSessions(p.previewId, [
      { sourceId: p.candidates[0].sourceId, action: "import" },
    ]);
    await vi.waitFor(() => expect(resolve).toBeDefined());
    f.switch();
    resolve({ schemaVersion: 1, userId: "a", status: "accepted" });
    await expect(pending).rejects.toThrow("stale import result");
  });
  it("projects Native to shared with visible Mithril model and no automatic transfer", async () => {
    const f = fixture();
    const preview = await f.importer.previewNativeSessions();
    expect(f.apply).not.toHaveBeenCalled();
    expect(preview.candidates[0].model).toBe("mithril-model");
    await f.importer.importNativeSessions(preview.previewId, [
      { sourceId: preview.candidates[0].sourceId, action: "skip" },
    ]);
    expect(f.apply).not.toHaveBeenCalled();
    expect(f.local[0].messages).toHaveLength(2);
  });
  it("rejects credentials, device paths and unfinished histories without uploading them", async () => {
    const f = fixture();
    f.local[0].messages[0].content = "Bearer secret-token /Users/person/secret";
    const preview = await f.importer.previewNativeSessions();
    expect(preview.candidates).toHaveLength(0);
    expect(JSON.stringify(preview)).not.toContain("secret-token");
    expect(f.apply).not.toHaveBeenCalled();
  });
  it("repeated clicks and retry use stable receipts without duplicate import or native writes", async () => {
    const f = fixture();
    const p = await f.importer.previewNativeSessions();
    const choices = [
      { sourceId: p.candidates[0].sourceId, action: "import" as const },
    ];
    await Promise.all([
      f.importer.importNativeSessions(p.previewId, choices),
      f.importer.importNativeSessions(p.previewId, choices),
    ]);
    await f.importer.importNativeSessions(p.previewId, choices);
    expect(f.apply).toHaveBeenCalledTimes(1);
    expect(f.local[0].title).toBe("History");
  });
  it("existing canonical history cannot be overwritten; only a confirmed separate copy", async () => {
    const f = fixture();
    const first = await f.importer.previewNativeSessions();
    f.existing([
      {
        id: first.candidates[0].sessionId,
        title: "Cloud",
        model: "mithril-model",
        revision: 7,
        eventSeq: 2,
        deleted: false,
        activeTurn: null,
      },
    ]);
    const p = await f.importer.previewNativeSessions();
    const sourceId = p.candidates[0].sourceId;
    await expect(
      f.importer.importNativeSessions(p.previewId, [
        { sourceId, action: "import" },
      ]),
    ).rejects.toThrow("never overwritten");
    await expect(
      f.importer.importNativeSessions(p.previewId, [
        { sourceId, action: "copy" },
      ]),
    ).rejects.toThrow("confirmation");
    await f.importer.importNativeSessions(p.previewId, [
      { sourceId, action: "copy", confirmCopy: true },
    ]);
    expect(f.apply.mock.calls[0][0]).not.toBe(first.candidates[0].sessionId);
    expect(f.apply.mock.calls[0][1].baseRevision).toBe(0);
  });
  it("binds preview to owner, profile, token and epoch", async () => {
    const f = fixture();
    const p = await f.importer.previewNativeSessions();
    f.switch();
    await expect(
      f.importer.importNativeSessions(p.previewId, [
        { sourceId: p.candidates[0].sourceId, action: "import" },
      ]),
    ).rejects.toThrow("account changed");
    expect(f.apply).not.toHaveBeenCalled();
  });
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Paged native history migration]]
it("previews later native sessions without reading or importing them automatically", async () => {
  const f = fixture();
  const source = f.local[0]!;
  f.local.splice(
    0,
    1,
    ...Array.from({ length: 75 }, (_, i) => ({
      ...source,
      id: `old-${i}`,
      title: `History ${i}`,
    })),
  );
  const first = await f.importer.previewNativeSessions();
  expect(first.candidates).toHaveLength(50);
  expect(first.nextOffset).toBe(50);
  const second = await f.importer.previewNativeSessions(50);
  expect(second.candidates).toHaveLength(25);
  expect(second.candidates[0]?.title).toBe("History 50");
  expect(second.nextOffset).toBeNull();
  expect(f.apply).not.toHaveBeenCalled();
  await expect(f.importer.previewNativeSessions(-1)).rejects.toThrow(
    "Invalid native history page",
  );
});
