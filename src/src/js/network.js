import { state } from './state.js';
import { auth } from './auth.js';

/**
 * WebRTC Network Engine (PeerJS Master-Client P2P Architecture)
 * Enables true cross-device real-time multiplayer on GitHub Pages.
 */

class NetworkEngine {
  constructor() {
    this.channel = null;
    this.peer = null;
    this.connections = new Map(); // Master: stores connection to each player
    this.hostConn = null;          // Player: stores connection to Master
    this.isHost = false;
    this.status = 'DISCONNECTED'; // DISCONNECTED, CONNECTING, CONNECTED
  }

  init(lobbyCode, isHost = false) {
    this.close();
    this.isHost = isHost;

    // 1. Same-device tab-to-tab fallback
    this.channel = new BroadcastChannel(`vtt_lobby_${lobbyCode}`);
    this.channel.onmessage = (event) => this.handleMessage(event.data);

    // 2. PeerJS WebRTC Setup
    this.initPeerJS(lobbyCode, isHost);
  }

  initPeerJS(lobbyCode, isHost) {
    if (typeof Peer === 'undefined') {
      console.warn('[Network] PeerJS library not loaded.');
      return;
    }

    const currentUser = state.currentUser || { id: 'anon_' + Date.now(), username: 'Anon' };
    
    // Deterministic Peer IDs for WebRTC discovery
    const masterPeerId = `vtt_room_${lobbyCode}_master`;
    const myPeerId = isHost 
      ? masterPeerId 
      : `vtt_room_${lobbyCode}_player_${currentUser.id}`;

    try {
      this.peer = new Peer(myPeerId, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        }
      });

      this.peer.on('open', (id) => {
        console.log(`[WebRTC] Peer aberto com ID: ${id}`);
        this.status = 'CONNECTED';
        this.updateConnectionBadge('🟢 WebRTC Conectado');

        if (!isHost) {
          // Player connects to the Master's Peer ID
          this.connectToMaster(masterPeerId, currentUser);
        }
      });

      // Master listens for incoming player connections
      if (isHost) {
        this.peer.on('connection', (conn) => {
          console.log(`[WebRTC Master] Novo jogador conectando: ${conn.peer}`);
          
          conn.on('open', () => {
            this.connections.set(conn.peer, conn);
            
            // Send current full lobby state to newly connected player
            conn.send({
              type: 'SYNC_FULL_STATE',
              payload: {
                lobby: state.activeLobby,
                players: state.players,
                turnIndex: state.currentTurnIndex,
                diceHistory: state.diceHistory
              }
            });
          });

          conn.on('data', (data) => this.handleMessage(data));
          
          conn.on('close', () => {
            console.log(`[WebRTC Master] Conexão encerrada com ${conn.peer}`);
            this.connections.delete(conn.peer);
          });
        });
      }

      this.peer.on('error', (err) => {
        console.warn('[WebRTC Error]', err.type, err.message);
        if (err.type === 'unavailable-id' && !isHost) {
          // Try alternative ID if duplicate
          console.log('[WebRTC] Tentando reconectar...');
        }
        this.updateConnectionBadge('⚠️ Reconectando...');
      });

    } catch (e) {
      console.error('[WebRTC Exception]', e);
    }
  }

  // Player connects to Master's WebRTC channel
  connectToMaster(masterPeerId, currentUser) {
    console.log(`[WebRTC Player] Conectando ao Mestre (${masterPeerId})...`);
    this.hostConn = this.peer.connect(masterPeerId, { reliable: true });

    this.hostConn.on('open', () => {
      console.log('[WebRTC Player] Conectado ao Mestre!');
      this.updateConnectionBadge('🟢 Conectado ao Mestre');

      // Send join request to Master
      const myPlayerInfo = {
        id: currentUser.id,
        username: currentUser.username,
        avatar: currentUser.avatar,
        isMaster: Boolean(currentUser.isMaster)
      };

      this.hostConn.send({
        type: 'PLAYER_JOINED',
        payload: myPlayerInfo
      });
    });

    this.hostConn.on('data', (data) => this.handleMessage(data));

    this.hostConn.on('close', () => {
      console.warn('[WebRTC Player] Desconectado do Mestre');
      this.updateConnectionBadge('🔴 Desconectado');
    });
  }

  // Send message to all peers (Master -> All Players, or Player -> Master)
  broadcast(type, payload) {
    const message = {
      type,
      payload,
      sender: state.currentUser ? state.currentUser.id : 'unknown',
      timestamp: Date.now()
    };

    // 1. Broadcast to local browser tabs
    if (this.channel) {
      this.channel.postMessage(message);
    }

    // 2. Broadcast via WebRTC
    if (this.isHost) {
      // Master sends to all connected player channels
      this.connections.forEach(conn => {
        if (conn.open) conn.send(message);
      });
    } else if (this.hostConn && this.hostConn.open) {
      // Player sends message to Master
      this.hostConn.send(message);
    }
  }

  handleMessage(message) {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'PLAYER_JOINED':
        if (this.isHost) {
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

          // Master broadcasts updated player list to all connected players
          this.broadcast('SYNC_PLAYERS', updatedPlayers);
        }
        break;

      case 'SYNC_PLAYERS':
        if (Array.isArray(message.payload)) {
          state.setPlayers(message.payload);
        }
        break;

      case 'SYNC_FULL_STATE':
        if (message.payload) {
          if (message.payload.players) state.setPlayers(message.payload.players);
          if (typeof message.payload.turnIndex === 'number') state.setTurnIndex(message.payload.turnIndex);
        }
        break;

      case 'ADVANCE_TURN':
        state.setTurnIndex(message.payload.turnIndex);
        if (this.isHost) {
          this.broadcast('ADVANCE_TURN', message.payload);
        }
        break;

      case 'DICE_ROLLED':
        state.addDiceRoll(message.payload);
        if (this.isHost) {
          // Master re-broadcasts dice roll to all other players
          this.broadcast('DICE_ROLLED', message.payload);
        }
        break;

      case 'MASTER_PRIVILEGE_CHANGED':
        auth.toggleMasterPrivilege(message.payload.targetUserId, message.payload.isMaster);
        if (this.isHost) {
          this.broadcast('MASTER_PRIVILEGE_CHANGED', message.payload);
        }
        break;

      case 'KICK_PLAYER':
        if (state.currentUser && state.currentUser.id === message.payload.targetUserId) {
          state.setLobby(null);
          alert('Você foi removido da sala pelo Mestre.');
        }
        if (this.isHost) {
          this.broadcast('KICK_PLAYER', message.payload);
        }
        break;
    }
  }

  updateConnectionBadge(text) {
    const badge = document.getElementById('connection-status-badge');
    if (badge) badge.textContent = text;
  }

  close() {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    if (this.hostConn) {
      this.hostConn.close();
      this.hostConn = null;
    }
    this.connections.forEach(conn => conn.close());
    this.connections.clear();

    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }
}

export const network = new NetworkEngine();
