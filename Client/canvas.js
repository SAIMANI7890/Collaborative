// Phase 6 rendering: layered canvases + RAF-batched previews + conflict-safe ordering
// === DOM/contexts ===
const committedCanvas = document.getElementById("committedCanvas");
const liveCanvas = document.getElementById("liveCanvas");
const cursorCanvas = document.getElementById("cursorCanvas");

// If canvases are not present, bail early (pre-room UI etc.)
if (!committedCanvas || !liveCanvas || !cursorCanvas) {
  console.warn(
    "[canvas] canvases not found yet (are you on the room selector?)"
  );
}

const committedCtx = committedCanvas?.getContext("2d");
const liveCtx = liveCanvas?.getContext("2d");
const cursorCtx = cursorCanvas?.getContext("2d");

// Controls (may be absent before join)
const colorPicker = document.getElementById("colorPicker");
const brushRange = document.getElementById("brushSize");
const eraserBtn = document.getElementById("eraserBtn");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const clearBtn = document.getElementById("clearBtn");

// Socket/global state (tolerate undefined during load)
const socket = window.socket;
const getNet = () => window.netState || { userId: "local", color: "#000" };

// === Local drawing state ===
let isDrawing = false;
let currentColor = colorPicker ? colorPicker.value : "#000000";
let brushSize = brushRange ? +brushRange.value : 5;
let isEraser = false;
let currentPath = [];
let currentStrokeId = null;
let localSeq = 0;

// Remote/live state
// strokeId -> {
//   color, size, tool, userId,
//   points: [{seq,x,y}],          // full in-progress path, kept sorted by seq
// }
const liveStrokes = new Map();

// userId -> { x, y, color, username }
const remoteCursors = new Map();

// Committed history cache (for append-only fast path)
let committedCount = 0;

// Drawing defaults
[committedCtx, liveCtx].forEach((c) => {
  if (!c) return;
  c.lineCap = "round";
  c.lineJoin = "round";
});

