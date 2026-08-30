'use strict';
/*
 * Print Control Centre — storage server
 *
 * Serves the static app and keeps the SQLite database as a file on disk.
 * The browser holds the database in memory (sql.js) and pushes the whole
 * file back on every change, exactly as it does when writing to a local
 * disk. The only addition here is a version token, so a second browser
 * cannot silently overwrite the first one's work.
 *
 * No dependencies — Node's standard library only.
 */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const PORT     = parseInt(process.env.PORT || '3737', 10);
const DB_PATH  = process.env.DB_PATH || '/data/printhour.sqlite';
const DATA_DIR = path.dirname(DB_PATH);
const BACKUPS  = path.join(DATA_DIR, 'backups');
const META     = path.join(DATA_DIR, 'meta.json');
const PUBLIC   = path.join(__dirname, 'public');
const KEEP     = parseInt(process.env.KEEP_BACKUPS || '14', 10);
const MAX_BODY = 64 * 1024 * 1024;

const TYPES = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',   '.wasm':'application/wasm',
  '.json':'application/json',         '.png':'image/png',
  '.svg':'image/svg+xml',             '.ico':'image/x-icon',
  '.txt':'text/plain; charset=utf-8'
};

async function readMeta(){
  try { return JSON.parse(await fsp.readFile(META,'utf8')); }
  catch { return { version: 0, updated: null }; }
}
async function writeMeta(m){
  await fsp.writeFile(META + '.tmp', JSON.stringify(m,null,2));
  await fsp.rename(META + '.tmp', META);
}
async function dbSize(){
  try { return (await fsp.stat(DB_PATH)).size; } catch { return 0; }
}

/* One snapshot per day, kept for KEEP days. Cheap insurance against
   "I deleted the wrong thing three hours ago". */
async function snapshot(){
  const size = await dbSize();
  if (!size) return;
  await fsp.mkdir(BACKUPS, { recursive: true });
  const day = new Date().toISOString().slice(0,10);
  const target = path.join(BACKUPS, `printhour-${day}.sqlite`);
  try { await fsp.access(target); return; } catch { /* not made yet today */ }
  await fsp.copyFile(DB_PATH, target);
  const files = (await fsp.readdir(BACKUPS)).filter(f=>f.endsWith('.sqlite')).sort();
  for (const old of files.slice(0, Math.max(0, files.length - KEEP))) {
    await fsp.unlink(path.join(BACKUPS, old)).catch(()=>{});
  }
}

function send(res, code, body, headers){
  res.writeHead(code, Object.assign({ 'Cache-Control':'no-store' }, headers||{}));
  res.end(body);
}
function json(res, code, obj, headers){
  send(res, code, JSON.stringify(obj), Object.assign({'Content-Type':'application/json'}, headers||{}));
}

function readBody(req){
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0;
    req.on('data', c => {
      total += c.length;
      if (total > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function serveStatic(req, res, urlPath){
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  try {
    const st = await fsp.stat(file);
    if (st.isDirectory()) return send(res, 404, 'Not found');
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control':'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch {
    send(res, 404, 'Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  try {
    if (url === '/api/health') return json(res, 200, { ok: true });

    if (url === '/api/db/meta' && req.method === 'GET') {
      const m = await readMeta();
      return json(res, 200, {
        version: m.version, updated: m.updated,
        size: await dbSize(), file: path.basename(DB_PATH), storage: 'umbrel'
      });
    }

    if (url === '/api/db' && req.method === 'GET') {
      const m = await readMeta();
      const size = await dbSize();
      if (!size) return send(res, 204, '', { 'X-DB-Version': String(m.version) });
      res.writeHead(200, {
        'Content-Type': 'application/vnd.sqlite3',
        'Content-Length': size,
        'X-DB-Version': String(m.version),
        'Cache-Control': 'no-store'
      });
      return fs.createReadStream(DB_PATH).pipe(res);
    }

    if (url === '/api/db' && req.method === 'PUT') {
      const m = await readMeta();
      const claimed = req.headers['if-match'];
      const size = await dbSize();

      // A first write against an empty database needs no token.
      if (size > 0 && claimed !== undefined && claimed !== '' && String(m.version) !== String(claimed)) {
        return json(res, 409, {
          error: 'stale',
          message: 'The database changed in another browser or tab.',
          version: m.version, updated: m.updated
        }, { 'X-DB-Version': String(m.version) });
      }

      const body = await readBody(req);
      if (!body.length) return json(res, 400, { error: 'empty body' });
      if (body.slice(0, 15).toString('latin1') !== 'SQLite format 3')
        return json(res, 400, { error: 'not a SQLite file' });

      await fsp.mkdir(DATA_DIR, { recursive: true });
      await snapshot();

      const tmp = DB_PATH + '.tmp';
      const fh = await fsp.open(tmp, 'w');
      await fh.writeFile(body);
      await fh.sync();               // on disk before the rename
      await fh.close();
      await fsp.rename(tmp, DB_PATH);

      const next = { version: m.version + 1, updated: new Date().toISOString() };
      await writeMeta(next);
      return json(res, 200, { ok: true, version: next.version, updated: next.updated, bytes: body.length },
                  { 'X-DB-Version': String(next.version) });
    }

    if (url === '/api/backups' && req.method === 'GET') {
      let files = [];
      try {
        files = (await fsp.readdir(BACKUPS)).filter(f => f.endsWith('.sqlite')).sort().reverse();
      } catch { /* none yet */ }
      return json(res, 200, { backups: files });
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url);
    return send(res, 405, 'Method not allowed');

  } catch (err) {
    console.error('[printhour]', err);
    return json(res, 500, { error: String(err.message || err) });
  }
});

/* Prove at startup that the data directory is writable. A read-only mount is
   the single most common deployment mistake, and without this check the app
   looks healthy right up until the first save fails. */
async function checkWritable() {
  const probe = path.join(DATA_DIR, '.write-probe');
  await fsp.writeFile(probe, 'ok');
  await fsp.unlink(probe);
}

fsp.mkdir(DATA_DIR, { recursive: true })
  .then(checkWritable)
  .then(() => server.listen(PORT, '0.0.0.0', () => {
    console.log(`[printhour] listening on ${PORT}`);
    console.log(`[printhour] database: ${DB_PATH}`);
    console.log('[printhour] data directory is writable');
  }))
  .catch(err => {
    console.error('');
    console.error('[printhour] CANNOT WRITE TO ' + DATA_DIR);
    console.error('[printhour] ' + err.message);
    console.error('[printhour] The container runs as uid 1500. Fix the host folder with:');
    console.error('[printhour]   sudo chown -R 1500:1500 <the folder you mounted at /data>');
    console.error('');
    process.exit(1);
  });

for (const sig of ['SIGTERM','SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
