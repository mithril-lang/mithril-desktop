// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  capabilityResourceManifestBytes,
  type CapabilityResourceManifest,
  type CapabilityResourceTransport,
} from "@mithril/workspace/capability-resources";
import type {
  RepositoryDocument,
  RepositoryTransport,
  RepositoryReceipt,
} from "@mithril/workspace/repository";
import {
  OriginalScheduleReplication,
  type OriginalScheduleReplicationPorts,
} from "./original-schedule-replication";
import {
  RepositorySync,
  emptyRepository,
} from "@mithril/workspace/repository-sync";
import { OriginalSchedulePreparationMailbox } from "@mithril/workspace/original-schedule-preparation";
import { captureOriginalCronFile } from "./cron-source-files";
import type {
  OriginalManualCommand,
  OriginalManualReceipt,
  OriginalManualResult,
} from "./original-schedule-manual";

const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
const sha = (v: string | Uint8Array): string =>
  createHash("sha256").update(v).digest("hex");
function cloud(): {
  repository: RepositoryTransport;
  resources: CapabilityResourceTransport;
  documents: Map<string, RepositoryDocument>;
  failures: { cloudAck: boolean; contextAck: boolean };
  operations: string[];
} {
  const failures = { cloudAck: false, contextAck: false },
    operations: string[] = [];
  const documents = new Map<string, RepositoryDocument>(),
    receipts = new Map<string, RepositoryReceipt>(),
    manifests = new Map<string, CapabilityResourceManifest>(),
    chunks = new Map<string, Uint8Array>();
  const forOwner = (owner: string): CapabilityResourceTransport => ({
    forOwner,
    putChunk: async (id, bytes) => {
      const digest = sha(bytes);
      chunks.set(JSON.stringify([owner, id, digest]), new Uint8Array(bytes));
      return digest;
    },
    getChunk: async (id, digest) => {
      const bytes = chunks.get(JSON.stringify([owner, id, digest]));
      if (!bytes) throw Error("Capability resource request failed (404)");
      return new Uint8Array(bytes);
    },
    putManifest: async (m) => {
      const digest = sha(capabilityResourceManifestBytes(m));
      manifests.set(
        JSON.stringify([owner, m.capabilityId, digest]),
        structuredClone(m),
      );
      return digest;
    },
    getManifest: async (id, digest) => {
      const m = manifests.get(JSON.stringify([owner, id, digest]));
      if (!m) throw Error("Capability resource request failed (404)");
      return structuredClone(m);
    },
  });
  const repository: RepositoryTransport = {
    page: async (collection, after = "") => ({
      schemaVersion: 1,
      userId: "alice",
      documents: structuredClone(
        [...documents.values()]
          .filter((d) => d.collection === collection && d.id > after)
          .sort((a, b) => a.id.localeCompare(b.id)),
      ),
      nextAfter: null,
    }),
    apply: async (edit) => {
      operations.push(edit.operationId);
      const retained = receipts.get(edit.operationId);
      if (retained) return structuredClone(retained);
      const key = edit.collection + ":" + edit.id,
        previous = documents.get(key);
      const accepted = (previous?.revision ?? 0) === edit.baseRevision;
      const document = accepted
        ? {
            collection: edit.collection,
            id: edit.id,
            revision: edit.baseRevision + 1,
            deleted: edit.deleted,
            updatedAt: 1,
            body: structuredClone(edit.body),
          }
        : (previous ?? null);
      if (accepted) documents.set(key, document!);
      const receipt = {
        schemaVersion: 1 as const,
        userId: "alice",
        operationId: edit.operationId,
        status: accepted ? ("accepted" as const) : ("conflict" as const),
        document,
      };
      receipts.set(edit.operationId, receipt);
      if (
        (failures.cloudAck && edit.id.startsWith("schedule-file-")) ||
        (failures.contextAck && edit.id.startsWith("schedule-profile-"))
      ) {
        failures.cloudAck = false;
        failures.contextAck = false;
        throw Error("lost cloud acknowledgement");
      }
      return structuredClone(receipt);
    },
  };
  return {
    repository,
    resources: forOwner("unbound"),
    documents,
    failures,
    operations,
  };
}
function device(
  peer: ReturnType<typeof cloud>,
  selected: boolean,
): {
  home: string;
  ports: OriginalScheduleReplicationPorts;
  events: string[];
  failures: { nativeAck: boolean };
} {
  const home = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-schedule-device-")),
  );
  roots.push(home);
  const events: string[] = [];
  const failures = { nativeAck: false };
  const restored = new Map<
    string,
    { source: string; expected: string | null; version: string }
  >();
  let prepared = false;
  const ports: OriginalScheduleReplicationPorts = {
    scope: { owner: "alice", profile: "default", timeZone: "UTC" },
    home,
    stateRoot: join(home, "private-state"),
    python: "/usr/bin/python3",
    repository: peer.repository,
    resources: peer.resources,
    assertActive: async () => {},
    custody: async (command) => {
      expect(command.action).toBe("status");
      return { userId: "alice", profile: "default", selected, revision: 1 };
    },
    prepare: async () => {
      prepared = true;
      events.push("prepare");
      return { bindingDigest: "a".repeat(64) };
    },
    bind: async (input) => {
      expect(prepared).toBe(true);
      expect(input.nativeVersion).toBe(
        captureOriginalCronFile(home, "default")?.version,
      );
      events.push("bind");
      return { bindingDigest: "b".repeat(64) };
    },
    parser: {
      prepareCreate: async () => {
        throw Error("No parser peer configured");
      },
      prepareTransition: async () => {
        throw Error("No parser peer configured");
      },
    },
    native: {
      capture: (profile) => captureOriginalCronFile(home, profile),
      restore: async (request) => {
        expect(prepared).toBe(true);
        events.push("restore");
        if (request.sourceText === undefined) throw Error("text required");
        const retained = restored.get(request.operationId);
        if (retained) {
          if (
            retained.source !== request.sourceText ||
            retained.expected !== request.expectedVersion
          )
            throw Error("changed restore operation");
          return {
            success: true,
            receipt: {
              owner: request.owner,
              profile: request.profile,
              operationId: request.operationId,
              version: retained.version,
            },
          };
        }
        const before = captureOriginalCronFile(home, request.profile);
        if ((before?.version ?? null) !== request.expectedVersion)
          throw Error("source CAS changed");
        mkdirSync(join(home, "cron"), { recursive: true });
        writeFileSync(join(home, "cron", "jobs.json"), request.sourceText);
        restored.set(request.operationId, {
          source: request.sourceText,
          expected: request.expectedVersion,
          version: sha(request.sourceText),
        });
        if (failures.nativeAck) {
          failures.nativeAck = false;
          throw Error("lost native acknowledgement");
        }
        return {
          success: true,
          receipt: {
            owner: request.owner,
            profile: request.profile,
            operationId: request.operationId,
            version: sha(request.sourceText),
          },
        };
      },
    },
  };
  return { home, ports, events, failures };
}
// @lat: [[cloud-workspace-tests#Automatic shared workdir device synchronization]]
it("keeps original shared folder aliases on a fresh device and after restart without merging equal independent snapshots", async () => {
  const peer = cloud(),
    a = device(peer, true),
    b = device(peer, false);
  const shared = join(a.home, "shared"),
    separate = join(a.home, "separate");
  mkdirSync(shared);
  mkdirSync(separate);
  mkdirSync(join(a.home, "cron"));
  writeFileSync(join(shared, "data.bin"), Buffer.from([255, 0, 42]));
  writeFileSync(join(separate, "data.bin"), Buffer.from([255, 0, 42]));
  const job = (id: string, workdir: string): Record<string, unknown> => ({
    id,
    name: id,
    prompt: "original",
    enabled: false,
    state: "paused",
    schedule: { kind: "interval", minutes: 30 },
    workdir,
    run_claim: null,
  });
  writeFileSync(
    join(a.home, "cron", "jobs.json"),
    JSON.stringify({
      jobs: [
        job("one", shared),
        job("two", shared),
        job("independent", separate),
      ],
    }),
  );
  await expect(
    new OriginalScheduleReplication(a.ports).sync(),
  ).resolves.toEqual({ status: "synced" });
  await expect(
    new OriginalScheduleReplication(b.ports).sync(),
  ).resolves.toEqual({ status: "synced" });
  const read = (): { id: string; workdir: string }[] =>
    JSON.parse(readFileSync(join(b.home, "cron", "jobs.json"), "utf8"))
      .jobs as { id: string; workdir: string }[];
  const rows = read();
  expect(rows[0].workdir).toBe(rows[1].workdir);
  expect(rows[2].workdir).not.toBe(rows[0].workdir);
  for (const row of rows)
    expect(readFileSync(join(row.workdir, "data.bin"))).toEqual(
      Buffer.from([255, 0, 42]),
    );
  const accepted = peer.operations.length;
  await expect(
    new OriginalScheduleReplication(b.ports).sync(),
  ).resolves.toEqual({ status: "synced" });
  expect(peer.operations).toHaveLength(accepted);
  expect(read()).toEqual(rows);
  writeFileSync(join(rows[0].workdir, "data.bin"), "shared edit on B");
  await expect(
    new OriginalScheduleReplication(b.ports).sync(),
  ).resolves.toEqual({ status: "synced" });
  await expect(
    new OriginalScheduleReplication(a.ports).sync(),
  ).resolves.toEqual({ status: "synced" });
  expect(readFileSync(join(shared, "data.bin"), "utf8")).toBe(
    "shared edit on B",
  );
  expect(readFileSync(join(separate, "data.bin"))).toEqual(
    Buffer.from([255, 0, 42]),
  );
}, 60000);
// @lat: [[cloud-workspace-tests#Automatic original schedule device roundtrip]]
it("composes real source, script and working-directory restoration to a fresh passive device and resumes after reopening", async () => {
  const peer = cloud(),
    a = device(peer, true),
    b = device(peer, false);
  mkdirSync(join(a.home, "scripts"));
  mkdirSync(join(a.home, "work"));
  mkdirSync(join(a.home, "cron"));
  writeFileSync(join(a.home, "scripts", "task.py"), "print('original')\n");
  writeFileSync(join(a.home, "work", "input.bin"), Buffer.from([0, 255, 1, 9]));
  const raw =
    '\uFEFF{\r\n "metadata":9223372036854775807,"jobs":[{"id":"one","name":"Original","prompt":"日本語","enabled":true,"state":"scheduled","schedule":{"kind":"cron","expr":"17 9 * * 1-5"},"script":"task.py","workdir":' +
    JSON.stringify(join(a.home, "work")) +
    ',"run_claim":null,"opaque":9007199254740993}]\r\n}';
  writeFileSync(join(a.home, "cron", "jobs.json"), raw);
  await expect(
    new OriginalScheduleReplication(a.ports).sync(),
  ).resolves.toEqual({ status: "synced" });
  await expect(
    new OriginalScheduleReplication(b.ports).sync(),
  ).resolves.toEqual({ status: "synced" });
  const restored = readFileSync(join(b.home, "cron", "jobs.json"), "utf8"),
    row = JSON.parse(restored.slice(1)).jobs[0];
  expect(restored).toBe(
    raw.replace(
      JSON.stringify(join(a.home, "work")),
      JSON.stringify(row.workdir),
    ),
  );
  expect(readFileSync(join(b.home, "scripts", "task.py"), "utf8")).toBe(
    "print('original')\n",
  );
  expect(readFileSync(join(row.workdir, "input.bin"))).toEqual(
    Buffer.from([0, 255, 1, 9]),
  );
  expect(b.events).toEqual(["prepare", "restore", "bind"]);
  await expect(
    new OriginalScheduleReplication(b.ports).sync(),
  ).resolves.toEqual({ status: "synced" });
  expect(b.events.filter((event) => event === "restore")).toHaveLength(1);
  expect(
    [...peer.documents.values()].some((d) =>
      JSON.stringify(d.body).includes(a.home),
    ),
  ).toBe(false);
}, 30000);

