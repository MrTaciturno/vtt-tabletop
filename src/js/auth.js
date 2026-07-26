import { state } from './state.js';

/**
 * Simplified Direct User Profile Manager (No passwords/registration required)
 */

class AuthManager {
  constructor() {
    this.STORAGE_KEY = 'vtt_quick_profile';
  }

  getProfile() {
    return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || null;
  }

  saveProfile(username, avatar = '🧙‍♂️', isMaster = false) {
    if (!username || !username.trim()) {
      throw new Error('Por favor, informe seu nome.');
    }

    const user = {
      id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      username: username.trim(),
      avatar: avatar || '🎲',
      isMaster: Boolean(isMaster)
    };

    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(user));
    state.setUser(user);
    return user;
  }

  updateProfile(updates) {
    const current = state.currentUser;
    if (!current) return;

    const updated = { ...current, ...updates };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(updated));
    state.setUser(updated);
    return updated;
  }

  logout() {
    state.setUser(null);
    state.setLobby(null);
  }

  toggleMasterPrivilege(targetUserId, makeMaster) {
    if (state.currentUser && state.currentUser.id === targetUserId) {
      const updated = { ...state.currentUser, isMaster: Boolean(makeMaster) };
      state.setUser(updated);
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(updated));
    }

    const updatedPlayers = state.players.map(p => {
      if (p.id === targetUserId) {
        return { ...p, isMaster: Boolean(makeMaster) };
      }
      return p;
    });
    state.setPlayers(updatedPlayers);
  }
}

export const auth = new AuthManager();
