import { state } from './state.js';
import { network } from './network.js';

/**
 * Animated Dice Engine & Web Audio Sound Synthesizer (d4, d6, d8, d10, d12, d100)
 */

class DiceEngine {
  constructor() {
    this.audioCtx = null;
  }

  getAudioContext() {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.audioCtx = new AudioCtx();
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  playDiceSound() {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      for (let i = 0; i < 4; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(300 + Math.random() * 500, now + i * 0.08);
        osc.frequency.exponentialRampToValueAtTime(100, now + i * 0.08 + 0.06);

        gain.gain.setValueAtTime(0.3, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.08 + 0.06);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.07);
      }
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }

  playFanfareSound() {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.value = freq;

        gain.gain.setValueAtTime(0.2, now + idx * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.4);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.1);
        osc.stop(now + idx * 0.1 + 0.45);
      });
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }

  roll(diceType = 'd6') {
    // Exclude d20 - Supported: d4, d6, d8, d10, d12, d100
    const allowed = ['d4', 'd6', 'd8', 'd10', 'd12', 'd100'];
    const validDice = allowed.includes(diceType) ? diceType : 'd6';

    const sides = parseInt(validDice.replace('d', ''), 10) || 6;
    const result = Math.floor(Math.random() * sides) + 1;

    const isMaxRoll = (result === sides);
    const isMinRoll = (result === 1);

    const currentUser = state.currentUser || { username: 'Jogador', avatar: '🎲' };

    const rollData = {
      id: 'roll_' + Date.now(),
      player: currentUser.username,
      avatar: currentUser.avatar,
      diceType: validDice,
      result,
      isMaxRoll,
      isMinRoll,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };

    this.playDiceSound();

    if (isMaxRoll) {
      this.playFanfareSound();
      if (window.confetti) {
        window.confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
      }
    }

    state.addDiceRoll(rollData);
    network.broadcast('DICE_ROLLED', rollData);

    return rollData;
  }
}

export const diceEngine = new DiceEngine();