// @lat: [[cloud-workspace-tests#Automatic original schedule lost cloud acknowledgement]]
it("reopens retained outboxes after a committed cloud write loses its acknowledgement without another operation", async () => {
  const peer = cloud(),
    a = device(peer, true);
  mkdirSync(join(a.home, "cron"));
  const source = '\uFEFF{"opaque":9223372036854775807,"jobs":[]}\r\n';
  writeFileSync(join(a.home, "cron", "jobs.json"), source);
  peer.failures.cloudAck = true;
  await expect(
    new OriginalScheduleReplication(a.ports).sync(),
  ).resolves.toEqual({ status: "deferred", reason: "cloud-write-unconfirmed" });
  await expect(
    new OriginalScheduleReplication(a.ports).sync(),
  ).resolves.toEqual({ status: "synced" });
  expect(new Set(peer.operations).size).toBe(2);
  expect([...peer.documents.values()].map((d) => d.revision)).toEqual([1, 1]);
  expect(readFileSync(join(a.home, "cron", "jobs.json"), "utf8")).toBe(source);
}, 30000);
// @lat: [[cloud-workspace-tests#Automatic original schedule lost native acknowledgement]]
it("reopens a committed Native restoration without overwriting subsequent script edits", async () => {
  const peer = cloud(),
    a = device(peer, true),
    b = device(peer, false);
  mkdirSync(join(a.home, "cron"));
  mkdirSync(join(a.home, "scripts"));
  writeFileSync(join(a.home, "scripts", "task.py"), "print('before')\n");
  const source =
    '{"jobs":[{"id":"one","name":"one","prompt":"test","enabled":true,"state":"scheduled","schedule":{"kind":"cron","expr":"17 9 * * 1-5"},"script":"task.py"}]}';
  writeFileSync(join(a.home, "cron", "jobs.json"), source);
  await expect(
    new OriginalScheduleReplication(a.ports).sync(),
  ).resolves.toEqual({ status: "synced" });
  b.failures.nativeAck = true;
  await expect(
    new OriginalScheduleReplication(b.ports).sync(),
  ).resolves.toEqual({
    status: "deferred",
    reason: "native-write-unconfirmed",
  });
  writeFileSync(join(b.home, "scripts", "task.py"), "print('after')\n");
  await expect(
    new OriginalScheduleReplication(b.ports).sync(),
  ).resolves.toEqual({
    status: "deferred",
    reason: "sources-changed-after-receipt",
  });
  expect(readFileSync(join(b.home, "scripts", "task.py"), "utf8")).toBe(
    "print('after')\n",
  );
  await expect(
    new OriginalScheduleReplication(b.ports).sync(),
  ).resolves.toEqual({ status: "synced" });
  expect(readFileSync(join(b.home, "scripts", "task.py"), "utf8")).toBe(
    "print('after')\n",
  );
}, 30000);

