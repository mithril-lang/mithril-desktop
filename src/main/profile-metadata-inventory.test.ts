// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { profileMetadataInventory } from "./profile-metadata-inventory";
const roots: string[] = [];
function fixture(): { root: string; bindings: string } {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-profile-inventory-")),
  );
  roots.push(root);
  const bindings = join(root, "bindings");
  mkdirSync(bindings);
  mkdirSync(join(root, "profiles"));
  return { root, bindings };
}
function binding(directory: string, profile: string, userId: string): void {
  writeFileSync(
    join(
      directory,
      createHash("sha256").update(profile).digest("hex") + ".json",
    ),
    JSON.stringify({ profile, userId }),
  );
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { force: true, recursive: true });
});
// @lat: [[cloud-workspace-tests#All-profile metadata inventory preserves selection]]
it("includes original empty and populated profiles without reading credentials or switching the active selection", () => {
  const f = fixture();
  for (const profile of ["research", "empty", "foreign"])
    mkdirSync(join(f.root, "profiles", profile));
  writeFileSync(join(f.root, "active_profile"), "research\n");
  writeFileSync(
    join(f.root, "profiles", "research", ".env"),
    "do not read or upload",
  );
  binding(f.bindings, "research", "alice");
  binding(f.bindings, "foreign", "bob");
  const adopt = vi.fn((profile: string): void => {
    if (profile === "foreign") throw Error("other account");
  });
  const inventory = profileMetadataInventory(
    f.root,
    f.bindings,
    "alice",
    adopt,
  );
  expect(inventory.sources.map((row) => row.profile)).toEqual([
    "default",
    "empty",
    "research",
  ]);
  expect(inventory.sources.every((row) => row.present)).toBe(true);
  expect(inventory.warnings).toHaveLength(1);
  expect(readFileSync(join(f.root, "active_profile"), "utf8")).toBe(
    "research\n",
  );
  expect(
    readFileSync(join(f.root, "profiles", "research", ".env"), "utf8"),
  ).toBe("do not read or upload");
});
// @lat: [[cloud-workspace-tests#All-profile metadata inventory retains absent owned sources]]
it("retains missing current-owner identities for deletion reconciliation but omits missing foreign sources", () => {
  const f = fixture();
  binding(f.bindings, "deleted", "alice");
  binding(f.bindings, "foreign", "bob");
  const inventory = profileMetadataInventory(
    f.root,
    f.bindings,
    "alice",
    () => {},
  );
  expect(inventory.sources.find((row) => row.profile === "deleted")).toEqual({
    profile: "deleted",
    root: join(f.root, "profiles", "deleted"),
    present: false,
  });
  expect(inventory.sources.some((row) => row.profile === "foreign")).toBe(
    false,
  );
});
// @lat: [[cloud-workspace-tests#All-profile metadata inventory rejects linked sources]]
it("does not adopt symlinked or invalid profile roots and rejects a forged binding identity", () => {
  const f = fixture(),
    other = fixture();
  symlinkSync(other.root, join(f.root, "profiles", "linked"));
  mkdirSync(join(f.root, "profiles", "Invalid"));
  const adopt = vi.fn();
  const inventory = profileMetadataInventory(
    f.root,
    f.bindings,
    "alice",
    adopt,
  );
  expect(inventory.sources.map((row) => row.profile)).toEqual(["default"]);
  expect(adopt.mock.calls.flat()).toEqual(["default"]);
  writeFileSync(
    join(f.bindings, "a".repeat(64) + ".json"),
    JSON.stringify({ profile: "fake", userId: "alice" }),
  );
  expect(() =>
    profileMetadataInventory(f.root, f.bindings, "alice", adopt),
  ).toThrow("binding");
});
