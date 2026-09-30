import {
  HISTORY_LIMIT,
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  PEER_TTL_MS,
  POSE_LIMIT,
  POSE_PLACES,
  type PeerPose,
  type CommunityFrame,
  type CommunityMessage,
  type CommunityPeer,
} from "./types";

/** Single-line variant for display names: newlines collapse to spaces. */
export function sanitizeName(raw: unknown, max: number): string {
  return sanitizeText(raw, max * 4)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Strips control characters and clamps length; returns "" for blank input. */
export function sanitizeText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  let out = "";
  for (const ch of raw) {
    const c = ch.charCodeAt(0);
    // Drop C0 controls (keeping \t and \n) and DEL.
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a) || c === 0x7f) continue;
    out += ch;
  }
  return out.trim().slice(0, max);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function parsePose(raw: unknown): PeerPose | undefined {
  if (!isRecord(raw)) return undefined;
  const { x, z, ry, mv, place } = raw;
  if (
    typeof x !== "number" ||
    typeof z !== "number" ||
    typeof ry !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(z) ||
    !Number.isFinite(ry) ||
    Math.abs(x) > POSE_LIMIT ||
    Math.abs(z) > POSE_LIMIT ||
    typeof place !== "string" ||
    !(POSE_PLACES as readonly string[]).includes(place)
  ) {
    return undefined;
  }
  return {
    x,
    z,
    ry: ((ry % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2),
    mv: mv === true,
    place: place as PeerPose["place"],
  };
}

/**
 * Validates a frame received from the network. Everything in it is untrusted
 * (other users, or a hostile relay), so it is rebuilt field by field.
 */
export function parseFrame(
  raw: unknown,
  now = Date.now(),
): CommunityFrame | null {
  if (!isRecord(raw)) return null;
  if (raw.type === "chat" && isRecord(raw.message)) {
    const m = raw.message;
    const text = sanitizeText(m.text, MAX_MESSAGE_LENGTH);
    const senderName = sanitizeName(m.senderName, MAX_NAME_LENGTH);
    const id = sanitizeText(m.id, 64);
    const roomId = sanitizeText(m.roomId, 64);
    const senderId = sanitizeText(m.senderId, 64);
    if (!text || !senderName || !id || !roomId || !senderId) return null;
    const ts = typeof m.ts === "number" && Number.isFinite(m.ts) ? m.ts : now;
    // Never trust a sender's clock for ordering into the far future.
    return {
      type: "chat",
      message: {
        id,
        roomId,
        senderId,
        senderName,
        text,
        ts: Math.min(ts, now),
      },
    };
  }
  if (raw.type === "presence" && isRecord(raw.peer)) {
    const p = raw.peer;
    const id = sanitizeText(p.id, 64);
    const name = sanitizeName(p.name, MAX_NAME_LENGTH);
    const roomId = sanitizeText(p.roomId, 64);
    if (!id || !name || !roomId) return null;
    const pose = parsePose(p.pose);
    return {
      type: "presence",
      peer: { id, name, roomId, lastSeen: now, ...(pose ? { pose } : {}) },
    };
  }
  if (raw.type === "leave") {
    const peerId = sanitizeText(raw.peerId, 64);
    return peerId ? { type: "leave", peerId } : null;
  }
  return null;
}

/** Appends a message unless already present; keeps the newest HISTORY_LIMIT. */
export function appendMessage(
  list: readonly CommunityMessage[],
  message: CommunityMessage,
): CommunityMessage[] {
  if (list.some((m) => m.id === message.id)) return list as CommunityMessage[];
  const next = [...list, message].sort((a, b) => a.ts - b.ts);
  return next.length > HISTORY_LIMIT
    ? next.slice(next.length - HISTORY_LIMIT)
    : next;
}

export function upsertPeer(
  peers: Readonly<Record<string, CommunityPeer>>,
  peer: CommunityPeer,
): Record<string, CommunityPeer> {
  return { ...peers, [peer.id]: peer };
}

export function removePeer(
  peers: Readonly<Record<string, CommunityPeer>>,
  peerId: string,
): Record<string, CommunityPeer> {
  if (!(peerId in peers)) return peers as Record<string, CommunityPeer>;
  const { [peerId]: _gone, ...rest } = peers;
  return rest;
}

export function prunePeers(
  peers: Readonly<Record<string, CommunityPeer>>,
  now: number,
): Record<string, CommunityPeer> {
  const out: Record<string, CommunityPeer> = {};
  for (const [id, p] of Object.entries(peers)) {
    if (now - p.lastSeen <= PEER_TTL_MS) out[id] = p;
  }
  return Object.keys(out).length === Object.keys(peers).length
    ? (peers as Record<string, CommunityPeer>)
    : out;
}

/** Only ws:// / wss:// relay URLs are accepted; anything else is ignored. */
export function normalizeRelayUrl(
  input: string | null | undefined,
): string | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    return u.protocol === "ws:" || u.protocol === "wss:" ? u.toString() : null;
  } catch {
    return null;
  }
}
