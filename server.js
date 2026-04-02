const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT = 3000;
const AU_TO_KM = 149597870.7;
const CANDIDATE_IDS = ['-1024', '-64']; // Artemis II, Artemis I


// ── Horizons fetch ──────────────────────────────────────────────────────────

function horizonsGet(command, center, callback) {
  const now  = new Date();
  const stop = new Date(now.getTime() + 3_600_000);
  const fmt  = d => d.toISOString().slice(0, 16);

  const params = new URLSearchParams({
    format:     'json',
    COMMAND:    command,
    EPHEM_TYPE: 'OBSERVER',
    CENTER:     center,
    START_TIME: fmt(now),
    STOP_TIME:  fmt(stop),
    STEP_SIZE:  '1h',
    QUANTITIES: '20',   // observer range (delta) in AU
  });

  const url = `https://ssd.jpl.nasa.gov/api/horizons.api?${params}`;

  https.get(url, res => {
    let raw = '';
    res.on('data', c => raw += c);
    res.on('end',  () => {
      try { callback(null, JSON.parse(raw)); }
      catch(e) { callback(e); }
    });
  }).on('error', callback);
}

function parseRange(text) {
  const soe = text.indexOf('$$SOE');
  const eoe = text.indexOf('$$EOE');
  if (soe === -1 || eoe === -1) return null;

  const line = text.slice(soe + 5, eoe).trim().split('\n').find(l => l.trim());
  if (!line) return null;

  const parts = line.trim().split(/\s+/);
  // Line: "YYYY-Mon-DD HH:MM  deltaAU  deldot"
  for (let i = 2; i < parts.length; i++) {
    const v = parseFloat(parts[i]);
    if (Number.isFinite(v) && v > 0 && v < 10) return v * AU_TO_KM;
  }
  return null;
}

// ── Try IDs until one has live data ────────────────────────────────────────

function findActiveSpacecraft(ids, callback) {
  if (!ids.length) { callback(null, null); return; }
  const [id, ...rest] = ids;
  horizonsGet(id, '500@399', (err, data) => {
    if (err) { findActiveSpacecraft(rest, callback); return; }
    const earthKm = parseRange(data.result || '');
    if (!earthKm)  { findActiveSpacecraft(rest, callback); return; }
    callback(null, { id, earthKm });
  });
}

// ── HTTP server ─────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const staticFiles = {
    '/':             ['public/index.html',    'text/html; charset=utf-8'],
    '/index.html':   ['public/index.html',    'text/html; charset=utf-8'],
    '/manifest.json':['public/manifest.json', 'application/manifest+json'],
    '/icon.png':     ['public/icon.png',      'image/png'],
  };

  if (staticFiles[req.url]) {
    const [file, mime] = staticFiles[req.url];
    res.writeHead(200, { 'Content-Type': mime });
    res.end(fs.readFileSync(path.join(__dirname, file)));
    return;
  }

  // Distance API endpoint
  if (req.url === '/api/distance') {
    findActiveSpacecraft(CANDIDATE_IDS, (err, found) => {
      if (err || !found) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no_active_mission' }));
        return;
      }

      horizonsGet(found.id, '500@301', (err2, moonData) => {
        const moonKm = (!err2 && moonData) ? parseRange(moonData.result || '') : null;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          spacecraftId: found.id,
          earthKm:      Math.round(found.earthKm),
          moonKm:       moonKm ? Math.round(moonKm) : null,
          fetchedAt:    new Date().toISOString(),
        }));
      });
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Artemis Tracker → http://localhost:${PORT}`);
});
