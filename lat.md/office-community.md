# Office Community

The Office tab doubles as a shared place where users talk to each other: a Community panel of chat rooms, one per hall of the convention center, with live presence. It is separate from One Chat, which talks to the user's own agents.

The panel ([[src/renderer/src/screens/Office/community/CommunityPanel.tsx#CommunityPanel]]) opens from the Community button beside Mithril Chat in [[src/renderer/src/screens/Office/Office.tsx]]. Rooms are listed in `COMMUNITY_ROOMS` (South Hall, West Hall, Hyperloop Lounge). Room ids stay `main-hall` and `exhibition`, so existing relays keep the same channels.

## Connection model

[[src/renderer/src/screens/Office/community/useCommunity.ts#useCommunity]] connects only while the panel is open, announces presence on a heartbeat and sends `leave` on close, so closing the panel drops you from the online list.

Transports live in [[src/renderer/src/screens/Office/community/transport.ts]]. With a relay URL (`ws://`/`wss://`, set in the panel's settings and stored in localStorage) it speaks JSON frames over a reconnecting WebSocket; with none it falls back to a same-device BroadcastChannel, so the feature works and is testable without a server but only reaches windows on this machine.

The relay (`scripts/community-relay.mjs`) is a stateless fan-out: it forwards each frame to every other client, never echoes to the sender, and rate-limits per socket. There is no history — a message reaches whoever is connected when it is sent.

## Avatars in the world

Joined users who are in [[office-3d-walk-mode|walk mode]] appear to everyone else as walking avatars. The connection lives in Office.tsx (not the panel), so avatars show with the panel closed; it is opt-in — nothing connects until the user presses Join, and Leave disconnects.

[[src/renderer/src/screens/Office/office3d/objects/Player.tsx#PlayerLayer]] reports the user's pose (x, z, facing, moving, place) at most 5 Hz and only on change; leaving walk mode clears it. Poses ride on presence frames and are validated by `parsePose` (finite, within ±400 world units, known place). Pose updates go into a mutable store instead of React state, so a busy world does not re-render the tree; state changes only when someone arrives, leaves, renames or changes room.

[[src/renderer/src/screens/Office/office3d/objects/RemoteAvatars.tsx#RemoteAvatarsLayer]] draws each peer with a rig and shirt colour hashed from their id (so everyone sees the same look), glides toward the latest pose (snapping on teleports), blends idle/walk, and shows only avatars whose place matches the current view. Remote avatars are visual only: they do not collide with or block other people.

## Untrusted input

Every inbound frame is rebuilt field by field by [[src/renderer/src/screens/Office/community/protocol.ts#parseFrame]], and message bodies render only as plain text.

Control characters are stripped, lengths are clamped, future timestamps are clamped to now, and malformed frames are dropped. Only `ws:`/`wss:` relay URLs are accepted by `normalizeRelayUrl`.

Identity is a display name plus a random per-install peer id, both in localStorage. There is no authentication yet: anyone who can reach the relay can join and choose any name.
