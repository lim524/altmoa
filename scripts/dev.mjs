import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GET } from '../api/index.mjs';
try { process.loadEnvFile('.env.local'); } catch {}
const root = path.resolve('dist');
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost:3000');
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
      const response = await GET(new Request(url));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      return res.end(Buffer.from(await response.arrayBuffer()));
    }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(3000, '127.0.0.1', () => console.log('Altmoa: http://localhost:3000'));
