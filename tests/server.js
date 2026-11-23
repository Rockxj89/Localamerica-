// Local stand-in for Vercel, used by the browser tests on pull requests (before anything is live).
// Serves the site's files and runs the api/ pages with the same redirects and short links as vercel.json.
// Run from anywhere: node tests/server.js (port 3000, or PORT).
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mp4': 'video/mp4', '.webp': 'image/webp'
};

// "/places/:slug" or "/:slug(camp|swimming)" -> a pattern with named parts
function compile(source) {
  const parts = source.split('/').map((seg) => {
    const m = /^:(\w+)(?:\((.*)\))?$/.exec(seg);
    if (!m) return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `(?<${m[1]}>${m[2] || '[^/]+'})`;
  });
  return new RegExp('^' + parts.join('/') + '$');
}
const fill = (dest, groups) => dest.replace(/:(\w+)/g, (all, k) => (k in groups ? encodeURIComponent(groups[k]) : all));
const redirects = (cfg.redirects || []).map((r) => ({ re: compile(r.source), ...r }));
const rewrites = (cfg.rewrites || []).map((r) => ({ re: compile(r.source), ...r }));

function runApi(name, query, req, res) {
  const file = path.join(ROOT, 'api', name + '.js');
  if (!/^[a-z0-9-]+$/.test(name) || !fs.existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
  req.query = query;
  Promise.resolve(require(file)(req, res)).catch((e) => {
    console.error(e);
    if (!res.headersSent) res.statusCode = 500;
    res.end('Server error');
  });
}

function serveFile(pathname, res) {
  const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const file = path.normalize(path.join(ROOT, rel));
  const inside = file.startsWith(ROOT + path.sep);
  const hidden = rel.split('/').some((s) => s.startsWith('.')) || rel.startsWith('/tests/') || rel.startsWith('/node_modules/');
  if (!inside || hidden || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const query = Object.fromEntries(url.searchParams);

  for (const r of redirects) {
    const m = r.re.exec(url.pathname);
    if (m) {
      res.statusCode = r.permanent ? 308 : 307;
      res.setHeader('Location', fill(r.destination, m.groups || {}));
      return res.end();
    }
  }
  for (const r of rewrites) {
    const m = r.re.exec(url.pathname);
    if (m) {
      const dest = new URL(fill(r.destination, m.groups || {}), 'http://localhost');
      const q = { ...Object.fromEntries(dest.searchParams), ...query };
      const api = /^\/api\/([a-z0-9-]+)$/.exec(dest.pathname);
      return api ? runApi(api[1], q, req, res) : serveFile(dest.pathname, res);
    }
  }
  const api = /^\/api\/([a-z0-9-]+)$/.exec(url.pathname);
  if (api) return runApi(api[1], query, req, res);
  return serveFile(url.pathname, res);
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`Local America test server on http://localhost:${port}`));
