import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const DIST_DIR = path.join(__dirname, 'dist');
const ROOT_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let safePath = path.normalize(req.url).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || !safePath) safePath = '/index.html';

  let filePath = path.join(DIST_DIR, safePath);

  // 1. Check in dist/
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // 2. Check in root/
    const rootFilePath = path.join(ROOT_DIR, safePath);
    if (fs.existsSync(rootFilePath) && !fs.statSync(rootFilePath).isDirectory()) {
      filePath = rootFilePath;
    } else if (fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
      filePath = path.join(DIST_DIR, 'index.html');
    } else if (fs.existsSync(path.join(ROOT_DIR, 'index.html'))) {
      filePath = path.join(ROOT_DIR, 'index.html');
    }
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      console.error(`[Server Error] File not found: ${filePath}`, err);
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>500 Internal Server Error</title></head>
        <body style="font-family: sans-serif; padding: 40px; background: #0f172a; color: #f8fafc;">
          <h2>⚠️ 500 Internal Server Error</h2>
          <p>Não foi possível carregar os arquivos da aplicação no servidor.</p>
          <p><strong>Causa provável:</strong> A pasta de build <code>dist/</code> não foi gerada no Render.</p>
          <hr style="border-color: #334155;" />
          <p><strong>Como resolver no Render.com:</strong></p>
          <ol>
            <li>Vá no painel do seu serviço no Render -> <strong>Settings</strong>.</li>
            <li>No campo <strong>Build Command</strong>, insira: <code>npm run build</code></li>
            <li>No campo <strong>Start Command</strong>, insira: <code>npm start</code></li>
            <li>Clique em <strong>Save Changes</strong> e faça um novo Deploy (<em>Manual Deploy -> Deploy latest commit</em>).</li>
          </ol>
        </body>
        </html>
      `);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000'
    });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 VTT Tabletop Server active on port ${PORT}`);
});
