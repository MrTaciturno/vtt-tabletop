import { state } from './state.js';
import { network } from './network.js';

/**
 * High-Performance WebGL 2D Tabletop Engine powered by PixiJS
 * Includes Master Drawing Tools: freehand, line, rect, circle, eraser & real-time Socket.IO sync.
 */

class BoardEngine {
  constructor() {
    this.container = null;
    this.app = null;

    // Minimum Map Dimensions (17 cols x 22 rows)
    this.MIN_MAP_COLS = 17;
    this.MIN_MAP_ROWS = 22;

    // Surrounding Outer Grid Margins (Character Sheet Area)
    this.outerLeft = 17;
    this.outerRight = 17;
    this.outerTop = 22;
    this.outerBottom = 22;

    // 1-Cell Separation Lane Ring around Central Map
    this.gapSize = 1;

    // Central Map Configured Dimensions
    this.cols = 20;
    this.rows = 15;

    this.cellSize = 50; // Base cell size in pixels
    this.bgImageUrl = null;

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

    // Token Management & Dragging
    this.tokens = [];
    this.draggedToken = null;
    this.selectedTokenId = null;
    this.dragStartGridX = 0;
    this.dragStartGridY = 0;
    this.dragCurrentPixelX = 0;
    this.dragCurrentPixelY = 0;
    this.dragMouseOffsetX = 0;
    this.dragMouseOffsetY = 0;
    this.dragTopLeftPixelX = 0;
    this.dragTopLeftPixelY = 0;
    this.dragWaypoints = []; // Array of grid waypoint objects [{ x, y }]

    // Master Drawing Tools State
    this.drawings = [];
    this.currentTool = 'select'; // 'select' | 'freehand' | 'line' | 'rect' | 'circle' | 'eraser'
    this.drawColor = '#ef4444';
    this.drawWidth = 4;
    this.drawFilled = false;
    this.isDrawing = false;
    this.activeDrawingPoints = [];
    this.drawStartWorldX = 0;
    this.drawStartWorldY = 0;
    this.drawCurrentWorldX = 0;
    this.drawCurrentWorldY = 0;

    this.lastMouseX = 0;
    this.lastMouseY = 0;

    // Network Throttling & Lerp Animation State
    this.lastDragEmitTime = 0;
    this.DRAG_EMIT_INTERVAL = 20; // 50Hz network limit (20ms)
    this.animatingSmoothTokens = false;

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
    return this.outerLeft + this.gapSize;
  }

  get mapOriginY() {
    return this.outerTop + this.gapSize;
  }

  get totalCols() {
    return this.outerLeft + this.gapSize + this.mapCols + this.gapSize + this.outerRight;
  }

  get totalRows() {
    return this.outerTop + this.gapSize + this.mapRows + this.gapSize + this.outerBottom;
  }

  getSlots() {
    const mapX = this.mapOriginX;
    const mapCols = this.mapCols;
    const centeredSlot5X = mapX + Math.floor((mapCols - 17) / 2);
    const rightSlotX = mapX + mapCols + this.gapSize;

    return [
      { id: 0, label: 'Planilha 1 (Esq. Sup)', x: 0, y: 0, cols: 17, rows: 22 },
      { id: 1, label: 'Planilha 2 (Esq. Inf)', x: 0, y: 22, cols: 17, rows: 22 },
      { id: 2, label: 'Planilha 3 (Dir. Sup)', x: rightSlotX, y: 0, cols: 17, rows: 22 },
      { id: 3, label: 'Planilha 4 (Dir. Inf)', x: rightSlotX, y: 22, cols: 17, rows: 22 },
      { id: 4, label: 'Planilha 5 (Topo Central)', x: centeredSlot5X, y: 0, cols: 17, rows: 22 }
    ];
  }