// @lat: [[cloud-workspace-tests#Automatic original schedule concurrent device edits]]
it("retains both independently edited inventories as a conflict instead of silently overwriting either device", async () => {
  const peer = cloud(),
    a = device(peer, true),
    b = device(peer, false);
  mkdirSync(join(a.home, "cron"));
  const source = '{"opaque":9223372036854775807,"name":"baseline","jobs":[]}';
  writeFileSync(join(a.home, "cron", "jobs.json"), source);
  await expect(
    new OriginalScheduleReplication(a.ports).sync(),
  ).resolves.toEqual({ status: "synced" });
  await expect(
    new OriginalScheduleReplication(b.ports).sync(),
  ).resolves.toEqual({ status: "synced" });
  const local = source.replace("baseline", "device_b");
  writeFileSync(
    join(a.home, "cron", "jobs.json"),
    source.replace("baseline", "device_a"),
  );
  writeFileSync(join(b.home, "cron", "jobs.json"), local);
  await expect(
    new OriginalScheduleReplication(a.ports).sync(),
  ).resolves.toEqual({ status: "synced" });
  await expect(
    new OriginalScheduleReplication(b.ports).sync(),
  ).resolves.toEqual({ status: "conflict", reason: "both-sources-changed" });
  expect(readFileSync(join(b.home, "cron", "jobs.json"), "utf8")).toBe(local);
  expect([...peer.documents.values()].map((d) => d.revision)).toEqual([1, 2]);
}, 30000);

