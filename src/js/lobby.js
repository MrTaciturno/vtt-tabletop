import { state } from './state.js';
import { network } from './network.js';
import { auth } from './auth.js';

/**
 * Lobby & Turn Management Controller
 */

class LobbyManager {
  createLobby(roomName = 'Mesa Principal') {
    let currentUser = state.currentUser;
    if (!currentUser) throw new Error('Escolha seu nome e avatar primeiro.');

    // Creator automatically becomes Master
    auth.toggleMasterPrivilege(currentUser.id, true);
    currentUser = state.currentUser;

    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const lobby = {
      code,
      name: roomName,
      masterId: currentUser.id,
      turnIndex: 0,
      createdAt: Date.now()
    };

    state.setLobby(lobby);

    const initialPlayer = {
      id: currentUser.id,
      username: currentUser.username,
      avatar: currentUser.avatar,
      isMaster: true
    };

    state.setPlayers([initialPlayer]);
    state.setTurnIndex(0);

    // Initialize WebSockets as Host (Master)
    network.init(code, true);

    return lobby;
  }

  joinLobby(code) {
    const currentUser = state.currentUser;
    if (!currentUser) throw new Error('Escolha seu nome e avatar primeiro.');

    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) throw new Error('Código da sala inválido.');

    const lobby = {
      code: cleanCode,
      name: `Sala ${cleanCode}`,
      masterId: null,
      turnIndex: 0
    };

    state.setLobby(lobby);

    const mePlayer = {
      id: currentUser.id,
      username: currentUser.username,
      avatar: currentUser.avatar,
      isMaster: Boolean(currentUser.isMaster)
    };

    state.setPlayers([mePlayer]);

    // Initialize WebSockets as Client (Player)
    network.init(cleanCode, false);

    return lobby;
  }

  leaveLobby() {
    network.close();
    state.setLobby(null);
    state.setPlayers([]);
  }

  advanceTurn() {
    if (state.players.length === 0) return;
    const nextIndex = (state.currentTurnIndex + 1) % state.players.length;
    state.setTurnIndex(nextIndex);

    network.broadcast('ADVANCE_TURN', { turnIndex: nextIndex });
  }

  movePlayerTurn(fromIndex, direction) {
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= state.players.length) return;

    const updated = [...state.players];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);

    state.setPlayers(updated);

    // Broadcast reordered turn positions to all clients
    network.broadcast('REORDER_PLAYERS', updated);
  }

  grantMasterPrivilege(targetUserId, makeMaster = true) {
    if (!state.currentUser || (!state.currentUser.isMaster && state.activeLobby?.masterId !== state.currentUser.id)) {
      throw new Error('Apenas o Mestre pode conceder privilégios.');
    }

    auth.toggleMasterPrivilege(targetUserId, makeMaster);
    network.broadcast('MASTER_PRIVILEGE_CHANGED', { targetUserId, isMaster: makeMaster });
  }

  kickPlayer(targetUserId) {
    if (!state.currentUser || (!state.currentUser.isMaster && state.activeLobby?.masterId !== state.currentUser.id)) {
      throw new Error('Apenas o Mestre pode remover jogadores.');
    }

    const updated = state.players.filter(p => p.id !== targetUserId);
    state.setPlayers(updated);

    network.broadcast('KICK_PLAYER', { targetUserId });
    network.broadcast('SYNC_PLAYERS', updated);
  }
}

export const lobbyManager = new LobbyManager();
