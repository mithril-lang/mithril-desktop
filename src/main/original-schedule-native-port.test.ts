// @vitest-environment node
import { expect, it, vi, afterEach } from "vitest";
import { createHash } from "crypto";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  BoundOriginalScheduleNativePort,
  type OriginalScheduleResourceBindings,
} from "./original-schedule-native-port";
import { captureOriginalCronFile } from "./cron-source-files";
import type { OriginalCronRestoreRequest } from "./cron-source-restore";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const hash = (text: string): string =>
  createHash("sha256").update(text).digest("hex");
const scope = { owner: "alice", profile: "default", timeZone: "Asia/Tokyo" };
const raw =
  '\uFEFF{\r\n "metadata":9223372036854775807,"jobs":[{"id":"one","name":"one","prompt":"日本語","enabled":false,"state":"paused","schedule":{"kind":"cron","expr":"17 9 * * 1-5"},"script":"/private/script.py","opaque":9007199254740993}]\r\n}';
const portable = raw.replace(
  '"/private/script.py"',
  '"mithril-resource://script"',
);
function bindings(): OriginalScheduleResourceBindings {
  return {
    capture: async () => [
      {
        jobId: "one",
        path: ["script"],
        expectedSourceText: '"/private/script.py"',
        replacementSourceText: '"mithril-resource://script"',
      },
    ],
    restore: async () => [
      {
        jobId: "one",
        path: ["script"],
        expectedSourceText: '"mithril-resource://script"',
        replacementSourceText: '"/restored/script.py"',
      },
    ],
  };
}
function fixture(): string {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-bound-schedule-")),
  );
  roots.push(root);
  mkdirSync(join(root, "cron"));
  writeFileSync(join(root, "cron", "jobs.json"), raw);
  return root;
}