// @lat: [[cloud-workspace-tests#Original Schedules concrete custody gate]]
it("requires exact profile and fresh owner-bound selected custody at the concrete coordinator boundary", async () => {
  const peer = cloud(),
    passive = device(peer, false);
  const engine = new OriginalScheduleReplication(passive.ports);
  await expect(engine.assertScreenScope("other")).rejects.toThrow(
    "profile changed",
  );
  await expect(engine.assertSelectedExecution()).rejects.toThrow(
    "selected device",
  );
  passive.ports.custody = async () => ({
    userId: "bob",
    profile: "default",
    selected: true,
    revision: 1,
  });
  await expect(engine.assertSelectedExecution()).rejects.toThrow(
    "selected device",
  );
  passive.ports.custody = async () => ({
    userId: "alice",
    profile: "default",
    selected: true,
    revision: 1,
  });
  await expect(engine.assertSelectedExecution()).resolves.toBeUndefined();
  engine.stop();
  await expect(engine.assertSelectedExecution()).rejects.toThrow(
    "identity changed",
  );
});

// @lat: [[cloud-workspace-tests#Empty original profile background registration]]
it("registers a fresh original profile in background without creating or restoring a jobs source", async () => {
  const peer = cloud();
  const fresh = device(peer, true);
  expect(captureOriginalCronFile(fresh.home, "default")).toBeNull();
  expect(await new OriginalScheduleReplication(fresh.ports).sync()).toEqual({
    status: "synced",
  });
  expect(captureOriginalCronFile(fresh.home, "default")).toBeNull();
  expect(fresh.events).toEqual(["prepare"]);
  expect(
    [...peer.documents.values()].map((row) => ({ id: row.id, body: row.body })),
  ).toEqual([
    {
      id: "schedule-profile-default",
      body: {
        format: "mithril-original-schedule-profile-v1",
        profile: "default",
        timeZone: "UTC",
      },
    },
  ]);
  const operations = peer.operations.length;
  expect(await new OriginalScheduleReplication(fresh.ports).sync()).toEqual({
    status: "synced",
  });
  expect(peer.operations).toHaveLength(operations);
});

