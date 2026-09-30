import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  appendMessage,
  removePeer,
  sanitizeText,
  upsertPeer,
} from "./protocol";
import { createCommunityTransport } from "./transport";
import { getPeerId, randomId } from "./identity";
import {
  HEARTBEAT_MS,
  MAX_MESSAGE_LENGTH,
  PEER_TTL_MS,
  type CommunityMessage,
  type CommunityPeer,
  type CommunityTransport,
  type ConnectionState,
  type PeerPose,
} from "./types";

export interface UseCommunityOptions {
  enabled: boolean;
  relayUrl: string | null;
  name: string;
  roomId: string;
}

/** Live state of everyone else in the world, read by the 3D avatars per frame. */
export type PeerLiveStore = Map<string, { pose?: PeerPose; lastSeen: number }>;

export interface CommunityApi {
  state: ConnectionState;
  selfId: string;
  messages: CommunityMessage[];
  /** Peers currently in the active room (including yourself). */
  peers: CommunityPeer[];
  /** Everyone else connected, in any room (roster for the 3D world). */
  others: CommunityPeer[];
  /** Mutable per-peer poses: updated at ~5 Hz without re-rendering React. */
  live: React.RefObject<PeerLiveStore>;
  send: (text: string) => boolean;
  /** Publish (or clear, with null) this user's avatar pose. */
  publishPose: (pose: PeerPose | null) => void;
}

/**
 * Connects while `enabled` (the user has joined): announces presence on a
 * heartbeat, collects chat/presence frames and drops peers that go quiet.
 * High-rate pose updates go into a mutable store; React state only changes
 * when someone arrives, leaves, renames or changes room.
 */
export function useCommunity({
  enabled,
  relayUrl,
  name,
  roomId,
}: UseCommunityOptions): CommunityApi {
  const selfId = useMemo(() => getPeerId(), []);
  const [state, setState] = useState<ConnectionState>("offline");
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [peers, setPeers] = useState<Record<string, CommunityPeer>>({});
  const transportRef = useRef<CommunityTransport | null>(null);
  const identityRef = useRef({ name, roomId });
  identityRef.current = { name, roomId };
  const selfPoseRef = useRef<PeerPose | null>(null);
  const live = useRef<PeerLiveStore>(new Map());

  const announce = useCallback((): void => {
    const { name: n, roomId: r } = identityRef.current;
    const pose = selfPoseRef.current ?? undefined;
    const peer: CommunityPeer = {
      id: selfId,
      name: n,
      roomId: r,
      lastSeen: Date.now(),
      ...(pose ? { pose } : {}),
    };
    transportRef.current?.send({ type: "presence", peer });
    setPeers((p) => {
      const prev = p[selfId];
      return prev && prev.name === n && prev.roomId === r
        ? p
        : upsertPeer(p, { ...peer, pose: undefined });
    });
  }, [selfId]);

  useEffect(() => {
    if (!enabled) return;
    const store = live.current;
    const transport = createCommunityTransport(relayUrl);
    transportRef.current = transport;
    const known = new Set<string>();
    const offState = transport.onState((s) => {
      setState(s);
      if (s === "online") announce();
    });
    const offFrame = transport.onFrame((frame) => {
      if (frame.type === "chat") {
        if (frame.message.senderId === selfId) return;
        setMessages((m) => appendMessage(m, frame.message));
      } else if (frame.type === "presence") {
        const peer = frame.peer;
        if (peer.id === selfId) return;
        store.set(peer.id, { pose: peer.pose, lastSeen: peer.lastSeen });
        const isNew = !known.has(peer.id);
        known.add(peer.id);
        setPeers((p) => {
          const prev = p[peer.id];
          if (prev && prev.name === peer.name && prev.roomId === peer.roomId) {
            return p; // pose-only update: the store already has it
          }
          return upsertPeer(p, { ...peer, pose: undefined });
        });
        // Answer a newcomer's hello so they see us without waiting a beat.
        if (isNew) announce();
      } else {
        known.delete(frame.peerId);
        store.delete(frame.peerId);
        setPeers((p) => removePeer(p, frame.peerId));
      }
    });
    const beat = setInterval(() => {
      announce();
      const now = Date.now();
      for (const [id, v] of store) {
        if (now - v.lastSeen > PEER_TTL_MS) {
          store.delete(id);
          known.delete(id);
          setPeers((p) => removePeer(p, id));
        }
      }
    }, HEARTBEAT_MS);
    return () => {
      clearInterval(beat);
      offFrame();
      offState();
      transport.send({ type: "leave", peerId: selfId });
      transport.close();
      transportRef.current = null;
      store.clear();
      setState("offline");
      setPeers({});
    };
  }, [enabled, relayUrl, selfId, announce]);

  // Name / room changes are re-announced immediately.
  useEffect(() => {
    if (enabled && transportRef.current) announce();
  }, [enabled, name, roomId, announce]);

  const publishPose = useCallback(
    (pose: PeerPose | null): void => {
      selfPoseRef.current = pose;
      const { name: n, roomId: r } = identityRef.current;
      if (!transportRef.current || !n) return;
      transportRef.current.send({
        type: "presence",
        peer: {
          id: selfId,
          name: n,
          roomId: r,
          lastSeen: Date.now(),
          ...(pose ? { pose } : {}),
        },
      });
    },
    [selfId],
  );

  const send = useCallback(
    (raw: string): boolean => {
      const text = sanitizeText(raw, MAX_MESSAGE_LENGTH);
      const { name: senderName, roomId: room } = identityRef.current;
      if (!text || !senderName || !transportRef.current) return false;
      const message: CommunityMessage = {
        id: randomId(),
        roomId: room,
        senderId: selfId,
        senderName,
        text,
        ts: Date.now(),
      };
      transportRef.current.send({ type: "chat", message });
      setMessages((m) => appendMessage(m, message));
      return true;
    },
    [selfId],
  );

  const roomMessages = useMemo(
    () => messages.filter((m) => m.roomId === roomId),
    [messages, roomId],
  );
  const roomPeers = useMemo(
    () =>
      Object.values(peers)
        .filter((p) => p.roomId === roomId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [peers, roomId],
  );
  const others = useMemo(
    () => Object.values(peers).filter((p) => p.id !== selfId),
    [peers, selfId],
  );

  return {
    state,
    selfId,
    messages: roomMessages,
    peers: roomPeers,
    others,
    live,
    send,
    publishPose,
  };
}
