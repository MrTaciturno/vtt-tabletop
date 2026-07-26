import { state } from './state.js';
import { auth } from './auth.js';
import { lobbyManager } from './lobby.js';
import { diceEngine } from './dice.js';
import { boardEngine } from './board.js';

/**
 * UI Renderer & DOM Controller
 */

class UIController {
  constructor() {
    this.toastContainer = null;
    this.showFloatingPlayers = true;
  }

  init() {
    this.createToastContainer();
    this.bindEvents();

    // Subscribe to state updates
    state.subscribe((event, data) => this.handleStateChange(event, data));

    // Check saved profile
    const saved = auth.getProfile();
    if (saved) {
      state.setUser(saved);
    }

    this.render();
  }

  createToastContainer() {
    if (!document.getElementById('toast-container')) {
      this.toastContainer = document.createElement('div');
      this.toastContainer.id = 'toast-container';
      document.body.appendChild(this.toastContainer);
    } else {
      this.toastContainer = document.getElementById('toast-container');
    }
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(50px)';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  handleStateChange(event, data) {
    if (event === 'USER_CHANGED') {
      this.renderNav();
      this.renderViews();
    } else if (event === 'LOBBY_CHANGED') {
      this.renderViews();
      this.renderLobbyHeader();
    } else if (event === 'PLAYERS_CHANGED' || event === 'TURN_CHANGED') {
      this.renderPlayers();
      this.renderTurnBanner();
    } else if (event === 'DICE_ROLLED') {
      this.renderRollLog();
      this.animateDiceDisplay(data);
    } else if (event === 'DICE_SELECTED') {
      this.updateDiceSelectionUI(data);
    }
  }