// @lat: [[cloud-workspace-tests#Empty original profile acknowledgement recovery]]
it("recovers a lost profile registration acknowledgement from its retained outbox without creating jobs", async () => {
  const peer = cloud(),
    fresh = device(peer, true);
  peer.failures.contextAck = true;
  await expect(
    new OriginalScheduleReplication(fresh.ports).sync(),
  ).rejects.toThrow("lost cloud acknowledgement");
  expect(await new OriginalScheduleReplication(fresh.ports).sync()).toEqual({
    status: "synced",
  });
  expect(new Set(peer.operations).size).toBe(1);
  expect([...peer.documents.values()].map((row) => row.revision)).toEqual([1]);
  expect(captureOriginalCronFile(fresh.home, "default")).toBeNull();
  expect(fresh.events).not.toContain("restore");
});

// @lat: [[cloud-workspace-tests#Simultaneous empty original profile devices]]
it("coalesces simultaneous fresh device profile registration through real independent private stores", async () => {
  const peer = cloud(),
    a = device(peer, true),
    b = device(peer, false);
  expect(
    await Promise.all([
      new OriginalScheduleReplication(a.ports).sync(),
      new OriginalScheduleReplication(b.ports).sync(),
    ]),
  ).toEqual([{ status: "synced" }, { status: "synced" }]);
  expect([...peer.documents.values()].map((row) => row.revision)).toEqual([1]);
  expect(captureOriginalCronFile(a.home, "default")).toBeNull();
  expect(captureOriginalCronFile(b.home, "default")).toBeNull();
  const operations = peer.operations.length;
  expect(await new OriginalScheduleReplication(b.ports).sync()).toEqual({
    status: "synced",
  });
  expect(peer.operations).toHaveLength(operations);
});

