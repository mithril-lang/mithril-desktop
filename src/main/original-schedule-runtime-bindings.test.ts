// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patchOriginalScheduleBindingsText } from "@mithril/workspace/original-schedule-text";
import { captureOriginalCronFile } from "./cron-source-files";
import {
  OriginalScheduleRuntimeBindings,
  type OriginalScheduleRuntimeAdmission,
} from "./original-schedule-runtime-bindings";
const scope = { owner: "alice", profile: "default", timeZone: "Asia/Tokyo" };
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function source(
  claim: string,
): NonNullable<ReturnType<typeof captureOriginalCronFile>> {
  const home = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-runtime-bindings-")),
  );
  roots.push(home);
  mkdirSync(join(home, "cron"));
  writeFileSync(
    join(home, "cron", "jobs.json"),
    '\uFEFF{\r\n"metadata":9223372036854775807,"jobs":[{"id":"one","name":"one","prompt":"hello","enabled":false,"state":"paused","schedule":{"kind":"cron","expr":"17 9 * * 1-5"},"run_claim":' +
      claim +
      ',"fire_claim":null,"pending_slot":null}]}\r\n',
  );
  return captureOriginalCronFile(home, "default")!;
}

// @lat: [[cloud-workspace-tests#Original schedule private runtime claim roundtrip]]
it("keeps native PID/nonces out of portable source and rebinds to exact local tokens without losing opaque numbers", async () => {
  const original = source(
    '{"pid":321,"owner":"PRIVATE_PROCESS_NONCE","opaque":9007199254740993}',
  );
  const local = source(
    '{"pid":654,"owner":"LOCAL_PROCESS_NONCE","opaque":9007199254740995}',
  );
  const admission = {
    assert: vi.fn<OriginalScheduleRuntimeAdmission["assert"]>(
      async () => undefined,
    ),
  };
  const native = { capture: vi.fn(() => local) };
  const binder = new OriginalScheduleRuntimeBindings(
    scope,
    native,
    admission,
    async () => undefined,
  );
  const portable = patchOriginalScheduleBindingsText(
    original.sourceText,
    scope.profile,
    scope.timeZone,
    await binder.capture(original),
  );
  expect(portable).not.toContain("PRIVATE_PROCESS_NONCE");
  expect(portable).not.toContain('"pid":321');
  expect(portable).toContain("9223372036854775807");
  const write = {
    ...scope,
    operationId: "runtime_restore",
    expectedVersion: local.version,
    sourceText: portable,
  };
  const restored = patchOriginalScheduleBindingsText(
    portable,
    scope.profile,
    scope.timeZone,
    await binder.restore(write),
  );
  expect(restored).toBe(local.sourceText);
  expect(admission.assert.mock.calls[0][0]).toMatchObject({
    ...scope,
    direction: "capture",
    jobIds: ["one"],
  });
  expect(admission.assert.mock.calls[1][0]).toMatchObject({
    ...scope,
    direction: "restore",
    operationId: write.operationId,
  });
});

// @lat: [[cloud-workspace-tests#Original schedule runtime claim admission refusal]]
it("refuses foreign references, changed native CAS and missing execution admission instead of restoring cloud claims", async () => {
  const original = source('{"pid":321,"owner":"PRIVATE_NONCE"}');
  const admission = {
    assert: vi.fn<OriginalScheduleRuntimeAdmission["assert"]>(
      async () => undefined,
    ),
  };
  const native = { capture: vi.fn(() => original) };
  const binder = new OriginalScheduleRuntimeBindings(
    scope,
    native,
    admission,
    async () => undefined,
  );
  const portable = patchOriginalScheduleBindingsText(
    original.sourceText,
    scope.profile,
    scope.timeZone,
    await binder.capture(original),
  );
  const write = {
    ...scope,
    operationId: "runtime_restore",
    expectedVersion: original.version,
    sourceText: portable,
  };
  await expect(
    binder.restore({ ...write, sourceText: original.sourceText }),
  ).rejects.toThrow("reference required");
  await expect(
    binder.restore({
      ...write,
      sourceText: portable.replace('"id":"one"', '"id":"other"'),
    }),
  ).rejects.toThrow("reference required");
  await expect(
    binder.restore({ ...write, expectedVersion: null }),
  ).rejects.toThrow("native source changed");
  const denied = new OriginalScheduleRuntimeBindings(
    scope,
    native,
    {
      assert: async () => {
        throw Error("Execution owner unavailable");
      },
    },
    async () => undefined,
  );
  native.capture.mockClear();
  await expect(denied.restore(write)).rejects.toThrow(
    "Execution owner unavailable",
  );
  expect(native.capture).not.toHaveBeenCalled();
  await expect(denied.capture(original)).rejects.toThrow(
    "Execution owner unavailable",
  );
});

// @lat: [[cloud-workspace-tests#Original schedule runtime absent native claims]]
it("binds a new native inventory to null claims while retaining original schedule data and rejecting account changes", async () => {
  const original = source('{"pid":321,"owner":"PRIVATE_NONCE"}');
  let active = true;
  const binder = new OriginalScheduleRuntimeBindings(
    scope,
    { capture: () => null },
    { assert: async () => undefined },
    async () => {
      if (!active) throw Error("Account changed");
    },
  );
  const portable = patchOriginalScheduleBindingsText(
    original.sourceText,
    scope.profile,
    scope.timeZone,
    await binder.capture(original),
  );
  const write = {
    ...scope,
    operationId: "new_inventory",
    expectedVersion: null,
    sourceText: portable,
  };
  const restored = patchOriginalScheduleBindingsText(
    portable,
    scope.profile,
    scope.timeZone,
    await binder.restore(write),
  );
  expect(restored).toBe(
    original.sourceText.replace('{"pid":321,"owner":"PRIVATE_NONCE"}', "null"),
  );
  active = false;
  await expect(binder.restore(write)).rejects.toThrow("Account changed");
});
