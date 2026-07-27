import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const DIST_DIR = path.join(__dirname, 'dist');

// Serve static files from dist and root
app.use(express.static(DIST_DIR));
app.use(express.static(__dirname));

// In-Memory Room State Storage
const rooms = {};

io.on('connection', (socket) => {
  console.log(`[Socket.IO] Client connected: ${socket.id}`);

  socket.on('JOIN_ROOM', ({ code, user }) => {
    if (!code) return;
    const roomCode = code.toUpperCase().trim();
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.userId = user?.id;

    if (!rooms[roomCode]) {
      rooms[roomCode] = {
        code: roomCode,
        players: [],
        turnIndex: 0,
        sheets: {},
        board: { cols: 20, rows: 15, bgImageUrl: null, tokens: [] }
      };
    }

    const room = rooms[roomCode];
    if (user && user.id) {
      const existingIndex = room.players.findIndex(p => p.id === user.id);
      if (existingIndex === -1) {
        room.players.push(user);
      } else {
        room.players[existingIndex] = user;
      }
    }

    // Send full initial room state to joining client
    socket.emit('SYNC_FULL_STATE', room);
    // Broadcast updated player list to room
    io.to(roomCode).emit('PLAYERS_CHANGED', room.players);
  });

  socket.on('REORDER_PLAYERS', (payload) => {
    const code = socket.roomCode;
    if (code && rooms[code]) {
      if (Array.isArray(payload)) {
        rooms[code].players = payload;
      } else if (payload && typeof payload === 'object') {
        if (Array.isArray(payload.players)) rooms[code].players = payload.players;
        if (typeof payload.turnIndex === 'number') rooms[code].turnIndex = payload.turnIndex;
      }
      io.to(code).emit('REORDER_PLAYERS', payload);
    }
  });

  socket.on('ADVANCE_TURN', ({ turnIndex }) => {
    const code = socket.roomCode;
    if (code && rooms[code]) {
      rooms[code].turnIndex = turnIndex;
      io.to(code).emit('ADVANCE_TURN', { turnIndex });
    }
  });

  socket.on('SHEET_UPDATED', (sheetData) => {
    const code = socket.roomCode;
    if (code && rooms[code]) {
      rooms[code].sheets[sheetData.slotId] = sheetData;
      io.to(code).emit('SHEET_UPDATED', sheetData);
    }
  });

  socket.on('BOARD_CONFIG_CHANGED', (config) => {
    const code = socket.roomCode;
    if (code && rooms[code]) {
      Object.assign(rooms[code].board, config);
      io.to(code).emit('BOARD_CONFIG_CHANGED', config);
    }
  });

  socket.on('TOKEN_SPAWNED', (token) => {
    const code = socket.roomCode;
    if (code && rooms[code]) {
      rooms[code].board.tokens.push(token);
      io.to(code).emit('TOKEN_SPAWNED', token);
    }
  });

  socket.on('TOKEN_MOVED', ({ id, x, y }) => {
    const code = socket.roomCode;
    if (code && rooms[code]) {
      const tok = rooms[code].board.tokens.find(t => t.id === id);
      if (tok) {
        tok.x = x;
        tok.y = y;
      }
      io.to(code).emit('TOKEN_MOVED', { id, x, y });
    }
  });

  socket.on('TOKEN_DELETED', ({ id }) => {
    const code = socket.roomCode;
    if (code && rooms[code]) {
      rooms[code].board.tokens = rooms[code].board.tokens.filter(t => t.id !== id);
      io.to(code).emit('TOKEN_DELETED', { id });
    }
  });

  socket.on('DICE_ROLLED', (rollData) => {
    const code = socket.roomCode;
    if (code) {
      io.to(code).emit('DICE_ROLLED', rollData);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
  });
});

// SPA Fallback
app.get('*', (req, res) => {
  const distIndex = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(distIndex)) {
    res.sendFile(distIndex);
  } else {
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Express + Socket.IO Server active on port ${PORT}`);
});
