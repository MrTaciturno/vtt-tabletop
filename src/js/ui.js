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
  }

  init() {
    this.createToastContainer();
    this.bindEvents();

    // Subscribe to state updates
    state.subscribe((event, data) => this.handleStateChange(event, data));

    // Render initial state
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
    // Auth Forms Toggle
    document.getElementById('tab-login')?.addEventListener('click', () => this.switchAuthTab('login'));
    document.getElementById('tab-register')?.addEventListener('click', () => this.switchAuthTab('register'));

    // Auth Submission
    document.getElementById('form-login')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const user = e.target.username.value;
      const pass = e.target.password.value;
      try {
        await auth.login(user, pass);
        this.showToast('Login efetuado com sucesso!', 'success');
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    document.getElementById('form-register')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const user = e.target.username.value;
      const pass = e.target.password.value;
      const avatar = e.target.avatar?.value || '🎲';
      const isMaster = e.target.isMaster?.checked;
      try {
        await auth.register(user, pass, avatar, isMaster);
        this.showToast('Conta criada com sucesso!', 'success');
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    // Navigation & Settings Modal
    document.getElementById('btn-logout')?.addEventListener('click', () => {
      auth.logout();
      this.showToast('Você saiu da sua conta.');
    });

    document.getElementById('btn-settings')?.addEventListener('click', () => {
      this.openModal('settings-modal');
    });

    document.getElementById('close-settings')?.addEventListener('click', () => {
      this.closeModal('settings-modal');
    });

    document.getElementById('form-settings')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const username = e.target.username.value;
      const avatar = document.querySelector('.avatar-option.selected')?.dataset.avatar || '🎲';
      auth.updateProfile({ username, avatar });
      this.closeModal('settings-modal');
      this.showToast('Configurações salvas!', 'success');
    });

    // Lobby Actions
    document.getElementById('btn-create-lobby')?.addEventListener('click', () => {
      try {
        const lobby = lobbyManager.createLobby();
        this.showToast(`Lobby criado! Código: ${lobby.code}`, 'gold');
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    document.getElementById('btn-join-lobby')?.addEventListener('click', () => {
      const codeInput = document.getElementById('join-code-input')?.value;
      try {
        lobbyManager.joinLobby(codeInput);
        this.showToast(`Conectado ao lobby!`, 'success');
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    document.getElementById('btn-leave-lobby')?.addEventListener('click', () => {
      lobbyManager.leaveLobby();
      this.showToast('Você saiu do lobby.');
    });

    document.getElementById('btn-copy-code')?.addEventListener('click', () => {
      if (state.activeLobby) {
        navigator.clipboard.writeText(state.activeLobby.code);
        this.showToast('Código do lobby copiado!', 'info');
      }
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

    // Map Background Image Upload
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

    // Preset Maps
    document.querySelectorAll('.preset-map-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const mapUrl = e.currentTarget.dataset.mapUrl;
        boardEngine.setBackgroundImage(mapUrl, true);
        this.showToast('Mapa selecionado!', 'info');
      });
    });

    // Token Spawner
    document.getElementById('form-spawn-token')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = e.target.tokenName.value || 'Token';
      const avatar = e.target.tokenAvatar.value || '🛡️';
      const color = e.target.tokenColor.value || '#8b5cf6';

      boardEngine.addToken(name, avatar, color, state.currentUser?.id, true);
      this.showToast(`Token '${name}' adicionado ao tabuleiro!`, 'success');
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

    // Dice Roll Controls
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

    // Avatar selection grid in modal
    document.querySelectorAll('.avatar-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        document.querySelectorAll('.avatar-option').forEach(o => o.classList.remove('selected'));
        e.currentTarget.classList.add('selected');
      });
    });
  }

  switchAuthTab(tab) {
    const tabLogin = document.getElementById('tab-login');
    const tabReg = document.getElementById('tab-register');
    const formLogin = document.getElementById('form-login');
    const formReg = document.getElementById('form-register');

    if (tab === 'login') {
      tabLogin?.classList.add('active');
      tabReg?.classList.remove('active');
      formLogin?.classList.remove('hidden');
      formReg?.classList.add('hidden');
    } else {
      tabReg?.classList.add('active');
      tabLogin?.classList.remove('active');
      formReg?.classList.remove('hidden');
      formLogin?.classList.add('hidden');
    }
  }

  openModal(id) {
    document.getElementById(id)?.classList.add('active');
  }

  closeModal(id) {
    document.getElementById(id)?.classList.remove('active');
  }

  render() {
    this.renderNav();
    this.renderViews();
  }

  renderNav() {
    const userNav = document.getElementById('user-nav-content');
    if (!userNav) return;

    if (state.currentUser) {
      userNav.innerHTML = `
        <div class="user-profile-badge" id="btn-settings">
          <div class="avatar-img">${state.currentUser.avatar}</div>
          <span style="font-weight: 600;">${state.currentUser.username}</span>
          ${state.currentUser.isMaster ? '<span class="badge badge-master">👑 Mestre</span>' : '<span class="badge badge-player">Jogador</span>'}
        </div>
        <button class="btn btn-secondary btn-icon" id="btn-logout" title="Sair">
          🚪
        </button>
      `;
      document.getElementById('btn-logout')?.addEventListener('click', () => auth.logout());
      document.getElementById('btn-settings')?.addEventListener('click', () => this.openModal('settings-modal'));
    } else {
      userNav.innerHTML = `<span class="text-muted" style="font-size: 0.85rem;">Faça login para jogar</span>`;
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

      // Initialize or resize board engine
      setTimeout(() => {
        boardEngine.init('tabletop-canvas-container');
      }, 50);
    }
  }

  renderLobbyHeader() {
    const lobby = state.activeLobby;
    if (!lobby) return;

    const titleEl = document.getElementById('vtt-room-title');
    const codeEl = document.getElementById('vtt-room-code');

    if (titleEl) titleEl.textContent = lobby.name;
    if (codeEl) codeEl.textContent = lobby.code;

    // Show/Hide Master controls based on role
    const isMaster = state.currentUser?.isMaster || lobby.masterId === state.currentUser?.id;
    const masterControls = document.getElementById('master-board-controls');
    if (masterControls) {
      masterControls.style.display = isMaster ? 'block' : 'none';
    }
  }

  renderPlayers() {
    const listEl = document.getElementById('vtt-player-list');
    if (!listEl) return;

    const activePlayerId = state.players[state.currentTurnIndex]?.id;
    const isCurrentUserMaster = state.currentUser?.isMaster || state.activeLobby?.masterId === state.currentUser?.id;

    listEl.innerHTML = state.players.map((p, index) => {
      const isActiveTurn = index === state.currentTurnIndex;
      return `
        <div class="player-card ${isActiveTurn ? 'active-turn' : ''}">
          <div class="player-info">
            <div class="avatar-img">${p.avatar}</div>
            <div class="player-details">
              <div class="player-name">
                ${p.username}
                ${p.isMaster ? '<span title="Mestre">👑</span>' : ''}
              </div>
              <span class="text-muted" style="font-size: 0.75rem;">
                ${isActiveTurn ? '🟢 Em turno' : 'Aguardando'}
              </span>
            </div>
          </div>

          <div style="display: flex; gap: 6px; align-items: center;">
            ${isCurrentUserMaster && p.id !== state.currentUser.id ? `
              <button class="player-role-btn" onclick="window.vttApp.toggleMaster('${p.id}', ${!p.isMaster})">
                ${p.isMaster ? 'Revogar Mestre' : 'Tornar Mestre'}
              </button>
              <button class="btn-icon" style="padding: 2px 6px; font-size: 0.75rem; color: #ef4444;" onclick="window.vttApp.kick('${p.id}')">
                ❌
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  renderTurnBanner() {
    const activePlayer = state.players[state.currentTurnIndex];
    const bannerText = document.getElementById('active-turn-display');
    const nextBtn = document.getElementById('btn-next-turn');

    if (activePlayer && bannerText) {
      const isMyTurn = state.currentUser && state.currentUser.id === activePlayer.id;
      bannerText.innerHTML = isMyTurn ? 
        `<span style="color: var(--accent-success);">🎯 SEU TURNO!</span> Mova seu token ou role os dados.` :
        `Turno de <strong>${activePlayer.username}</strong> ${activePlayer.avatar}`;
    }

    const isMasterOrTurn = state.currentUser?.isMaster || state.currentUser?.id === activePlayer?.id;
    if (nextBtn) {
      nextBtn.style.display = isMasterOrTurn ? 'inline-flex' : 'none';
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
      <div class="log-entry ${roll.isNat20 ? 'nat20' : roll.isNat1 ? 'nat1' : ''}">
        <div class="log-meta">
          <span>${roll.avatar} <strong>${roll.player}</strong> (${roll.diceType.toUpperCase()})</span>
          <span>${roll.timestamp}</span>
        </div>
        <div class="log-result">
          Resultado: <strong>${roll.result}</strong>
          ${roll.isNat20 ? '🔥 ACERTO CRÍTICO! (20)' : roll.isNat1 ? '💀 FALHA CRÍTICA! (1)' : ''}
        </div>
      </div>
    `).join('');
  }
}

export const ui = new UIController();
