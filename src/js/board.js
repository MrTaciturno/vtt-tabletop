import { state } from './state.js';
import { network } from './network.js';

/**
 * High-Performance WebGL 2D Tabletop Engine powered by PixiJS
 */

class BoardEngine {
  constructor() {
    this.container = null;
    this.app = null;

    // Minimum Map Dimensions (17 cols x 22 rows)
    this.MIN_MAP_COLS = 17;
    this.MIN_MAP_ROWS = 22;

    // Surrounding Outer Grid Margins
    this.outerLeft = 17;
    this.outerRight = 17;
    this.outerTop = 22;
    this.outerBottom = 22;

    // Central Map Configured Dimensions
    this.cols = 20;
    this.rows = 15;

    this.cellSize = 50; // Base cell size in pixels
    this.bgImageUrl = null;
    this.mapSprite = null;

    // Cache of loaded PixiJS sheet textures { [slotId]: PIXI.Texture }
    this.sheetTextures = {};

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
    this.tokens = [];
    this.draggedToken = null;

    // Bindings
    this.onResize = this.resize.bind(this);
  }

  get mapCols() {
    return Math.max(this.MIN_MAP_COLS, this.cols || 17);
  }

  get mapRows() {
    return Math.max(this.MIN_MAP_ROWS, this.rows || 22);
  }

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

    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;

    // Initialize PixiJS Application
    const PixiApp = window.PIXI ? PIXI.Application : null;

    if (PixiApp) {
      this.app = new PixiApp({
        width,
        height,
        backgroundColor: 0x0b111e,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true
      });
      this.container.appendChild(this.app.view);
    } else {
      console.warn('[BoardEngine] PixiJS not loaded via CDN. Falling back to native canvas.');
    }

    this.centerView();
    this.bindEvents();

    state.subscribe((event) => {
      if (event === 'SHEETS_CHANGED') {
        this.render();
      }
    });

