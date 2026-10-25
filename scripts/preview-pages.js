'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'dist');
const PORT = Number(process.env.PREVIEW_PORT || 4174);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const requested = pathname === '/' ? '/index.html' : pathname;
    const file = path.resolve(ROOT, `.${requested}`);
    if (!file.startsWith(`${ROOT}${path.sep}`) && file !== path.join(ROOT, 'index.html')) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const stat = await fs.stat(file).catch(() => null);
    if (!stat || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found. Run npm run build:pages first.');
      return;
    }

    const content = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(content);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(error.message);
  }
});

fs.stat(path.join(ROOT, 'index.html'))
  .then(() => {
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`静态预览：http://127.0.0.1:${PORT}`);
    });
  })
  .catch(() => {
    console.error('dist/ 不存在，请先执行：npm run build:pages');
    process.exitCode = 1;
  });
