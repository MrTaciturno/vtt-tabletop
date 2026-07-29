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
  window.vttApp = {
    openSheetModal: (slotId) => {
      ui.openSheetModal(slotId);
    },
    reorderTurn: (fromIndex, direction) => {
      lobbyManager.movePlayerTurn(fromIndex, direction);
    },
    toggleMaster: (userId, makeMaster) => {
      try {
        lobbyManager.grantMasterPrivilege(userId, makeMaster);
        ui.showToast(`Privilégios atualizados.`, 'gold');
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

  ui.init();

  console.log('⚔️ Virtual Tabletop Initialized!');
});
