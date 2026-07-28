import { state } from './state.js';
import { auth } from './auth.js';
import { lobbyManager } from './lobby.js';
import { diceEngine } from './dice.js';
import { boardEngine } from './board.js';
import { defaultPoiseData } from './defaultPoise.js';

/**
 * UI Renderer & DOM Controller
 */

class UIController {
  constructor() {
    this.toastContainer = null;
    this.showFloatingPlayers = true;
    this.tokenNameCounters = {};
    this.activeInlineEditData = null;
  }

  init() {
    this.createToastContainer();
    this.bindEvents();

    state.subscribe((event, data) => this.handleStateChange(event, data));

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
      this.updateSheetSelectOptions();
    } else if (event === 'LOBBY_CHANGED') {
      this.renderViews();
      this.renderLobbyHeader();
      this.updateSheetSelectOptions();
    } else if (event === 'PLAYERS_CHANGED' || event === 'TURN_CHANGED') {
      this.renderPlayers();
      this.renderTurnBanner();
      this.updateSheetSelectOptions();
    } else if (event === 'SHEETS_CHANGED') {
      this.updateSheetSelectOptions();
      this.renderSheetFieldsInspector();
    } else if (event === 'FIELD_CLICKED') {
      this.showTabletopInlineEditor(data);
    } else if (event === 'TOKEN_SELECTED') {
      this.updateTokenEditUI(data);
    } else if (event === 'DICE_ROLLED') {
      this.renderRollLog();
      this.animateDiceDisplay(data);
      this.showGlobalDiceAnnouncement(data);
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

        // If switching away from drawing tab, reset drawing tool to 'select' (Pan/Select)
        if (targetTab !== 'draw') {
          boardEngine.setDrawingTool('select');
          document.querySelectorAll('.draw-tool-btn').forEach(b => {
            if (b.dataset.tool === 'select') b.classList.add('active');
            else b.classList.remove('active');
          });
        }
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

    // Map Background Image Upload with Automatic Optimization for WebSocket Sync
    document.getElementById('map-file-input')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.showToast('Processando mapa...', 'info');
        this.compressMapImage(file, (optimizedDataUrl) => {
          boardEngine.setBackgroundImage(optimizedDataUrl, true);
          this.showToast('Mapa enviado para todos os jogadores!', 'success');
        });
      }
    });

    document.getElementById('btn-remove-map')?.addEventListener('click', () => {
      boardEngine.setBackgroundImage(null, true);
      this.showToast('Mapa de fundo removido.', 'info');
    });

    // Character Sheet Controls (.poise & Image)
    document.getElementById('btn-load-default-poise')?.addEventListener('click', () => {
      const slotId = Number(document.getElementById('sheet-slot-select')?.value) || 0;
      const currentUser = state.currentUser || { id: 'anon', username: 'Jogador' };

      if (!defaultPoiseData) {
        this.showToast('Erro ao carregar modelo de planilha.', 'error');
        return;
      }

      const sheetData = {
        slotId,
        ownerId: currentUser.id,
        ownerName: currentUser.username,
        poiseData: defaultPoiseData,
        fieldValues: {},
        updatedAt: Date.now()
      };

      state.updateCharacterSheet(slotId, sheetData);
      network.broadcast('SHEET_UPDATED', sheetData);
      this.showToast(`Planilha Padrão 1.5 carregada na Vaga ${slotId + 1}!`, 'success');
      this.updateSheetSelectOptions();
      this.renderSheetFieldsInspector();
    });

    document.getElementById('poise-file-input')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      const slotId = Number(document.getElementById('sheet-slot-select')?.value) || 0;
      const currentUser = state.currentUser || { id: 'anon', username: 'Jogador' };

      if (!file) return;

      if (file.name.endsWith('.poise') || file.name.endsWith('.json')) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const poiseData = JSON.parse(evt.target.result);
            const sheetData = {
              slotId,
              ownerId: currentUser.id,
              ownerName: currentUser.username,
              poiseData,
              fieldValues: {},
              updatedAt: Date.now()
            };

            state.updateCharacterSheet(slotId, sheetData);
            network.broadcast('SHEET_UPDATED', sheetData);
            this.showToast(`Planilha '${file.name}' carregada na Vaga ${slotId + 1}!`, 'success');
            this.updateSheetSelectOptions();
            this.renderSheetFieldsInspector();
          } catch (err) {
            this.showToast('Erro ao ler arquivo .poise: formato JSON inválido.', 'error');
          }
        };
        reader.readAsText(file);
      } else {
        // Image File Fallback
        this.showToast('Processando imagem da planilha...', 'info');
        this.compressMapImage(file, (optimizedDataUrl) => {
          try {
            boardEngine.setSheetImage(slotId, optimizedDataUrl, true);
            this.showToast('Planilha atualizada e exibida na mesa!', 'success');
            this.updateSheetSelectOptions();
          } catch (err) {
            this.showToast(err.message, 'error');
          }
        });
      }
    });

    document.getElementById('sheet-slot-select')?.addEventListener('change', () => {
      this.renderSheetFieldsInspector();
    });

    // Tabletop Inline Editor Handlers
    const saveInlineEdit = () => {
      if (this.activeInlineEditData) {
        const { slotId, field } = this.activeInlineEditData;
        const val = document.getElementById('inline-field-input')?.value || '';
        state.updateSheetFieldValue(slotId, field.id, val, true);
        
        const sheet = state.characterSheets[slotId];
        if (sheet) network.broadcast('SHEET_UPDATED', sheet);

        this.activeInlineEditData = null;
        document.getElementById('tabletop-inline-editor')?.classList.add('hidden');
      }
    };

    document.getElementById('inline-field-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        saveInlineEdit();
      } else if (e.key === 'Escape') {
        this.activeInlineEditData = null;
        document.getElementById('tabletop-inline-editor')?.classList.add('hidden');
      }
    });

    document.getElementById('inline-field-input')?.addEventListener('blur', () => {
      saveInlineEdit();
    });

    document.getElementById('btn-focus-sheet')?.addEventListener('click', () => {
      const slotId = document.getElementById('sheet-slot-select')?.value || 0;
      boardEngine.focusSlot(slotId);
    });

    document.getElementById('btn-focus-map')?.addEventListener('click', () => {
      boardEngine.centerView();
    });

    // Token Spawner
    document.getElementById('form-spawn-token')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const rawName = e.target.tokenName?.value;
      const imageUrl = e.target.tokenImg?.value || null;
      const avatar = e.target.tokenAvatar?.value || '🛡️';
      const color = e.target.tokenColor?.value || '#8b5cf6';
      const size = Number(e.target.tokenSize?.value) || 1;

      const finalName = this.getAutoTokenName(rawName, imageUrl, avatar);

      boardEngine.addToken(finalName, avatar, color, state.currentUser?.id, size, imageUrl, true);
      this.showToast(`Token '${finalName}' (${size}x${size}) adicionado!`, 'success');
      e.target.reset();
    });

    // Quick Spawn Presets
    document.querySelectorAll('.quick-token-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const rawName = e.currentTarget.dataset.name;
        const avatar = e.currentTarget.dataset.avatar || '🎲';
        const color = e.currentTarget.dataset.color || '#8b5cf6';
        const imageUrl = e.currentTarget.dataset.img || null;
        const size = Number(e.currentTarget.dataset.size) || 1;

        const finalName = this.getAutoTokenName(rawName, imageUrl, avatar);

        boardEngine.addToken(finalName, avatar, color, state.currentUser?.id, size, imageUrl, true);
        this.showToast(`Token '${finalName}' (${size}x${size}) adicionado!`, 'success');
      });
    });

    // Form Edit Selected Token
    document.getElementById('form-edit-token')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const tokenId = boardEngine.selectedTokenId;
      if (!tokenId) return;

      const name = document.getElementById('edit-token-name')?.value;
      const avatar = document.getElementById('edit-token-avatar')?.value;
      const color = document.getElementById('edit-token-color')?.value;
      const size = Number(document.getElementById('edit-token-size')?.value) || 1;

      boardEngine.updateToken(tokenId, { name, avatar, color, size }, true);
      this.showToast(`Token '${name}' (${size}x${size}) atualizado!`, 'success');
    });

    document.getElementById('btn-delete-token')?.addEventListener('click', () => {
      const tokenId = boardEngine.selectedTokenId;
      if (!tokenId) return;

      boardEngine.deleteToken(tokenId, true);
      this.showToast(`Token removido.`, 'info');
    });

    // Drawing Tool Selector Buttons
    document.querySelectorAll('.draw-tool-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.draw-tool-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');

        const tool = e.currentTarget.dataset.tool;
        boardEngine.setDrawingTool(tool);
      });
    });

    // Color Picker & Presets
    const drawColorPicker = document.getElementById('draw-color-picker');
    if (drawColorPicker) {
      drawColorPicker.addEventListener('input', (e) => {
        boardEngine.setDrawingColor(e.target.value);
      });
    }

    document.querySelectorAll('.color-preset-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const color = e.currentTarget.dataset.color;
        if (drawColorPicker) drawColorPicker.value = color;
        boardEngine.setDrawingColor(color);
      });
    });

    // Stroke Width
    document.getElementById('draw-width-select')?.addEventListener('change', (e) => {
      boardEngine.setDrawingWidth(Number(e.target.value));
    });

    // Fill Checkbox
    document.getElementById('draw-fill-checkbox')?.addEventListener('change', (e) => {
      boardEngine.setDrawingFill(e.target.checked);
    });

    // Clear All Drawings
    document.getElementById('btn-clear-drawings')?.addEventListener('click', () => {
      if (confirm('Tem certeza que deseja apagar todos os desenhos do tabuleiro?')) {
        boardEngine.clearDrawings(true);
        this.showToast('Desenhos apagados.', 'info');
      }
    });

    // Instant Dice Roll Controls (d4, d6, d8, d10, d12, d20, d100)
    document.querySelectorAll('.dice-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const diceType = e.currentTarget.dataset.dice;
        this.updateDiceSelectionUI(diceType);

        const modVal = parseInt(document.getElementById('dice-modifier-input')?.value, 10) || 0;

        const diceCube = document.getElementById('dice-cube');
        if (diceCube) {
          diceCube.classList.add('rolling');
          setTimeout(() => diceCube.classList.remove('rolling'), 400);
        }

        diceEngine.roll(diceType, modVal);
      });
    });
  }

  // Compress map image to max 1000px dimension JPEG (~50KB) so it transmits instantly over WebSockets
  compressMapImage(file, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 1000;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.65);
        callback(compressedDataUrl);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  updateSheetSelectOptions() {
    const selectEl = document.getElementById('sheet-slot-select');
    if (!selectEl) return;

    const currentUserId = state.currentUser?.id;
    const sheets = state.characterSheets || {};
    const slots = boardEngine.getSlots();

    // Determine current user's default assigned slot
    let mySlotId = Object.keys(sheets).find(sId => sheets[sId]?.ownerId === currentUserId);

    if (mySlotId === undefined) {
      // Find slot corresponding to player index or first empty slot
      const userIndex = state.players.findIndex(p => p.id === currentUserId);
      if (userIndex >= 0 && userIndex < slots.length && !sheets[userIndex]) {
        mySlotId = userIndex;
      } else {
        const emptySlot = slots.find(s => !sheets[s.id]);
        mySlotId = emptySlot ? emptySlot.id : 0;
      }
    } else {
      mySlotId = Number(mySlotId);
    }

    const previousVal = selectEl.value;

    selectEl.innerHTML = slots.map(s => {
      const sheet = sheets[s.id];
      let statusTag = ' (Vaga Livre)';
      if (sheet) {
        if (sheet.ownerId === currentUserId) {
          statusTag = ` — 🌟 Sua Planilha (${sheet.ownerName})`;
        } else {
          statusTag = ` — 👤 ${sheet.ownerName}`;
        }
      }
      return `<option value="${s.id}">${s.label}${statusTag}</option>`;
    }).join('');

    if (previousVal !== '' && slots.some(s => s.id === Number(previousVal))) {
      selectEl.value = previousVal;
    } else {
      selectEl.value = mySlotId;
    }
  }

  getAutoTokenName(inputName, imageUrl, avatar) {
    if (inputName && inputName.trim()) {
      return inputName.trim();
    }

    let baseName = 'Token';
    if (imageUrl) {
      const filename = imageUrl.split('/').pop();
      baseName = filename.replace(/\.[^/.]+$/, "");
    } else if (avatar) {
      baseName = avatar;
    }

    if (!this.tokenNameCounters) this.tokenNameCounters = {};
    this.tokenNameCounters[baseName] = (this.tokenNameCounters[baseName] || 0) + 1;

    return `${baseName}-${this.tokenNameCounters[baseName]}`;
  }

  updateTokenEditUI(token) {
    const editPanel = document.getElementById('token-edit-panel');
    if (!editPanel) return;

    if (!token) {
      editPanel.classList.add('hidden');
      return;
    }

    editPanel.classList.remove('hidden');

    const nameInput = document.getElementById('edit-token-name');
    const avatarSelect = document.getElementById('edit-token-avatar');
    const colorInput = document.getElementById('edit-token-color');
    const sizeSelect = document.getElementById('edit-token-size');

    if (nameInput) nameInput.value = token.name || '';
    if (avatarSelect) avatarSelect.value = token.avatar || '⚔️';
    if (colorInput) colorInput.value = token.color || '#8b5cf6';
    if (sizeSelect) sizeSelect.value = token.size || 1;
  }

  renderFloatingWidgetVisibility() {
    const widget = document.getElementById('floating-players-widget');
    if (widget) {
      if (this.showFloatingPlayers) {
        widget.style.display = 'flex';
      } else {
        widget.style.display = 'none';
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
      this.renderFloatingWidgetVisibility();

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
              <button type="button" class="turn-btn" title="Mover para cima" onclick="window.vttApp.reorderTurn(${index}, -1)">▲</button>
              <button type="button" class="turn-btn" title="Mover para baixo" onclick="window.vttApp.reorderTurn(${index}, 1)">▼</button>
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
    if (diceCube && rollData) {
      const val = rollData.totalResult !== undefined ? rollData.totalResult : rollData.result;
      diceCube.textContent = val;
    }
  }

  showGlobalDiceAnnouncement(data) {
    const banner = document.getElementById('global-dice-announcement');
    const playerEl = document.getElementById('announcement-player');
    const resultEl = document.getElementById('announcement-result');
    const detailsEl = document.getElementById('announcement-details');

    if (!banner || !playerEl || !resultEl || !detailsEl || !data) return;

    const username = data.player?.username || data.player || 'Jogador';
    const avatar = data.player?.avatar || data.avatar || '🎲';

    playerEl.innerHTML = `${avatar} <strong>${username}</strong> rolou:`;
    
    const mod = Number(data.modifier) || 0;
    const modStr = mod > 0 ? ` + ${mod}` : (mod < 0 ? ` - ${Math.abs(mod)}` : '');
    const raw = data.rawResult !== undefined ? data.rawResult : data.result;
    const total = data.totalResult !== undefined ? data.totalResult : data.result;

    resultEl.textContent = `${total}`;
    detailsEl.textContent = `Dado: ${data.diceType ? data.diceType.toUpperCase() : 'D20'}${modStr} (Resultado bruto: ${raw})`;

    banner.classList.remove('hidden');
    if (this.announcementTimeout) clearTimeout(this.announcementTimeout);
    this.announcementTimeout = setTimeout(() => {
      banner.classList.add('hidden');
    }, 4000);
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

  showTabletopInlineEditor(data) {
    const editor = document.getElementById('tabletop-inline-editor');
    const input = document.getElementById('inline-field-input');
    if (!editor || !input || !data || !boardEngine.container) return;

    this.activeInlineEditData = data;

    const rect = boardEngine.container.getBoundingClientRect();
    const fieldScreenPos = boardEngine.worldToScreen(data.fieldPxX, data.fieldPxY);
    
    const fieldWidthScreen = data.fieldPxW * boardEngine.scale;
    const fieldHeightScreen = Math.max(26, data.fieldPxH * boardEngine.scale);

    editor.style.left = `${rect.left + fieldScreenPos.x}px`;
    editor.style.top = `${rect.top + fieldScreenPos.y}px`;
    editor.style.width = `${Math.max(120, fieldWidthScreen)}px`;

    input.value = data.currentVal || '';
    editor.classList.remove('hidden');
    input.focus();
    input.select();
  }

  renderSheetFieldsInspector() {
    const container = document.getElementById('sheet-fields-container');
    const list = document.getElementById('sheet-fields-list');
    const slotId = Number(document.getElementById('sheet-slot-select')?.value) || 0;

    if (!container || !list) return;

    const sheet = state.characterSheets[slotId];
    if (!sheet || !sheet.poiseData || !sheet.poiseData.fields) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');

    list.innerHTML = sheet.poiseData.fields.map(f => {
      const val = (sheet.fieldValues && sheet.fieldValues[f.id] !== undefined) ? sheet.fieldValues[f.id] : (f.value || '');
      return `
        <div class="form-group" style="margin-bottom: 4px;">
          <label style="font-size: 0.7rem; color: #cbd5e1; margin-bottom: 1px;">${f.name || f.id}</label>
          <input type="text" class="form-control sidebar-field-input" data-slot="${slotId}" data-field="${f.id}" value="${val}" style="font-size: 0.75rem; padding: 4px 6px;" />
        </div>
      `;
    }).join('');

    list.querySelectorAll('.sidebar-field-input').forEach(inp => {
      inp.addEventListener('change', (e) => {
        const sId = Number(e.target.dataset.slot);
        const fId = e.target.dataset.field;
        const newVal = e.target.value;

        state.updateSheetFieldValue(sId, fId, newVal, true);
        const updatedSheet = state.characterSheets[sId];
        if (updatedSheet) network.broadcast('SHEET_UPDATED', updatedSheet);
      });
    });
  }

  renderRollLog() {
    const logFeed = document.getElementById('vtt-roll-log');
    if (!logFeed) return;

    logFeed.innerHTML = state.diceHistory.slice().reverse().map(roll => {
      const username = roll.player?.username || roll.player || 'Jogador';
      const avatar = roll.player?.avatar || roll.avatar || '🎲';
      const mod = Number(roll.modifier) || 0;
      const modStr = mod > 0 ? `+${mod}` : (mod < 0 ? `${mod}` : '');
      const raw = roll.rawResult !== undefined ? roll.rawResult : roll.result;
      const total = roll.totalResult !== undefined ? roll.totalResult : roll.result;

      return `
        <div class="log-entry ${roll.isMaxRoll ? 'nat20' : roll.isMinRoll ? 'nat1' : ''}">
          <div class="log-meta">
            <span>${avatar} <strong>${username}</strong> (${roll.diceType ? roll.diceType.toUpperCase() : 'D20'}${modStr ? ' ' + modStr : ''})</span>
            <span>${roll.timestamp}</span>
          </div>
          <div class="log-result">
            Resultado: <strong>${total}</strong> ${modStr ? `<small style="font-weight:normal; opacity:0.8;">(${raw} ${modStr})</small>` : ''}
            ${roll.isMaxRoll ? '🔥 MÁXIMO!' : roll.isMinRoll ? '💀 MÍNIMO!' : ''}
          </div>
        </div>
      `;
    }).join('');
  }
}

export const ui = new UIController();
