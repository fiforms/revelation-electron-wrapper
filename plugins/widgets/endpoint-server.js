// plugins/widgets/endpoint-server.js
//
// The "host" half of the overlay widget contract (see overlaywidgets/README.md):
// validates parameter values against a widget's manifest, expands the
// manifest's endpoint templates, fetches them under the safety rules, and
// returns data in the shape each endpoint's `expect` promises.
//
// Runs in the Electron main process. The renderer only ever names a widget, an
// endpoint and some values; the URL always comes from the manifest.

const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const https = require('https');
const ICAL = require('ical.js');


const WIDGETS_DIR = path.join(__dirname, 'overlaywidgets');
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;
const MIN_TTL = 60;

class WidgetError extends Error {
  constructor(reason, status) {
    super(`Widget data unavailable: ${reason}`);
    this.reason = reason;
    if (status) this.status = status;
  }
}

// ---------------------------------------------------------------- manifests

const manifestCache = new Map();

function listWidgets() {
  if (!fs.existsSync(WIDGETS_DIR)) return [];
  return fs.readdirSync(WIDGETS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && ID_RE.test(d.name) && fs.existsSync(path.join(WIDGETS_DIR, d.name, 'manifest.json')))
    .map(d => d.name)
    .sort();
}

function loadManifest(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new WidgetError('unknown_widget');
  if (manifestCache.has(id)) return manifestCache.get(id);
  const file = path.join(WIDGETS_DIR, id, 'manifest.json');
  if (!fs.existsSync(file)) throw new WidgetError('unknown_widget');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifestCache.set(id, manifest);
  return manifest;
}

// Validation lives in validate.js (shared with the browser).
const { validateValue, validateParams } = require('./validate');

// ----------------------------------------------------------------- endpoints

function expandTemplate(endpoint, params, args) {
  const template = String(endpoint.url);

  // Whole-URL endpoint: a single {name} naming a url parameter.
  const whole = template.match(/^\{([a-z][a-z0-9_]*)\}$/);
  if (whole) {
    const value = params[whole[1]];
    if (!value) throw new WidgetError('not_configured');
    return value;
  }

  const cleanArgs = {};
  for (const [name, def] of Object.entries(endpoint.args || {})) {
    cleanArgs[name] = validateValue(def, args && args[name], 'invalid_args');
    if (cleanArgs[name] === null || cleanArgs[name] === '') throw new WidgetError('invalid_args');
  }

  return template.replace(/\{(?:(arg|secret):)?([a-z][a-z0-9_]*)\}/g, (_m, kind, name) => {
    if (kind === 'secret') throw new WidgetError('not_configured'); // no admin settings UI yet
    const source = kind === 'arg' ? cleanArgs : params;
    const v = source[name];
    if (v === undefined || v === null || v === '') throw new WidgetError('not_configured');
    return encodeURIComponent(String(v));
  });
}

// ------------------------------------------------------------------- network

function isPublicAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a >= 224) return false;
    return true;
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]);
    if (lower === '::' || lower === '::1') return false;
    if (/^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith('ff')) return false;
    return true;
  }
  return false;
}

// Resolve once, check every address, and connect to the address we checked so a
// second lookup can't return something different.
async function resolvePublic(hostname) {
  if (net.isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new WidgetError('blocked_address');
    return { address: hostname, family: net.isIPv6(hostname) ? 6 : 4 };
  }
  let records;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    throw new WidgetError('dns_failed');
  }
  if (!records.length || !records.every(r => isPublicAddress(r.address))) {
    throw new WidgetError('blocked_address');
  }
  return records[0];
}

function requestOnce(url) {
  return resolvePublic(url.hostname).then(({ address, family }) => new Promise((resolve, reject) => {
    const req = https.request({
      host: address,
      family,
      servername: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { host: url.host, 'user-agent': 'REVELation-widgets/1.0', accept: '*/*' },
      timeout: TIMEOUT_MS
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve({ redirect: res.headers.location });
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new WidgetError('upstream_status', res.statusCode));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          req.destroy();
          reject(new WidgetError('too_large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', () => reject(new WidgetError('upstream_unreachable')));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', err => reject(err instanceof WidgetError ? err : new WidgetError('upstream_unreachable')));
    req.end();
  }));
}

async function httpsGet(urlString) {
  let current = urlString;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let url;
    try { url = new URL(current); } catch { throw new WidgetError('blocked_url'); }
    if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password) {
      throw new WidgetError(hop === 0 ? 'blocked_url' : 'blocked_redirect');
    }
    const result = await requestOnce(url);
    if (result.redirect) {
      current = new URL(result.redirect, url).toString();
      continue;
    }
    return result.body;
  }
  throw new WidgetError('too_many_redirects');
}

// ---------------------------------------------------------------------- iCal

function pad(n) { return String(n).padStart(2, '0'); }

