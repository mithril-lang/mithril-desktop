import { describe, expect, it } from "vitest";
import { sessionHistoryItems } from "@mithril/workspace/session-history";
import type { ChatEvent } from "@mithril/workspace/sessions";

describe("packaged shared transcript", () => {
  // @lat: [[cloud-workspace-tests#Complete packaged shared timeline]]
  it("preserves a complete long log and refuses a late missing page", () => {
    const events: ChatEvent[] = Array.from({ length: 20005 }, (_, index) => ({
      seq: index + 1,
      type: "user",
      data: { content: `Original ${index + 1}` },
      turnId: null,
      createdAt: index + 1,
    }));
    const deleted = {
      id: "original_deleted",
      kind: "user",
      content: "Retained original",
      timestamp: 1,
      deleted: true,
    };
    events.push({
      seq: 20006,
      type: "history_item",
      data: { sourceId: deleted.id, payload: JSON.stringify(deleted) },
      turnId: null,
      createdAt: 20006,
    });
    const items = sessionHistoryItems(events);
    expect(items).toHaveLength(20006);
    expect(items[0].content).toBe("Original 1");
    expect(items[20004].content).toBe("Original 20005");
    expect(items[20005]).toEqual(deleted);
    expect(sessionHistoryItems(events)).toEqual(items);
    const missing = [...events];
    missing.splice(20001, 1);
    expect(() => sessionHistoryItems(missing)).toThrow("order");
  });
});
