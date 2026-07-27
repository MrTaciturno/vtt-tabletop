import { state } from './state.js';
import { network } from './network.js';
import { ui } from './ui.js';

/**
 * Interactive Tabletop Board Engine (Pan, Zoom, Expanded Grid & Character Sheets)
 */

class BoardEngine {
  constructor() {
    this.container = null;
    this.canvas = null;
    this.ctx = null;
    
    // Minimum Map Dimensions (17 cols x 22 rows)
    this.MIN_MAP_COLS = 17;
    this.MIN_MAP_ROWS = 22;

    // Surrounding Outer Grid Margins
    this.outerLeft = 17;
    this.outerRight = 17;
    this.outerTop = 22;
    this.outerBottom = 22;

    // Central Map Configured Dimensions
    this.cols = 20; // Configured map cols
    this.rows = 15; // Configured map rows

    this.cellSize = 50; // Base cell size in pixels
    this.bgImage = null;
    this.bgImageUrl = null;

    // Loaded Sheet Images Cache { [slotIndex]: HTMLImageElement }
    this.sheetImageCache = {};

    // Viewport Transform (Pan & Zoom)
    this.scale = 0.8;
    this.minScale = 0.2;
    this.maxScale = 3.0;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.startPanX = 0;
    this.startPanY = 0;

    // Token Management
    this.tokens = []; // Array of { id, name, avatar, color, ownerId, x, y }
    this.draggedToken = null;

    // Bindings
    this.onResize = this.resize.bind(this);
  }

  // Active Map Dimensions (enforcing minimum 17x22)
  get mapCols() {
    return Math.max(this.MIN_MAP_COLS, this.cols || 17);
  }

  get mapRows() {
    return Math.max(this.MIN_MAP_ROWS, this.rows || 22);
  }

  // Total Grid Dimensions (Outer Margins + Map)
  get mapOriginX() {
    return this.outerLeft;
  }

  get mapOriginY() {
    return this.outerTop;
  }

  get totalCols() {
    return this.outerLeft + this.mapCols + this.outerRight;
  }

  get totalRows() {
    return this.outerTop + this.mapRows + this.outerBottom;
  }

  // Defined 17x22 Character Sheet Slots around the Central Map
  getSlots() {
    const mapX = this.mapOriginX;
    const mapCols = this.mapCols;
    const centeredSlot5X = mapX + Math.floor((mapCols - 17) / 2);

    return [
      { id: 0, label: 'Planilha 1 (Esq. Sup)', x: 0, y: 0, cols: 17, rows: 22 },
      { id: 1, label: 'Planilha 2 (Esq. Inf)', x: 0, y: 22, cols: 17, rows: 22 },
      { id: 2, label: 'Planilha 3 (Dir. Sup)', x: mapX + mapCols, y: 0, cols: 17, rows: 22 },
      { id: 3, label: 'Planilha 4 (Dir. Inf)', x: mapX + mapCols, y: 22, cols: 17, rows: 22 },
      { id: 4, label: 'Planilha 5 (Topo Central)', x: centeredSlot5X, y: 0, cols: 17, rows: 22 }
    ];
  }

  init(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    this.container.innerHTML = ''; // Clear container

    // Create Canvas
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tabletop-canvas';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.resize();
    this.centerView();
    this.bindEvents();

    state.subscribe((event) => {
      if (event === 'SHEETS_CHANGED') {
        this.preloadSheetImages();
        this.render();
      }
    });

    this.render();
  }

  preloadSheetImages() {
    const sheets = state.characterSheets || {};
    Object.keys(sheets).forEach(slotId => {
      const sheet = sheets[slotId];
      if (sheet && sheet.imageUrl) {
        if (!this.sheetImageCache[slotId] || this.sheetImageCache[slotId].src !== sheet.imageUrl) {
          const img = new Image();
          img.onload = () => this.render();
          img.src = sheet.imageUrl;
          this.sheetImageCache[slotId] = img;
        }
      } else {
        delete this.sheetImageCache[slotId];
      }
    });
  }

  resize() {
    if (!this.container || !this.canvas) return;
    this.canvas.width = this.container.clientWidth;
    this.canvas.height = this.container.clientHeight;
    this.render();
  }

