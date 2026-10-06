import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { applyCloudSessionTitle } from "./native-history-title";
// @lat: [[cloud-workspace-tests#Native title compare and swap]]
it("applies only to the captured original title and marks user provenance", () => {
  const db = new Database(":memory:");
  try {
    db.exec(
      "CREATE TABLE sessions(id TEXT PRIMARY KEY,title TEXT UNIQUE,title_source TEXT);INSERT INTO sessions VALUES('source','Original','auto');",
    );
    expect(
      applyCloudSessionTitle(db, "source", "Original", "Cloud edited"),
    ).toBe("Cloud edited");
    expect(
      db
        .prepare("SELECT title,title_source FROM sessions WHERE id='source'")
        .get(),
    ).toEqual({ title: "Cloud edited", title_source: "user" });
    expect(() =>
      applyCloudSessionTitle(db, "source", "Original", "Stale write"),
    ).toThrow("changed");
    expect(db.prepare("SELECT title FROM sessions").get()).toEqual({
      title: "Cloud edited",
    });
  } finally {
    db.close();
  }
});
it("retains all source rows when a canonical duplicate cannot fit the original schema", () => {
  const db = new Database(":memory:");
  try {
    db.exec(
      "CREATE TABLE sessions(id TEXT PRIMARY KEY,title TEXT UNIQUE);INSERT INTO sessions VALUES('one','Original'),('two','Duplicate');",
    );
    expect(() =>
      applyCloudSessionTitle(db, "one", "Original", "Duplicate"),
    ).toThrow();
    expect(db.prepare("SELECT * FROM sessions ORDER BY id").all()).toEqual([
      { id: "one", title: "Original" },
      { id: "two", title: "Duplicate" },
    ]);
  } finally {
    db.close();
  }
});
it("supports older source schemas and a captured null title without changing other fields", () => {
  const db = new Database(":memory:");
  try {
    db.exec(
      "CREATE TABLE sessions(id TEXT PRIMARY KEY,title TEXT,model TEXT);INSERT INTO sessions VALUES('one',NULL,'native-model');",
    );
    expect(applyCloudSessionTitle(db, "one", null, "Cloud")).toBe("Cloud");
    expect(db.prepare("SELECT * FROM sessions").get()).toEqual({
      id: "one",
      title: "Cloud",
      model: "native-model",
    });
  } finally {
    db.close();
  }
});
