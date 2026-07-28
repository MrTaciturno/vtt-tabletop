/**
 * .POISE Character Sheet Loader & Exporter
 * Handles JSON parsing of .poise files (bgImage, fields, items),
 * state synchronization, and browser export/download.
 */

class PoiseLoader {
  constructor() {}

  createEmptyPoiseSheet() {
    return {
      bgImage: '',
      fields: [],
      items: []
    };
  }

  exportPoiseFile(sheetData, fileName = 'planilha.poise') {
    try {
      const jsonStr = JSON.stringify(sheetData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName.endsWith('.poise') ? fileName : `${fileName}.poise`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting .poise file:', err);
    }
  }

  parsePoiseFile(file, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (parsed && (parsed.fields || parsed.bgImage || parsed.items)) {
          callback(null, parsed);
        } else {
          callback(new Error('Arquivo .poise inválido.'));
        }
      } catch (err) {
        callback(err);
      }
    };
    reader.onerror = (err) => callback(err);
    reader.readAsText(file);
  }
}

export const poiseLoader = new PoiseLoader();