  centerView() {
    if (!this.canvas) return;
    const mapCenterX = (this.mapOriginX + this.mapCols / 2) * this.cellSize;
    const mapCenterY = (this.mapOriginY + this.mapRows / 2) * this.cellSize;
    this.panX = this.canvas.width / 2 - mapCenterX * this.scale;
    this.panY = this.canvas.height / 2 - mapCenterY * this.scale;
    this.render();
  }

  focusSlot(slotId) {
    const slot = this.getSlots().find(s => s.id === Number(slotId));
    if (!slot || !this.canvas) return;

    const slotCenterX = (slot.x + slot.cols / 2) * this.cellSize;
    const slotCenterY = (slot.y + slot.rows / 2) * this.cellSize;
    this.panX = this.canvas.width / 2 - slotCenterX * this.scale;
    this.panY = this.canvas.height / 2 - slotCenterY * this.scale;
    this.render();
  }

  setGridSize(cols, rows, broadcast = true) {
    this.cols = Math.max(5, Math.min(60, cols));
    this.rows = Math.max(5, Math.min(60, rows));

    // Ensure tokens remain inside total bounds
    this.tokens.forEach(t => {
      if (t.x >= this.totalCols) t.x = this.totalCols - 1;
      if (t.y >= this.totalRows) t.y = this.totalRows - 1;
    });

    this.render();

    if (broadcast) {
      network.broadcast('BOARD_CONFIG_CHANGED', {
        cols: this.cols,
        rows: this.rows,
        bgImageUrl: this.bgImageUrl
      });
    }
  }

  setBackgroundImage(src, broadcast = true) {
    if (!src) {
      this.bgImage = null;
      this.bgImageUrl = null;
      this.render();
      if (broadcast) {
        network.broadcast('BOARD_CONFIG_CHANGED', {
          cols: this.cols,
          rows: this.rows,
          bgImageUrl: null
        });
      }
      return;
    }

    const img = new Image();
    img.onload = () => {
      this.bgImage = img;
      this.bgImageUrl = src;
      this.render();
    };
    img.src = src;

    if (broadcast) {
      network.broadcast('BOARD_CONFIG_CHANGED', {
        cols: this.cols,
        rows: this.rows,
        bgImageUrl: src
      });
    }
  }

  setSheetImage(slotId, imageUrl, broadcast = true) {
    const currentUser = state.currentUser || { id: 'anon', username: 'Jogador' };
    const isMaster = currentUser.isMaster || state.activeLobby?.masterId === currentUser.id;
    const sId = Number(slotId);

    const existing = state.characterSheets[sId];
    if (existing && existing.ownerId && existing.ownerId !== currentUser.id && !isMaster) {
      throw new Error(`Esta vaga de planilha já pertence a ${existing.ownerName}. Escolha outra vaga no menu!`);
    }

    const sheetData = {
      slotId: sId,
      ownerId: currentUser.id,
      ownerName: currentUser.username,
      imageUrl,
      updatedAt: Date.now()
    };

    state.updateCharacterSheet(sId, sheetData);

    if (broadcast) {
      network.broadcast('SHEET_UPDATED', sheetData);
    }
  }

  addToken(name, avatar, color = '#8b5cf6', ownerId = null, broadcast = true) {
    const tokenId = 'tok_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    
    // Spawn near center of central map
    const x = this.mapOriginX + Math.floor(this.mapCols / 2);
    const y = this.mapOriginY + Math.floor(this.mapRows / 2);

    const token = {
      id: tokenId,
      name,
      avatar,
      color,
      ownerId: ownerId || state.currentUser?.id,
      x,
      y
    };

    this.tokens.push(token);
    this.render();

    if (broadcast) {
      network.broadcast('TOKEN_SPAWNED', token);
    }
    return token;
  }

  moveToken(tokenId, x, y, broadcast = true) {
    const token = this.tokens.find(t => t.id === tokenId);
    if (token) {
      token.x = Math.max(0, Math.min(this.totalCols - 1, x));
      token.y = Math.max(0, Math.min(this.totalRows - 1, y));
      this.render();

      if (broadcast) {
        network.broadcast('TOKEN_MOVED', { id: tokenId, x: token.x, y: token.y });
      }
    }
  }

