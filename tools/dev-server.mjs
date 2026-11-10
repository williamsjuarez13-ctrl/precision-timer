// Local preview: static files + /api/board (the real handler).  node tools/dev-server.mjs [port]
// Then open http://localhost:8787/  — or http://localhost:8787/?data=data after `npm run scan`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from '../api/board.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), port = +process.argv[2] || 8787;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.md': 'text/plain; charset=utf-8', '.png': 'image/png' };
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/board') { res.status = c => { res.statusCode = c; return res; }; res.json = b => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(b)); return res; }; return handler({ method: req.method, query: Object.fromEntries(u.searchParams) }, res); }
  const file = path.join(ROOT, path.normalize(u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname)));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream'); fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`http://localhost:${port}/`));