  init(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    this.container.innerHTML = '';

    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;

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
      console.warn('[BoardEngine] PixiJS not loaded via CDN.');
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

  // DRAWING TOOL CONFIGURATION
  setDrawingTool(tool) {
    this.currentTool = tool || 'select';
    this.render();
  }

  setDrawingColor(color) {
    this.drawColor = color || '#ef4444';
  }

  setDrawingWidth(width) {
    this.drawWidth = width || 4;
  }

  setDrawingFill(filled) {
    this.drawFilled = Boolean(filled);
  }

  addDrawing(drawing, broadcast = true) {
    this.drawings.push(drawing);
    this.render();

    if (broadcast) {
      network.broadcast('DRAWING_ADDED', drawing);
    }
  }

  deleteDrawing(drawingId, broadcast = true) {
    this.drawings = this.drawings.filter(d => d.id !== drawingId);
    this.render();

    if (broadcast) {
      network.broadcast('DRAWING_DELETED', { id: drawingId });
    }
  }

  clearDrawings(broadcast = true) {
    this.drawings = [];
    this.render();

    if (broadcast) {
      network.broadcast('DRAWINGS_CLEARED');
    }
  }

  eraseDrawingAt(worldX, worldY) {
    const eraseRadius = 16;
    const toDelete = this.drawings.find(d => {
      if (d.type === 'freehand' && d.points) {
        return d.points.some(p => Math.hypot(p.x - worldX, p.y - worldY) < eraseRadius + (d.width || 4));
      } else if (d.type === 'line') {
        const midX = (d.x1 + d.x2) / 2;
        const midY = (d.y1 + d.y2) / 2;
        return Math.hypot(midX - worldX, midY - worldY) < Math.hypot(d.x2 - d.x1, d.y2 - d.y1) / 2 + 10;
      } else if (d.type === 'rect') {
        const minX = Math.min(d.x1, d.x2);
        const maxX = Math.max(d.x1, d.x2);
        const minY = Math.min(d.y1, d.y2);
        const maxY = Math.max(d.y1, d.y2);
        return worldX >= minX - 10 && worldX <= maxX + 10 && worldY >= minY - 10 && worldY <= maxY + 10;
      } else if (d.type === 'circle') {
        const radius = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
        const dist = Math.hypot(worldX - d.x1, worldY - d.y1);
        return Math.abs(dist - radius) < 16 || (d.filled && dist <= radius);
      }
      return false;
    });

    if (toDelete) {
      this.deleteDrawing(toDelete.id, true);
    }
  }

  selectToken(tokenId) {
    this.selectedTokenId = tokenId;
    const token = this.tokens.find(t => t.id === tokenId);
    state.notify('TOKEN_SELECTED', token);
    this.render();
  }

  addToken(name, avatar, color = '#8b5cf6', ownerId = null, size = 1, imageUrl = null, broadcast = true, extraProps = {}) {
    const tokenId = 'tok_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    
    const x = this.mapOriginX + Math.floor(this.mapCols / 2);
    const y = this.mapOriginY + Math.floor(this.mapRows / 2);

    const token = {
      id: tokenId,
      name,
      avatar,
      color,
      size: Math.max(1, Math.min(4, Number(size) || 1)),
      cols: Number(extraProps.cols) || Number(size) || 1,
      rows: Number(extraProps.rows) || Number(size) || 1,
      isEquipment: Boolean(extraProps.isEquipment),
      imageUrl: imageUrl || null,
      ownerId: ownerId || state.currentUser?.id,
      x,
      y
    };

    this.tokens.push(token);
    this.selectToken(tokenId);

    if (broadcast) {
      network.broadcast('TOKEN_SPAWNED', token);
    }
    return token;
  }

  moveToken(tokenId, x, y, broadcast = true) {
    const token = this.tokens.find(t => t.id === tokenId);
    if (token) {
      const newX = Math.max(0, Math.min(this.totalCols - 1, x));
      const newY = Math.max(0, Math.min(this.totalRows - 1, y));

      if (!broadcast) {
        // Received from remote peer: smoothly interpolate position
        token.targetX = newX;
        token.targetY = newY;
        this.startSmoothTokenAnimation();
      } else {
        // Local movement: snap immediately
        token.x = newX;
        token.y = newY;
        delete token.targetX;
        delete token.targetY;
        this.render();

        network.broadcast('TOKEN_MOVED', { id: tokenId, x: token.x, y: token.y });
      }
    }
  }

  startSmoothTokenAnimation() {
    if (this.animatingSmoothTokens) return;
    this.animatingSmoothTokens = true;

    const animateStep = () => {
      let stillAnimating = false;

      this.tokens.forEach(t => {
        if (t.targetX !== undefined && t.targetY !== undefined) {
          const dx = t.targetX - t.x;
          const dy = t.targetY - t.y;

          if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
            t.x += dx * 0.45;
            t.y += dy * 0.45;
            stillAnimating = true;
          } else {
            t.x = t.targetX;
            t.y = t.targetY;
            delete t.targetX;
            delete t.targetY;
          }
        }
      });

      this.render();

      if (stillAnimating) {
        requestAnimationFrame(animateStep);
      } else {
        this.animatingSmoothTokens = false;
      }
    };

    requestAnimationFrame(animateStep);
  }

