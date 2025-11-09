# 🧩 Real-Time Collaborative Drawing Canvas

A multi-user web drawing application that allows multiple users to draw simultaneously on a shared HTML5 canvas — synchronized in real time using WebSockets.

---

## 🚀 Features

- 🎨 **Drawing Tools** – Brush, eraser, color palette, adjustable stroke width  
- ⚡ **Real-Time Sync** – All users see updates instantly  
- 👥 **User Indicators** – Each user gets a unique color and cursor marker  
- 🔄 **Undo / Redo (Global)** – Consistent canvas history shared by all users  
- 🧭 **Conflict Resolution** – Smooth merging of concurrent drawings  
- 🧑‍🤝‍🧑 **User Presence** – Displays online users with assigned colors  
- 💾 **Optional Persistence** – Server can replay history to restore state  

---

## 🏗️ Tech Stack
**Frontend**
HTML5 Canvas + Vanilla JavaScript 
**Backend**
Node.js + Socket.io
**Protocol**
WebSocket (bidirectional event streaming) |

---

## 📂 Project Structure

collaborative-canvas/
├── client/
│ ├── index.html # Main UI
│ ├── style.css # Canvas and toolbar styling
│ ├── canvas.js # Canvas drawing logic
│ ├── websocket.js # Handles WebSocket connection & events
│ └── main.js # App initialization and user setup
├── server/
│ ├── server.js # Express + Socket.io backend
├── package.json
├── README.md
└── ARCHITECTURE.md

**Setup & Usage**

**1. Install Dependencies**
npm install

**2.Start the Server**
npm start

**Open Multiple Clients**
Open multiple browser tabs or devices and navigate to the same URL.
Each client will appear as a unique user on the shared canvas.

🧪 **Testing Multi-User Drawing**
  Open "https://collaborative-zuca.vercel.app" in two or more browsers/tabs.
  Draw using different colors — all drawings will sync in real-time.
  Try undo/redo — the history should update for all users simultaneously.
  Disconnect and reconnect — your canvas will re-sync to the global state.
  
🧠 **Known Limitations**
  Undo/Redo works at operation level, not pixel-by-pixel.
  Conflict resolution in overlapping strokes may cause slight jitter under high latency.
  No persistent storage between sessions (can be added via JSON replay).
  
⏱️ **Development Time**
  Total time spent: ~30 hours
  Focus areas:
  Real-time data synchronization
  Global operation history
  Efficient canvas redraw strategy

💡 Possible Future Enhancements
🖼️ Persistent canvas storage (MongoDB or Redis)
📱 Touch screen / mobile drawing support
📏 Shape tools (rectangles, lines, text)
⚙️ Optimized event batching for high concurrency
🌐 Multi-room support (collaborative spaces)
