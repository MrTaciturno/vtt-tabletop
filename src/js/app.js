import { state } from './state.js';
import { auth } from './auth.js';
import { ui } from './ui.js';
import { lobbyManager } from './lobby.js';
import { diceEngine } from './dice.js';
import { boardEngine } from './board.js';

/**
 * Main Application Initializer
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize UI & Bindings
  ui.init();

  // Expose global helper actions for dynamic inline HTML buttons
  window.vttApp = {
    toggleMaster: (userId, makeMaster) => {
      try {
        lobbyManager.grantMasterPrivilege(userId, makeMaster);
        ui.showToast(`Privilégios de Mestre ${makeMaster ? 'concedidos' : 'revogados'}.`, 'gold');
      } catch (err) {
        ui.showToast(err.message, 'error');
      }
    },
    kick: (userId) => {
      try {
        lobbyManager.kickPlayer(userId);
        ui.showToast(`Jogador removido da sala.`, 'info');
      } catch (err) {
        ui.showToast(err.message, 'error');
      }
    }
  };

  console.log('⚔️ Virtual Tabletop & Interactive Board Engine Initialized!');
});
