const https = require('https');

const AU_TO_KM      = 149597870.7;
const CANDIDATE_IDS = ['-1024', '-64']; // Artemis II, Artemis I

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
    QUANTITIES: '20',
  });

  https.get(`https://ssd.jpl.nasa.gov/api/horizons.api?${params}`, res => {
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
  for (let i = 2; i < parts.length; i++) {
    const v = parseFloat(parts[i]);
    if (Number.isFinite(v) && v > 0 && v < 10) return v * AU_TO_KM;
  }
  return null;
}

function findActive(ids, callback) {
  if (!ids.length) { callback(null, null); return; }
  const [id, ...rest] = ids;
  horizonsGet(id, '500@399', (err, data) => {
    if (err) { findActive(rest, callback); return; }
    const earthKm = parseRange(data.result || '');
    if (!earthKm) { findActive(rest, callback); return; }
    callback(null, { id, earthKm });
  });
}

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  findActive(CANDIDATE_IDS, (err, found) => {
    if (err || !found) {
      res.status(404).json({ error: 'no_active_mission' });
      return;
    }

    horizonsGet(found.id, '500@301', (err2, moonData) => {
      const moonKm = (!err2 && moonData) ? parseRange(moonData.result || '') : null;
      res.json({
        spacecraftId: found.id,
        earthKm:      Math.round(found.earthKm),
        moonKm:       moonKm ? Math.round(moonKm) : null,
        fetchedAt:    new Date().toISOString(),
      });
    });
  });
};
