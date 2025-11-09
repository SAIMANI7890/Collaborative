Overview
This document describes the architecture of the Collaborative Canvas project (frontend: static HTML/CSS/JS; backend: Node.js + Express + Socket.IO). It explains the data flow, the WebSocket protocol (messages and payloads), undo/redo semantics, performance optimizations, and conflict resolution strategies used to keep multi-user drawing correct and responsive.
<img width="1024" height="1024" alt="ARCHITECTURE" src="https://github.com/user-attachments/assets/3b2434b9-6343-4791-accd-ea60c1344b27" />

Data Flow Diagram (text)
[User Browser]
   └─(pointer events)─> [Client Canvas JS (canvas.js)]
                          ├─local render (instant)
                          ├─throttled emits (socket.emit)
                          └─RAF-batched preview rendering

Client (Socket.IO) <───WebSocket───> Backend (Socket.IO server)
                                           ├─receive events (draw, cursor, strokeComplete, undo, redo, clear)
                                           ├─maintain in-memory rooms { users, operationHistory, redoStack }
                                           └─broadcast events / historyUpdate to room

Backend persists (in-memory/optional DB) → room.operationHistory (append-only) → broadcast historyUpdate

Other Clients receive broadcasts → update liveStrokes / committed canvas
WebSocket Protocol — messages & payloads
All messages are exchanged over Socket.IO. The server is authoritative for history (operationHistory per room) and uses room-scoped broadcasts.

From Client → Server
joinRoom

"joinRoom": "<roomId>"
Client requests to join a room; server responds with init.

cursor (throttled)

{
  "x": number, "y": number,
  "userId": string,
  "color": string
}
Lightweight cursor position updates for remote cursors.

draw (throttled / streaming)

{
  "strokeId": string,
  "seq": number,
  "x": number,
  "y": number,
  "color": string,
  "size": number,
  "tool": "brush" | "eraser",
  "userId": string,
  "isDrawing": boolean,
  "clientTs": number
}
In-progress stroke points. These are used to produce live previews (client-side RAF loop sorts and draws points by seq).

strokeComplete (end-of-stroke, authoritative commit)

{
  "userId": string,
  "strokeId": string,
  "path": [ {x:number,y:number}, ... ],
  "color": string,
  "size": number,
  "tool": "brush" | "eraser",
  // server will annotate with serverTs and a strokeId if missing
}
Sent when a user finishes a stroke. The server appends the full stroke to operationHistory and emits historyUpdate.

undo / redo / clear-canvas

{ } // no payload
Requests global undo/redo/clear. Server modifies operationHistory and redoStack and emits historyUpdate.

From Server → Clients
init (to joining client)

{
  "self": { userId, username, color, roomId },
  "users": [ ... ],
  "history": [ strokeObj, ... ],
  "roomId": "<id>"
}
Initial state (users + authoritative history) for the joining client.

user-joined / user-left

{ "userId": string, "username"?: string, "color"?: string }
Notification of other users joining/leaving.

cursor

{ x, y, userId, color }
Broadcast cursor updates.

draw

{ strokeId, seq, x, y, color, size, tool, userId, isDrawing, clientTs }
Broadcasts in-progress draw points for live preview.

historyUpdate (authoritative)

[ strokeObj, ... ]
The full list (or append-only updated list) of committed strokes for the room. Clients use this to update the committed canvas and to remove live previews for strokes that are now committed.

Undo / Redo Strategy (Global authoritative)
Server-side authoritative history: The server stores operationHistory (append-only list of strokes) and a redoStack per room.

strokeComplete is the only message that appends to operationHistory. Clients only locally preview in-progress strokes.

Undo:

Client emits undo.

Server pops last stroke from operationHistory (if any), pushes it to redoStack, and emits historyUpdate to the room.

Clients receive historyUpdate and re-render committed canvas from the list (fast path: append optimization if history length grew).

Redo:

Client emits redo.

Server pops from redoStack, pushes back to operationHistory, and emits historyUpdate.

Clear:

Server clears both operationHistory and redoStack, then emits historyUpdate with [].

Why server-side: Ensures a single canonical order of strokes and a consistent undo/redo across all clients in the room. Clients don’t attempt local-only undos (that would diverge).

Performance Decisions & Rationale
1. Throttling & Batching
Throttled emits (e.g., 20ms) for draw and cursor to reduce network churn while keeping interactivity.

Why: Raw pointer events can generate hundreds of events/sec; throttling reduces message volume dramatically with minimal perceived latency.

2. RAF-batched rendering
Clients maintain liveStrokes map and use requestAnimationFrame to redraw in-progress strokes each animation frame.

Why: Consolidates many small updates into one paint per frame, reduces layout/paint overhead, and keeps UI smooth at 60fps.

3. Layered canvases
Three canvas layers: committedCanvas (finalized strokes), liveCanvas (in-progress preview), cursorCanvas (remote cursors & names).

Why: Clearing/redrawing only the layer that changes avoids full-canvas re-renders, improving performance and easing erase logic.

