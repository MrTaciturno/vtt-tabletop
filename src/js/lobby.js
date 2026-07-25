import { state } from './state.js';
import { network } from './network.js';
import { auth } from './auth.js';

/**
 * Lobby & Turn Management Controller
 */

class LobbyManager {
  createLobby(roomName = 'Mesa Principal') {
    const currentUser = state.currentUser;
    if (!currentUser) throw new Error('Você precisa estar logado.');

    // Force user to be Master when creating a lobby if they aren't already
    if (!currentUser.isMaster) {
      auth.toggleMasterPrivilege(currentUser.id, true);
    }

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

    // Initialize network channel for room code
    network.init(code);

    return lobby;
  }

  joinLobby(code) {
    const currentUser = state.currentUser;
    if (!currentUser) throw new Error('Você precisa estar logado.');

    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) throw new Error('Código do lobby inválido.');

    const lobby = {
      code: cleanCode,
      name: `Lobby ${cleanCode}`,
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

    // Add myself to room
    const updatedPlayers = [...state.players.filter(p => p.id !== currentUser.id), mePlayer];
    state.setPlayers(updatedPlayers);

    // Initialize network channel
    network.init(cleanCode);

    // Broadcast join to peers
    network.broadcast('PLAYER_JOINED', mePlayer);

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

    // Broadcast turn advance across network
    network.broadcast('ADVANCE_TURN', { turnIndex: nextIndex });
  }

  grantMasterPrivilege(targetUserId, makeMaster = true) {
    if (!state.currentUser || (!state.currentUser.isMaster && state.activeLobby?.masterId !== state.currentUser.id)) {
      throw new Error('Apenas o Mestre pode conceder ou revogar privilégios.');
    }

    auth.toggleMasterPrivilege(targetUserId, makeMaster);

    // Broadcast change
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
