import { state } from './state.js';
import { network } from './network.js';
import { ui } from './ui.js';

/**
 * Interactive Tabletop Board Engine (Pan, Zoom, Grid & Token Dragging)
 */

class BoardEngine {
  constructor() {
    this.container = null;
    this.canvas = null;
    this.ctx = null;
    
    // Grid & Map Properties
    this.cols = 20;
    this.rows = 15;
    this.cellSize = 50; // Base cell size in pixels
    this.bgImage = null;
    this.bgImageUrl = null;

    // Viewport Transform (Pan & Zoom)
    this.scale = 1;
    this.minScale = 0.4;
    this.maxScale = 3.0;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.startPanX = 0;
    this.startPanY = 0;

    // Token Management
    this.tokens = []; // Array of { id, name, avatar, color, ownerId, x, y }
    this.draggedToken = null;
    this.dragOffsetGridX = 0;
    this.dragOffsetGridY = 0;

    // Bindings
    this.onResize = this.resize.bind(this);
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

    // Redraw loop
    this.render();
  }

  resize() {
    if (!this.container || !this.canvas) return;
    this.canvas.width = this.container.clientWidth;
    this.canvas.height = this.container.clientHeight;
    this.render();
  }

  centerView() {
    const boardWidth = this.cols * this.cellSize;
    const boardHeight = this.rows * this.cellSize;
    this.panX = (this.canvas.width - boardWidth * this.scale) / 2;
    this.panY = (this.canvas.height - boardHeight * this.scale) / 2;
    this.render();
  }

  setGridSize(cols, rows, broadcast = true) {
    this.cols = Math.max(5, Math.min(60, cols));
    this.rows = Math.max(5, Math.min(60, rows));

    // Ensure tokens remain inside bounds
    this.tokens.forEach(t => {
      if (t.x >= this.cols) t.x = this.cols - 1;
      if (t.y >= this.rows) t.y = this.rows - 1;
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

  addToken(name, avatar, color = '#8b5cf6', ownerId = null, broadcast = true) {
    const tokenId = 'tok_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    
    // Find empty cell or place near center
    const x = Math.floor(this.cols / 2);
    const y = Math.floor(this.rows / 2);

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
      token.x = Math.max(0, Math.min(this.cols - 1, x));
      token.y = Math.max(0, Math.min(this.rows - 1, y));
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

  // Mouse & Touch Event Handlers for Pan, Zoom & Dragging
  bindEvents() {
    window.addEventListener('resize', this.onResize);

    const canvas = this.canvas;

    // Zoom on Mouse Wheel
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * zoomFactor));
      
      // Zoom centered at mouse cursor
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

      // Check if clicking a token
      const gridPos = this.screenToGrid(mouseX, mouseY);
      const clickedToken = this.tokens.slice().reverse().find(t => t.x === gridPos.x && t.y === gridPos.y);

      // Permission check: Master can drag all tokens, Player can drag owned tokens
      const isMaster = state.currentUser?.isMaster || state.activeLobby?.masterId === state.currentUser?.id;
      const canDrag = clickedToken && (isMaster || clickedToken.ownerId === state.currentUser?.id);

      if (canDrag) {
        this.draggedToken = clickedToken;
      } else {
        // Start Board Panning
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

    const boardWidth = this.cols * this.cellSize;
    const boardHeight = this.rows * this.cellSize;

    // 1. Draw Background Image if loaded
    if (this.bgImage) {
      ctx.drawImage(this.bgImage, 0, 0, boardWidth, boardHeight);
    } else {
      // Dark wood / tabletop texture background
      ctx.fillStyle = '#151d2a';
      ctx.fillRect(0, 0, boardWidth, boardHeight);
    }

    // 2. Draw Square Grid Overlay
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;

    for (let c = 0; c <= this.cols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * this.cellSize, 0);
      ctx.lineTo(c * this.cellSize, boardHeight);
      ctx.stroke();
    }

    for (let r = 0; r <= this.rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * this.cellSize);
      ctx.lineTo(boardWidth, r * this.cellSize);
      ctx.stroke();
    }

    // Outer Board Border Glow
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.6)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, boardWidth, boardHeight);

    // 3. Draw Tokens
    this.tokens.forEach(t => {
      const centerX = t.x * this.cellSize + this.cellSize / 2;
      const centerY = t.y * this.cellSize + this.cellSize / 2;
      const radius = (this.cellSize / 2) * 0.8;

      // Token Shadow
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = 10;

      // Token Base Circle
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fillStyle = t.color || '#8b5cf6';
      ctx.fill();

      // Token Border
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      ctx.shadowColor = 'transparent';

      // Token Avatar Emoji / Icon
      ctx.font = `${radius * 1.1}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.avatar || '🎲', centerX, centerY + 2);

      // Token Name Label
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