// @lat: [[cloud-workspace-tests#Bound original schedule source roundtrip]]
it("captures real complete source as portable bytes and restores exact bound source with separate CAS/digests", async () => {
  const root = fixture();
  const receipts = new Map<string, string>();
  const restore = vi.fn(async (request: OriginalCronRestoreRequest) => {
    if (request.sourceText === undefined) throw Error("text required");
    const retained = receipts.get(request.operationId);
    if (!retained) {
      expect(request.expectedVersion).toBe(hash(raw));
      writeFileSync(join(root, "cron", "jobs.json"), request.sourceText);
      receipts.set(request.operationId, hash(request.sourceText));
    }
    return {
      success: true as const,
      receipt: {
        owner: request.owner,
        profile: request.profile,
        operationId: request.operationId,
        version: retained ?? hash(request.sourceText),
      },
    };
  });
  const port = new BoundOriginalScheduleNativePort(
    scope,
    { capture: (profile) => captureOriginalCronFile(root, profile), restore },
    bindings(),
    async () => undefined,
  );
  const captured = await port.capture();
  expect(captured).toEqual({
    ...scope,
    sourceText: portable,
    sourceDigest: hash(portable),
    version: hash(raw),
  });
  expect(captured.sourceText).not.toContain("/private/script.py");
  const write = {
    ...scope,
    operationId: "retained",
    sourceText: portable,
    expectedVersion: hash(raw),
  };
  const receipt = await port.restore(write);
  const target = raw.replace("/private/script.py", "/restored/script.py");
  expect(readFileSync(join(root, "cron", "jobs.json"), "utf8")).toBe(target);
  expect(receipt).toEqual({
    ...scope,
    operationId: "retained",
    version: hash(target),
    sourceDigest: hash(portable),
  });
  // Replay of the Agent's retained receipt may acknowledge old bytes without replacing later authored edits.
  writeFileSync(
    join(root, "cron", "jobs.json"),
    target.replace("日本語", "newer"),
  );
  expect(await port.restore(write)).toEqual(receipt);
  expect(readFileSync(join(root, "cron", "jobs.json"), "utf8")).toContain(
    "newer",
  );
});
// @lat: [[cloud-workspace-tests#Bound original schedule identity and receipt guards]]
it("refuses wrong identity, stale raw digests, bad resource CAS and mismatched receipts before acknowledging restoration", async () => {
  const root = fixture();
  const restore = vi.fn(async (request: OriginalCronRestoreRequest) => ({
    success: true as const,
    receipt: {
      owner: request.owner,
      profile: request.profile,
      operationId: request.operationId,
      version: "a".repeat(64),
    },
  }));
  const boundary = {
    capture: (profile: string) => captureOriginalCronFile(root, profile),
    restore,
  };
  const port = new BoundOriginalScheduleNativePort(
    scope,
    boundary,
    bindings(),
    async () => undefined,
  );
  const write = {
    ...scope,
    operationId: "one",
    sourceText: portable,
    expectedVersion: hash(raw),
  };
  await expect(port.restore({ ...write, owner: "bob" })).rejects.toThrow(
    "identity changed",
  );
  expect(restore).not.toHaveBeenCalled();
  await expect(port.restore(write)).rejects.toThrow("unconfirmed");
  const stale = new BoundOriginalScheduleNativePort(
    scope,
    {
      ...boundary,
      capture: () => ({
        ...captureOriginalCronFile(root, "default")!,
        version: "a".repeat(64),
      }),
    },
    bindings(),
    async () => undefined,
  );
  await expect(stale.capture()).rejects.toThrow("source changed");
  const wrong = bindings();
  wrong.capture = async () => [
    {
      jobId: "one",
      path: ["script"],
      expectedSourceText: '"stale"',
      replacementSourceText: '"bound"',
    },
  ];
  await expect(
    new BoundOriginalScheduleNativePort(
      scope,
      boundary,
      wrong,
      async () => undefined,
    ).capture(),
  ).rejects.toThrow("binding unavailable");
  expect(readFileSync(join(root, "cron", "jobs.json"), "utf8")).toBe(raw);
});
// @lat: [[cloud-workspace-tests#Bound original schedule account invalidation]]
it("invalidates an account change while bindings are awaited and never passes the old source to restore", async () => {
  const root = fixture();
  let active = true;
  const guard = async (): Promise<void> => {
    if (!active) throw Error("account changed");
  };
  const restore = vi.fn();
  const binder = bindings();
  binder.restore = async () => {
    active = false;
    return [];
  };
  const port = new BoundOriginalScheduleNativePort(
    scope,
    { capture: (profile) => captureOriginalCronFile(root, profile), restore },
    binder,
    guard,
  );
  await expect(
    port.restore({
      ...scope,
      operationId: "one",
      sourceText: portable,
      expectedVersion: hash(raw),
    }),
  ).rejects.toThrow("binding unavailable");
  expect(restore).not.toHaveBeenCalled();
  expect(readFileSync(join(root, "cron", "jobs.json"), "utf8")).toBe(raw);
});
// @lat: [[cloud-workspace-tests#Bound original schedule source roundtrip]]
it("keeps missing storage absent and has no raw-source fallback when resource binding fails", async () => {
  const capture = vi.fn(() => null),
    restore = vi.fn();
  const binder = bindings();
  binder.capture = async () => {
    throw Error("private token /private/path");
  };
  const port = new BoundOriginalScheduleNativePort(
    scope,
    { capture, restore },
    binder,
    async () => undefined,
  );
  expect(await port.capture()).toEqual({
    ...scope,
    sourceText: null,
    sourceDigest: null,
    version: null,
  });
  const root = fixture();
  const failed = new BoundOriginalScheduleNativePort(
    scope,
    { capture: (profile) => captureOriginalCronFile(root, profile), restore },
    binder,
    async () => undefined,
  );
  await expect(failed.capture()).rejects.toThrow(
    /^Original schedule resource binding unavailable$/,
  );
  expect(restore).not.toHaveBeenCalled();
});
