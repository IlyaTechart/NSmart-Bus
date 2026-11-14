/* Dev preview on the PC: serves www/ and proxies upstream requests like the Android bridge does.
 *   node tools/devserver.js [port]   -> http://localhost:8787/   (#screen=lines, #screen=timetable, #drawer, #focus=14) */
const http = require('http'), fs = require('fs'), path = require('path');
const WWW = path.join(__dirname, '..', 'www');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const SHIM = '<script>window.AndroidNet={request:function(id,m,u,b,h,t){fetch("/__proxy",{method:"POST",body:JSON.stringify({m:m,u:u,b:b,h:JSON.parse(h)})})' +
  '.then(function(r){return r.json()}).then(function(j){__httpDone(id,j.status,j.text)}).catch(function(e){__httpDone(id,-1,String(e))})}};</script>';
http.createServer(async (req, res) => {
  if (req.url === '/__proxy') {
    let body = ''; for await (const c of req) body += c;
    const q = JSON.parse(body);
    try {
      const r = await fetch(q.u, { method: q.m, body: q.m === 'POST' ? q.b : undefined, headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 (Trecker dev)' }, q.h) });
      const text = await r.text();
      res.end(JSON.stringify({ status: r.status, text }));
    } catch (e) { res.end(JSON.stringify({ status: -1, text: String(e) })); }
    return;
  }
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(WWW, p);
  if (!f.startsWith(WWW) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('404'); }
  let data = fs.readFileSync(f);
  if (p === '/index.html') data = data.toString().replace('<script src="js/net.js">', SHIM + '<script src="js/net.js">');
  res.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream');
  res.end(data);
}).listen(+(process.argv[2] || 8787), () => console.log('dev server on', +(process.argv[2] || 8787)));
