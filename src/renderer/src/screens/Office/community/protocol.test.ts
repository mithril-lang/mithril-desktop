import { describe, expect, it } from "vitest";
import {
  appendMessage,
  normalizeRelayUrl,
  parseFrame,
  prunePeers,
  sanitizeText,
} from "./protocol";
import { HISTORY_LIMIT, PEER_TTL_MS, type CommunityMessage } from "./types";

const msg = (id: string, ts: number): CommunityMessage => ({
  id,
  roomId: "main-hall",
  senderId: "s",
  senderName: "Sam",
  text: "hi",
  ts,
});

describe("community protocol", () => {
  it("rejects malformed and blank frames", () => {
    expect(parseFrame(null)).toBeNull();
    expect(parseFrame({ type: "chat", message: { text: "  " } })).toBeNull();
    expect(parseFrame({ type: "nope" })).toBeNull();
  });

  it("rebuilds chat frames field by field and strips control chars", () => {
    const frame = parseFrame(
      {
        type: "chat",
        message: { ...msg("1", 5), text: "he\u0000llo", extra: "x" },
      },
      100,
    );
    expect(frame).toEqual({
      type: "chat",
      message: { ...msg("1", 5), text: "hello" },
    });
  });

  it("clamps future timestamps to now", () => {
    const frame = parseFrame({ type: "chat", message: msg("1", 9_999) }, 100);
    expect(frame?.type === "chat" && frame.message.ts).toBe(100);
  });

  it("dedupes, orders and caps history", () => {
    let list: CommunityMessage[] = [];
    list = appendMessage(list, msg("b", 2));
    list = appendMessage(list, msg("a", 1));
    list = appendMessage(list, msg("a", 1));
    expect(list.map((m) => m.id)).toEqual(["a", "b"]);
    for (let i = 0; i < HISTORY_LIMIT + 5; i++)
      list = appendMessage(list, msg(`m${i}`, 10 + i));
    expect(list).toHaveLength(HISTORY_LIMIT);
  });

  it("prunes silent peers", () => {
    const peers = {
      a: { id: "a", name: "A", roomId: "r", lastSeen: 0 },
      b: { id: "b", name: "B", roomId: "r", lastSeen: PEER_TTL_MS },
    };
    expect(Object.keys(prunePeers(peers, PEER_TTL_MS + 1))).toEqual(["b"]);
  });

  it("accepts only ws/wss relay URLs", () => {
    expect(normalizeRelayUrl("wss://relay.example.com/x")).toBe(
      "wss://relay.example.com/x",
    );
    expect(normalizeRelayUrl("https://relay.example.com")).toBeNull();
    expect(normalizeRelayUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeRelayUrl("")).toBeNull();
    expect(sanitizeText(42, 5)).toBe("");
  });

  it("validates avatar poses and drops implausible ones", () => {
    const peer = { id: "a", name: "A", roomId: "r" };
    const ok = parseFrame(
      {
        type: "presence",
        peer: {
          ...peer,
          pose: { x: 1, z: -2, ry: -1, mv: true, place: "bank" },
        },
      },
      5,
    );
    expect(ok?.type === "presence" && ok.peer.pose).toMatchObject({
      x: 1,
      z: -2,
      mv: true,
      place: "bank",
    });
    for (const pose of [
      { x: 1e9, z: 0, ry: 0, mv: false, place: "outside" },
      { x: 0, z: 0, ry: 0, mv: false, place: "moon" },
      { x: NaN, z: 0, ry: 0, mv: false, place: "outside" },
      "nope",
    ]) {
      const f = parseFrame({ type: "presence", peer: { ...peer, pose } });
      expect(f?.type === "presence" && f.peer.pose).toBeUndefined();
    }
  });
});
