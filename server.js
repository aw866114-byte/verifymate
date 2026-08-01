// Local dev server: serves index.html and routes /api/verify to the handler.
const http = require('http'); const fs = require('fs'); const path = require('path');
const verify = require('./api/verify');
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/verify') { req.query = Object.fromEntries(u.searchParams); return verify(req, res); }
  const file = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
  const fp = path.join(__dirname, file);
  if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : 'text/plain');
    return res.end(fs.readFileSync(fp));
  }
  res.statusCode = 404; res.end('not found');
}).listen(3000, () => console.log('VerifyMate dev on http://localhost:3000'));
