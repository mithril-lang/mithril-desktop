---
lat:
  require-code-mention: true
---

# Tool attempt observations

Desktop reads private attempt metadata on its already attached dashboard conversation, without creating a session, starting inference, executing tools or retrying an uncertain operation.

[[src/renderer/src/screens/Chat/toolAttemptReader.ts#ToolAttemptReader]] uses only the current client, runtime session and transport generation. [[src/renderer/src/screens/Chat/ToolAttemptsPanel.tsx#ToolAttemptsPanel]] is mounted in the existing Chat screen for dashboard transport. Legacy fallback does not acquire new read authority.

The fixed `tools.attempts` read sends explicit session ID and a limit of 50, with an optional previously returned cursor. Profile/connection/session changes, session-info, disconnect, cancellation and unmount invalidate observations. Three-second read deadlines and thirty-second observation expiry discard late results; neither causes a retry. Metadata does not recover result bodies/artifacts or prove delivery, confirmed stop or complete effects.

## Test specifications

Tests verify metadata boundaries and lifecycle admission without treating mocked dashboard replies as hosted or installed execution proof.

### Metadata boundaries

Validate exact protocol, bounded rows/bytes, cursor and state consistency, and duplicate IDs; retain only tool name, host attempt ID, state and terminal flag rather than arbitrary server-added bodies.

### Retired and bounded reads

Missing authority sends no RPC. Changed session/client/generation, explicit invalidation, deadline and expiry yield unknown without replay or restoring a late page.

### Mounted transport consumer

The actual transport hook and panel perform explicit metadata reads on the existing attached client, discard session-info and disconnect responses, and do not create a connection, conversation or prompt for a read.
