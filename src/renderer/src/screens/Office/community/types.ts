/**
 * Community: the convention center's shared chat space. Every Mithril user who
 * connects to the same relay lands in the same rooms, sees who is online and
 * talks in real time.
 */

export interface CommunityRoom {
  id: string;
  /** i18n key suffix under `office.communityRoom_*`; falls back to `label`. */
  label: string;
}

export const COMMUNITY_ROOMS: readonly CommunityRoom[] = [
  { id: "main-hall", label: "Main Hall" },
  { id: "exhibition", label: "Exhibition Floor" },
  { id: "hyperloop", label: "Hyperloop Lounge" },
];

export const DEFAULT_ROOM_ID = COMMUNITY_ROOMS[0].id;

export const MAX_MESSAGE_LENGTH = 500;
export const MAX_NAME_LENGTH = 32;
export const HISTORY_LIMIT = 200;
/** Presence heartbeat; a peer silent for `PEER_TTL_MS` is treated as gone. */
export const HEARTBEAT_MS = 10_000;
export const PEER_TTL_MS = 30_000;

export interface CommunityMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  text: string;
  ts: number;
}

export type PosePlace = "outside" | "office" | "bank" | "showroom";
export const POSE_PLACES: readonly PosePlace[] = [
  "outside",
  "office",
  "bank",
  "showroom",
];
/** World-space limit for a believable position; anything beyond is dropped. */
export const POSE_LIMIT = 400;

/** A walking user's avatar state in world coordinates. */
export interface PeerPose {
  x: number;
  z: number;
  /** Facing (radians, yaw). */
  ry: number;
  /** Moving (walk animation) vs standing. */
  mv: boolean;
  place: PosePlace;
}

export interface CommunityPeer {
  id: string;
  name: string;
  roomId: string;
  lastSeen: number;
  /** Present only while the user is walking the world (walk mode). */
  pose?: PeerPose;
}

/** Wire protocol. The relay only fans frames out; it holds no state. */
export type CommunityFrame =
  | { type: "chat"; message: CommunityMessage }
  | { type: "presence"; peer: CommunityPeer }
  | { type: "leave"; peerId: string };

export type ConnectionState = "connecting" | "online" | "offline";

export interface CommunityTransport {
  send(frame: CommunityFrame): void;
  onFrame(handler: (frame: CommunityFrame) => void): () => void;
  onState(handler: (state: ConnectionState) => void): () => void;
  close(): void;
}
