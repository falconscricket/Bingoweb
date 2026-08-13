// Couple Bingo - Backend Server
// Run: npm install && npm start
// Opens on http://localhost:3000

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const TURN_SECONDS = 15;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- In-memory room store ----------
// rooms[code] = {
//   code, players: [{id,name}], status: 'waiting'|'arranging'|'playing'|'finished',
//   calledNumbers: [], turn: 'p1'|'p2'|null, turnStartedAt: number|null,
//   winner: 'p1'|'p2'|null, ready: [], boards: { p1: [...25 nums 1-25], p2: [...25 nums 1-25] },
//   createdAt: number
// }
const rooms = {};

function genCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms[code]);
  return code;
}

function otherId(id) {
  return id === 'p1' ? 'p2' : 'p1';
}

// Returns win line (array of [r,c]) or null, using a player's own board + called numbers
// Board is a plain 25-number grid (1-25, no free space) - number 5 is only
// styled specially on the frontend, it still has to be called like any other.
function checkWinForBoard(board, calledNumbers) {
  if (!board) return null;
  const marked = new Set(calledNumbers);
  const gAt = (idx) => board[idx];
  const M = (r, c) => {
    const idx = r * 5 + c;
    return marked.has(gAt(idx));
  };
  const lines = [];
  for (let r = 0; r < 5; r++) lines.push([[r,0],[r,1],[r,2],[r,3],[r,4]]);
  for (let c = 0; c < 5; c++) lines.push([[0,c],[1,c],[2,c],[3,c],[4,c]]);
  lines.push([[0,0],[1,1],[2,2],[3,3],[4,4]]);
  lines.push([[0,4],[1,3],[2,2],[3,1],[4,0]]);
  for (const line of lines) {
    if (line.every(([r, c]) => M(r, c))) return line;
  }
  return null;
}

// Strip data the requesting player shouldn't see (opponent's board layout)
function publicRoom(room, requestingPlayerId) {
  const { boards, ...rest } = room;
  return {
    ...rest,
    myBoard: boards[requestingPlayerId] || null,
  };
}

function cleanupOldRooms() {
  const cutoff = Date.now() - 1000 * 60 * 60 * 6; // 6 hours
  for (const code of Object.keys(rooms)) {
    if (rooms[code].createdAt < cutoff) delete rooms[code];
  }
}
setInterval(cleanupOldRooms, 1000 * 60 * 30);

// ---------- Routes ----------

// Create a new room, or join an existing one by code
// body: { name, code? }
app.post('/api/rooms', (req, res) => {
  const { name, code } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  const cleanName = name.trim().slice(0, 20);

  if (!code) {
    const newCode = genCode();
    const room = {
      code: newCode,
      players: [{ id: 'p1', name: cleanName }],
      status: 'waiting',
      calledNumbers: [],
      turn: null,
      turnStartedAt: null,
      winner: null,
      ready: [],
      boards: {},
      createdAt: Date.now(),
    };
    rooms[newCode] = room;
    return res.json({ code: newCode, playerId: 'p1', room: publicRoom(room, 'p1') });
  }

  const room = rooms[code];
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  if (room.players.length >= 2) {
    return res.status(409).json({ error: 'Room is full' });
  }
  room.players.push({ id: 'p2', name: cleanName });
  room.status = 'arranging';
  return res.json({ code, playerId: 'p2', room: publicRoom(room, 'p2') });
});

// Get current room state (poll this)
// query: ?playerId=p1
app.get('/api/rooms/:code', (req, res) => {
  const room = rooms[req.params.code];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const playerId = req.query.playerId;
  res.json({ room: publicRoom(room, playerId) });
});

// Save a player's board arrangement (private - opponent never receives this via GET)
// body: { playerId, board: [25 numbers, 1-25] }
app.post('/api/rooms/:code/board', (req, res) => {
  const room = rooms[req.params.code];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const { playerId, board } = req.body;
  if (!['p1', 'p2'].includes(playerId) || !Array.isArray(board) || board.length !== 25) {
    return res.status(400).json({ error: 'Invalid board' });
  }
  room.boards[playerId] = board;
  res.json({ ok: true });
});

// Mark a player ready; when both players are ready, game starts
// body: { playerId }
app.post('/api/rooms/:code/ready', (req, res) => {
  const room = rooms[req.params.code];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const { playerId } = req.body;
  if (!room.ready.includes(playerId)) room.ready.push(playerId);

  if (room.ready.length >= 2 && room.players.length >= 2) {
    room.status = 'playing';
    room.turn = 'p1';
    room.turnStartedAt = Date.now();
    room.calledNumbers = [];
    room.winner = null;
  }
  res.json({ room: publicRoom(room, playerId) });
});

// Call a number - server validates turn & checks win using BOTH real boards (cheat-proof)
// body: { playerId, number }
app.post('/api/rooms/:code/call', (req, res) => {
  const room = rooms[req.params.code];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const { playerId, number } = req.body;

  if (room.status !== 'playing') return res.status(400).json({ error: 'Game not in progress' });
  if (room.turn !== playerId) return res.status(403).json({ error: 'Not your turn' });
  if (room.calledNumbers.includes(number)) return res.status(400).json({ error: 'Already called' });

  room.calledNumbers.push(number);

  const p1Win = checkWinForBoard(room.boards.p1, room.calledNumbers);
  const p2Win = checkWinForBoard(room.boards.p2, room.calledNumbers);

  if (p1Win || p2Win) {
    room.status = 'finished';
    // whoever's line completed on this very call wins; if somehow both, caller wins
    room.winner = p1Win && p2Win ? playerId : (p1Win ? 'p1' : 'p2');
  } else {
    room.turn = otherId(playerId);
    room.turnStartedAt = Date.now();
  }

  res.json({ room: publicRoom(room, playerId) });
});

// Reset room for "Play Again"
// body: { playerId }
app.post('/api/rooms/:code/reset', (req, res) => {
  const room = rooms[req.params.code];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  room.status = 'arranging';
  room.calledNumbers = [];
  room.turn = null;
  room.turnStartedAt = null;
  room.winner = null;
  room.ready = [];
  room.boards = {};
  res.json({ room: publicRoom(room, req.body.playerId) });
});

app.listen(PORT, () => {
  console.log(`Couple Bingo backend running on http://localhost:${PORT}`);
});
