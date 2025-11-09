window.socket = io("http://localhost:3000");
window.netState = { userId: null, color: null, username: null, roomId: null };
window.onlineUsers = new Map();

const roomSelector = document.getElementById("roomSelector");
const appContainer = document.getElementById("appContainer");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const leaveBtn = document.getElementById("leaveBtn");
const userBadge = document.getElementById("userBadge");
const userOverlay = document.getElementById("userOverlay");
const roomInfo = document.getElementById("roomInfo");

/* === Join Room === */
joinRoomBtn.addEventListener("click", () => {
  const dropdownRoom = document.getElementById("roomDropdown").value;
  const customRoom = document.getElementById("customRoom").value.trim();
  const roomId = customRoom || dropdownRoom;
  if (!roomId) return;

  socket.emit("joinRoom", roomId);

  roomSelector.classList.add("hidden");
  appContainer.classList.remove("hidden");
  appContainer.classList.add("fullscreen");
  document.body.classList.add("no-hover");
  document.body.style.overflow = "hidden";

  const resizeCanvases = () => {
    document.querySelectorAll("canvas").forEach((c) => {
      c.width = window.innerWidth * 0.9;
      c.height = window.innerHeight * 0.85;
    });
  };
  resizeCanvases();
  window.addEventListener("resize", resizeCanvases);
});

/* === Leave Room === */
leaveBtn.addEventListener("click", () => {
  socket.emit("leaveRoom", window.netState.roomId);
  appContainer.classList.remove("fullscreen");
  appContainer.classList.add("hidden");
  roomSelector.classList.remove("hidden");
  document.body.classList.remove("no-hover");
  document.body.style.overflow = "auto";
  userBadge.style.display = "none";
  userOverlay.innerHTML = "";
  roomInfo.style.display = "none";
});

/* === Update Overlay === */
function renderUserOverlay() {
  userOverlay.innerHTML = "";
  window.onlineUsers.forEach((user) => {
    const item = document.createElement("div");
    item.className = "user-overlay-item";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.backgroundColor = user.color;
    item.appendChild(dot);
    const nameSpan = document.createElement("span");
    nameSpan.textContent =
      user.userId === window.netState.userId
        ? `${user.username} (You)`
        : user.username;
    item.appendChild(nameSpan);
    userOverlay.appendChild(item);
  });

  // Room info + count
  const total = window.onlineUsers.size;
  const roomId = window.netState.roomId || "Unknown";
  roomInfo.style.display = "flex";
  roomInfo.innerHTML = `
    <div>🎨 <strong>Room:</strong> ${roomId}</div>
    <div>👥 <strong>Users:</strong> ${total}</div>
  `;
}

/* === Socket Events === */
socket.on("init", ({ self, users, history, roomId }) => {
  window.netState = { ...self, roomId };
  window.onlineUsers.clear();
  users.forEach((u) => window.onlineUsers.set(u.userId, u));
  renderUserOverlay();

  userBadge.style.display = "flex";
  userBadge.innerHTML = `
    <span class="dot" style="background:${self.color}"></span>
    <span>👤 <strong>${self.username}</strong></span>
  `;

  document.dispatchEvent(new CustomEvent("historyUpdate", { detail: history }));
});

socket.on("user-joined", (u) => {
  window.onlineUsers.set(u.userId, u);
  renderUserOverlay();
});

socket.on("user-left", ({ userId }) => {
  window.onlineUsers.delete(userId);
  renderUserOverlay();
  document.dispatchEvent(
    new CustomEvent("remote-user-left", { detail: { userId } })
  );
});

socket.on("historyUpdate", (history) => {
  document.dispatchEvent(new CustomEvent("historyUpdate", { detail: history }));
});
