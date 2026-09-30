#!/usr/bin/env node
// Minimal relay for the Office "Community" space: fans every JSON frame a
// client sends out to every other connected client. It keeps no state and
// never echoes to the sender.
//
//   node scripts/community-relay.mjs            # ws://0.0.0.0:8787
//   PORT=9000 node scripts/community-relay.mjs
//
// Put it behind TLS (wss://) for anything beyond localhost.
import { WebSocketServer } from "ws";

const port = Number(process.env.PORT ?? 8787);
const MAX_BYTES = 8192;
const MAX_FRAMES_PER_SEC = 20;

const wss = new WebSocketServer({ port, maxPayload: MAX_BYTES });

wss.on("connection", (socket) => {
  let windowStart = Date.now();
  let count = 0;
  socket.on("message", (data, isBinary) => {
    if (isBinary) return;
    const now = Date.now();
    if (now - windowStart > 1000) {
      windowStart = now;
      count = 0;
    }
    if (++count > MAX_FRAMES_PER_SEC) return;
    for (const peer of wss.clients) {
      if (peer !== socket && peer.readyState === 1) peer.send(data.toString());
    }
  });
});

console.log(`community relay listening on ws://0.0.0.0:${port}`);
