import { state } from './state.js';

/**
 * Authentication & User Settings Manager
 */

class AuthManager {
  constructor() {
    this.STORAGE_KEY = 'vtt_accounts_db';
    this.initDatabase();
  }

  initDatabase() {
    if (!localStorage.getItem(this.STORAGE_KEY)) {
      // Default initial admin account if empty
      const initialAccounts = [
        {
          id: 'usr_master_1',
          username: 'MasterDungeon',
          avatar: '🧙‍♂️',
          isMaster: true,
          passwordHash: '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918' // 'admin123'
        }
      ];
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(initialAccounts));
    }
  }

  getAccounts() {
    return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || [];
  }

  saveAccounts(accounts) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(accounts));
  }

  async hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async register(username, password, avatar = '🎲', isMaster = false) {
    const accounts = this.getAccounts();
    const existing = accounts.find(a => a.username.toLowerCase() === username.toLowerCase());
    
    if (existing) {
      throw new Error('Este nome de usuário já está em uso.');
    }

    const passwordHash = await this.hashPassword(password);
    const newUser = {
      id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      username,
      avatar,
      isMaster: Boolean(isMaster),
      passwordHash
    };

    accounts.push(newUser);
    this.saveAccounts(accounts);
    
    // Auto-login
    const { passwordHash: _, ...safeUser } = newUser;
    state.setUser(safeUser);
    return safeUser;
  }

  async login(username, password) {
    const accounts = this.getAccounts();
    const user = accounts.find(a => a.username.toLowerCase() === username.toLowerCase());
    
    if (!user) {
      throw new Error('Usuário não encontrado.');
    }

    const passwordHash = await this.hashPassword(password);
    if (user.passwordHash !== passwordHash) {
      throw new Error('Senha incorreta.');
    }

    const { passwordHash: _, ...safeUser } = user;
    state.setUser(safeUser);
    return safeUser;
  }

  logout() {
    state.setUser(null);
    state.setLobby(null);
  }

  updateProfile(updates) {
    const current = state.currentUser;
    if (!current) return;

    const accounts = this.getAccounts();
    const index = accounts.findIndex(a => a.id === current.id);
    
    if (index !== -1) {
      if (updates.avatar) accounts[index].avatar = updates.avatar;
      if (updates.username) accounts[index].username = updates.username;
      
      this.saveAccounts(accounts);

      const updatedUser = { ...current, ...updates };
      state.setUser(updatedUser);
      return updatedUser;
    }
  }

  // Master capability: Toggle or grant Master privileges to another user
  toggleMasterPrivilege(targetUserId, makeMaster) {
    const accounts = this.getAccounts();
    const index = accounts.findIndex(a => a.id === targetUserId);
    
    if (index !== -1) {
      accounts[index].isMaster = Boolean(makeMaster);
      this.saveAccounts(accounts);

      // If updating active user
      if (state.currentUser && state.currentUser.id === targetUserId) {
        state.setUser({ ...state.currentUser, isMaster: Boolean(makeMaster) });
      }

      // Also update in active lobby players list
      const updatedPlayers = state.players.map(p => {
        if (p.id === targetUserId) {
          return { ...p, isMaster: Boolean(makeMaster) };
        }
        return p;
      });
      state.setPlayers(updatedPlayers);
    }
  }
}

export const auth = new AuthManager();