function formatTime(time, allDay) {
  if (allDay) return `${time.year}-${pad(time.month)}-${pad(time.day)}`;
  return time.toJSDate().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function parseIcal(text, days) {
  let root;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new WidgetError('invalid_response');
  }
  if (root.name !== 'vcalendar') throw new WidgetError('invalid_response');

  for (const vtz of root.getAllSubcomponents('vtimezone')) {
    try {
      const tz = new ICAL.Timezone(vtz);
      if (!ICAL.TimezoneService.has(tz.tzid)) ICAL.TimezoneService.register(tz.tzid, tz);
    } catch { /* unknown zone: dates fall back to floating */ }
  }

  const windowStart = Date.now() - 24 * 3600 * 1000; // keep today's earlier events
  const windowEnd = Date.now() + days * 24 * 3600 * 1000;

  // Group so RECURRENCE-ID overrides attach to their series.
  const series = new Map();
  for (const vevent of root.getAllSubcomponents('vevent')) {
    const uid = String(vevent.getFirstPropertyValue('uid') || '');
    if (!series.has(uid)) series.set(uid, { master: null, overrides: [] });
    const group = series.get(uid);
    if (vevent.hasProperty('recurrence-id')) group.overrides.push(vevent);
    else group.master = vevent;
  }

  const events = [];
  const push = (ev, start, end, uid) => {
    const allDay = start.isDate;
    const startMs = start.toJSDate().getTime();
    if (startMs > windowEnd) return false;
    const endMs = end.toJSDate().getTime();
    if (endMs < windowStart) return true;
    events.push({
      uid,
      title: String(ev.summary || ''),
      location: String(ev.location || ''),
      description: String(ev.description || ''),
      start: formatTime(start, allDay),
      end: formatTime(end, allDay),
      all_day: allDay
    });
    return true;
  };

  for (const [uid, group] of series) {
    const master = group.master || group.overrides[0];
    if (!master) continue;
    let ev;
    try { ev = new ICAL.Event(master); } catch { continue; }
    if (!ev.startDate) continue;

    if (!ev.isRecurring()) {
      const end = ev.endDate || ev.startDate;
      push(ev, ev.startDate, end, uid);
      continue;
    }

    for (const ovr of group.overrides) {
      try { ev.relateException(new ICAL.Event(ovr)); } catch { /* ignore broken override */ }
    }
    const iterator = ev.iterator();
    let next;
    let guard = 0;
    while ((next = iterator.next()) && guard++ < 2000) {
      const details = ev.getOccurrenceDetails(next);
      if (!push(details.item, details.startDate, details.endDate, uid)) break;
    }
  }

  events.sort((a, b) => a.start.localeCompare(b.start));
  const name = root.getFirstPropertyValue('x-wr-calname') || '';
  const tzProp = root.getFirstPropertyValue('x-wr-timezone') || '';
  return { name: String(name), timezone: String(tzProp), events };
}

function shapeResponse(expect, body, endpoint) {
  switch (expect) {
    case 'text':
      return body;
    case 'json':
      try { return JSON.parse(body); } catch { throw new WidgetError('invalid_response'); }
    case 'ical':
      return parseIcal(body, Math.min(Math.max(Number(endpoint.days) || 60, 1), 366));
    default:
      throw new WidgetError('invalid_response');
  }
}

// --------------------------------------------------------------------- cache

const cache = new Map(); // url -> { at, ttl, expect, data }
const MAX_CACHE_ENTRIES = 200;

async function fetchEndpoint({ widget, endpoint: endpointName, params, args }) {
  const manifest = loadManifest(widget);
  if (typeof endpointName !== 'string' || !NAME_RE.test(endpointName)
    || !Object.prototype.hasOwnProperty.call(manifest.endpoints || {}, endpointName)) {
    throw new WidgetError('unknown_endpoint');
  }
  const endpoint = manifest.endpoints[endpointName];
  const cleanParams = validateParams(manifest, params);
  const url = expandTemplate(endpoint, cleanParams, args);

  const key = `${endpoint.expect}|${endpoint.days || ''}|${url}`;
  const ttl = Math.max(Math.min(Number(endpoint.ttl) || 0, 86400), MIN_TTL);
  const hit = cache.get(key);
  const nowSec = Math.floor(Date.now() / 1000);
  if (hit && nowSec - hit.at < ttl) {
    return { data: hit.data, fetched_at: hit.at, stale: false };
  }

  try {
    const body = await httpsGet(url);
    const data = shapeResponse(endpoint.expect, body, endpoint);
    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(key, { at: nowSec, data });
    return { data, fetched_at: nowSec, stale: false };
  } catch (err) {
    if (hit) return { data: hit.data, fetched_at: hit.at, stale: true };
    throw err;
  }
}

// Wrapper for IPC: errors can't carry custom fields across contextBridge, so
// they come back as a plain { error: { reason } } result.
async function fetchEndpointSafe(request) {
  try {
    return await fetchEndpoint(request || {});
  } catch (err) {
    return { error: { reason: err.reason || 'upstream_unreachable', status: err.status } };
  }
}

module.exports = {
  WIDGETS_DIR,
  WidgetError,
  listWidgets,
  loadManifest,
  validateParams,
  fetchEndpoint,
  fetchEndpointSafe,
  parseIcal,
  isPublicAddress
};
