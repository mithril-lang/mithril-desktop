// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  profileMemoryInventory,
  profileMemorySource,
} from "./profile-memory-inventory";
import { memoryFileId } from "@mithril/workspace/memory-files";
const roots: string[] = [];
const fixture = (): string => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-profile-memory-")),
  );
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { force: true, recursive: true });
});

// @lat: [[cloud-workspace-tests#All-profile Memory inventory preserves original files]]
it("captures every owned original profile without changing selection or serializing configuration", () => {
  const root = fixture();
  writeFileSync(join(root, "active_profile"), "research\n");
  const sources = ["default", "research", "empty"].map((profile) => {
    const home = join(root, profile);
    mkdirSync(join(home, "memories"), { recursive: true });
    writeFileSync(
      join(home, "config.yaml"),
      "memory:\n  memory_char_limit: 5000\nAPI_KEY: DO_NOT_COPY\n",
    );
    if (profile !== "empty")
      writeFileSync(join(home, "memories", "MEMORY.md"), ` ${profile} notes\n`);
    return { profile, root: home, present: true };
  });
  const snapshot = profileMemoryInventory(sources);
  expect(snapshot.ids).toHaveLength(9);
  expect(snapshot.documents).toHaveLength(2);
  expect(snapshot.documents.map((row) => row.id)).toEqual([
    memoryFileId("default", "memory"),
    memoryFileId("research", "memory"),
  ]);
  expect(JSON.stringify(snapshot.documents)).not.toContain("DO_NOT_COPY");
  expect(snapshot.warnings).toEqual([]);
  expect(readFileSync(join(root, "active_profile"), "utf8")).toBe("research\n");
  const original = snapshot.documents[1];
  const document = { ...original, revision: 2, updatedAt: 1 };
  expect(profileMemorySource(sources, document)?.profile).toBe("research");
  expect(
    profileMemorySource(sources, {
      ...document,
      id: memoryFileId("default", "memory"),
    }),
  ).toBeUndefined();
  expect(
    profileMemorySource(
      sources.filter((source) => source.profile !== "research"),
      document,
    ),
  ).toBeUndefined();
  rmSync(sources[1].root, { recursive: true });
  expect(profileMemorySource(sources, document)).toBeUndefined();
});

// @lat: [[cloud-workspace-tests#All-profile Memory inventory preserves unavailable sources]]
it("does not claim deletion authority for a missing, linked or malformed profile", () => {
  const root = fixture(),
    good = join(root, "good"),
    linked = join(root, "linked"),
    bad = join(root, "bad");
  mkdirSync(good);
  mkdirSync(bad);
  writeFileSync(join(good, "SOUL.md"), "Persona\n");
  writeFileSync(join(bad, "SOUL.md"), Buffer.from([0xff]));
  symlinkSync(good, linked);
  const snapshot = profileMemoryInventory([
    { profile: "good", root: good, present: true },
    { profile: "linked", root: linked, present: true },
    { profile: "bad", root: bad, present: true },
    { profile: "gone", root: join(root, "gone"), present: false },
  ]);
  expect(snapshot.ids).toHaveLength(3);
  expect(snapshot.ids.every((id) => id.startsWith("memory-good-"))).toBe(true);
  expect(snapshot.documents).toHaveLength(1);
  expect(snapshot.warnings).toHaveLength(2);
});