  bindEvents() {
    // Quick Profile Setup Submission
    document.getElementById('form-quick-profile')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const username = e.target.username.value;
      const avatar = document.querySelector('.profile-avatar-option.selected')?.dataset.avatar || '🧙‍♂️';
      
      try {
        auth.saveProfile(username, avatar);
        this.showToast(`Bem-vindo, ${username}!`, 'success');
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    // Profile Avatar Selection
    document.querySelectorAll('.profile-avatar-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        document.querySelectorAll('.profile-avatar-option').forEach(o => o.classList.remove('selected'));
        e.currentTarget.classList.add('selected');
      });
    });

    // Change Profile
    document.getElementById('btn-change-profile')?.addEventListener('click', () => {
      auth.logout();
    });

    // Lobby Actions
    document.getElementById('btn-create-lobby')?.addEventListener('click', () => {
      try {
        const lobby = lobbyManager.createLobby();
        this.showToast(`Sala criada! Você é o Mestre 👑`, 'gold');
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    document.getElementById('btn-join-lobby')?.addEventListener('click', () => {
      const codeInput = document.getElementById('join-code-input')?.value;
      try {
        lobbyManager.joinLobby(codeInput);
        this.showToast(`Conectado à sala!`, 'success');
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    document.getElementById('btn-leave-lobby')?.addEventListener('click', () => {
      lobbyManager.leaveLobby();
      this.showToast('Você saiu da sala.');
    });

    document.getElementById('btn-copy-code')?.addEventListener('click', () => {
      if (state.activeLobby) {
        navigator.clipboard.writeText(state.activeLobby.code);
        this.showToast('Código da sala copiado!', 'info');
      }
    });

    // Toggle Floating Players Window
    document.getElementById('btn-toggle-players-widget')?.addEventListener('click', () => {
      this.showFloatingPlayers = !this.showFloatingPlayers;
      this.renderFloatingWidgetVisibility();
    });

    document.getElementById('close-floating-players')?.addEventListener('click', () => {
      this.showFloatingPlayers = false;
      this.renderFloatingWidgetVisibility();
    });

    // Turn Controls
    document.getElementById('btn-next-turn')?.addEventListener('click', () => {
      lobbyManager.advanceTurn();
    });

    // Right Menu Tabs
    document.querySelectorAll('.menu-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetTab = e.currentTarget.dataset.tab;
        document.querySelectorAll('.menu-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));

        e.currentTarget.classList.add('active');
        document.getElementById(`tab-pane-${targetTab}`)?.classList.remove('hidden');
      });
    });

    // Board & Map Controls (Master)
    document.getElementById('btn-update-grid')?.addEventListener('click', () => {
      const cols = parseInt(document.getElementById('grid-cols-input')?.value, 10) || 20;
      const rows = parseInt(document.getElementById('grid-rows-input')?.value, 10) || 15;
      boardEngine.setGridSize(cols, rows, true);
      this.showToast(`Grid atualizado para ${cols}x${rows}`, 'info');
    });

    document.getElementById('btn-center-board')?.addEventListener('click', () => {
      boardEngine.centerView();
    });

    // Map Background Image Upload (Master)
    document.getElementById('map-file-input')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target.result;
          boardEngine.setBackgroundImage(dataUrl, true);
          this.showToast('Mapa de fundo carregado!', 'success');
        };
        reader.readAsDataURL(file);
      }
    });

    document.getElementById('btn-remove-map')?.addEventListener('click', () => {
      boardEngine.setBackgroundImage(null, true);
      this.showToast('Mapa de fundo removido.', 'info');
    });

    // Token Spawner
    document.getElementById('form-spawn-token')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = e.target.tokenName.value || 'Token';
      const avatar = e.target.tokenAvatar.value || '🛡️';
      const color = e.target.tokenColor.value || '#8b5cf6';

      boardEngine.addToken(name, avatar, color, state.currentUser?.id, true);
      this.showToast(`Token '${name}' adicionado!`, 'success');
      e.target.reset();
    });

    // Quick Spawn Presets
    document.querySelectorAll('.quick-token-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const name = e.currentTarget.dataset.name;
        const avatar = e.currentTarget.dataset.avatar;
        const color = e.currentTarget.dataset.color;
        boardEngine.addToken(name, avatar, color, state.currentUser?.id, true);
        this.showToast(`Token '${name}' adicionado!`, 'success');
      });
    });

    // Dice Roll Controls (d4, d6, d8, d10, d12, d100)
    document.querySelectorAll('.dice-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const diceType = e.currentTarget.dataset.dice;
        state.setSelectedDice(diceType);
      });
    });

    document.getElementById('btn-roll-dice')?.addEventListener('click', () => {
      const diceCube = document.getElementById('dice-cube');
      if (diceCube) {
        diceCube.classList.add('rolling');
      }
      setTimeout(() => {
        diceEngine.roll(state.selectedDice);
        if (diceCube) diceCube.classList.remove('rolling');
      }, 400);
    });
  }

  renderFloatingWidgetVisibility() {
    const widget = document.getElementById('floating-players-widget');
    if (widget) {
      if (this.showFloatingPlayers) {
        widget.classList.remove('hidden');
      } else {
        widget.classList.add('hidden');
      }
    }
  }

  renderViews() {
    const viewAuth = document.getElementById('view-auth');
    const viewDashboard = document.getElementById('view-dashboard');
    const viewVTT = document.getElementById('view-vtt');

    if (!state.currentUser) {
      viewAuth?.classList.remove('hidden');
      viewDashboard?.classList.add('hidden');
      viewVTT?.classList.add('hidden');
    } else if (!state.activeLobby) {
      viewAuth?.classList.add('hidden');
      viewDashboard?.classList.remove('hidden');
      viewVTT?.classList.add('hidden');
    } else {
      viewAuth?.classList.add('hidden');
      viewDashboard?.classList.add('hidden');
      viewVTT?.classList.remove('hidden');

      this.renderLobbyHeader();
      this.renderPlayers();
      this.renderTurnBanner();
      this.renderRollLog();

      setTimeout(() => {
        boardEngine.init('tabletop-canvas-container');
      }, 50);
    }
  }

  renderNav() {
    const userNav = document.getElementById('user-nav-content');
    if (!userNav) return;

    if (state.currentUser) {
      userNav.innerHTML = `
        <div class="user-profile-badge" id="btn-change-profile" title="Trocar perfil">
          <div class="avatar-img">${state.currentUser.avatar}</div>
          <span style="font-weight: 600; font-size: 0.85rem;">${state.currentUser.username}</span>
          ${state.currentUser.isMaster ? '<span class="badge badge-master">👑 Mestre</span>' : ''}
        </div>
      `;
      document.getElementById('btn-change-profile')?.addEventListener('click', () => auth.logout());
    } else {
      userNav.innerHTML = `<span class="text-muted" style="font-size: 0.8rem;">Escolha seu nome para jogar</span>`;
    }
  }

  renderLobbyHeader() {
    const lobby = state.activeLobby;
    if (!lobby) return;

    const titleEl = document.getElementById('vtt-room-title');
    const codeEl = document.getElementById('vtt-room-code');

    if (titleEl) titleEl.textContent = lobby.name;
    if (codeEl) codeEl.textContent = lobby.code;

    const isMaster = state.currentUser?.isMaster || lobby.masterId === state.currentUser?.id;
    const masterControls = document.getElementById('master-board-controls');
    if (masterControls) {
      masterControls.style.display = isMaster ? 'block' : 'none';
    }
  }

  renderPlayers() {
    const listEl = document.getElementById('vtt-player-list');
    const countBadge = document.getElementById('online-count-badge');
    if (!listEl) return;

    if (countBadge) countBadge.textContent = `${state.players.length}`;

    const isCurrentUserMaster = state.currentUser?.isMaster || state.activeLobby?.masterId === state.currentUser?.id;

    listEl.innerHTML = state.players.map((p, index) => {
      const isActiveTurn = index === state.currentTurnIndex;
      return `
        <div class="player-card ${isActiveTurn ? 'active-turn' : ''}">
          <div class="player-info" style="gap: 8px;">
            <div class="avatar-img" style="width: 26px; height: 26px; font-size: 0.75rem;">${p.avatar}</div>
            <div class="player-details">
              <div class="player-name" style="font-size: 0.85rem;">
                ${p.username} ${p.isMaster ? '👑' : ''}
              </div>
            </div>
          </div>

          <div style="display: flex; gap: 4px; align-items: center;">
            <div class="turn-reorder-btns">
              <button class="turn-btn" title="Mover para cima" onclick="window.vttApp.reorderTurn(${index}, -1)">▲</button>
              <button class="turn-btn" title="Mover para baixo" onclick="window.vttApp.reorderTurn(${index}, 1)">▼</button>
            </div>
            ${isCurrentUserMaster && p.id !== state.currentUser.id ? `
              <button class="btn-icon" style="padding: 2px 4px; font-size: 0.65rem; color: #ef4444;" onclick="window.vttApp.kick('${p.id}')">✕</button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  renderTurnBanner() {
    const activePlayer = state.players[state.currentTurnIndex];
    const bannerText = document.getElementById('active-turn-display');

    if (activePlayer && bannerText) {
      const isMyTurn = state.currentUser && state.currentUser.id === activePlayer.id;
      bannerText.innerHTML = isMyTurn ? 
        `<span style="color: var(--accent-success);">🎯 SEU TURNO!</span>` :
        `Turno de <strong>${activePlayer.username}</strong> ${activePlayer.avatar}`;
    }
  }

  animateDiceDisplay(rollData) {
    const diceCube = document.getElementById('dice-cube');
    if (diceCube) {
      diceCube.textContent = rollData.result;
    }
  }

  updateDiceSelectionUI(diceType) {
    document.querySelectorAll('.dice-btn').forEach(btn => {
      if (btn.dataset.dice === diceType) {
        btn.classList.add('selected');
      } else {
        btn.classList.remove('selected');
      }
    });
  }

  renderRollLog() {
    const logFeed = document.getElementById('vtt-roll-log');
    if (!logFeed) return;

    logFeed.innerHTML = state.diceHistory.map(roll => `
      <div class="log-entry ${roll.isMaxRoll ? 'nat20' : roll.isMinRoll ? 'nat1' : ''}">
        <div class="log-meta">
          <span>${roll.avatar} <strong>${roll.player}</strong> (${roll.diceType.toUpperCase()})</span>
          <span>${roll.timestamp}</span>
        </div>
        <div class="log-result">
          Resultado: <strong>${roll.result}</strong>
          ${roll.isMaxRoll ? '🔥 MÁXIMO!' : roll.isMinRoll ? '💀 MÍNIMO!' : ''}
        </div>
      </div>
    `).join('');
  }
}

export const ui = new UIController();