  updateToken(tokenId, updates, broadcast = true) {
    const token = this.tokens.find(t => t.id === tokenId);
    if (token) {
      Object.assign(token, updates);
      this.render();

      if (broadcast) {
        network.broadcast('TOKEN_UPDATED', token);
      }
    }
  }

  deleteToken(tokenId, broadcast = true) {
    if (this.selectedTokenId === tokenId) {
      this.selectedTokenId = null;
      state.notify('TOKEN_SELECTED', null);
    }
    this.tokens = this.tokens.filter(t => t.id !== tokenId);
    this.render();

    if (broadcast) {
      network.broadcast('TOKEN_DELETED', { id: tokenId });
    }
  }

  screenToWorld(screenX, screenY) {
    return {
      x: (screenX - this.panX) / this.scale,
      y: (screenY - this.panY) / this.scale
    };
  }

  screenToGrid(screenX, screenY) {
    const worldPos = this.screenToWorld(screenX, screenY);
    return {
      x: Math.floor(worldPos.x / this.cellSize),
      y: Math.floor(worldPos.y / this.cellSize)
    };
  }

  bindEvents() {
    window.addEventListener('resize', this.onResize);

    const container = this.container;
    if (!container) return;

    // Zoom on Mouse Wheel
    container.addEventListener('wheel', (e) => {
      e.preventDefault();

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const clampedDelta = Math.max(-120, Math.min(120, e.deltaY));
      const zoomFactor = Math.pow(0.999, clampedDelta);
      
      const targetScale = this.scale * zoomFactor;
      const newScale = Math.max(this.minScale, Math.min(this.maxScale, targetScale));

      if (Math.abs(newScale - this.scale) > 0.0001) {
        const worldMouseX = (mouseX - this.panX) / this.scale;
        const worldMouseY = (mouseY - this.panY) / this.scale;

        this.scale = newScale;
        this.panX = mouseX - worldMouseX * newScale;
        this.panY = mouseY - worldMouseY * newScale;

        this.render();
      }
    }, { passive: false });

    // Mouse Down Handler (Panning & Drawing Tools)
    container.addEventListener('mousedown', (e) => {
      const rect = container.getBoundingClientRect();
      this.lastMouseX = e.clientX - rect.left;
      this.lastMouseY = e.clientY - rect.top;

      const worldPos = this.screenToWorld(this.lastMouseX, this.lastMouseY);

      if (this.currentTool !== 'select' && !this.draggedToken) {
        // Start Drawing Mode
        this.isDrawing = true;
        this.drawStartWorldX = worldPos.x;
        this.drawStartWorldY = worldPos.y;
        this.drawCurrentWorldX = worldPos.x;
        this.drawCurrentWorldY = worldPos.y;
        this.activeDrawingPoints = [{ x: worldPos.x, y: worldPos.y }];

        if (this.currentTool === 'eraser') {
          this.eraseDrawingAt(worldPos.x, worldPos.y);
        }
        this.render();
        return;
      }

      if (!this.draggedToken) {
        this.isPanning = true;
        this.startPanX = e.clientX - this.panX;
        this.startPanY = e.clientY - this.panY;

        const gridPos = this.screenToGrid(this.lastMouseX, this.lastMouseY);
        const clickedToken = this.tokens.slice().reverse().find(t => t.x === gridPos.x && t.y === gridPos.y);
        if (!clickedToken) {
          this.selectToken(null);
        }
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (container) {
        const rect = container.getBoundingClientRect();
        this.lastMouseX = e.clientX - rect.left;
        this.lastMouseY = e.clientY - rect.top;
      }

      const worldPos = this.screenToWorld(this.lastMouseX, this.lastMouseY);

      if (this.isDrawing) {
        this.drawCurrentWorldX = worldPos.x;
        this.drawCurrentWorldY = worldPos.y;

        if (this.currentTool === 'freehand') {
          this.activeDrawingPoints.push({ x: worldPos.x, y: worldPos.y });
        } else if (this.currentTool === 'eraser') {
          this.eraseDrawingAt(worldPos.x, worldPos.y);
        }
        this.render();

      } else if (this.draggedToken && container) {
        this.dragCurrentPixelX = worldPos.x;
        this.dragCurrentPixelY = worldPos.y;

        this.dragTopLeftPixelX = worldPos.x - this.dragMouseOffsetX;
        this.dragTopLeftPixelY = worldPos.y - this.dragMouseOffsetY;

        const tSize = Math.max(1, Math.min(4, Number(this.draggedToken.size) || 1));

        const now = Date.now();
        if (now - this.lastDragEmitTime >= this.DRAG_EMIT_INTERVAL) {
          this.lastDragEmitTime = now;
          const currentGridX = Math.max(0, Math.min(this.totalCols - tSize, Math.floor(this.dragTopLeftPixelX / this.cellSize)));
          const currentGridY = Math.max(0, Math.min(this.totalRows - tSize, Math.floor(this.dragTopLeftPixelY / this.cellSize)));

          if (this.draggedToken.x !== currentGridX || this.draggedToken.y !== currentGridY) {
            this.draggedToken.x = currentGridX;
            this.draggedToken.y = currentGridY;
            network.broadcast('TOKEN_MOVED', { id: this.draggedToken.id, x: currentGridX, y: currentGridY });
          }
        }

        this.render();

      } else if (this.isPanning) {
        this.panX = e.clientX - this.startPanX;
        this.panY = e.clientY - this.startPanY;
        this.render();
      }
    });

    // Mouse Up: Commit Drawing or Snap Token
    window.addEventListener('mouseup', () => {
      if (this.isDrawing) {
        this.isDrawing = false;
        const drawingId = 'draw_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);

        if (this.currentTool === 'freehand' && this.activeDrawingPoints.length > 1) {
          this.addDrawing({
            id: drawingId,
            type: 'freehand',
            color: this.drawColor,
            width: this.drawWidth,
            points: [...this.activeDrawingPoints]
          }, true);
        } else if (this.currentTool === 'line') {
          this.addDrawing({
            id: drawingId,
            type: 'line',
            color: this.drawColor,
            width: this.drawWidth,
            x1: this.drawStartWorldX,
            y1: this.drawStartWorldY,
            x2: this.drawCurrentWorldX,
            y2: this.drawCurrentWorldY
          }, true);
        } else if (this.currentTool === 'rect') {
          this.addDrawing({
            id: drawingId,
            type: 'rect',
            color: this.drawColor,
            width: this.drawWidth,
            filled: this.drawFilled,
            x1: this.drawStartWorldX,
            y1: this.drawStartWorldY,
            x2: this.drawCurrentWorldX,
            y2: this.drawCurrentWorldY
          }, true);
        } else if (this.currentTool === 'circle') {
          this.addDrawing({
            id: drawingId,
            type: 'circle',
            color: this.drawColor,
            width: this.drawWidth,
            filled: this.drawFilled,
            x1: this.drawStartWorldX,
            y1: this.drawStartWorldY,
            x2: this.drawCurrentWorldX,
            y2: this.drawCurrentWorldY
          }, true);
        }
        this.activeDrawingPoints = [];
      }

      if (this.draggedToken) {
        const tSize = Math.max(1, Math.min(4, Number(this.draggedToken.size) || 1));
        const gridX = Math.max(0, Math.min(this.totalCols - tSize, Math.floor(this.dragTopLeftPixelX / this.cellSize)));
        const gridY = Math.max(0, Math.min(this.totalRows - tSize, Math.floor(this.dragTopLeftPixelY / this.cellSize)));

        this.moveToken(this.draggedToken.id, gridX, gridY, true);
        this.draggedToken = null;
        this.dragWaypoints = [];
      }

      this.isPanning = false;
      this.render();
    });

    // Spacebar Keydown Handler: Insert Waypoint
    window.addEventListener('keydown', (e) => {
      if ((e.code === 'Space' || e.key === ' ') && this.draggedToken) {
        e.preventDefault();

        const tSize = Math.max(1, Math.min(4, Number(this.draggedToken.size) || 1));
        const targetX = Math.max(0, Math.min(this.totalCols - tSize, Math.floor(this.dragTopLeftPixelX / this.cellSize)));
        const targetY = Math.max(0, Math.min(this.totalRows - tSize, Math.floor(this.dragTopLeftPixelY / this.cellSize)));

        const lastWp = this.dragWaypoints[this.dragWaypoints.length - 1];
        if (!lastWp || lastWp.x !== targetX || lastWp.y !== targetY) {
          this.dragWaypoints.push({ x: targetX, y: targetY });
          this.render();
        }
      }
    });
  }

  // PIXI.JS RENDER PIPELINE
  render() {
    if (!this.app || !window.PIXI) return;

    const stage = this.app.stage;
    stage.removeChildren();

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

    // 1-Cell Separation Lane Ring
    const gapX = (this.mapOriginX - this.gapSize) * this.cellSize;
    const gapY = (this.mapOriginY - this.gapSize) * this.cellSize;
    const gapW = (this.mapCols + this.gapSize * 2) * this.cellSize;
    const gapH = (this.mapRows + this.gapSize * 2) * this.cellSize;

    bgGfx.beginFill(0x06b6d4, 0.22);
    bgGfx.drawRect(gapX, gapY, gapW, gapH);
    bgGfx.endFill();

    // Central Map Background Area
    bgGfx.beginFill(0x151d2a);
    bgGfx.drawRect(mapX, mapY, mapW, mapH);
    bgGfx.endFill();
    stage.addChild(bgGfx);

    // Layer 1: Map Background Sprite
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

    // Layer 1.5: Master Drawings Container
    const drawingsGfx = new PIXI.Graphics();

    const drawShape = (gfx, d) => {
      const hexColor = parseInt((d.color || '#ef4444').replace('#', '0x'), 16);
      gfx.lineStyle(d.width || 4, hexColor, 1);

      if (d.type === 'freehand' && d.points && d.points.length > 0) {
        gfx.moveTo(d.points[0].x, d.points[0].y);
        for (let i = 1; i < d.points.length; i++) {
          gfx.lineTo(d.points[i].x, d.points[i].y);
        }
      } else if (d.type === 'line') {
        gfx.moveTo(d.x1, d.y1);
        gfx.lineTo(d.x2, d.y2);
      } else if (d.type === 'rect') {
        const x = Math.min(d.x1, d.x2);
        const y = Math.min(d.y1, d.y2);
        const w = Math.abs(d.x2 - d.x1);
        const h = Math.abs(d.y2 - d.y1);
        if (d.filled) {
          gfx.beginFill(hexColor, 0.35);
          gfx.drawRect(x, y, w, h);
          gfx.endFill();
        } else {
          gfx.drawRect(x, y, w, h);
        }
      } else if (d.type === 'circle') {
        const radius = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
        if (d.filled) {
          gfx.beginFill(hexColor, 0.35);
          gfx.drawCircle(d.x1, d.y1, radius);
          gfx.endFill();
        } else {
          gfx.drawCircle(d.x1, d.y1, radius);
        }
      }
    };

    this.drawings.forEach(d => drawShape(drawingsGfx, d));

    // Live Preview of Current Active Drawing
    if (this.isDrawing && this.currentTool !== 'select' && this.currentTool !== 'eraser') {
      const previewDrawing = {
        type: this.currentTool,
        color: this.drawColor,
        width: this.drawWidth,
        filled: this.drawFilled,
        x1: this.drawStartWorldX,
        y1: this.drawStartWorldY,
        x2: this.drawCurrentWorldX,
        y2: this.drawCurrentWorldY,
        points: this.activeDrawingPoints
      };
      drawShape(drawingsGfx, previewDrawing);
    }

    stage.addChild(drawingsGfx);

    // Layer 2: Character Sheet Slots (17x22 Regions)
    const slots = this.getSlots();
    const sheets = state.characterSheets || {};

    slots.forEach(slot => {
      const slotPixelX = slot.x * this.cellSize;
      const slotPixelY = slot.y * this.cellSize;
      const slotPixelW = slot.cols * this.cellSize;
      const slotPixelH = slot.rows * this.cellSize;

      const sheet = sheets[slot.id];
      const imgUrl = sheet?.bgImage || sheet?.imageUrl || null;

      const slotContainer = new PIXI.Container();
      slotContainer.x = slotPixelX;
      slotContainer.y = slotPixelY;
      slotContainer.eventMode = 'static';
      slotContainer.cursor = 'pointer';

      const slotGfx = new PIXI.Graphics();

      if (imgUrl) {
        slotGfx.beginFill(0x0f172a, 0.95);
        slotGfx.drawRect(0, 0, slotPixelW, slotPixelH);
        slotGfx.endFill();
        slotContainer.addChild(slotGfx);

        const sheetTexture = PIXI.Texture.from(imgUrl);
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

        const borderGfx = new PIXI.Graphics();
        borderGfx.lineStyle(3, 0x22c55e, 0.8);
        borderGfx.drawRect(0, 0, slotPixelW, slotPixelH);
        
        borderGfx.beginFill(0x22c55e, 0.9);
        borderGfx.drawRect(0, 0, slotPixelW, 26);
        borderGfx.endFill();
        slotContainer.addChild(borderGfx);

        const labelText = new PIXI.Text(`📋 ${sheet.ownerName || sheet.name || 'Planilha'} (Clique p/ Abrir)`, {
          fontFamily: 'sans-serif',
          fontSize: 12,
          fontWeight: 'bold',
          fill: 0x0f172a
        });
        labelText.x = 10;
        labelText.y = 6;
        slotContainer.addChild(labelText);

      } else {
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

        const placeholderText = new PIXI.Text(`📋 ${slot.label}\nVaga de Planilha 17x22\n(Clique para abrir / carregar)`, {
          fontFamily: 'sans-serif',
          fontSize: 13,
          fontWeight: 'bold',
          fill: 0xeab308,
          align: 'center'
        });
        placeholderText.anchor.set(0.5);
        placeholderText.x = slotPixelW / 2;
        placeholderText.y = slotPixelH / 2;
        slotContainer.addChild(placeholderText);
      }

      slotContainer.on('pointerdown', () => {
        state.notify('SHEET_SLOT_CLICKED', { slotId: slot.id, sheetData: sheet });
      });

      stage.addChild(slotContainer);
    });

    // Layer 3: Square Grid Overlay & 1-Cell Separation Lane Border
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

    // 1-Cell Separation Ring Outline
    gridGfx.lineStyle(2.5, 0x06b6d4, 0.9);
    gridGfx.drawRect(gapX, gapY, gapW, gapH);

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

    // Layer 4: Interactive Tokens Layer
    const tokensContainer = new PIXI.Container();

    this.tokens.forEach(t => {
      const tokGroup = new PIXI.Container();
      const tCols = Math.max(1, Math.min(4, Number(t.cols) || Number(t.size) || 1));
      const tRows = Math.max(1, Math.min(4, Number(t.rows) || Number(t.size) || 1));
      
      const isBeingDragged = this.draggedToken && this.draggedToken.id === t.id;
      const topLeftCenterX = isBeingDragged ? this.dragTopLeftPixelX : (t.x + 0.5) * this.cellSize;
      const topLeftCenterY = isBeingDragged ? this.dragTopLeftPixelY : (t.y + 0.5) * this.cellSize;

      const centerX = topLeftCenterX + ((tCols - 1) * this.cellSize) / 2;
      const centerY = topLeftCenterY + ((tRows - 1) * this.cellSize) / 2;

      tokGroup.x = centerX;
      tokGroup.y = centerY;
      tokGroup.eventMode = 'static';
      tokGroup.cursor = 'pointer';

      const hexColor = parseInt((t.color || '#8b5cf6').replace('#', '0x'), 16);

      if (t.isEquipment || tCols !== tRows) {
        // Equipment Card Rectangular Sprite
        const rectWidth = tCols * this.cellSize * 0.94;
        const rectHeight = tRows * this.cellSize * 0.94;

        if (t.imageUrl) {
          const tex = PIXI.Texture.from(t.imageUrl);
          const sprite = new PIXI.Sprite(tex);
          sprite.anchor.set(0.5);
          sprite.width = rectWidth;
          sprite.height = rectHeight;

          const borderGfx = new PIXI.Graphics();
          borderGfx.lineStyle(2.5, hexColor, 1);
          borderGfx.drawRoundedRect(-rectWidth / 2, -rectHeight / 2, rectWidth, rectHeight, 6);

          tokGroup.addChild(sprite);
          tokGroup.addChild(borderGfx);
        } else {
          const cardGfx = new PIXI.Graphics();
          cardGfx.beginFill(0x1e293b, 0.95);
          cardGfx.lineStyle(2.5, hexColor, 1);
          cardGfx.drawRoundedRect(-rectWidth / 2, -rectHeight / 2, rectWidth, rectHeight, 6);
          cardGfx.endFill();

          const cardText = new PIXI.Text(t.name || 'Item', {
            fontFamily: 'sans-serif',
            fontSize: 11,
            fontWeight: 'bold',
            fill: 0xffffff
          });
          cardText.anchor.set(0.5);

          tokGroup.addChild(cardGfx);
          tokGroup.addChild(cardText);
        }

        // Selected Highlight Outline
        if (this.selectedTokenId === t.id) {
          const selGfx = new PIXI.Graphics();
          selGfx.lineStyle(3.5, 0xf59e0b, 1);
          selGfx.drawRoundedRect(-rectWidth / 2 - 3, -rectHeight / 2 - 3, rectWidth + 6, rectHeight + 6, 8);
          tokGroup.addChild(selGfx);
        }

      } else {
        // Standard Circular Token Rendering
        const radius = ((tCols * this.cellSize) / 2) * 0.88;

        if (t.imageUrl) {
          const tex = PIXI.Texture.from(t.imageUrl);
          const sprite = new PIXI.Sprite(tex);
          sprite.anchor.set(0.5);
          sprite.width = radius * 1.8;
          sprite.height = radius * 1.8;

          const circleGfx = new PIXI.Graphics();
          circleGfx.beginFill(0x0f172a, isBeingDragged ? 0.85 : 1.0);
          circleGfx.drawCircle(0, 0, radius);
          circleGfx.endFill();

          circleGfx.lineStyle(3, hexColor, 1);
          circleGfx.drawCircle(0, 0, radius);
          tokGroup.addChild(circleGfx);
          tokGroup.addChild(sprite);

        } else {
          const circleGfx = new PIXI.Graphics();
          circleGfx.beginFill(hexColor, isBeingDragged ? 0.85 : 1.0);
          circleGfx.drawCircle(0, 0, radius);
          circleGfx.endFill();

          circleGfx.lineStyle(2.5, 0xffffff, 1);
          circleGfx.drawCircle(0, 0, radius);
          tokGroup.addChild(circleGfx);

          const avatarText = new PIXI.Text(t.avatar || '🎲', {
            fontSize: radius * 1.0
          });
          avatarText.anchor.set(0.5);
          avatarText.y = 1;
          tokGroup.addChild(avatarText);
        }

        // Selected Highlight Ring
        if (this.selectedTokenId === t.id) {
          const selGfx = new PIXI.Graphics();
          selGfx.lineStyle(3.5, 0xf59e0b, 1);
          selGfx.drawCircle(0, 0, radius + 5);
          tokGroup.addChild(selGfx);
        }

        // Name Label Tag
        const nameText = new PIXI.Text(t.name, {
          fontFamily: 'sans-serif',
          fontSize: Math.max(10, 9 + tCols),
          fontWeight: 'bold',
          fill: 0xffffff,
          stroke: 0x000000,
          strokeThickness: 3
        });
        nameText.anchor.set(0.5, 0);
        nameText.y = radius + 4;
        tokGroup.addChild(nameText);
      }

      // Interactive Pointer Events
      tokGroup.on('pointerdown', (e) => {
        this.selectToken(t.id);

        const isMaster = state.currentUser?.isMaster || state.activeLobby?.masterId === state.currentUser?.id;
        const canDrag = isMaster || t.ownerId === state.currentUser?.id;
        if (canDrag && this.currentTool === 'select') {
          this.draggedToken = t;
          this.dragStartGridX = t.x;
          this.dragStartGridY = t.y;
          this.dragWaypoints = [{ x: t.x, y: t.y }];

          const origEvent = e.data?.originalEvent || e;
          const rect = this.container.getBoundingClientRect();
          this.lastMouseX = (origEvent.clientX || 0) - rect.left;
          this.lastMouseY = (origEvent.clientY || 0) - rect.top;

          const worldPos = this.screenToWorld(this.lastMouseX, this.lastMouseY);

          // Top-left cell center of the token:
          const topLeftCenterX = (t.x + 0.5) * this.cellSize;
          const topLeftCenterY = (t.y + 0.5) * this.cellSize;

          // Mouse offset relative to the TOP-LEFT cell center:
          this.dragMouseOffsetX = worldPos.x - topLeftCenterX;
          this.dragMouseOffsetY = worldPos.y - topLeftCenterY;

          this.dragTopLeftPixelX = topLeftCenterX;
          this.dragTopLeftPixelY = topLeftCenterY;
          this.dragCurrentPixelX = worldPos.x;
          this.dragCurrentPixelY = worldPos.y;

          e.stopPropagation();
          this.render();
        }
      });

      tokensContainer.addChild(tokGroup);
    });

    stage.addChild(tokensContainer);

    // Layer 5: Vector Arrow, Waypoint Nodes & Rounded Euclidean Distance
    if (this.draggedToken) {
      const vectorGfx = new PIXI.Graphics();
      vectorGfx.lineStyle(3.5, 0x38bdf8, 0.95);

      let accumulatedDist = 0;

      // 1. Draw completed waypoint segments
      for (let i = 0; i < this.dragWaypoints.length - 1; i++) {
        const wp1 = this.dragWaypoints[i];
        const wp2 = this.dragWaypoints[i + 1];

        const p1X = (wp1.x + 0.5) * this.cellSize;
        const p1Y = (wp1.y + 0.5) * this.cellSize;
        const p2X = (wp2.x + 0.5) * this.cellSize;
        const p2Y = (wp2.y + 0.5) * this.cellSize;

        vectorGfx.moveTo(p1X, p1Y);
        vectorGfx.lineTo(p2X, p2Y);

        accumulatedDist += Math.hypot(wp2.x - wp1.x, wp2.y - wp1.y);
      }

      // 2. Draw current active segment from last waypoint to current top-left cell center
      const lastWp = this.dragWaypoints[this.dragWaypoints.length - 1];
      const lastPxX = (lastWp.x + 0.5) * this.cellSize;
      const lastPxY = (lastWp.y + 0.5) * this.cellSize;
      const currPxX = this.dragTopLeftPixelX;
      const currPxY = this.dragTopLeftPixelY;

      vectorGfx.moveTo(lastPxX, lastPxY);
      vectorGfx.lineTo(currPxX, currPxY);

      // Active segment distance in grid units
      const activeGridX = currPxX / this.cellSize - 0.5;
      const activeGridY = currPxY / this.cellSize - 0.5;
      accumulatedDist += Math.hypot(activeGridX - lastWp.x, activeGridY - lastWp.y);

      // Vector Arrowhead at current cursor position
      const angle = Math.atan2(currPxY - lastPxY, currPxX - lastPxX);
      const arrowSize = 14;
      vectorGfx.beginFill(0x38bdf8, 1);
      vectorGfx.drawPolygon([
        currPxX, currPxY,
        currPxX - arrowSize * Math.cos(angle - Math.PI / 6), currPxY - arrowSize * Math.sin(angle - Math.PI / 6),
        currPxX - arrowSize * Math.cos(angle + Math.PI / 6), currPxY - arrowSize * Math.sin(angle + Math.PI / 6)
      ]);
      vectorGfx.endFill();

      // Waypoint Node Markers (Snap circles with step numbers)
      for (let i = 0; i < this.dragWaypoints.length; i++) {
        const wp = this.dragWaypoints[i];
        const wpPxX = (wp.x + 0.5) * this.cellSize;
        const wpPxY = (wp.y + 0.5) * this.cellSize;

        vectorGfx.lineStyle(2, 0x38bdf8, 1);
        vectorGfx.beginFill(i === 0 ? 0x0f172a : 0x0284c7, 0.95);
        vectorGfx.drawCircle(wpPxX, wpPxY, i === 0 ? 7 : 11);
        vectorGfx.endFill();

        if (i > 0) {
          const nodeText = new PIXI.Text(`${i}`, {
            fontFamily: 'sans-serif',
            fontSize: 10,
            fontWeight: 'bold',
            fill: 0xffffff
          });
          nodeText.anchor.set(0.5);
          nodeText.x = wpPxX;
          nodeText.y = wpPxY;
          stage.addChild(nodeText);
        }
      }

      stage.addChild(vectorGfx);

      // Rounded Integer Euclidean Distance (e.g., 10 down + 10 right = 14)
      const roundedDist = Math.round(accumulatedDist);

      const badgeGfx = new PIXI.Graphics();
      badgeGfx.beginFill(0x0369a1, 0.95);
      badgeGfx.lineStyle(1.5, 0x38bdf8, 1);
      badgeGfx.drawRoundedRect(currPxX - 34, currPxY - 42, 68, 28, 6);
      badgeGfx.endFill();
      stage.addChild(badgeGfx);

      const distText = new PIXI.Text(`${roundedDist} quad.`, {
        fontFamily: 'sans-serif',
        fontSize: 11,
        fontWeight: 'bold',
        fill: 0xffffff
      });
      distText.anchor.set(0.5);
      distText.x = currPxX;
      distText.y = currPxY - 28;
      stage.addChild(distText);
    }
  }
}

export const boardEngine = new BoardEngine();