// @lat: [[cloud-workspace-tests#Original parser mailbox background roundtrip]]
it("processes confirmed parser requests on a passive device while retaining original source and private journals", async () => {
  const peer = cloud(),
    passive = device(peer, false);
  await new OriginalScheduleReplication(passive.ports).sync();
  let state = emptyRepository();
  const browser = new RepositorySync(
    "alice",
    peer.repository,
    {
      read: async () => structuredClone(state),
      update: async (_owner, change) => {
        state = change(structuredClone(state));
        return structuredClone(state);
      },
    },
    () => {},
    ["schedule"],
  );
  await browser.load();
  const mailbox = new OriginalSchedulePreparationMailbox(
    browser,
    passive.ports.scope,
  );
  const request = {
    ...passive.ports.scope,
    operationId: crypto.randomUUID(),
    input: { schedule: "17 9 * * 1-5", prompt: "Example" },
  };
  let parses = 0;
  passive.ports.parser.prepareCreate = async (input) => {
    parses++;
    expect(input).toEqual(request);
    const sourceText =
      '{"id":"012345abcdef","name":"Example","prompt":"Example","schedule":{"kind":"cron","expr":"17 9 * * 1-5"},"enabled":true,"state":"scheduled","opaque":9223372036854775807}';
    return { ...input, job: JSON.parse(sourceText), sourceText };
  };
  await mailbox.submit("create", request);
  expect(await mailbox.result("create", request)).toBeNull();
  expect(await new OriginalScheduleReplication(passive.ports).sync()).toEqual({
    status: "synced",
  });
  expect(
    ((await mailbox.result("create", request)) as { sourceText: string })
      .sourceText,
  ).toContain("9223372036854775807");
  expect(captureOriginalCronFile(passive.home, "default")).toBeNull();
  expect(passive.events).not.toContain("restore");
  expect(passive.events).not.toContain("bind");
  expect(
    [...peer.documents.values()].some((row) =>
      row.id.startsWith("schedule-file-"),
    ),
  ).toBe(false);
  await new OriginalScheduleReplication(passive.ports).sync();
  expect(parses).toBe(1);
  const created = (await mailbox.result("create", request))!;
  const transition = {
    ...passive.ports.scope,
    operationId: crypto.randomUUID(),
    action: "resume" as const,
    source: { ...created.job, enabled: false, state: "paused" },
  };
  passive.ports.parser.prepareTransition = async (input) => ({
    ...input,
    job: { ...input.source, enabled: true, state: "scheduled" },
  });
  await mailbox.submit("transition", transition);
  passive.ports.prepare = async () => {
    throw Error("execution policy unavailable");
  };
  expect(
    await new OriginalScheduleReplication(passive.ports)
      .sync()
      .catch((error) => error.message),
  ).toBe("execution policy unavailable");
  expect((await mailbox.result("transition", transition))?.job.state).toBe(
    "scheduled",
  );
  expect(captureOriginalCronFile(passive.home, "default")).toBeNull();
});

