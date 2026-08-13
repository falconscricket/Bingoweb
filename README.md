# Couple Bingo — Backend + Frontend

A real Node.js backend (Express) for the couple-themed 5x5 Bingo game, with
room create/join, per-player boards, turn logic, and server-side win checking.

## Run it

```bash
cd couple-bingo-backend
npm install
npm start
```

Server starts at **http://localhost:3000** — open it on two devices on the
same network (or deploy it, see below) to play.

## How it works

- `server.js` — Express server. Rooms are kept in memory (`rooms` object).
  Each room stores both players' board layouts server-side, so a player can
  never see their partner's arrangement, and win-checking is done on the
  server (cheat-proof) using each player's real stored board.
- `public/index.html` — frontend. Talks to the backend only via `fetch`
  calls to `/api/...` and polls every ~1.2s to stay in sync across devices.

## API endpoints

| Method | Path                        | Purpose                          |
|--------|-----------------------------|-----------------------------------|
| POST   | `/api/rooms`                | Create a room, or join by `code`  |
| GET    | `/api/rooms/:code`          | Get room state (poll this)        |
| POST   | `/api/rooms/:code/board`    | Save your 24-number arrangement   |
| POST   | `/api/rooms/:code/ready`    | Mark yourself ready to start      |
| POST   | `/api/rooms/:code/call`     | Call a number on your turn        |
| POST   | `/api/rooms/:code/reset`    | Play again                        |

## Deploying so two phones (different networks) can play

`localhost` only works if both devices are on the same Wi-Fi. To play from
anywhere:
1. Deploy this folder to any Node host (Render, Railway, Fly.io, a VPS, etc.)
2. Run `npm install && npm start` there (or let the platform run `npm start`)
3. Share the public URL — the frontend already calls relative `/api/...`
   paths, so no code changes are needed.

## Notes

- Rooms are in-memory only — restarting the server clears all games. Swap in
  a real database (e.g. Redis or MongoDB) in `server.js` if you need games
  to survive restarts.
- Rooms older than 6 hours are auto-cleaned.
