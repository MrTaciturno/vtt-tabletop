import { state } from './state.js';
import { auth } from './auth.js';
import { boardEngine } from './board.js';

/**
 * Socket.IO Realtime Network Engine
 */

class NetworkEngine {
  constructor() {
    this.socket = null;
    this.channel = null;
    this.lobbyCode = null;
    this.isHost = false;
    this.status = 'DISCONNECTED';
  }

  init(lobbyCode, isHost = false) {
    this.close();
    this.lobbyCode = lobbyCode.toUpperCase().trim();
    this.isHost = isHost;

    // 1. Same-device local tab BroadcastChannel fallback
    this.channel = new BroadcastChannel(`vtt_lobby_${this.lobbyCode}`);
    this.channel.onmessage = (event) => this.handleMessage(event.data);

    // 2. Socket.IO Client Connection
    this.initSocketIO(this.lobbyCode);
  }

  initSocketIO(lobbyCode) {
    this.updateStatusBadge('🟡 Conectando...', 'badge-player');

    const socketFactory = window.io || (typeof io !== 'undefined' ? io : null);

    if (!socketFactory) {
      console.warn('[Network] Socket.IO client library not loaded. Falling back to local tab mode.');
      this.updateStatusBadge('⚠️ Modo Local', 'badge-player');
      return;
    }

    try {
      this.socket = socketFactory(window.location.origin, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10
      });

      this.socket.on('connect', () => {
        console.log(`[Socket.IO] Conectado ao servidor. ID: ${this.socket.id}`);
        this.status = 'CONNECTED';
        this.updateStatusBadge('🟢 Sala Conectada', 'badge-active');

        const currentUser = state.currentUser || { id: 'anon_' + Date.now(), username: 'Anon', avatar: '🎲' };
        
        // Join room on server
        this.socket.emit('JOIN_ROOM', {
          code: lobbyCode,
          user: {
            id: currentUser.id,
            username: currentUser.username,
            avatar: currentUser.avatar,
            isMaster: Boolean(currentUser.isMaster)
          }
        });
      });

      // Handle Socket.IO events from server
      this.socket.on('SYNC_FULL_STATE', (room) => {
        if (room) {
          if (Array.isArray(room.players)) state.setPlayers(room.players);
          if (typeof room.turnIndex === 'number') state.setTurnIndex(room.turnIndex);
          if (room.sheets) state.setCharacterSheets(room.sheets);
          if (room.board) {
            if (room.board.cols && room.board.rows) {
              boardEngine.setGridSize(room.board.cols, room.board.rows, false);
            }
            if (room.board.bgImageUrl !== undefined) {
              boardEngine.setBackgroundImage(room.board.bgImageUrl, false);
            }
            if (Array.isArray(room.board.tokens)) {
              boardEngine.tokens = room.board.tokens;
              boardEngine.render();
            }
          }
        }
      });

      this.socket.on('PLAYERS_CHANGED', (players) => {
        if (Array.isArray(players)) state.setPlayers(players);
      });

      this.socket.on('REORDER_PLAYERS', (payload) => {
        if (Array.isArray(payload)) {
          state.setPlayers(payload);
        } else if (payload && typeof payload === 'object') {
          if (Array.isArray(payload.players)) state.setPlayers(payload.players);
          if (typeof payload.turnIndex === 'number') state.setTurnIndex(payload.turnIndex);
        }
      });

      this.socket.on('ADVANCE_TURN', ({ turnIndex }) => {
        if (typeof turnIndex === 'number') state.setTurnIndex(turnIndex);
      });

      this.socket.on('SHEET_UPDATED', (sheetData) => {
        if (sheetData) state.updateCharacterSheet(sheetData.slotId, sheetData);
      });

      this.socket.on('BOARD_CONFIG_CHANGED', (config) => {
        if (config) {
          if (config.cols && config.rows) boardEngine.setGridSize(config.cols, config.rows, false);
          if (config.bgImageUrl !== undefined) boardEngine.setBackgroundImage(config.bgImageUrl, false);
        }
      });

      this.socket.on('TOKEN_SPAWNED', (token) => {
        if (token) {
          const exists = boardEngine.tokens.some(t => t.id === token.id);
          if (!exists) {
            boardEngine.tokens.push(token);
            boardEngine.render();
          }
        }
      });

      this.socket.on('TOKEN_MOVED', ({ id, x, y }) => {
        if (id) boardEngine.moveToken(id, x, y, false);
      });

      this.socket.on('TOKEN_UPDATED', (tokenData) => {
        if (tokenData && tokenData.id) boardEngine.updateToken(tokenData.id, tokenData, false);
      });

      this.socket.on('TOKEN_DELETED', ({ id }) => {
        if (id) boardEngine.deleteToken(id, false);
      });

      this.socket.on('DICE_ROLLED', (rollData) => {
        if (rollData) state.addDiceRoll(rollData);
      });

      this.socket.on('disconnect', () => {
        this.updateStatusBadge('🟡 Reconectando...', 'badge-player');
      });

      this.socket.on('connect_error', (err) => {
        console.warn('[Socket.IO Connect Error]', err);
        this.updateStatusBadge('🔴 Erro de Conexão', 'badge-player');
      });

    } catch (e) {
      console.error('[Socket.IO Exception]', e);
    }
  }

  broadcast(type, payload) {
    const currentUser = state.currentUser || { id: 'unknown' };
    const message = {
      type,
      payload,
      sender: currentUser.id,
      timestamp: Date.now()
    };

    if (this.channel) {
      this.channel.postMessage(message);
    }

    if (this.socket && this.socket.connected) {
      this.socket.emit(type, payload);
    }
  }

  handleMessage(message) {
    if (!message || !message.type) return;

    const currentUserId = state.currentUser ? state.currentUser.id : null;
    if (message.sender === currentUserId) return;
    
    switch (message.type) {
      case 'SHEET_UPDATED':
        if (message.payload) state.updateCharacterSheet(message.payload.slotId, message.payload);
        break;
      case 'REORDER_PLAYERS':
        if (Array.isArray(message.payload)) {
          state.setPlayers(message.payload);
        } else if (message.payload && typeof message.payload === 'object') {
          if (Array.isArray(message.payload.players)) state.setPlayers(message.payload.players);
          if (typeof message.payload.turnIndex === 'number') state.setTurnIndex(message.payload.turnIndex);
        }
        break;
      case 'BOARD_CONFIG_CHANGED':
        if (message.payload) {
          if (message.payload.cols && message.payload.rows) boardEngine.setGridSize(message.payload.cols, message.payload.rows, false);
          if (message.payload.bgImageUrl !== undefined) boardEngine.setBackgroundImage(message.payload.bgImageUrl, false);
        }
        break;
      case 'TOKEN_SPAWNED':
        if (message.payload) {
          const exists = boardEngine.tokens.some(t => t.id === message.payload.id);
          if (!exists) {
            boardEngine.tokens.push(message.payload);
            boardEngine.render();
          }
        }
        break;
      case 'TOKEN_MOVED':
        if (message.payload) boardEngine.moveToken(message.payload.id, message.payload.x, message.payload.y, false);
        break;
      case 'TOKEN_DELETED':
        if (message.payload) boardEngine.deleteToken(message.payload.id, false);
        break;
      case 'ADVANCE_TURN':
        if (message.payload) state.setTurnIndex(message.payload.turnIndex);
        break;
      case 'DICE_ROLLED':
        if (message.payload) state.addDiceRoll(message.payload);
        break;
    }
  }

  updateStatusBadge(text, badgeClass = 'badge-active') {
    const badge = document.getElementById('connection-status-badge');
    if (badge) {
      badge.textContent = text;
      badge.className = `badge ${badgeClass}`;
    }
  }

  close() {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    if (this.socket) {
      try {
        this.socket.disconnect();
      } catch (e) {}
      this.socket = null;
    }
    this.status = 'DISCONNECTED';
  }
}

export const network = new NetworkEngine();
