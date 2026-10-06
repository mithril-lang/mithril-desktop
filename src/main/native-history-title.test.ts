import Database from "better-sqlite3";
import { expect, it } from "vitest";
import {
  applyCloudSessionTitle,
  applyCloudSessionModel,
  applyCloudSessionArchive,
} from "./native-history-title";
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

// @lat: [[cloud-workspace-tests#Native model compare and swap]]
it("updates only archival model metadata under exact source CAS and retains title and other sessions", () => {
  const db = new Database(":memory:");
  try {
    db.exec(
      "CREATE TABLE sessions(id TEXT PRIMARY KEY,title TEXT,model TEXT);INSERT INTO sessions VALUES('one','Original','native-one'),('two','Other','retained');",
    );
    expect(applyCloudSessionModel(db, "one", "native-one", "cloud-two")).toBe(
      "cloud-two",
    );
    expect(() =>
      applyCloudSessionModel(db, "one", "native-one", "stale"),
    ).toThrow("changed");
    expect(() => applyCloudSessionModel(db, "one", "cloud-two", "")).toThrow(
      "Invalid",
    );
    expect(db.prepare("SELECT * FROM sessions ORDER BY id").all()).toEqual([
      { id: "one", title: "Original", model: "cloud-two" },
      { id: "two", title: "Other", model: "retained" },
    ]);
  } finally {
    db.close();
  }
});

// @lat: [[cloud-workspace-tests#Native archive compare and swap]]
it("changes only captured archive state and rolls back altered metadata while retaining messages and folders", () => {
  const db = new Database(":memory:");
  try {
    db.exec(
      "CREATE TABLE sessions(id TEXT PRIMARY KEY,title TEXT,archived INTEGER NOT NULL DEFAULT 0);CREATE TABLE messages(session_id TEXT,content TEXT);CREATE TABLE desktop_session_context_folders(session_id TEXT,folder_path TEXT);INSERT INTO sessions VALUES('one','Original',0),('two','Other',1);INSERT INTO messages VALUES('one','Retained');INSERT INTO desktop_session_context_folders VALUES('one','/workspace/kept');",
    );
    expect(applyCloudSessionArchive(db, "one", false, true)).toBe(true);
    expect(() => applyCloudSessionArchive(db, "one", false, false)).toThrow(
      "changed",
    );
    expect(applyCloudSessionArchive(db, "one", true, false)).toBe(false);
    db.exec(
      "CREATE TRIGGER alter_archive AFTER UPDATE OF archived ON sessions BEGIN UPDATE sessions SET title='Mutated' WHERE id=NEW.id; END;",
    );
    expect(() => applyCloudSessionArchive(db, "one", false, true)).toThrow(
      "readback",
    );
    expect(db.prepare("SELECT * FROM sessions ORDER BY id").all()).toEqual([
      { id: "one", title: "Original", archived: 0 },
      { id: "two", title: "Other", archived: 1 },
    ]);
    expect(db.prepare("SELECT * FROM messages").all()).toEqual([
      { session_id: "one", content: "Retained" },
    ]);
    expect(
      db.prepare("SELECT * FROM desktop_session_context_folders").all(),
    ).toEqual([{ session_id: "one", folder_path: "/workspace/kept" }]);
    db.exec(
      "CREATE TABLE legacy(id TEXT PRIMARY KEY,title TEXT);DROP TRIGGER alter_archive;DROP TABLE sessions;ALTER TABLE legacy RENAME TO sessions;",
    );
    expect(() => applyCloudSessionArchive(db, "one", false, true)).toThrow(
      "schema unavailable",
    );
  } finally {
    db.close();
  }
});

// @lat: [[cloud-workspace-tests#Original compression lineage archive]]
it("matches original Agent archiving across compression lineage and preserves separate conversations", () => {
  const db = new Database(":memory:");
  try {
    db.exec(
      "CREATE TABLE sessions(id TEXT PRIMARY KEY,parent_session_id TEXT,end_reason TEXT,archived INTEGER,title TEXT);INSERT INTO sessions VALUES('root',NULL,'compression',0,'Root'),('middle','root','compression',0,'Middle'),('tip','middle',NULL,0,'Tip'),('other',NULL,NULL,0,'Other');",
    );
    expect(applyCloudSessionArchive(db, "tip", false, true)).toBe(true);
    expect(
      db.prepare("SELECT id,archived FROM sessions ORDER BY id").all(),
    ).toEqual([
      { id: "middle", archived: 1 },
      { id: "other", archived: 0 },
      { id: "root", archived: 1 },
      { id: "tip", archived: 1 },
    ]);
    expect(applyCloudSessionArchive(db, "root", true, false)).toBe(false);
    expect(db.prepare("SELECT archived FROM sessions").all()).toEqual([
      { archived: 0 },
      { archived: 0 },
      { archived: 0 },
      { archived: 0 },
    ]);
    db.exec(
      "CREATE TRIGGER mutate_lineage AFTER UPDATE OF archived ON sessions WHEN NEW.id='middle' BEGIN UPDATE sessions SET title='Mutated' WHERE id='root'; END;",
    );
    expect(() => applyCloudSessionArchive(db, "tip", false, true)).toThrow(
      "readback",
    );
    expect(
      db.prepare("SELECT title,archived FROM sessions WHERE id='root'").get(),
    ).toEqual({ title: "Root", archived: 0 });
  } finally {
    db.close();
  }
});