function manualRequest(peer: ReturnType<typeof cloud>): OriginalManualReceipt {
  const document = peer.documents.get("schedule:schedule-file-default")!;
  return {
    userId: "alice",
    profile: "default",
    jobId: "one",
    operationId: "manual-one",
    sourceRevision: document.revision,
    sourceDigest: (document.body as { digest: string }).digest,
    status: "unknown",
  };
}
function authoredManualDevice(
  peer: ReturnType<typeof cloud>,
): ReturnType<typeof device> {
  const a = device(peer, true);
  mkdirSync(join(a.home, "cron"));
  mkdirSync(join(a.home, "scripts"));
  writeFileSync(join(a.home, "scripts", "task.py"), "print('original')\n");
  writeFileSync(
    join(a.home, "cron", "jobs.json"),
    '{"opaque":9223372036854775807,"jobs":[{"id":"one","name":"one","prompt":"test","enabled":true,"state":"scheduled","schedule":{"kind":"cron","expr":"17 9 * * 1-5"},"script":"task.py"}]}',
  );
  return a;
}
// @lat: [[cloud-workspace-tests#Original manual concrete source resource binding]]
it("dispatches through the concrete synchronized source/resource binding and retains output on the ordinary replication path", async () => {
  const peer = cloud(),
    a = authoredManualDevice(peer);
  const engine = new OriginalScheduleReplication(a.ports);
  expect(await engine.sync()).toEqual({ status: "synced" });
  const request = manualRequest(peer);
  let effects = 0,
    lost = true;
  const command = async (
    c: OriginalManualCommand,
  ): Promise<OriginalManualResult> => {
    if (c.action === "take")
      return effects === 0
        ? { fresh: true, request, authorityRevision: 1 }
        : { fresh: false, request: null };
    if (lost) throw Error("lost report acknowledgement");
    const { action: _action, ...receipt } = c;
    return { userId: "alice", ...receipt };
  };
  const consumer = engine.manualConsumer({
    command,
    serialize: async <T>(action: () => Promise<T>): Promise<T> => action(),
    run: async (input) => {
      expect(input.expectedVersion).toBe(
        captureOriginalCronFile(a.home, "default")!.version,
      );
      expect(input.operationId).toBe(request.operationId);
      effects++;
      writeFileSync(
        join(a.home, "scripts", "output.txt"),
        "actual output bytes",
      );
      return { success: true, receipt: { ...input, status: "completed" } };
    },
  });
  await expect(consumer.poll()).rejects.toThrow("lost report acknowledgement");
  expect(effects).toBe(1);
  expect(await engine.sync()).toEqual({ status: "synced" });
  expect(manualRequest(peer).sourceDigest).not.toBe(request.sourceDigest);
  engine.stop();
  lost = false;
  const reopened = new OriginalScheduleReplication(a.ports);
  const replay = reopened.manualConsumer({
    command,
    serialize: async <T>(action: () => Promise<T>): Promise<T> => action(),
    run: async () => {
      throw Error("replay must not execute");
    },
  });
  await replay.poll();
  expect(effects).toBe(1);
  expect(readFileSync(join(a.home, "scripts", "output.txt"), "utf8")).toBe(
    "actual output bytes",
  );
  reopened.stop();
}, 30000);

// @lat: [[cloud-workspace-tests#Original manual concrete stale resource refusal]]
it("refuses changed script resources, selected custody and stopped contexts before binding dispatch", async () => {
  const peer = cloud(),
    a = authoredManualDevice(peer);
  const engine = new OriginalScheduleReplication(a.ports);
  await engine.sync();
  const request = manualRequest(peer);
  expect(await engine.manualBinding(request, 1)).toMatchObject({
    owner: "alice",
    jobId: "one",
    sourceDigest: request.sourceDigest,
  });
  writeFileSync(join(a.home, "scripts", "task.py"), "print('changed')\n");
  await expect(engine.manualBinding(request, 1)).rejects.toThrow(
    "resources changed",
  );
  writeFileSync(join(a.home, "scripts", "task.py"), "print('original')\n");
  a.ports.custody = async () => ({
    userId: "alice",
    profile: "default",
    selected: true,
    revision: 2,
  });
  await expect(engine.manualBinding(request, 1)).rejects.toThrow(
    "custody changed",
  );
  a.ports.custody = async () => ({
    userId: "alice",
    profile: "default",
    selected: false,
    revision: 1,
  });
  await expect(engine.manualBinding(request, 1)).rejects.toThrow(
    "selected device",
  );
  engine.stop();
  await expect(engine.manualBinding(request, 1)).rejects.toThrow(
    "identity changed",
  );
}, 30000);
