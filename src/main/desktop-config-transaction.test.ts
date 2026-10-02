import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  existsSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { DesktopConfigTransaction } from "./desktop-config-transaction";
const temporary: string[] = [];
function fixture(): {
  path: string;
  first: DesktopConfigTransaction;
  second: DesktopConfigTransaction;
} {
  const home = mkdtempSync(join(tmpdir(), "mithril-desktop-config-"));
  temporary.push(home);
  const path = join(home, "desktop.json");
  const write = (file: string, content: string): void => {
    writeFileSync(`${file}.tmp`, content);
    renameSync(`${file}.tmp`, file);
  };
  return {
    path,
    first: new DesktopConfigTransaction(() => path, write),
    second: new DesktopConfigTransaction(() => path, write),
  };
}
afterEach(() => {
  for (const home of temporary.splice(0))
    rmSync(home, { recursive: true, force: true });
});
describe("Desktop settings original-document CAS", () => {
  it("preserves unrelated fields and rejects an independent stale writer", () => {
    const f = fixture();
    writeFileSync(f.path, JSON.stringify({ locale: "en", other: "Retained" }));
    const first = f.first.read(),
      stale = f.second.read();
    first.locale = "ja";
    f.first.write(first);
    stale.other = "Overwrite";
    expect(() => f.second.write(stale)).toThrow("another instance");
    expect(JSON.parse(readFileSync(f.path, "utf8"))).toEqual({
      locale: "ja",
      other: "Retained",
    });
    expect(existsSync(`${f.path}.desktop-lock`)).toBe(false);
  });
  it("refuses unreadable documents and unknown copies without overwriting them", () => {
    const f = fixture();
    writeFileSync(f.path, "broken");
    expect(() => f.first.read(true)).toThrow("left unchanged");
    expect(() => f.first.write(f.first.read())).toThrow("refresh");
    expect(readFileSync(f.path, "utf8")).toBe("broken");
    writeFileSync(f.path, "{}");
    const original = f.first.read();
    expect(() => f.first.write({ ...original, locale: "en" })).toThrow(
      "refresh",
    );
  });
  it("fails closed on another live or stale lock and does not remove it", () => {
    const f = fixture();
    const original = f.first.read();
    writeFileSync(`${f.path}.desktop-lock`, "Other instance");
    expect(() => f.first.write(original)).toThrow("busy");
    expect(readFileSync(`${f.path}.desktop-lock`, "utf8")).toBe(
      "Other instance",
    );
    expect(existsSync(f.path)).toBe(false);
  });
});
