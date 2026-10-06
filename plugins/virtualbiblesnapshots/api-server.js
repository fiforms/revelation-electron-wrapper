// Registers HTTP API routes for the virtualbiblesnapshots plugin.
// Called by apiServer._loadPluginRoutes() at startup.
//
// GET  /api/virtualbiblesnapshots/search  — search remote VRBM catalogue
// POST /api/virtualbiblesnapshots/import  — body { md5 } (looked up across all configured
//                                           libraries); downloads into _media, returns front-matter YAML

const https = require('https');
const path  = require('path');
const fs    = require('fs');
const yaml  = require('js-yaml');

// ─── simple in-memory JSON cache (1 hour TTL) ─────────────────────────────
const _cache = {};
const CACHE_TTL = 60 * 60 * 1000;

function fetchJson(url) {
  const hit = _cache[url];
  if (hit && Date.now() < hit.expires) return Promise.resolve(hit.data);
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'revelation-app' } }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(Object.assign(new Error(`HTTP ${res.statusCode} fetching ${url}`), { status: 502 }));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          _cache[url] = { data, expires: Date.now() + CACHE_TTL };
          resolve(data);
        } catch {
          reject(Object.assign(new Error(`Invalid JSON from ${url}`), { status: 502 }));
        }
      });
    }).on('error', reject);
  });
}

// ─── shared helpers (mirrors addmedia/api-server.js) ──────────────────────

function generateTag(meta) {
  const base = (meta.original_filename || meta.filename || 'media')
    .split(/\W+/)[0].slice(0, 7).toLowerCase() || 'media';
  const digits = (meta.filename.match(/\d/g) || []).slice(0, 4);
  while (digits.length < 4) digits.push('0');
  return `${base}${digits.join('')}`;
}

function buildEntry(meta) {
  const fields = {
    filename:    meta.filename    || '',
    title:       meta.title       || '',
    mediatype:   meta.mediatype   || '',
    description: meta.description || '',
    attribution: meta.attribution || '',
    license:     meta.license     || '',
    url_origin:  meta.url_origin  || '',
    url_library: meta.url_library || '',
    url_direct:  meta.url_direct  || ''
  };
  const required = new Set(['filename', 'title', 'mediatype']);
  for (const [k, v] of Object.entries(fields)) {
    if (!required.has(k) && v === '') delete fields[k];
  }
  if (meta.large_variant?.filename) {
    const lv = { filename: meta.large_variant.filename };
    if (meta.large_variant.original_filename) lv.original_filename = meta.large_variant.original_filename;
    if (meta.large_variant.url_direct)        lv.url_direct        = meta.large_variant.url_direct;
    fields.large_variant = lv;
  }
  return fields;
}

// ─── md5 lookup (searches all libs, uses cache if warm) ───────────────────

async function findByMd5(md5, cfg, warn) {
  const apiBase = (cfg.apiBase || 'https://content.vrbm.org').replace(/\/$/, '');
  const libs    = (cfg.libraries || '/thumbs,/videos,/music,/illustrations')
    .split(',').map(s => s.trim()).filter(Boolean);
  for (const lib of libs) {
    const libName = lib.replace(/^\//, '');
    let rows;
    try { rows = await fetchJson(`${apiBase}/${libName}/snapshots.json`); }
    catch (err) { warn?.(`[vbs import] skipping ${libName}: ${err.message}`); continue; }
    const row = rows.find(r => r.md5 === md5);
    if (row) return row;
  }
  return null;
}

// ─── routes ───────────────────────────────────────────────────────────────

module.exports = {
  register(routes, callPlugin, AppContext) {

    function getCfg() {
      return AppContext.plugins?.['virtualbiblesnapshots']?.config || {};
    }

    // GET /api/virtualbiblesnapshots/search?query=nature&collection=thumbs&maxResults=30
    //
    // Returns a YAML list of matching items. Each item contains all fields
    // needed to identify the asset AND to pass directly to the import endpoint.
    // Collections: thumbs | videos | music | illustrations
    routes['GET /api/virtualbiblesnapshots/search'] = async (sp) => {
      const query = sp.get('query') || '';
      if (!query) throw { status: 400, message: 'Missing query parameter' };
      const maxResults     = Math.min(parseInt(sp.get('maxResults') || '30', 10), 100);
      const collectionFilter = sp.get('collection') || '';

      const cfg     = getCfg();
      const apiBase = (cfg.apiBase || 'https://content.vrbm.org').replace(/\/$/, '');
      const libs    = (cfg.libraries || '/thumbs,/videos,/music,/illustrations')
        .split(',').map(s => s.trim()).filter(Boolean);

      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const matches = []; // { date, hit }

      for (const lib of libs) {
        const libName = lib.replace(/^\//, '');
        if (collectionFilter && libName !== collectionFilter) continue;

        let rows;
        try { rows = await fetchJson(`${apiBase}/${libName}/snapshots.json`); }
        catch (err) {
          AppContext.warn?.(`[vbs search] skipping ${libName}: ${err.message}`);
          continue;
        }

        for (const row of rows) {
          if (row.xx === 'XX') continue;
          const hay = [row.dir, row.filename, row.desc]
            .map(s => String(s || '').toLowerCase()).join(' ');
          if (!terms.every(t => hay.includes(t))) continue;

          // Display fields only — omit empty values for clean YAML output.
          const hit = {};
          const display = {
            ftype:    row.ftype                    || '',
            filename: row.filename                 || '',
            md5:      row.md5                      || '',
            dir:      row.dir                      || '',
            desc:     (row.desc || '').slice(0, 120),
            arttype:  row.arttype                  || ''
          };
          for (const [k, v] of Object.entries(display)) {
            if (v) hit[k] = v;
          }
          matches.push({ date: row.date || '', hit });
        }
      }

      matches.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      return matches.slice(0, maxResults).map(m => m.hit);
    };

    // POST /api/virtualbiblesnapshots/import
    // Body: { "md5": "<md5 from a search result>" }  (the full item is re-resolved
    // server-side from the remote snapshots.json, not trusted from the client)
    //
    // Downloads the asset into the shared _media library, then returns a
    // text/yaml snippet ready to paste directly under `media:` in front matter
    // (identical format to GET /api/addmedia/item).
    routes['POST /api/virtualbiblesnapshots/import'] = async (sp, res, body) => {
      const md5 = body?.md5;
      if (!md5) throw { status: 400, message: 'Request body must include md5 (e.g. md5=abc123)' };

      const item = await findByMd5(md5, getCfg(), AppContext.warn?.bind(AppContext));
      if (!item) throw { status: 404, message: `No item found with md5: ${md5}` };

      const importResult = await callPlugin('fetch-to-media-library', { item });
      if (!importResult?.success) {
        throw { status: 500, message: importResult?.error || 'Import failed' };
      }

      const filename = importResult.filename || importResult.stored?.[0]?.filename;
      if (!filename) throw { status: 500, message: 'Import succeeded but no filename was returned' };

      const metaPath = path.join(AppContext.config.presentationsDir, '_media', `${filename}.json`);
      if (!fs.existsSync(metaPath)) {
        throw { status: 500, message: `Imported metadata not found: ${filename}.json` };
      }

      const meta    = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const tag     = generateTag(meta);
      const entry   = buildEntry(meta);
      const snippet = yaml.dump({ [tag]: entry }, { lineWidth: -1 });
      const buf     = Buffer.from(snippet, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/yaml; charset=utf-8', 'Content-Length': buf.length });
      res.end(buf);
      // return undefined so apiServer skips its own wrapping
    };

  }
};