  deleteToken(tokenId, broadcast = true) {
    this.tokens = this.tokens.filter(t => t.id !== tokenId);
    this.render();

    if (broadcast) {
      network.broadcast('TOKEN_DELETED', { id: tokenId });
    }
  }

  bindEvents() {
    window.addEventListener('resize', this.onResize);

    const canvas = this.canvas;

    // Zoom on Mouse Wheel
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * zoomFactor));
      
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      this.panX = mouseX - (mouseX - this.panX) * (newScale / this.scale);
      this.panY = mouseY - (mouseY - this.panY) * (newScale / this.scale);
      this.scale = newScale;

      this.render();
    }, { passive: false });

    // Mouse Down (Pan or Drag Token)
    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const gridPos = this.screenToGrid(mouseX, mouseY);
      const clickedToken = this.tokens.slice().reverse().find(t => t.x === gridPos.x && t.y === gridPos.y);

      const isMaster = state.currentUser?.isMaster || state.activeLobby?.masterId === state.currentUser?.id;
      const canDrag = clickedToken && (isMaster || clickedToken.ownerId === state.currentUser?.id);

      if (canDrag) {
        this.draggedToken = clickedToken;
      } else {
        this.isPanning = true;
        this.startPanX = e.clientX - this.panX;
        this.startPanY = e.clientY - this.panY;
      }
    });

    // Mouse Move
    canvas.addEventListener('mousemove', (e) => {
      if (this.draggedToken) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const gridPos = this.screenToGrid(mouseX, mouseY);

        if (gridPos.x !== this.draggedToken.x || gridPos.y !== this.draggedToken.y) {
          this.moveToken(this.draggedToken.id, gridPos.x, gridPos.y, true);
        }
      } else if (this.isPanning) {
        this.panX = e.clientX - this.startPanX;
        this.panY = e.clientY - this.startPanY;
        this.render();
      }
    });

    // Mouse Up
    window.addEventListener('mouseup', () => {
      this.isPanning = false;
      this.draggedToken = null;
    });
  }

  screenToGrid(screenX, screenY) {
    const boardX = (screenX - this.panX) / this.scale;
    const boardY = (screenY - this.panY) / this.scale;
    return {
      x: Math.floor(boardX / this.cellSize),
      y: Math.floor(boardY / this.cellSize)
    };
  }

  // RENDER ENGINE
  render() {
    if (!this.ctx || !this.canvas) return;

    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Clear background
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.scale, this.scale);

    const totalW = this.totalCols * this.cellSize;
    const totalH = this.totalRows * this.cellSize;

    const mapX = this.mapOriginX * this.cellSize;
    const mapY = this.mapOriginY * this.cellSize;
    const mapW = this.mapCols * this.cellSize;
    const mapH = this.mapRows * this.cellSize;

    // 0. Tabletop Outer Felt / Wood Background
    ctx.fillStyle = '#0b111e';
    ctx.fillRect(0, 0, totalW, totalH);

    // 1. Draw Central Map Background Area
    ctx.fillStyle = '#151d2a';
    ctx.fillRect(mapX, mapY, mapW, mapH);

    if (this.bgImage) {
      // Anchored at top-left corner of central map grid with exact cell dimensions configured by master (no stretch)
      const drawImgCols = Math.min(this.mapCols, Math.max(1, this.cols || 17));
      const drawImgRows = Math.min(this.mapRows, Math.max(1, this.rows || 22));
      const imgW = drawImgCols * this.cellSize;
      const imgH = drawImgRows * this.cellSize;

      ctx.drawImage(this.bgImage, mapX, mapY, imgW, imgH);

      // Boundary outline for configured map size
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.9)';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(mapX, mapY, imgW, imgH);
    }

    // 2. Draw Character Sheet Slot Rectangles (17x22 each)
    const slots = this.getSlots();
    const sheets = state.characterSheets || {};

    slots.forEach(slot => {
      const slotPixelX = slot.x * this.cellSize;
      const slotPixelY = slot.y * this.cellSize;
      const slotPixelW = slot.cols * this.cellSize;
      const slotPixelH = slot.rows * this.cellSize;

      const sheet = sheets[slot.id];
      const cachedImg = this.sheetImageCache[slot.id];

      if (cachedImg) {
        // Background for slot
        ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
        ctx.fillRect(slotPixelX, slotPixelY, slotPixelW, slotPixelH);

        // Aspect-ratio contain fit inside 17x22 rectangle to prevent sheet stretch
        const imgRatio = cachedImg.width / cachedImg.height;
        const slotRatio = slotPixelW / slotPixelH;
        let drawW = slotPixelW;
        let drawH = slotPixelH;
        let drawX = slotPixelX;
        let drawY = slotPixelY;

        if (imgRatio > slotRatio) {
          drawH = slotPixelW / imgRatio;
          drawY = slotPixelY + (slotPixelH - drawH) / 2;
        } else {
          drawW = slotPixelH * imgRatio;
          drawX = slotPixelX + (slotPixelW - drawW) / 2;
        }

        ctx.drawImage(cachedImg, drawX, drawY, drawW, drawH);
      } else {
        // Draw empty slot background placeholder
        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        ctx.fillRect(slotPixelX, slotPixelY, slotPixelW, slotPixelH);

        // Dashed border for empty slot
        ctx.strokeStyle = 'rgba(234, 179, 8, 0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(slotPixelX + 4, slotPixelY + 4, slotPixelW - 8, slotPixelH - 8);
        ctx.setLineDash([]);

        // Slot Label Text
        ctx.font = 'bold 16px sans-serif';
        ctx.fillStyle = 'rgba(234, 179, 8, 0.8)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`📋 ${slot.label}`, slotPixelX + slotPixelW / 2, slotPixelY + slotPixelH / 2 - 10);

        ctx.font = '12px sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fillText('Retângulo 17x22 (Vaga de Planilha)', slotPixelX + slotPixelW / 2, slotPixelY + slotPixelH / 2 + 15);
      }

      // Slot Outer Border Glow
      ctx.strokeStyle = sheet ? 'rgba(34, 197, 94, 0.8)' : 'rgba(234, 179, 8, 0.6)';
      ctx.lineWidth = 3;
      ctx.strokeRect(slotPixelX, slotPixelY, slotPixelW, slotPixelH);

      // Header Tag for Owner/Slot Name
      ctx.fillStyle = sheet ? 'rgba(34, 197, 94, 0.9)' : 'rgba(234, 179, 8, 0.9)';
      ctx.fillRect(slotPixelX, slotPixelY, slotPixelW, 26);

      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const titleText = sheet ? `📋 Planilha: ${sheet.ownerName}` : `📋 ${slot.label} (17x22)`;
      ctx.fillText(titleText, slotPixelX + 10, slotPixelY + 13);
    });

    // 3. Draw Complete Square Grid Overlay (Entire Board)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;

    for (let c = 0; c <= this.totalCols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * this.cellSize, 0);
      ctx.lineTo(c * this.cellSize, totalH);
      ctx.stroke();
    }

    for (let r = 0; r <= this.totalRows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * this.cellSize);
      ctx.lineTo(totalW, r * this.cellSize);
      ctx.stroke();
    }

    // Central Map Border Glow
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.8)';
    ctx.lineWidth = 4;
    ctx.strokeRect(mapX, mapY, mapW, mapH);

    // Central Map Header Label Tag
    ctx.fillStyle = 'rgba(139, 92, 246, 0.9)';
    ctx.fillRect(mapX, mapY - 26 < 0 ? mapY : mapY - 26, 180, 26);
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`🗺️ Mapa Central (${this.mapCols}x${this.mapRows})`, mapX + 90, (mapY - 26 < 0 ? mapY : mapY - 26) + 13);

    // 4. Draw Tokens
    this.tokens.forEach(t => {
      const centerX = t.x * this.cellSize + this.cellSize / 2;
      const centerY = t.y * this.cellSize + this.cellSize / 2;
      const radius = (this.cellSize / 2) * 0.8;

      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = 10;

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fillStyle = t.color || '#8b5cf6';
      ctx.fill();

      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      ctx.shadowColor = 'transparent';

      ctx.font = `${radius * 1.1}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.avatar || '🎲', centerX, centerY + 2);

      ctx.font = 'bold 10px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.strokeText(t.name, centerX, centerY + radius + 10);
      ctx.fillText(t.name, centerX, centerY + radius + 10);
    });

    ctx.restore();
  }
}

export const boardEngine = new BoardEngine();
