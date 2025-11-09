const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "../client")));

const rooms = {}; // { roomId: { users: {}, operationHistory: [], redoStack: [] } }

function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = { users: {}, operationHistory: [], redoStack: [] };
  }
  return rooms[roomId];
}

function randomColor() {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 80%, 60%)`;
}

function generateUsername() {
  return `User ${Math.floor(100 + Math.random() * 900)}`;
}

// =====================
// SOCKET CONNECTION
// =====================
io.on("connection", (socket) => {
  console.log(`🟢 New connection: ${socket.id}`);

  // Handle joining a specific room
  socket.on("joinRoom", (roomId) => {
    const room = getOrCreateRoom(roomId);
    socket.join(roomId);

    const user = {
      userId: socket.id,
      username: generateUsername(),
      color: randomColor(),
      roomId,
    };

    room.users[socket.id] = user;

    console.log(`👋 ${user.username} joined ${roomId}`);

    // Send back initial state
    socket.emit("init", {
      self: user,
      users: Object.values(room.users),
      history: room.operationHistory,
      roomId,
    });

    // Notify others in room
    socket.to(roomId).emit("user-joined", user);

    // ========== Drawing Events ==========
    socket.on("cursor", (payload) => {
      socket.to(roomId).emit("cursor", payload);
    });

    socket.on("draw", (payload) => {
      socket.to(roomId).emit("draw", payload);
    });

    socket.on("strokeComplete", (stroke) => {
      const serverTs = Date.now();
      const fullStroke = {
        ...stroke,
        serverTs,
        strokeId:
          stroke.strokeId ||
          `${stroke.userId}-${serverTs}-${Math.random()
            .toString(36)
            .slice(2, 6)}`,
      };
      room.operationHistory.push(fullStroke);
      room.redoStack = [];
      io.to(roomId).emit("historyUpdate", room.operationHistory);
    });

    socket.on("undo", () => {
      if (room.operationHistory.length > 0) {
        const last = room.operationHistory.pop();
        room.redoStack.push(last);
        io.to(roomId).emit("historyUpdate", room.operationHistory);
      }
    });

    socket.on("redo", () => {
      if (room.redoStack.length > 0) {
        const redoStroke = room.redoStack.pop();
        room.operationHistory.push(redoStroke);
        io.to(roomId).emit("historyUpdate", room.operationHistory);
      }
    });

    socket.on("clear-canvas", () => {
      room.operationHistory = [];
      room.redoStack = [];
      io.to(roomId).emit("historyUpdate", []);
    });

    // ========== Disconnect ==========
    socket.on("disconnect", () => {
      console.log(`❌ ${user.username} left ${roomId}`);
      delete room.users[socket.id];
      socket.to(roomId).emit("user-left", { userId: socket.id });

      // Cleanup empty room
      if (Object.keys(room.users).length === 0) {
        console.log(`🧹 Cleaning up empty room: ${roomId}`);
        delete rooms[roomId];
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
