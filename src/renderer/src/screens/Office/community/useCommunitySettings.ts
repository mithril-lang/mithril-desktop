import { useCallback, useState } from "react";
import { MAX_NAME_LENGTH } from "./types";
import {
  getStoredJoined,
  getStoredName,
  getStoredRelay,
  getStoredRoom,
  setStoredJoined,
  setStoredName,
  setStoredRelay,
  setStoredRoom,
} from "./identity";

export interface CommunitySettings {
  name: string;
  relayUrl: string | null;
  roomId: string;
  /** Opt-in: only a joined user connects, chats and shows an avatar. */
  joined: boolean;
  setIdentity: (name: string, relayUrl: string | null) => void;
  setRoomId: (id: string) => void;
  setJoined: (joined: boolean) => void;
}

/** Persisted Community preferences, shared by the panel and the 3D world. */
export function useCommunitySettings(defaultName?: string): CommunitySettings {
  const [name, setName] = useState(
    () => getStoredName() || defaultName?.slice(0, MAX_NAME_LENGTH) || "",
  );
  const [relayUrl, setRelay] = useState<string | null>(getStoredRelay);
  const [roomId, setRoom] = useState(getStoredRoom);
  const [joined, setJoinedState] = useState(getStoredJoined);

  const setIdentity = useCallback((n: string, r: string | null) => {
    setStoredName(n);
    setStoredRelay(r);
    setName(n);
    setRelay(r);
  }, []);
  const setRoomId = useCallback((id: string) => {
    setStoredRoom(id);
    setRoom(id);
  }, []);
  const setJoined = useCallback((j: boolean) => {
    setStoredJoined(j);
    setJoinedState(j);
  }, []);

  return { name, relayUrl, roomId, joined, setIdentity, setRoomId, setJoined };
}
