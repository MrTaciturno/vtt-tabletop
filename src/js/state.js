/**
 * Global Reactive State Management for VTT
 */

class AppState {
  constructor() {
    this.currentUser = JSON.parse(localStorage.getItem('vtt_user')) || null;
    this.activeLobby = null; // { code, masterId, name, turnIndex: 0 }
    this.players = [];       // Array of { id, username, avatar, isMaster, peerId }
    this.currentTurnIndex = 0;
    this.diceHistory = [];   // Array of { id, player, diceType, result, timestamp, isNat20, isNat1 }
    this.selectedDice = 'd20';
    this.characterSheets = {}; // { [slotIndex]: { id, ownerId, ownerName, imageUrl } }
    this.listeners = new Set();
  }

  // Subscribe UI components to state changes
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(event, data) {
    this.listeners.forEach(fn => fn(event, data, this));
  }

  setUser(user) {
    this.currentUser = user;
    if (user) {
      localStorage.setItem('vtt_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('vtt_user');
    }
    this.notify('USER_CHANGED', user);
  }

  setLobby(lobby) {
    this.activeLobby = lobby;
    this.notify('LOBBY_CHANGED', lobby);
  }

  setPlayers(players) {
    this.players = players;
    this.notify('PLAYERS_CHANGED', players);
  }

  setTurnIndex(index) {
    this.currentTurnIndex = index;
    if (this.activeLobby) {
      this.activeLobby.turnIndex = index;
    }
    this.notify('TURN_CHANGED', index);
  }

  setCharacterSheets(sheets) {
    this.characterSheets = sheets || {};
    this.notify('SHEETS_CHANGED', this.characterSheets);
  }

  updateCharacterSheet(slotIndex, sheetData) {
    this.characterSheets[slotIndex] = sheetData;
    this.notify('SHEETS_CHANGED', this.characterSheets);
  }

  addDiceRoll(rollData) {
    this.diceHistory.unshift(rollData);
    if (this.diceHistory.length > 50) this.diceHistory.pop();
    this.notify('DICE_ROLLED', rollData);
  }

  setSelectedDice(diceType) {
    this.selectedDice = diceType;
    this.notify('DICE_SELECTED', diceType);
  }
}

export const state = new AppState();
