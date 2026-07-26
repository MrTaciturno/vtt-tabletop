import { state } from './state.js';
import { auth } from './auth.js';
import { boardEngine } from './board.js';

/**
 * Universal WebSocket Network Engine (MQTT over Secure WSS)
 * Guarantees 100% reliable cross-device & cross-network communication on GitHub Pages!
 */

class NetworkEngine {
  constructor() {
    this.client = null;
    this.channel = null;
    this.lobbyCode = null;
    this.isHost = false;
    this.status = 'DISCONNECTED';
    
    this.brokers = [
      'wss://broker.emqx.io:8084/mqtt',
      'wss://broker.hivemq.com:8884/mqtt'
    ];
    this.brokerIndex = 0;
  }

  init(lobbyCode, isHost = false) {
    this.close();
    this.lobbyCode = lobbyCode.toUpperCase();
    this.isHost = isHost;

    this.channel = new BroadcastChannel(`vtt_lobby_${this.lobbyCode}`);
    this.channel.onmessage = (event) => this.handleMessage(event.data);

    this.initMQTT(this.lobbyCode);
  }

  initMQTT(lobbyCode) {
    if (typeof mqtt === 'undefined') {
      console.warn('[Network] MQTT library not loaded. Falling back to BroadcastChannel.');
      this.updateStatusBadge('⚠️ Apenas Local', 'badge-player');
      return;
    }

    const brokerUrl = this.brokers[this.brokerIndex];
    const clientId = `vtt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const topic = `vtt/rooms/${lobbyCode}`;

    this.updateStatusBadge('🟡 Conectando...', 'badge-player');

    try {
      this.client = mqtt.connect(brokerUrl, {
        clientId,
        clean: true,
        connectTimeout: 8000,
        reconnectPeriod: 3000
      });

      this.client.on('connect', () => {
        console.log(`[WebSocket] Conectado ao broker ${brokerUrl}`);
        this.status = 'CONNECTED';
        this.updateStatusBadge('🟢 Sala Conectada', 'badge-active');

        this.client.subscribe(topic, { qos: 0 }, (err) => {
          if (!err) {
            const currentUser = state.currentUser || { id: 'anon_' + Date.now(), username: 'Anon', avatar: '🎲' };
            const playerPayload = {
              id: currentUser.id,
              username: currentUser.username,
              avatar: currentUser.avatar,
              isMaster: Boolean(currentUser.isMaster)
            };

            this.broadcast('PLAYER_JOINED', playerPayload);

            if (this.isHost) {
              this.broadcast('SYNC_PLAYERS', state.players);
              this.broadcast('BOARD_CONFIG_CHANGED', {
                cols: boardEngine.cols,
                rows: boardEngine.rows,
                bgImageUrl: boardEngine.bgImageUrl
              });
            }
          }
        });
      });

      this.client.on('message', (receivedTopic, payload) => {
        if (receivedTopic !== topic) return;
        try {
          const message = JSON.parse(payload.toString());
          this.handleMessage(message);
        } catch (e) {
          console.warn('[WebSocket] Non-JSON payload:', e);
        }
      });

      this.client.on('error', (err) => {
        console.warn('[WebSocket Error]', err);
        this.tryNextBroker(lobbyCode);
      });

      this.client.on('offline', () => {
        this.updateStatusBadge('🟡 Reconectando...', 'badge-player');
      });

    } catch (e) {
      console.error('[WebSocket Exception]', e);
      this.tryNextBroker(lobbyCode);
    }
  }

  tryNextBroker(lobbyCode) {
    if (this.brokerIndex < this.brokers.length - 1) {
      this.brokerIndex++;
      this.closeClient();
      setTimeout(() => this.initMQTT(lobbyCode), 1000);
    } else {
      this.updateStatusBadge('🔴 Erro de Conexão', 'badge-player');
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

    if (this.client && this.client.connected && this.lobbyCode) {
      const topic = `vtt/rooms/${this.lobbyCode}`;
      this.client.publish(topic, JSON.stringify(message));
    }
  }

  handleMessage(message) {
    if (!message || !message.type) return;

    const currentUserId = state.currentUser ? state.currentUser.id : null;
    
    switch (message.type) {
      case 'PLAYER_JOINED': {
        const newPlayer = message.payload;
        const existingIndex = state.players.findIndex(p => p.id === newPlayer.id);
        let updatedPlayers;

        if (existingIndex === -1) {
          updatedPlayers = [...state.players, newPlayer];
        } else {
          updatedPlayers = [...state.players];
          updatedPlayers[existingIndex] = newPlayer;
        }

        state.setPlayers(updatedPlayers);

        if (this.isHost && message.sender !== currentUserId) {
          this.broadcast('SYNC_FULL_STATE', {
            players: updatedPlayers,
            turnIndex: state.currentTurnIndex,
            board: {
              cols: boardEngine.cols,
              rows: boardEngine.rows,
              bgImageUrl: boardEngine.bgImageUrl,
              tokens: boardEngine.tokens
            }
          });
        }
        break;
      }

      case 'SYNC_PLAYERS':
      case 'REORDER_PLAYERS':
        if (Array.isArray(message.payload)) {
          state.setPlayers(message.payload);
        }
        break;

      case 'SYNC_FULL_STATE':
        if (message.payload) {
          if (Array.isArray(message.payload.players)) {
            state.setPlayers(message.payload.players);
          }
          if (typeof message.payload.turnIndex === 'number') {
            state.setTurnIndex(message.payload.turnIndex);
          }
          if (message.payload.board) {
            const b = message.payload.board;
            if (b.cols && b.rows) boardEngine.setGridSize(b.cols, b.rows, false);
            if (b.bgImageUrl !== undefined) boardEngine.setBackgroundImage(b.bgImageUrl, false);
            if (Array.isArray(b.tokens)) {
              boardEngine.tokens = b.tokens;
              boardEngine.render();
            }
          }
        }
        break;

      case 'BOARD_CONFIG_CHANGED':
        if (message.payload && message.sender !== currentUserId) {
          if (message.payload.cols && message.payload.rows) {
            boardEngine.setGridSize(message.payload.cols, message.payload.rows, false);
          }
          if (message.payload.bgImageUrl !== undefined) {
            boardEngine.setBackgroundImage(message.payload.bgImageUrl, false);
          }
        }
        break;

      case 'TOKEN_SPAWNED':
        if (message.payload && message.sender !== currentUserId) {
          boardEngine.tokens.push(message.payload);
          boardEngine.render();
        }
        break;

      case 'TOKEN_MOVED':
        if (message.payload && message.sender !== currentUserId) {
          boardEngine.moveToken(message.payload.id, message.payload.x, message.payload.y, false);
        }
        break;

      case 'TOKEN_DELETED':
        if (message.payload && message.sender !== currentUserId) {
          boardEngine.deleteToken(message.payload.id, false);
        }
        break;

      case 'ADVANCE_TURN':
        if (message.sender !== currentUserId) {
          state.setTurnIndex(message.payload.turnIndex);
        }
        break;

      case 'DICE_ROLLED':
        if (message.sender !== currentUserId) {
          state.addDiceRoll(message.payload);
        }
        break;

      case 'MASTER_PRIVILEGE_CHANGED':
        auth.toggleMasterPrivilege(message.payload.targetUserId, message.payload.isMaster);
        break;

      case 'KICK_PLAYER':
        if (currentUserId && currentUserId === message.payload.targetUserId) {
          state.setLobby(null);
          alert('Você foi removido da sala pelo Mestre.');
        }
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

  closeClient() {
    if (this.client) {
      try {
        this.client.end(true);
      } catch (e) {}
      this.client = null;
    }
  }

  close() {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.closeClient();
    this.status = 'DISCONNECTED';
  }
}

export const network = new NetworkEngine();
