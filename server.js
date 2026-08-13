// Couple Bingo - Backend Server with Telegram Bot & Mini App
// Run: npm install && npm start
// Opens on http://localhost:3000

const express = require('express');
const path = require('path');
const { Telegraf } = require('telegraf');

const app = express();
const PORT = process.env.PORT || 3000;
const TURN_SECONDS = 15;
const BOT_TOKEN = process.env.BOT_TOKEN;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Telegram Bot Setup ----------
if (BOT_TOKEN) {
  const bot = new Telegraf(BOT_TOKEN);

  // /start command with Web App Button
  bot.start((ctx) => {
    ctx.reply('Welcome to Couple Bingo! Click below to play the game inside Telegram:', {
      reply_markup: {
        inline_keyboard: [
          [
            { 
              text: '🎮 Play Couple Bingo', 
              web_app: { url: 'https://bingoweb-production-eb74.up.railway.app' } 
            }
          ]
        ]
      }
    });
  });

  // Example text handler
  bot.on('text', (ctx) => {
    ctx.reply(`Ungaluku anuppiya msg: ${ctx.message.text}`);
  });

  // Telegram Webhook Route
  app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
    bot.handleUpdate(req.body, res);
    res.sendStatus(200);
  });
}

// ---------- In-memory room store ----------
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

const LINES = (() => {
  const lines = [];
  for (let r = 0; r < 5; r++) lines.push([[r,0],[r,1],[r,2],[r,3],[r,4]]);
  for (let c = 0; c < 5; c++) lines.push([[0,c],[1,c],[2,c],[3,c],[4,c]]);
  lines.push([[0,0],[1,1],[2,2],[3,3],[4,4]]);
  lines.push([[0,4],[1,3],[2,2],[3,1],[4,0]]);
  return lines;
})();

function getCompletedLines(board, calledNumbers) {
  if (!board) return [];
  const marked = new Set(calledNumbers);
  const gAt = (idx) => board[idx];
  const M = (r, c) => marked.has(gAt(r * 5 + c));
  return LINES.filter(line => line.every(([r, c]) => M(r, c)));
}

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
      winLines: null,
      progress: { p1: 0, p2: 0 },
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

app.get('/api/rooms/:code', (req, res) => {
  const room = rooms[req.params.code];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const playerId = req.query.playerId;
  res.json({ room: publicRoom(room, playerId) });
});

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
    room.winLines = null;
    room.progress = { p1: 0, p2: 0 };
  }
  res.json({ room: publicRoom(room, playerId) });
});

app.post('/api/rooms/:code/call', (req, res) => {
  const room = rooms[req.params.code];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const { playerId, number } = req.body;

  if (room.status !== 'playing') return res.status(400).json({ error: 'Game not in progress' });
  if (room.turn !== playerId) return res.status(403).json({ error: 'Not your turn' });
  if (room.calledNumbers.includes(number)) return res.status(400).json({ error: 'Already called' });

  room.calledNumbers.push(number);

  const p1Lines = getCompletedLines(room.boards.p1, room.calledNumbers);
  const p2Lines = getCompletedLines(room.boards.p2, room.calledNumbers);
  room.progress = { p1: p1Lines.length, p2: p2Lines.length };

  const TARGET_MATCHES = 5; 
  const p1Done = p1Lines.length >= TARGET_MATCHES;
  const p2Done = p2Lines.length >= TARGET_MATCHES;

  if (p1Done || p2Done) {
    room.status = 'finished';
    room.winner = p1Done && p2Done ? playerId : (p1Done ? 'p1' : 'p2');
    room.winLines = room.winner === 'p1' ? p1Lines : p2Lines;
  } else {
    room.turn = otherId(playerId);
    room.turnStartedAt = Date.now();
  }

  res.json({ room: publicRoom(room, playerId) });
});

app.post('/api/rooms/:code/reset', (req, res) => {
  const room = rooms[req.params.code];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  room.status = 'arranging';
  room.calledNumbers = [];
  room.turn = null;
  room.turnStartedAt = null;
  room.winner = null;
  room.winLines = null;
  room.progress = { p1: 0, p2: 0 };
  room.ready = [];
  room.boards = {};
  res.json({ room: publicRoom(room, req.body.playerId) });
});

app.listen(PORT, async () => {
  console.log(`Couple Bingo backend & Telegram bot running on http://localhost:${PORT}`);

  // Auto set Telegram Webhook for Railway
  if (BOT_TOKEN) {
    try {
      const { Telegraf } = require('telegraf');
      const tempBot = new Telegraf(BOT_TOKEN);
      const WEBHOOK_URL = `https://bingoweb-production-eb74.up.railway.app/webhook/${BOT_TOKEN}`;
      await tempBot.telegram.setWebhook(WEBHOOK_URL);
      console.log(`Telegram Webhook successfully set to: ${WEBHOOK_URL}`);
    } catch (error) {
      console.error('Failed to set webhook automatically:', error);
    }
  }
});
