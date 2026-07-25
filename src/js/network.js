import { state } from './state.js';
import { auth } from './auth.js';

/**
 * Network Communication Layer (BroadcastChannel + PeerJS WebRTC)
 * Allows instant tab-to-tab real-time sync & remote peer connection on GitHub Pages.
 */

class NetworkEngine {
  constructor() {
    this.channel = null;
    this.peer = null;
    this.connections = new Map(); // peerId -> connection
    this.hostConnection = null;
    this.isHost = false;
  }

  init(lobbyCode) {
    this.close();

    // 1. Local Broadcast Channel for instant browser tab sync
    this.channel = new BroadcastChannel(`vtt_lobby_${lobbyCode}`);
    this.channel.onmessage = (event) => this.handleMessage(event.data);

    // 2. PeerJS WebRTC Setup
    this.initPeerJS(lobbyCode);
  }

  initPeerJS(lobbyCode) {
    if (typeof Peer === 'undefined') return; // If PeerJS library isn't loaded yet

    const myUserId = state.currentUser ? state.currentUser.id : 'anon_' + Date.now();
    const peerId = `vtt_${lobbyCode}_${myUserId}`;

    try {
      this.peer = new Peer(peerId, {
        debug: 1
      });

      this.peer.on('open', (id) => {
        console.log('[PeerJS] Connected with ID:', id);
      });

      this.peer.on('connection', (conn) => {
        this.connections.set(conn.peer, conn);
        conn.on('data', (data) => this.handleMessage(data));
        conn.on('close', () => this.connections.delete(conn.peer));
      });

      this.peer.on('error', (err) => {
        console.warn('[PeerJS] Notice:', err.message);
      });
    } catch (e) {
      console.warn('[PeerJS] Exception:', e);
    }
  }

  broadcast(type, payload) {
    const message = {
      type,
      payload,
      sender: state.currentUser ? state.currentUser.id : 'unknown',
      timestamp: Date.now()
    };

    // Broadcast locally to tabs
    if (this.channel) {
      this.channel.postMessage(message);
    }

    // Broadcast across WebRTC connections
    this.connections.forEach(conn => {
      if (conn.open) conn.send(message);
    });
  }

  handleMessage(message) {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'PLAYER_JOINED':
        this.onPlayerJoined(message.payload);
        break;

      case 'SYNC_PLAYERS':
        if (Array.isArray(message.payload)) {
          state.setPlayers(message.payload);
        }
        break;

      case 'ADVANCE_TURN':
        state.setTurnIndex(message.payload.turnIndex);
        break;

      case 'DICE_ROLLED':
        state.addDiceRoll(message.payload);
        break;

      case 'MASTER_PRIVILEGE_CHANGED':
        auth.toggleMasterPrivilege(message.payload.targetUserId, message.payload.isMaster);
        break;

      case 'KICK_PLAYER':
        if (state.currentUser && state.currentUser.id === message.payload.targetUserId) {
          state.setLobby(null);
          alert('Você foi removido da sala pelo Mestre.');
        }
        break;
    }
  }

  onPlayerJoined(newPlayer) {
    if (!state.activeLobby) return;
    
    // Check if player already exists
    const existingIndex = state.players.findIndex(p => p.id === newPlayer.id);
    let updatedPlayers;

    if (existingIndex === -1) {
      updatedPlayers = [...state.players, newPlayer];
    } else {
      updatedPlayers = [...state.players];
      updatedPlayers[existingIndex] = newPlayer;
    }

    state.setPlayers(updatedPlayers);

    // Host syncs current state back to all peers
    if (state.currentUser && state.currentUser.id === state.activeLobby.masterId) {
      this.broadcast('SYNC_PLAYERS', updatedPlayers);
    }
  }

  close() {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.connections.clear();
  }
}

export const network = new NetworkEngine();
