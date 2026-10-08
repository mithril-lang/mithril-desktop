// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  patchProfileMetadataFile,
  readProfileMetadataFile,
  replaceProfileMetadataFile,
} from "./profile-meta-files";
const profileFixture = vi.hoisted(() => ({ root: "" }));
vi.mock("./utils", () => ({
  profileHome: () => profileFixture.root,
  isValidProfileName: (name: string) =>
    /^[a-z0-9_][a-z0-9_-]{0,63}$/.test(name),
  PROFILE_NAME_ERROR: "Invalid profile name",
}));
import {
  setProfileName,
  setProfileColor,
  setProfileAvatar,
  removeProfileAvatar,
  readProfileMeta,
} from "./profile-meta";
const roots: string[] = [];
const fixture = (): string => {
  const root = mkdtempSync(
    join(realpathSync(tmpdir()), "mithril-profile-meta-"),
  );
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});
describe("original profile metadata files", () => {
  // @lat: [[cloud-workspace-tests#Cloud workspace tests#Profile metadata retains original extension tokens]]
  it("retains opaque integer precision, unknown fields and whitespace through original appearance edits", () => {
    const root = fixture(),
      path = join(root, "profile-meta.json");
    const source =
      '{\r\n "opaque":9223372036854775807,"name":"old","future":{"secret":false} }\r\n';
    writeFileSync(path, source);
    patchProfileMetadataFile(root, { name: "new" });
    expect(readFileSync(path, "utf8")).toBe(source.replace('"old"', '"new"'));
    expect(readProfileMetadataFile(root)?.toString()).toBe(
      source.replace('"old"', '"new"'),
    );
    expect(readdirSync(root)).toEqual(["profile-meta.json"]);
  });
  // @lat: [[cloud-workspace-tests#Cloud workspace tests#Invalid profile metadata is retained]]
  it("refuses malformed, duplicate and nonobject sources instead of overwriting them", () => {
    const root = fixture(),
      path = join(root, "profile-meta.json");
    for (const source of ["{broken", "[]", '{"name":"a","name":"b"}']) {
      writeFileSync(path, source);
      expect(() =>
        patchProfileMetadataFile(root, { color: "#abcdef" }),
      ).toThrow();
      expect(readFileSync(path, "utf8")).toBe(source);
      expect(readdirSync(root)).toEqual(["profile-meta.json"]);
    }
  });
  // @lat: [[cloud-workspace-tests#Cloud workspace tests#Profile metadata avatar capacity]]
  it("preserves the full original avatar capacity while clearing another field", () => {
    const root = fixture(),
      path = join(root, "profile-meta.json");
    const avatar = "data:image/png;base64," + "a".repeat(1_499_970);
    writeFileSync(
      path,
      JSON.stringify({ avatar, name: "old", future: { retained: true } }),
    );
    patchProfileMetadataFile(root, { name: undefined });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      avatar,
      future: { retained: true },
    });
  });
  // @lat: [[cloud-workspace-tests#Cloud workspace tests#Profile metadata rejects linked storage]]
  it("refuses symbolic links without changing their destination", () => {
    const root = fixture(),
      other = fixture(),
      target = join(other, "source.json");
    writeFileSync(target, '{"name":"private"}');
    symlinkSync(target, join(root, "profile-meta.json"));
    expect(() => patchProfileMetadataFile(root, { name: "new" })).toThrow(
      "Unsafe",
    );
    expect(readFileSync(target, "utf8")).toBe('{"name":"private"}');
  });
  // @lat: [[cloud-workspace-tests#Cloud workspace tests#Profile metadata sequential appearance edits]]
  it("serializes appearance mutations without losing a preceding field", () => {
    const root = fixture();
    patchProfileMetadataFile(root, { name: "new" });
    patchProfileMetadataFile(root, { color: "#abcdef" });
    expect(JSON.parse(readProfileMetadataFile(root)!.toString())).toEqual({
      name: "new",
      color: "#abcdef",
    });
  });
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Original profile appearance handlers preserve data]]
it("routes the original name, color and avatar handlers through lossless atomic editing", async () => {
  const root = fixture(),
    path = join(root, "profile-meta.json");
  profileFixture.root = root;
  writeFileSync(path, '{"opaque":9223372036854775807,"name":"old"}');
  const results = await Promise.all([
    setProfileName("research", " 調査担当 "),
    setProfileColor("research", "#abcdef"),
    setProfileAvatar("research", "data:image/png;base64,abcd"),
  ]);
  expect(results).toEqual([
    { success: true },
    { success: true },
    { success: true },
  ]);
  expect(await readProfileMeta("research")).toEqual({
    name: "調査担当",
    color: "#abcdef",
    avatar: "data:image/png;base64,abcd",
  });
  expect((await removeProfileAvatar("research")).success).toBe(true);
  expect(readFileSync(path, "utf8")).toContain('"opaque":9223372036854775807');
  expect((await readProfileMeta("research")).avatar).toBeUndefined();
  writeFileSync(path, "{broken");
  expect((await setProfileName("research", "new")).success).toBe(false);
  expect(readFileSync(path, "utf8")).toBe("{broken");
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Profile metadata downloaded writes preserve concurrent edits]]
it("rejects stale downloaded replacements and deletions, including absence changes", () => {
  const root = fixture(),
    path = join(root, "profile-meta.json");
  const before = Buffer.from('{"name":"old"}');
  writeFileSync(path, before);
  const captured = readProfileMetadataFile(root);
  patchProfileMetadataFile(root, { name: "newer local edit" });
  for (const target of [Buffer.from('{"name":"cloud"}'), null]) {
    expect(() => replaceProfileMetadataFile(root, captured, target)).toThrow(
      "changed",
    );
  }
  expect(readFileSync(path, "utf8")).toBe('{"name":"newer local edit"}');
  expect(() => replaceProfileMetadataFile(root, null, before)).toThrow(
    "changed",
  );
  expect(readdirSync(root)).toEqual(["profile-meta.json"]);
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Profile metadata exact replacement and tombstone]]
it("installs original cloud bytes exactly and applies a matched tombstone", () => {
  const root = fixture();
  const bytes = Buffer.from(
    '\ufeff{\r\n "opaque":9223372036854775807,"name":"cloud" }\r\n',
  );
  replaceProfileMetadataFile(root, null, bytes);
  expect(readProfileMetadataFile(root)?.equals(bytes)).toBe(true);
  expect(() =>
    replaceProfileMetadataFile(root, bytes, Buffer.from("{broken")),
  ).toThrow();
  expect(readProfileMetadataFile(root)?.equals(bytes)).toBe(true);
  replaceProfileMetadataFile(root, bytes, null);
  expect(readProfileMetadataFile(root)).toBeNull();
  expect(() => replaceProfileMetadataFile(root, bytes, bytes)).toThrow(
    "changed",
  );
  replaceProfileMetadataFile(root, null, null);
  expect(readdirSync(root)).toEqual([]);
});