// ===== Helpers =====
function drawSegment(ctx, from, to, color, size) {
  if (!ctx) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

// Robust coordinates for mouse/touch/pen
function getPos(canvas, e) {
  const rect = canvas.getBoundingClientRect();

  // Adjust for scaling differences between CSS and actual resolution
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function throttle(fn, limitMs) {
  let last = 0,
    timeout = null,
    pendingArgs = null;
  return (...args) => {
    const now = performance.now();
    if (now - last >= limitMs) {
      last = now;
      fn(...args);
    } else {
      pendingArgs = args;
      if (!timeout) {
        timeout = setTimeout(() => {
          last = performance.now();
          fn(...pendingArgs);
          timeout = null;
          pendingArgs = null;
        }, Math.max(0, limitMs - (now - last)));
      }
    }
  };
}

function newStrokeId() {
  return `${getNet().userId}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

// Safe emit wrappers (don’t crash if socket not ready)
const safeEmit = (event, payload) => {
  if (socket && socket.connected) socket.emit(event, payload);
};

// ===== Local input (pointer events) =====
if (committedCanvas) {
  committedCanvas.addEventListener(
    "pointerdown",
    (e) => {
      e.preventDefault();
      committedCanvas.setPointerCapture?.(e.pointerId);

      isDrawing = true;
      const p0 = getPos(committedCanvas, e);
      currentPath = [p0];
      currentStrokeId = newStrokeId();
      localSeq = 0;

      // Start/ensure live stroke cache so RAF draws full path every frame
      liveStrokes.set(currentStrokeId, {
        color: isEraser ? "#fff" : getNet().color || currentColor,
        size: brushSize,
        tool: isEraser ? "eraser" : "brush",
        userId: getNet().userId,
        points: [{ seq: localSeq, x: p0.x, y: p0.y }],
      });

      // Send initial point (ok to throttle; local path renders immediately)
      emitDrawThrottled({
        strokeId: currentStrokeId,
        seq: localSeq++,
        x: p0.x,
        y: p0.y,
        color: getNet().color || currentColor,
        size: brushSize,
        tool: isEraser ? "eraser" : "brush",
        userId: getNet().userId,
        isDrawing: true,
        clientTs: performance.now(),
      });
    },
    { passive: false }
  );

  committedCanvas.addEventListener(
    "pointermove",
    (e) => {
      // Cursor broadcast (throttled)
      const pos = getPos(committedCanvas, e);
      emitCursorThrottled({
        x: pos.x,
        y: pos.y,
        userId: getNet().userId,
        color: getNet().color,
      });

      if (!isDrawing) return;

      // Update local live path immediately for instant feedback
      const s = liveStrokes.get(currentStrokeId);
      if (s) {
        s.points.push({ seq: localSeq, x: pos.x, y: pos.y });
      }

      // Network (throttled) — do not wait for echo to render locally
      emitDrawThrottled({
        strokeId: currentStrokeId,
        seq: localSeq++,
        x: pos.x,
        y: pos.y,
        color: getNet().color || currentColor,
        size: brushSize,
        tool: isEraser ? "eraser" : "brush",
        userId: getNet().userId,
        isDrawing: true,
        clientTs: performance.now(),
      });

      currentPath.push(pos);
    },
    { passive: false }
  );

  // End draw on canvas or anywhere (avoid “stuck drawing”)
  const endDraw = () => {
    if (!isDrawing) return;
    isDrawing = false;

    const last = currentPath.at(-1) || { x: 0, y: 0 };

    safeEmit("draw", {
      strokeId: currentStrokeId,
      seq: localSeq++,
      x: last.x,
      y: last.y,
      color: getNet().color || currentColor,
      size: brushSize,
      tool: isEraser ? "eraser" : "brush",
      userId: getNet().userId,
      isDrawing: false,
      clientTs: performance.now(),
    });

    // Commit authoritative stroke to server
    if (currentPath.length > 1) {
      safeEmit("strokeComplete", {
        userId: getNet().userId,
        path: currentPath,
        color: currentColor,
        size: brushSize,
        tool: isEraser ? "eraser" : "brush",
        strokeId: currentStrokeId,
      });
    }

    currentPath = [];
    currentStrokeId = null;
  };

  committedCanvas.addEventListener(
    "pointerup",
    (e) => {
      e.preventDefault();
      endDraw();
    },
    { passive: false }
  );
  committedCanvas.addEventListener(
    "pointerleave",
    (e) => {
      e.preventDefault();
      endDraw();
    },
    { passive: false }
  );
  window.addEventListener("pointerup", endDraw, { passive: true });
}

// ===== Controls =====
if (colorPicker)
  colorPicker.addEventListener("input", (e) => {
    currentColor = e.target.value;
    isEraser = false;
  });
if (brushRange)
  brushRange.addEventListener("input", (e) => {
    brushSize = +e.target.value;
  });
if (eraserBtn)
  eraserBtn.addEventListener("click", () => {
    isEraser = !isEraser; // toggle on/off
    if (isEraser) {
      eraserBtn.classList.add("active");
    } else {
      eraserBtn.classList.remove("active");
    }
  });

if (undoBtn) undoBtn.addEventListener("click", () => safeEmit("undo"));
if (redoBtn) redoBtn.addEventListener("click", () => safeEmit("redo"));
if (clearBtn)
  clearBtn.addEventListener("click", () => safeEmit("clear-canvas"));

// ===== Networking (emit; throttled) =====
const emitCursorThrottled = throttle((p) => safeEmit("cursor", p), 20);
const emitDrawThrottled = throttle((p) => safeEmit("draw", p), 20);

// ===== Networking (listen) =====
if (socket) {
  // RAF-batched in-progress stroke previews
  socket.on("draw", (p) => {
    const { strokeId, seq, x, y, color, size, tool, userId } = p || {};
    if (!strokeId || seq == null || !userId) return;

    let s = liveStrokes.get(strokeId);
    if (!s) {
      s = {
        color: tool === "eraser" ? "#fff" : color,
        size,
        tool,
        userId,
        points: [],
      };
      liveStrokes.set(strokeId, s);
    }

    // Push point; we'll sort in render loop to handle out-of-order packets
    s.points.push({ seq, x, y });
  });

  // Cursor updates
  socket.on("cursor", ({ x, y, userId, color }) => {
    const u = (window.onlineUsers || new Map()).get(userId);
    remoteCursors.set(userId, { x, y, color, username: u?.username });
  });
}

// External signals
document.addEventListener("remote-user-left", (e) => {
  const { userId } = e.detail || {};
  remoteCursors.delete(userId);
  for (const [sid, s] of [...liveStrokes.entries()]) {
    if (s.userId === userId) liveStrokes.delete(sid);
  }
});

// History authoritative updates (sorted by serverTs upstream)
document.addEventListener("historyUpdate", (e) => {
  const history = (e.detail || []).slice();

  // Append-only fast path vs full redraw (undo/redo/clear)
  const isAppendOnly = history.length >= committedCount;
  if (!committedCtx) return;

  if (isAppendOnly) {
    for (let i = committedCount; i < history.length; i++) {
      drawCommittedStroke(history[i]);
    }
    committedCount = history.length;
  } else {
    committedCtx.clearRect(0, 0, committedCanvas.width, committedCanvas.height);
    for (const stroke of history) drawCommittedStroke(stroke);
    committedCount = history.length;
  }

  // Remove live previews that just got committed
  const committedIds = new Set(history.map((s) => s.strokeId));
  for (const sid of [...liveStrokes.keys()]) {
    if (committedIds.has(sid)) liveStrokes.delete(sid);
  }
});

function drawCommittedStroke(stroke) {
  const col = stroke.tool === "eraser" ? "#fff" : stroke.color;
  for (let i = 1; i < stroke.path.length; i++) {
    drawSegment(
      committedCtx,
      stroke.path[i - 1],
      stroke.path[i],
      col,
      stroke.size
    );
  }
}

// ===== RAF loops =====
function renderLive() {
  if (!liveCtx) return requestAnimationFrame(renderLive);

  // We DO clear each frame...
  liveCtx.clearRect(0, 0, liveCanvas.width, liveCanvas.height);

  // ...but we redraw full in-progress paths, not only new segments.
  for (const [, s] of liveStrokes) {
    if (!s.points.length) continue;

    // Sort by seq to handle any network out-of-order
    // (in practice most locals are in-order and this is cheap)
    s.points.sort((a, b) => a.seq - b.seq);

    const color = s.tool === "eraser" ? "#fff" : s.color;
    for (let i = 1; i < s.points.length; i++) {
      const from = { x: s.points[i - 1].x, y: s.points[i - 1].y };
      const to = { x: s.points[i].x, y: s.points[i].y };
      drawSegment(liveCtx, from, to, color, s.size);
    }
  }

  requestAnimationFrame(renderLive);
}
renderLive();

function renderCursors() {
  if (!cursorCtx) return requestAnimationFrame(renderCursors);
  cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
  remoteCursors.forEach(({ x, y, color, username }) => {
    cursorCtx.beginPath();
    cursorCtx.globalAlpha = 0.7;
    cursorCtx.fillStyle = color || "rgba(0,0,0,0.6)";
    cursorCtx.arc(x, y, 6, 0, Math.PI * 2);
    cursorCtx.fill();

    cursorCtx.globalAlpha = 1;
    cursorCtx.font = "12px Arial";
    cursorCtx.fillStyle = color || "#000";
    if (username) cursorCtx.fillText(username, x + 10, y + 3);
  });
  requestAnimationFrame(renderCursors);
}
renderCursors();

// ---- Optional debug: uncomment to verify pointer events ----
// committedCanvas?.addEventListener("pointerdown", () => console.log("🖱️ down"));
// committedCanvas?.addEventListener("pointermove", () => console.log("🖱️ move"));
// committedCanvas?.addEventListener("pointerup",   () => console.log("🖱️ up"));
