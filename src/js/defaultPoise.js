import padraoPoiseRaw from '../padrao1_5.poise?raw';

let defaultPoiseData = null;
try {
  defaultPoiseData = JSON.parse(padraoPoiseRaw);
} catch (e) {
  console.warn('Error parsing padrao1_5.poise:', e);
}

export { defaultPoiseData };
