import { MAX_NAME_LENGTH, DEFAULT_ROOM_ID } from "./types";
import { normalizeRelayUrl, sanitizeText } from "./protocol";

const NAME_KEY = "mithril:office:community:name";
const RELAY_KEY = "mithril:office:community:relay";
const ROOM_KEY = "mithril:office:community:room";
const JOINED_KEY = "mithril:office:community:joined";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // localStorage may be unavailable in sandboxed renderers
  }
}

export function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// One id per app session (window), deliberately NOT persisted: windows of the
// same install share localStorage and would otherwise all be "you" — each
// would drop the others' frames as its own echo.
let sessionPeerId: string | null = null;
export function getPeerId(): string {
  sessionPeerId ??= randomId();
  return sessionPeerId;
}

export function getStoredName(): string {
  return sanitizeText(read(NAME_KEY), MAX_NAME_LENGTH);
}
export function setStoredName(name: string): void {
  write(NAME_KEY, sanitizeText(name, MAX_NAME_LENGTH) || null);
}

export function getStoredRelay(): string | null {
  return normalizeRelayUrl(read(RELAY_KEY));
}
export function setStoredRelay(url: string | null): void {
  write(RELAY_KEY, normalizeRelayUrl(url));
}

export function getStoredRoom(): string {
  return read(ROOM_KEY) || DEFAULT_ROOM_ID;
}
export function setStoredRoom(id: string): void {
  write(ROOM_KEY, id);
}

export function getStoredJoined(): boolean {
  return read(JOINED_KEY) === "1";
}
export function setStoredJoined(joined: boolean): void {
  write(JOINED_KEY, joined ? "1" : null);
}
