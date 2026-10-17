import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GET, POST } from '../api/index.mjs';
try { process.loadEnvFile('.env.local'); } catch {}
const root = path.resolve('dist');
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost:3000');
    if (url.pathname==='/community'){url.searchParams.set('route','public-community');url.pathname='/api/index';}else if(url.pathname.startsWith('/posts/')){url.searchParams.set('route','public-post');url.searchParams.set('id',url.pathname.slice(7));url.pathname='/api/index';}
    if (url.pathname.startsWith('/api/')) {
      if (!['GET','POST'].includes(req.method)) { res.writeHead(405); return res.end(); }
      let body;
      if(req.method==='POST'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>12000){res.writeHead(413);return res.end('Request too large');}chunks.push(chunk);}body=Buffer.concat(chunks);}
      const response = await (req.method==='POST'?POST:GET)(new Request(url,{method:req.method,headers:req.headers,...(body?{body}:{})}));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      return res.end(Buffer.from(await response.arrayBuffer()));
    }
    let file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    try{if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');}catch{}
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.xml':'application/xml; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(3000, '127.0.0.1', () => console.log('Altmoa: http://localhost:3000'));