4. Append-only fast path for history updates
When historyUpdate length >= previous committedCount, client draws only the new appended strokes. If history shrunk or changed (undo/redo/clear), do a full redraw.

Why: Most operations are appends (normal drawing), so this avoids expensive full redraws.

5. Minimal payloads and encoding
Send points as compact JSON with numeric fields only. Consider optional binary/compact encodings later if bandwidth becomes an issue.

Conflict Resolution & Ordering
Deterministic stroke IDs and per-point sequencing
strokeId: Each stroke has a unique strokeId (<userId>-<timestamp>-random) generated client-side and validated/annotated by server.

per-point seq numbers: Each point in an in-progress stroke carries a seq integer (local incremental). Unordered arrival is handled by sorting on seq before rendering.

serverTs: Server attaches serverTs on commit to give authoritative ordering between concurrent strokes from different clients.

Handling simultaneous drawing
Clients can draw simultaneously; server does not try to merge strokes — it appends strokes to operationHistory in the order it receives strokeComplete. This is the canonical order for replay.

To handle out-of-order point arrival:

Live previews store points in a list and sort by seq before drawing. This handles network jitter/out-of-order UDP/TCP sequences.

For eraser:

Eraser is treated as a stroke with tool: "eraser" and color set to background (client-side uses #fff). Erase is just another stroke; on replay it removes pixels by drawing white strokes.

Why this approach
Simplicity and determinism: strokes are atomic units; ordering is per-stroke server authoritative.

Real-time perceived correctness: local client renders immediately (optimistic), and server history convergence ensures eventual consistency for all participants.

The chosen model avoids complex CRDT/OT logic (which would be required for per-pixel merge conflicts) and is sufficient for a drawing app where strokes are the natural atomic unit.

Message schemas (examples)
draw (in-progress):

{
  "strokeId": "socket123-168000-3b9f",
  "seq": 12,
  "x": 234.2,
  "y": 120.9,
  "color": "#000000",
  "size": 6,
  "tool": "brush",
  "userId": "socket123",
  "isDrawing": true,
  "clientTs": 1680000000000
}
strokeComplete (commit):

{
  "userId": "socket123",
  "strokeId": "socket123-168000-3b9f",
  "path": [
    {"x":10,"y":20}, {"x":11,"y":21}, ...
  ],
  "color": "#000000",
  "size": 6,
  "tool": "brush"
}
historyUpdate (server → clients):

[
  {
    "strokeId": "socket123-168000-3b9f",
    "userId": "socket123",
    "path": [ {x,y}, ... ],
    "color": "#000000",
    "size": 6,
    "tool": "brush",
    "serverTs": 1680000012345
  },
  ...
]
Scalability & Reliability Considerations (future improvements)
Persistence: Move operationHistory from in-memory to a DB (e.g., Redis for fast lists or Postgres for durable storage) so room history survives restarts.

Autoscaling: Socket.IO clustering with Redis adapter (or other pub/sub) for horizontal scaling across multiple backend instances.

Auth & Rooms: Add authentication tokens / user accounts and room ACLs for private rooms.

Binary protocols: If bandwidth becomes a limit, switch to binary framing or protobuf to reduce message size.

Snapshotting: Store periodic raster snapshots to speed new-join rendering (avoid replaying thousands of strokes).

Rate limiting & quotas: Prevent abusive clients from generating excessive events.

Why these design choices? (short justification)
Server-authoritative history ensures all clients converge to the same canvas state and enables consistent undo/redo across participants.

Optimistic local rendering + server commit keeps UX instant while still guaranteeing consistency.

Throttling + RAF + layered canvases deliver smooth UI with manageable network usage.

Stroke-level atomicity is simpler and performant for collaborative drawing compared to complex per-pixel merge algorithms.

Operational Checklist for Deployers
Backend (Render):

server.js must use process.env.PORT.

Proper CORS config for Socket.IO (allow the frontend origin).

Optionally serve a health route: GET /health → 200 OK.

Frontend (Vercel / Netlify / static):

Load Socket.IO client from backend if backend and frontend are on different origins:

<script src="https://<backend-host>/socket.io/socket.io.js"></script>
and connect with io("https://<backend-host>").

Testing:

Open multiple browsers / incognito windows and verify real-time behavior, undo/redo sync, and history replay on join.

Monitoring:

Enable server logs and health checks; add metrics (connections/sec, messages/sec) if scaling.

Appendix — Quick sequence for a user stroke (end-to-end)
User starts pointerdown → client creates strokeId, localSeq = 0, local preview (immediate).

Client emits initial draw point (throttled) to server.

While drawing, client continues to push local points and emit draw events (throttled).

Client releases pointer → emits strokeComplete (full path) to server.

Server appends fullStroke with serverTs to operationHistory, clears redoStack, and emits historyUpdate to room.

All clients receive historyUpdate, redraw committed strokes (append-only fast path), and remove corresponding live previews.
