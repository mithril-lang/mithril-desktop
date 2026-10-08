import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { originalScheduleReplicationAdmission } from "./original-schedule-replication-admission";
const scope = { owner: "account_a", profile: "a", timeZone: "UTC" };
const text = '\uFEFF{"jobs":[]}\r\n';
const input = {
  ...scope,
  direction: "restore" as const,
  sourceDigest: createHash("sha256").update(text).digest("hex"),
  operationId: "restore_a",
  jobIds: [],
};
function fixture(): {
  state: {
    revision: number;
    userId: string;
    profile: string;
    selected: boolean;
    text: string | null;
    active: boolean;
  };
  directions: string[];
  assert: ReturnType<typeof originalScheduleReplicationAdmission>;
} {
  const state = {
    revision: 3,
    userId: scope.owner,
    profile: scope.profile,
    selected: false,
    text: text as string | null,
    active: true,
  };
  const directions: string[] = [];
  const check = async (): Promise<void> => {
    if (!state.active) throw Error("Account changed");
  };
  return {
    state,
    directions,
    assert: originalScheduleReplicationAdmission({
      scope,
      authorityRevision: 3,
      check,
      custody: async () => ({
        userId: state.userId,
        profile: state.profile,
        selected: state.selected,
        revision: state.revision,
      }),
      source: async (direction) => {
        directions.push(direction);
        return state.text;
      },
    }),
  };
}
// @lat: [[cloud-workspace-tests#Automatic schedule exact source admission]]
it("admits both passive restoration and local capture only against the exact source and authority", async () => {
  const f = fixture();
  await f.assert(input);
  await f.assert({ ...input, direction: "capture", operationId: null });
  expect(f.directions).toEqual(["restore", "capture"]);
  for (const changed of [null, text.trim(), text + " "]) {
    f.state.text = changed;
    await expect(f.assert(input)).rejects.toThrow("Schedule source changed");
  }
});
// @lat: [[cloud-workspace-tests#Automatic schedule authority refusal]]
it("refuses missing or changed authority, foreign identity and stale account before source admission", async () => {
  for (const patch of [
    { revision: 0 },
    { revision: 4 },
    { userId: "account_b" },
    { profile: "b" },
    { active: false },
  ]) {
    const f = fixture();
    Object.assign(f.state, patch);
    await expect(f.assert(input)).rejects.toThrow();
    expect(f.directions).toEqual([]);
  }
  const f = fixture();
  await expect(f.assert({ ...input, owner: "account_b" })).rejects.toThrow(
    "identity changed",
  );
  await expect(f.assert({ ...input, timeZone: "Asia/Tokyo" })).rejects.toThrow(
    "identity changed",
  );
});
// @lat: [[cloud-workspace-tests#Automatic schedule account race]]
it("rejects an account change during custody or source I/O", async () => {
  for (const stage of ["custody", "source"]) {
    let active = true;
    const assert = originalScheduleReplicationAdmission({
      scope,
      authorityRevision: 3,
      check: async () => {
        if (!active) throw Error("Account changed");
      },
      custody: async () => {
        if (stage === "custody") active = false;
        return {
          userId: scope.owner,
          profile: scope.profile,
          selected: true,
          revision: 3,
        };
      },
      source: async () => {
        if (stage === "source") active = false;
        return text;
      },
    });
    await expect(assert(input)).rejects.toThrow("Account changed");
  }
});