    this.render();
  }

  resize() {
    if (!this.container || !this.app) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.app.renderer.resize(width, height);
    this.render();
  }

  centerView() {
    const width = this.container ? this.container.clientWidth : 800;
    const height = this.container ? this.container.clientHeight : 600;

    const mapCenterX = (this.mapOriginX + this.mapCols / 2) * this.cellSize;
    const mapCenterY = (this.mapOriginY + this.mapRows / 2) * this.cellSize;
    this.panX = width / 2 - mapCenterX * this.scale;
    this.panY = height / 2 - mapCenterY * this.scale;
    this.render();
  }

  focusSlot(slotId) {
    const width = this.container ? this.container.clientWidth : 800;
    const height = this.container ? this.container.clientHeight : 600;

    const slot = this.getSlots().find(s => s.id === Number(slotId));
    if (!slot) return;

    const slotCenterX = (slot.x + slot.cols / 2) * this.cellSize;
    const slotCenterY = (slot.y + slot.rows / 2) * this.cellSize;
    this.panX = width / 2 - slotCenterX * this.scale;
    this.panY = height / 2 - slotCenterY * this.scale;
    this.render();
  }

  setGridSize(cols, rows, broadcast = true) {
    this.cols = Math.max(5, Math.min(60, cols));
    this.rows = Math.max(5, Math.min(60, rows));

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
    this.bgImageUrl = src || null;
    this.render();

    if (broadcast) {
      network.broadcast('BOARD_CONFIG_CHANGED', {
        cols: this.cols,
        rows: this.rows,
        bgImageUrl: src || null
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

    const container = this.container;
    if (!container) return;

    // Zoom on Mouse Wheel
    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * zoomFactor));
      
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      this.panX = mouseX - (mouseX - this.panX) * (newScale / this.scale);
      this.panY = mouseY - (mouseY - this.panY) * (newScale / this.scale);
      this.scale = newScale;

      this.render();
    }, { passive: false });

    // Mouse Panning
    container.addEventListener('mousedown', (e) => {
      // Check if clicking inside stage background (not token)
      if (e.target === this.app?.view || e.target === container || e.target.tagName === 'CANVAS') {
        this.isPanning = true;
        this.startPanX = e.clientX - this.panX;
        this.startPanY = e.clientY - this.panY;
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        this.panX = e.clientX - this.startPanX;
        this.panY = e.clientY - this.startPanY;
        this.render();
      }
    });

    window.addEventListener('mouseup', () => {
      this.isPanning = false;
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

  // PIXI.JS RENDER PIPELINE
  render() {
    if (!this.app || !window.PIXI) return;

    const stage = this.app.stage;
    stage.removeChildren(); // Refresh stage

    // Apply transform (Pan & Zoom)
    stage.position.set(this.panX, this.panY);
    stage.scale.set(this.scale, this.scale);

    const totalW = this.totalCols * this.cellSize;
    const totalH = this.totalRows * this.cellSize;

    const mapX = this.mapOriginX * this.cellSize;
    const mapY = this.mapOriginY * this.cellSize;
    const mapW = this.mapCols * this.cellSize;
    const mapH = this.mapRows * this.cellSize;

    // Layer 0: Board Tabletop Background
    const bgGfx = new PIXI.Graphics();
    bgGfx.beginFill(0x0b111e);
    bgGfx.drawRect(0, 0, totalW, totalH);
    bgGfx.endFill();

    // Central Map Background Area
    bgGfx.beginFill(0x151d2a);
    bgGfx.drawRect(mapX, mapY, mapW, mapH);
    bgGfx.endFill();
    stage.addChild(bgGfx);

    // Layer 1: Map Background Sprite (Anchored top-left, exact cell dimension, no stretch)
    if (this.bgImageUrl) {
      const texture = PIXI.Texture.from(this.bgImageUrl);
      const sprite = new PIXI.Sprite(texture);
      sprite.x = mapX;
      sprite.y = mapY;

      const drawImgCols = Math.min(this.mapCols, Math.max(1, this.cols || 17));
      const drawImgRows = Math.min(this.mapRows, Math.max(1, this.rows || 22));
      sprite.width = drawImgCols * this.cellSize;
      sprite.height = drawImgRows * this.cellSize;
      stage.addChild(sprite);

      const mapOutline = new PIXI.Graphics();
      mapOutline.lineStyle(2.5, 0x3b82f6, 0.9);
      mapOutline.drawRect(mapX, mapY, sprite.width, sprite.height);
      stage.addChild(mapOutline);
    }

    // Layer 2: Character Sheet Slots (17x22 each, aspect ratio contain)
    const slots = this.getSlots();
    const sheets = state.characterSheets || {};

    slots.forEach(slot => {
      const slotPixelX = slot.x * this.cellSize;
      const slotPixelY = slot.y * this.cellSize;
      const slotPixelW = slot.cols * this.cellSize;
      const slotPixelH = slot.rows * this.cellSize;

      const sheet = sheets[slot.id];
      const slotContainer = new PIXI.Container();
      slotContainer.x = slotPixelX;
      slotContainer.y = slotPixelY;

      const slotGfx = new PIXI.Graphics();

      if (sheet && sheet.imageUrl) {
        // Dark background for slot
        slotGfx.beginFill(0x0f172a, 0.95);
        slotGfx.drawRect(0, 0, slotPixelW, slotPixelH);
        slotGfx.endFill();
        slotContainer.addChild(slotGfx);

        // Render sheet sprite with aspect-ratio contain
        const sheetTexture = PIXI.Texture.from(sheet.imageUrl);
        const sheetSprite = new PIXI.Sprite(sheetTexture);

        sheetTexture.baseTexture.on('loaded', () => {
          const imgRatio = sheetSprite.texture.width / sheetSprite.texture.height;
          const slotRatio = slotPixelW / slotPixelH;
          if (imgRatio > slotRatio) {
            sheetSprite.width = slotPixelW;
            sheetSprite.height = slotPixelW / imgRatio;
            sheetSprite.y = (slotPixelH - sheetSprite.height) / 2;
          } else {
            sheetSprite.height = slotPixelH;
            sheetSprite.width = slotPixelH * imgRatio;
            sheetSprite.x = (slotPixelW - sheetSprite.width) / 2;
          }
        });

        sheetSprite.width = slotPixelW;
        sheetSprite.height = slotPixelH;
        slotContainer.addChild(sheetSprite);

        // Green Border
        const borderGfx = new PIXI.Graphics();
        borderGfx.lineStyle(3, 0x22c55e, 0.8);
        borderGfx.drawRect(0, 0, slotPixelW, slotPixelH);
        
        // Header Tag
        borderGfx.beginFill(0x22c55e, 0.9);
        borderGfx.drawRect(0, 0, slotPixelW, 26);
        borderGfx.endFill();
        slotContainer.addChild(borderGfx);

        const labelText = new PIXI.Text(`📋 Planilha: ${sheet.ownerName}`, {
          fontFamily: 'sans-serif',
          fontSize: 12,
          fontWeight: 'bold',
          fill: 0x0f172a
        });
        labelText.x = 10;
        labelText.y = 6;
        slotContainer.addChild(labelText);

      } else {
        // Empty Slot
        slotGfx.beginFill(0x0f172a, 0.75);
        slotGfx.drawRect(0, 0, slotPixelW, slotPixelH);
        slotGfx.endFill();

        slotGfx.lineStyle(2, 0xeab308, 0.6);
        slotGfx.drawRect(0, 0, slotPixelW, slotPixelH);

        slotGfx.beginFill(0xeab308, 0.9);
        slotGfx.drawRect(0, 0, slotPixelW, 26);
        slotGfx.endFill();
        slotContainer.addChild(slotGfx);

        const labelText = new PIXI.Text(`📋 ${slot.label} (17x22)`, {
          fontFamily: 'sans-serif',
          fontSize: 12,
          fontWeight: 'bold',
          fill: 0x0f172a
        });
        labelText.x = 10;
        labelText.y = 6;
        slotContainer.addChild(labelText);

        const placeholderText = new PIXI.Text(`📋 ${slot.label}\nVaga de Planilha 17x22`, {
          fontFamily: 'sans-serif',
          fontSize: 14,
          fontWeight: 'bold',
          fill: 0xeab308,
          align: 'center'
        });
        placeholderText.anchor.set(0.5);
        placeholderText.x = slotPixelW / 2;
        placeholderText.y = slotPixelH / 2;
        slotContainer.addChild(placeholderText);
      }

      stage.addChild(slotContainer);
    });

    // Layer 3: Complete Square Grid Lines Overlay
    const gridGfx = new PIXI.Graphics();
    gridGfx.lineStyle(1, 0xffffff, 0.12);

    for (let c = 0; c <= this.totalCols; c++) {
      gridGfx.moveTo(c * this.cellSize, 0);
      gridGfx.lineTo(c * this.cellSize, totalH);
    }
    for (let r = 0; r <= this.totalRows; r++) {
      gridGfx.moveTo(0, r * this.cellSize);
      gridGfx.lineTo(this.totalCols * this.cellSize, r * this.cellSize);
    }

    // Central Map Border Glow
    gridGfx.lineStyle(4, 0x8b5cf6, 0.8);
    gridGfx.drawRect(mapX, mapY, mapW, mapH);

    // Map Header Tag
    gridGfx.beginFill(0x8b5cf6, 0.9);
    gridGfx.drawRect(mapX, mapY - 26 < 0 ? mapY : mapY - 26, 180, 26);
    gridGfx.endFill();

    stage.addChild(gridGfx);

    const mapTitle = new PIXI.Text(`🗺️ Mapa Central (${this.mapCols}x${this.mapRows})`, {
      fontFamily: 'sans-serif',
      fontSize: 12,
      fontWeight: 'bold',
      fill: 0xffffff
    });
    mapTitle.x = mapX + 10;
    mapTitle.y = (mapY - 26 < 0 ? mapY : mapY - 26) + 6;
    stage.addChild(mapTitle);

    // Layer 4: Interactive Tokens Layer (PixiJS DisplayObjects & Dragging)
    const tokensContainer = new PIXI.Container();

    this.tokens.forEach(t => {
      const tokGroup = new PIXI.Container();
      const centerX = t.x * this.cellSize + this.cellSize / 2;
      const centerY = t.y * this.cellSize + this.cellSize / 2;
      const radius = (this.cellSize / 2) * 0.8;

      tokGroup.x = centerX;
      tokGroup.y = centerY;
      tokGroup.eventMode = 'static';
      tokGroup.cursor = 'pointer';

      // Token Base Circle Graphic
      const circleGfx = new PIXI.Graphics();
      const hexColor = parseInt((t.color || '#8b5cf6').replace('#', '0x'), 16);
      circleGfx.beginFill(hexColor);
      circleGfx.drawCircle(0, 0, radius);
      circleGfx.endFill();

      circleGfx.lineStyle(2.5, 0xffffff, 1);
      circleGfx.drawCircle(0, 0, radius);
      tokGroup.addChild(circleGfx);

      // Avatar Emoji Text
      const avatarText = new PIXI.Text(t.avatar || '🎲', {
        fontSize: radius * 1.1
      });
      avatarText.anchor.set(0.5);
      avatarText.y = 1;
      tokGroup.addChild(avatarText);

      // Name Label Text
      const nameText = new PIXI.Text(t.name, {
        fontFamily: 'sans-serif',
        fontSize: 10,
        fontWeight: 'bold',
        fill: 0xffffff,
        stroke: 0x000000,
        strokeThickness: 3
      });
      nameText.anchor.set(0.5, 0);
      nameText.y = radius + 4;
      tokGroup.addChild(nameText);

      // Interactive Drag Handlers
      tokGroup.on('pointerdown', (e) => {
        const isMaster = state.currentUser?.isMaster || state.activeLobby?.masterId === state.currentUser?.id;
        const canDrag = isMaster || t.ownerId === state.currentUser?.id;
        if (canDrag) {
          this.draggedToken = t;
          e.stopPropagation();
        }
      });

      tokensContainer.addChild(tokGroup);
    });

    stage.addChild(tokensContainer);
  }
}

export const boardEngine = new BoardEngine();
