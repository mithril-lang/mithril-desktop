import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { nativeSessionInventory } from "./native-session-inventory";

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Stable paged original SQLite inventory]]
it("completes SQLite pages with equal timestamps and retains archived source rows", () => {
  const db = new Database(":memory:");
  try {
    db.exec(
      "CREATE TABLE sessions(id TEXT PRIMARY KEY,started_at INTEGER,archived INTEGER)",
    );
    const insert = db.prepare("INSERT INTO sessions VALUES(?,1,?)");
    db.transaction(() => {
      for (let i = 0; i < 1205; i++)
        insert.run(`s${String(i).padStart(4, "0")}`, i % 2);
    })();
    let pages = 0;
    const rows = db.transaction(() =>
      nativeSessionInventory((limit, offset) => {
        pages++;
        return db
          .prepare(
            "SELECT * FROM sessions ORDER BY started_at DESC,id COLLATE BINARY ASC LIMIT ? OFFSET ?",
          )
          .all(limit, offset) as Array<{ id: string; archived: number }>;
      }),
    )();
    expect(rows).toHaveLength(1205);
    expect(rows.filter((row) => row.archived === 1)).toHaveLength(602);
    expect(pages).toBe(13);
    expect(rows.at(-1)?.id).toBe("s1204");
  } finally {
    db.close();
  }
});
it("refuses overlapping pages rather than silently omitting source history", () => {
  const page = Array.from({ length: 100 }, (_, i) => ({ id: String(i) }));
  expect(() => nativeSessionInventory(() => page)).toThrow("inventory changed");
});
