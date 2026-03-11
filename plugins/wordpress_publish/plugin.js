const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const { URL } = require('url');
const os = require('os');
const { BrowserWindow } = require('electron');

function requireAppLibModule(moduleName) {
  const candidates = [
    path.join(__dirname, '..', '..', 'lib', moduleName),
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar', 'lib', moduleName) : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app', 'lib', moduleName) : null,
    path.join(process.cwd(), 'lib', moduleName)
  ].filter(Boolean);

  let lastError = null;
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (err) {
      lastError = err;
      if (err?.code !== 'MODULE_NOT_FOUND' || !String(err.message || '').includes(candidate)) {
        throw err;
      }
    }
  }

  const searched = candidates.map((candidate) => `${candidate}.js`).join(', ');
  const baseMessage = lastError?.message ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Unable to resolve app module "${moduleName}". Searched: ${searched}.${baseMessage}`);
}

const { signChallenge, fingerprintPublicKey } = requireAppLibModule('peerAuth');
const configManager = requireAppLibModule('configManager');
const { writePresentationManifest, MANIFEST_FILENAME } = requireAppLibModule('presentationManifest');

let AppCtx = null;
const MAX_IN_MEMORY_UPLOAD_REQUEST_BYTES = 64 * 1024 * 1024;
const DEFAULT_UPLOAD_CHUNK_SIZE_BYTES = 8 * 1024 * 1024;

function normalizeSiteBaseUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new Error('Pairing URL is required.');
  }

  const prefixed = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed;
  try {
    parsed = new URL(prefixed);
  } catch (_err) {
    throw new Error('Pairing URL is invalid.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Pairing URL must use http or https.');
  }

  const trimmedPath = parsed.pathname.replace(/\/+$/, '');
  const wpJsonIdx = trimmedPath.indexOf('/wp-json/');
  if (wpJsonIdx >= 0) {
    parsed.pathname = trimmedPath.slice(0, wpJsonIdx) || '/';
  } else {
    parsed.pathname = trimmedPath || '/';
  }
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
}

function buildEndpoint(baseUrl, path) {
  const parsed = new URL(baseUrl);
  const basePath = parsed.pathname === '/' ? '' : parsed.pathname;
  parsed.pathname = `${basePath}${path}`;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function fetchJson(url, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        rejectUnauthorized: parsed.protocol === 'https:',
        checkServerIdentity: parsed.protocol === 'https:' ? tls.checkServerIdentity : undefined,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          : undefined
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          const raw = String(data || '').trim();
          let json = null;
          if (raw) {
            try {
              json = JSON.parse(raw);
            } catch (_err) {
              json = null;
            }
          }
          if (res.statusCode >= 400) {
            if (res.statusCode === 413) {
              return reject(
                new Error(
                  'Upload rejected: file/request too large (HTTP 413). Increase server limits (for example nginx `client_max_body_size` and PHP `post_max_size` / `upload_max_filesize`) or reduce file size.'
                )
              );
            }
            if (json && typeof json === 'object') {
              return reject(new Error(json?.message || json?.error || `Request failed (${res.statusCode})`));
            }
            const snippet = raw.slice(0, 180).replace(/\s+/g, ' ');
            return reject(new Error(`Request failed (${res.statusCode}) with non-JSON response: ${snippet || '[empty]'}`));
          }
          if (json && typeof json === 'object') {
            return resolve(json);
          }
          if (!raw) {
            return resolve({});
          }
          return reject(new Error('Invalid JSON response from WordPress site. Make sure the WordPress plugin is updated with publish endpoints.'));
        });
      }
    );

    req.setTimeout(12000, () => {
      req.destroy(new Error('Pairing request timed out.'));
    });

    req.on('error', (err) => {
      if (parsed.protocol === 'https:') {
        const code = String(err?.code || '');
        if (['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code)) {
          return reject(new Error(`TLS certificate validation failed for ${parsed.hostname}: ${err.message}`));
        }
      }
      reject(err);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function canonicalizeForSignature(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeForSignature(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${phpJsonEncodeString(key)}:${canonicalizeForSignature(value[key])}`).join(',')}}`;
  }

  if (typeof value === 'string') {
    return phpJsonEncodeString(value);
  }

  return JSON.stringify(value);
}

function phpJsonEncodeString(value) {
  let out = '"';
  for (const ch of String(value)) {
    const code = ch.codePointAt(0);
    switch (ch) {
      case '"':
        out += '\\"';
        break;
      case '\\':
        out += '\\\\';
        break;
      case '/':
        out += '\\/';
        break;
      case '\b':
        out += '\\b';
        break;
      case '\f':
        out += '\\f';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\t':
        out += '\\t';
        break;
      default:
        if (code <= 0x1f || code === 0x7f) {
          out += `\\u${code.toString(16).padStart(4, '0')}`;
          break;
        }
        if (code <= 0xffff) {
          if (code >= 0x80) {
            out += `\\u${code.toString(16).padStart(4, '0')}`;
          } else {
            out += ch;
          }
          break;
        }
        const adjusted = code - 0x10000;
        const high = 0xd800 + (adjusted >> 10);
        const low = 0xdc00 + (adjusted & 0x3ff);
        out += `\\u${high.toString(16).padStart(4, '0')}\\u${low.toString(16).padStart(4, '0')}`;
        break;
    }
  }
  out += '"';
  return out;
}

function createRequestSignatureMessage(action, pairingId, timestamp, nonce, payloadHash) {
  return [String(action || ''), String(pairingId || ''), String(timestamp || ''), String(nonce || ''), String(payloadHash || '')].join('\n');
}

function sha256Base64Url(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('base64url');
}

function buildSignedPublishAuth(action, pairingId, payload, options = {}) {
  if (!AppCtx.config?.rsaPrivateKey || !AppCtx.config?.rsaPublicKey) {
    throw new Error('Local RSA keypair is not available in app config.');
  }

  const excludeFields = Array.isArray(options.excludeFields) ? options.excludeFields : [];
  const signedPayload = { ...(payload || {}) };
  for (const field of excludeFields) {
    delete signedPayload[field];
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = new Date().toISOString();
  const payloadHash = sha256Base64Url(canonicalizeForSignature(signedPayload));
  const message = createRequestSignatureMessage(action, pairingId, timestamp, nonce, payloadHash);

  return {
    method: 'rsa',
    timestamp,
    nonce,
    payloadHash,
    signature: signChallenge(AppCtx.config.rsaPrivateKey, message),
    publicKey: AppCtx.config.rsaPublicKey
  };
}

function ensurePluginConfig() {
  if (!AppCtx.config.pluginConfigs || typeof AppCtx.config.pluginConfigs !== 'object') {
    AppCtx.config.pluginConfigs = {};
  }
  if (!AppCtx.config.pluginConfigs.wordpress_publish || typeof AppCtx.config.pluginConfigs.wordpress_publish !== 'object') {
    AppCtx.config.pluginConfigs.wordpress_publish = {};
  }
  if (!Array.isArray(AppCtx.config.pluginConfigs.wordpress_publish.pairings)) {
    AppCtx.config.pluginConfigs.wordpress_publish.pairings = [];
  }
  const plugin = AppCtx.plugins?.wordpress_publish;
  if (plugin) {
    plugin.config = AppCtx.config.pluginConfigs.wordpress_publish;
  }
  return AppCtx.config.pluginConfigs.wordpress_publish;
}

function persistPluginConfig() {
  if (typeof AppCtx?.saveConfig === 'function') {
    AppCtx.saveConfig(AppCtx.config);
    return;
  }
  if (typeof configManager?.saveConfig === 'function') {
    configManager.saveConfig(AppCtx.config);
    return;
  }
  throw new Error('Config persistence is unavailable.');
}

function emitPluginProgress(event, action, payload = {}) {
  try {
    event?.sender?.send?.('plugin-progress', {
      plugin: 'wordpress_publish',
      action,
      ...payload
    });
  } catch (_err) {
    // Ignore progress delivery errors; they should not fail the operation.
  }
}

function getLocalIdentityPayload() {
  return {
    appName: AppCtx.config?.mdnsInstanceName || 'REVELation',
    claimedHostname: os.hostname(),
    appInstanceId: AppCtx.config?.mdnsInstanceId || '',
    appVersion: AppCtx.version || '',
    appPublicKey: AppCtx.config?.rsaPublicKey || ''
  };
}

async function pairWithRsa(siteBaseUrl) {
  if (!AppCtx.config?.rsaPrivateKey || !AppCtx.config?.rsaPublicKey) {
    throw new Error('Local RSA keypair is not available in app config.');
  }

  const challengeEndpoint = buildEndpoint(siteBaseUrl, '/wp-json/revelation/v1/pair/challenge');
  const pairEndpoint = buildEndpoint(siteBaseUrl, '/wp-json/revelation/v1/pair');
  const challengeResp = await fetchJson(challengeEndpoint, { method: 'POST', body: {} });
  const challenge = String(challengeResp?.challenge || '').trim();

  if (!challenge) {
    throw new Error('WordPress pairing challenge was empty.');
  }

  const signature = signChallenge(AppCtx.config.rsaPrivateKey, challenge);
  const payload = {
    auth: {
      method: 'rsa',
      challenge,
      signature,
      publicKey: AppCtx.config.rsaPublicKey
    },
    client: getLocalIdentityPayload()
  };

  return fetchJson(pairEndpoint, { method: 'POST', body: payload });
}

async function checkPairingStatus(siteBaseUrl, pairingRequestId) {
  if (!AppCtx.config?.rsaPrivateKey || !AppCtx.config?.rsaPublicKey) {
    throw new Error('Local RSA keypair is not available in app config.');
  }
  const id = String(pairingRequestId || '').trim();
  if (!id) {
    throw new Error('pairingRequestId is required.');
  }
  const statusEndpoint = buildEndpoint(siteBaseUrl, '/wp-json/revelation/v1/pair/status');
  const signature = signChallenge(AppCtx.config.rsaPrivateKey, id);
  const payload = {
    pairingRequestId: id,
    auth: {
      method: 'rsa',
      signature,
      publicKey: AppCtx.config.rsaPublicKey
    }
  };
  return fetchJson(statusEndpoint, { method: 'POST', body: payload });
}

function upsertPairingRecord(record) {
  const cfg = ensurePluginConfig();
  const pairings = Array.isArray(cfg.pairings) ? [...cfg.pairings] : [];
  const existingIdx = pairings.findIndex((item) => item?.siteBaseUrl === record.siteBaseUrl);
  if (existingIdx >= 0) {
    pairings[existingIdx] = record;
  } else {
    pairings.push(record);
  }
  cfg.pairings = pairings;
  persistPluginConfig();
  return pairings;
}

function removePairingBySiteBaseUrl(siteBaseUrl) {
  const cfg = ensurePluginConfig();
  const existing = Array.isArray(cfg.pairings) ? cfg.pairings : [];
  cfg.pairings = existing.filter((item) => item?.siteBaseUrl !== siteBaseUrl);
  persistPluginConfig();
  return cfg.pairings;
}

function createPairingWindow(data = {}) {
  const pairingWin = new BrowserWindow({
    width: 760,
    height: 700,
    webPreferences: {
      preload: AppCtx.preload
    }
  });
  pairingWin.setMenu(null);
  const key = AppCtx.config.key;
  const query = new URLSearchParams();
  query.set('key', key);
  if (data?.slug) query.set('slug', String(data.slug));
  if (data?.mdFile) query.set('md', String(data.mdFile));
  if (data?.title) query.set('title', String(data.title));
  pairingWin.loadURL(`http://${AppCtx.hostURL}:${AppCtx.config.viteServerPort}/plugins_${key}/wordpress_publish/pairing.html?${query.toString()}`);
}

function parseJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function findPairingBySiteBaseUrl(siteBaseUrl) {
  const cfg = ensurePluginConfig();
  const normalized = normalizeSiteBaseUrl(siteBaseUrl);
  const pairings = Array.isArray(cfg.pairings) ? cfg.pairings : [];
  return pairings.find((item) => item?.siteBaseUrl === normalized) || null;
}

function safePresentationFilePath(presentationDir, relativePath) {
  const rel = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || rel.includes('\0')) {
    throw new Error(`Invalid manifest file path: ${relativePath}`);
  }
  const parts = rel.split('/');
  for (const part of parts) {
    if (!part || part === '.' || part === '..') {
      throw new Error(`Unsafe manifest file path: ${relativePath}`);
    }
  }
  const target = path.resolve(path.join(presentationDir, rel));
  const base = `${path.resolve(presentationDir)}${path.sep}`;
  if (!target.startsWith(base)) {
    throw new Error(`Unsafe manifest file path: ${relativePath}`);
  }
  return target;
}

function safeMediaLibraryFilePath(mediaDir, relativePath) {
  const rel = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || rel.includes('\0')) {
    throw new Error(`Invalid media library file path: ${relativePath}`);
  }
  const parts = rel.split('/');
  for (const part of parts) {
    if (!part || part === '.' || part === '..') {
      throw new Error(`Unsafe media library file path: ${relativePath}`);
    }
  }
  const target = path.resolve(path.join(mediaDir, rel));
  const base = `${path.resolve(mediaDir)}${path.sep}`;
  if (!target.startsWith(base)) {
    throw new Error(`Unsafe media library file path: ${relativePath}`);
  }
  return target;
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function estimateUploadRequestBytes(filename, modified, fileBytes) {
  const b64Len = Math.ceil(Math.max(0, Number(fileBytes) || 0) / 3) * 4;
  const envelope = {
    pairingId: '00000000-0000-0000-0000-000000000000',
    publishToken: 'x'.repeat(32),
    localSlug: 'x',
    remoteSlug: 'x',
    filename: String(filename || ''),
    modified: String(modified || ''),
    contentBase64: 'x'.repeat(b64Len)
  };
  return Buffer.byteLength(JSON.stringify(envelope), 'utf8');
}

function estimateChunkUploadRequestBytes({ filename, modified, fileBytes, extraFields = {} }) {
  const b64Len = Math.ceil(Math.max(0, Number(fileBytes) || 0) / 3) * 4;
  const envelope = {
    pairingId: '00000000-0000-0000-0000-000000000000',
    publishToken: 'x'.repeat(32),
    filename: String(filename || ''),
    modified: String(modified || ''),
    chunkIndex: 0,
    totalChunks: 1,
    contentBase64: 'x'.repeat(b64Len),
    ...extraFields
  };
  return Buffer.byteLength(JSON.stringify(envelope), 'utf8');
}

function getMaxUploadRequestBytes() {
  const cfg = ensurePluginConfig();
  const rawValue = cfg?.maxUploadRequestBytes;
  if (rawValue === 0 || rawValue === '0') {
    return 0;
  }
  const raw = Number(rawValue);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  // Conservative default to catch common nginx default limits early.
  return 900 * 1024;
}

function getUploadChunkSizeBytes() {
  const cfg = ensurePluginConfig();
  const raw = Number(cfg?.uploadChunkSizeBytes);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_UPLOAD_CHUNK_SIZE_BYTES;
}

function pickEffectiveUploadLimitBytes(serverLimitBytes) {
  const server = Number(serverLimitBytes);
  if (Number.isFinite(server) && server > 0) {
    return {
      bytes: Math.floor(server),
      source: 'server'
    };
  }
  return {
    bytes: getMaxUploadRequestBytes(),
    source: 'client'
  };
}

function ensureUploadFitsProcessMemory(filename, fileSizeBytes, estimatedRequestBytes, label) {
  if (estimatedRequestBytes <= MAX_IN_MEMORY_UPLOAD_REQUEST_BYTES) {
    return;
  }
  throw new Error(
    `${label} upload blocked before request: "${filename}" (${formatBytes(fileSizeBytes)}) would require an estimated ${formatBytes(estimatedRequestBytes)} JSON request, ` +
    `which exceeds the desktop in-memory safety cap of ${formatBytes(MAX_IN_MEMORY_UPLOAD_REQUEST_BYTES)}. ` +
    'This transport base64-encodes files in-process, so larger uploads risk crashing Electron. Reduce file size or use a smaller asset.'
  );
}

function resolvePresentationContext(data = {}) {
  const slug = String(data.slug || '').trim();
  const mdFile = String(data.mdFile || 'presentation.md').trim();
  if (!slug) {
    throw new Error('Presentation slug is required.');
  }
  const presentationDir = path.resolve(path.join(AppCtx.config.presentationsDir, slug));
  if (!presentationDir.startsWith(path.resolve(AppCtx.config.presentationsDir) + path.sep)) {
    throw new Error('Invalid presentation path.');
  }
  if (!fs.existsSync(presentationDir) || !fs.statSync(presentationDir).isDirectory()) {
    throw new Error(`Presentation folder not found: ${slug}`);
  }
  return { slug, mdFile, presentationDir };
}

function getMediaLibraryDir() {
  const mediaDir = path.resolve(path.join(AppCtx.config.presentationsDir, '_media'));
  const expected = `${path.resolve(AppCtx.config.presentationsDir)}${path.sep}`;
  if (!mediaDir.startsWith(expected)) {
    throw new Error('Invalid media library path.');
  }
  if (!fs.existsSync(mediaDir) || !fs.statSync(mediaDir).isDirectory()) {
    throw new Error('Local media library folder not found.');
  }
  return mediaDir;
}

function buildLocalMediaIndex(mediaDir) {
  const files = fs.readdirSync(mediaDir).filter((name) => name.endsWith('.json') && name !== 'index.json' && name !== 'manifest.json');
  const index = {};
  for (const file of files) {
    const fullPath = path.join(mediaDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      if (data?.large_variant?.filename) {
        const variantPath = path.join(mediaDir, data.large_variant.filename);
        data.large_variant_local = fs.existsSync(variantPath);
      }
      const key = path.basename(file, '.json');
      index[key] = data;
    } catch (err) {
      AppCtx.warn?.(`[wordpress_publish] Failed to parse media metadata ${file}: ${err.message}`);
    }
  }
  const indexPath = path.join(mediaDir, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  return index;
}

function buildMediaLibraryManifest(mediaDir) {
  const files = [];
  const entries = fs.readdirSync(mediaDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name === 'manifest.json') continue;
    const absolutePath = path.join(mediaDir, entry.name);
    const stats = fs.statSync(absolutePath);
    files.push({
      filename: entry.name,
      modified: stats.mtime.toISOString()
    });
  }
  files.sort((a, b) => a.filename.localeCompare(b.filename));
  return {
    generatedAt: new Date().toISOString(),
    generatedBy: 'wordpress_publish_media_sync',
    files
  };
}

async function syncMediaLibraryToSite(siteBaseUrl, pairingRecord, options = {}) {
  if (!pairingRecord?.pairingId || !pairingRecord?.publishToken) {
    throw new Error('This pairing is incomplete. Re-pair the site before syncing media.');
  }

  const mediaDir = getMediaLibraryDir();
  buildLocalMediaIndex(mediaDir);
  const manifest = buildMediaLibraryManifest(mediaDir);
  if (!Array.isArray(manifest.files) || !manifest.files.length) {
    throw new Error('Local media library has no files to sync.');
  }

  const checkEndpoint = buildEndpoint(siteBaseUrl, '/wp-json/revelation/v1/media-sync/check');
  const checkPayload = {
    pairingId: pairingRecord.pairingId,
    publishToken: pairingRecord.publishToken,
    manifest
  };
  checkPayload.auth = buildSignedPublishAuth('media-sync-check', pairingRecord.pairingId, checkPayload);
  const checkResp = await fetchJson(checkEndpoint, {
    method: 'POST',
    body: checkPayload
  });

  const neededFiles = Array.isArray(checkResp?.neededFiles) ? checkResp.neededFiles : [];
  const uploadLimit = pickEffectiveUploadLimitBytes(checkResp?.serverMaxUploadRequestBytes);
  const maxUploadRequestBytes = uploadLimit.bytes;
  const chunkSizeBytes = getUploadChunkSizeBytes();
  const uploadEndpoint = buildEndpoint(siteBaseUrl, '/wp-json/revelation/v1/media-sync/file');
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  if (onProgress) {
    onProgress({
      phase: 'start',
      totalFiles: manifest.files.length,
      neededFiles: neededFiles.length,
      uploadedFiles: 0
    });
  }

  let uploadedFiles = 0;
  for (const item of neededFiles) {
    const filename = String(item?.filename || '').trim();
    if (!filename) continue;
    const absPath = safeMediaLibraryFilePath(mediaDir, filename);
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      throw new Error(`Media library file is missing: ${filename}`);
    }
    const fileSizeBytes = fs.statSync(absPath).size;
    const totalChunks = Math.max(1, Math.ceil(fileSizeBytes / chunkSizeBytes));
    const largestChunkBytes = Math.min(fileSizeBytes || chunkSizeBytes, chunkSizeBytes);
    const estimatedRequestBytes = estimateChunkUploadRequestBytes({
      filename,
      modified: String(item?.modified || ''),
      fileBytes: largestChunkBytes
    });
    ensureUploadFitsProcessMemory(filename, largestChunkBytes, estimatedRequestBytes, 'Media');
    if (maxUploadRequestBytes > 0 && estimatedRequestBytes > maxUploadRequestBytes) {
      const sourceLabel = uploadLimit.source === 'server' ? 'server-advertised' : 'client-configured';
      throw new Error(
        `Media upload blocked before request: "${filename}" chunk (${formatBytes(largestChunkBytes)}) would exceed configured upload request limit (${formatBytes(maxUploadRequestBytes)}). ` +
        `Limit source: ${sourceLabel}. Increase wordpress_publish.maxUploadRequestBytes (if client limit) and server limits (nginx client_max_body_size, PHP post_max_size/upload_max_filesize).`
      );
    }
    const handle = fs.openSync(absPath, 'r');
    try {
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        const offset = chunkIndex * chunkSizeBytes;
        const currentChunkBytes = Math.min(chunkSizeBytes, Math.max(0, fileSizeBytes - offset));
        const buffer = Buffer.allocUnsafe(currentChunkBytes);
        const bytesRead = fs.readSync(handle, buffer, 0, currentChunkBytes, offset);
        const uploadPayload = {
          pairingId: pairingRecord.pairingId,
          publishToken: pairingRecord.publishToken,
          filename,
          modified: String(item?.modified || ''),
          chunkIndex,
          totalChunks,
          contentBase64: buffer.subarray(0, bytesRead).toString('base64')
        };
        uploadPayload.auth = buildSignedPublishAuth('media-sync-file', pairingRecord.pairingId, uploadPayload, {
          excludeFields: ['contentBase64']
        });
        await fetchJson(uploadEndpoint, {
          method: 'POST',
          body: uploadPayload
        });
      }
      uploadedFiles += 1;
      if (onProgress) {
        onProgress({
          phase: 'file',
          filename,
          totalFiles: manifest.files.length,
          neededFiles: neededFiles.length,
          uploadedFiles
        });
      }
    } finally {
      fs.closeSync(handle);
    }
  }

  const commitEndpoint = buildEndpoint(siteBaseUrl, '/wp-json/revelation/v1/media-sync/commit');
  const commitPayload = {
    pairingId: pairingRecord.pairingId,
    publishToken: pairingRecord.publishToken,
    manifest
  };
  commitPayload.auth = buildSignedPublishAuth('media-sync-commit', pairingRecord.pairingId, commitPayload);
  const commitResp = await fetchJson(commitEndpoint, {
    method: 'POST',
    body: commitPayload
  });

  return {
    siteName: String(commitResp?.siteName || pairingRecord.siteName || siteBaseUrl),
    siteBaseUrl,
    uploadedCount: uploadedFiles,
    neededFiles: neededFiles.length,
    totalFiles: manifest.files.length,
    sharedMediaIndexUrl: String(commitResp?.sharedMediaIndexUrl || checkResp?.serverIndexUrl || '')
  };
}

async function publishPresentationToSite(siteBaseUrl, pairingRecord, presentation) {
  if (!pairingRecord?.pairingId || !pairingRecord?.publishToken) {
    throw new Error('This pairing is incomplete. Re-pair the site before publishing.');
  }

  const { slug, mdFile, presentationDir } = presentation;
  writePresentationManifest(presentationDir, {
    slug,
    md: mdFile,
    generatedAt: new Date().toISOString(),
    generatedBy: 'wordpress_publish'
  });

  const manifestPath = path.join(presentationDir, MANIFEST_FILENAME);
  const manifest = parseJsonFile(manifestPath);
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  if (!files.length) {
    throw new Error('Presentation manifest has no files to publish.');
  }

  const checkEndpoint = buildEndpoint(siteBaseUrl, '/wp-json/revelation/v1/publish/check');
  const checkPayload = {
    pairingId: pairingRecord.pairingId,
    publishToken: pairingRecord.publishToken,
    localSlug: slug,
    manifest
  };
  checkPayload.auth = buildSignedPublishAuth('publish-check', pairingRecord.pairingId, checkPayload);
  const checkResp = await fetchJson(checkEndpoint, {
    method: 'POST',
    body: checkPayload
  });

  const neededFiles = Array.isArray(checkResp?.neededFiles) ? checkResp.neededFiles : [];
  const remoteSlug = String(checkResp?.remoteSlug || '').trim() || slug;
  const uploadEndpoint = buildEndpoint(siteBaseUrl, '/wp-json/revelation/v1/publish/file');
  const uploadLimit = pickEffectiveUploadLimitBytes(checkResp?.serverMaxUploadRequestBytes);
  const maxUploadRequestBytes = uploadLimit.bytes;
  const chunkSizeBytes = getUploadChunkSizeBytes();

  for (const item of neededFiles) {
    const filename = String(item?.filename || '').trim();
    if (!filename) continue;
    const absPath = safePresentationFilePath(presentationDir, filename);
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      throw new Error(`File listed in manifest is missing: ${filename}`);
    }
    const fileSizeBytes = fs.statSync(absPath).size;
    const totalChunks = Math.max(1, Math.ceil(fileSizeBytes / chunkSizeBytes));
    const largestChunkBytes = Math.min(fileSizeBytes || chunkSizeBytes, chunkSizeBytes);
    const estimatedRequestBytes = estimateChunkUploadRequestBytes({
      filename,
      modified: String(item?.modified || ''),
      fileBytes: largestChunkBytes,
      extraFields: {
        localSlug: slug,
        remoteSlug
      }
    });
    ensureUploadFitsProcessMemory(filename, largestChunkBytes, estimatedRequestBytes, 'Presentation');
    if (maxUploadRequestBytes > 0 && estimatedRequestBytes > maxUploadRequestBytes) {
      const sourceLabel = uploadLimit.source === 'server' ? 'server-advertised' : 'client-configured';
      throw new Error(
        `Upload blocked before request: "${filename}" chunk (${formatBytes(largestChunkBytes)}) would exceed configured upload request limit (${formatBytes(maxUploadRequestBytes)}). ` +
        `Limit source: ${sourceLabel}. Increase wordpress_publish.maxUploadRequestBytes (if client limit) and server limits (nginx client_max_body_size, PHP post_max_size/upload_max_filesize).`
      );
    }
    const handle = fs.openSync(absPath, 'r');
    try {
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        const offset = chunkIndex * chunkSizeBytes;
        const currentChunkBytes = Math.min(chunkSizeBytes, Math.max(0, fileSizeBytes - offset));
        const buffer = Buffer.allocUnsafe(currentChunkBytes);
        const bytesRead = fs.readSync(handle, buffer, 0, currentChunkBytes, offset);
        const uploadPayload = {
          pairingId: pairingRecord.pairingId,
          publishToken: pairingRecord.publishToken,
          localSlug: slug,
          remoteSlug,
          filename,
          modified: String(item?.modified || ''),
          chunkIndex,
          totalChunks,
          contentBase64: buffer.subarray(0, bytesRead).toString('base64')
        };
        uploadPayload.auth = buildSignedPublishAuth('publish-file', pairingRecord.pairingId, uploadPayload, {
          excludeFields: ['contentBase64']
        });
        await fetchJson(uploadEndpoint, {
          method: 'POST',
          body: uploadPayload
        });
      }
    } finally {
      fs.closeSync(handle);
    }
  }

  const commitEndpoint = buildEndpoint(siteBaseUrl, '/wp-json/revelation/v1/publish/commit');
  const commitPayload = {
    pairingId: pairingRecord.pairingId,
    publishToken: pairingRecord.publishToken,
    localSlug: slug,
    remoteSlug,
    manifest
  };
  commitPayload.auth = buildSignedPublishAuth('publish-commit', pairingRecord.pairingId, commitPayload);
  const commitResp = await fetchJson(commitEndpoint, {
    method: 'POST',
    body: commitPayload
  });

  return {
    siteName: String(commitResp?.siteName || pairingRecord.siteName || siteBaseUrl),
    siteBaseUrl,
    localSlug: slug,
    remoteSlug: String(commitResp?.remoteSlug || remoteSlug),
    uploadedCount: neededFiles.length,
    totalFiles: files.length,
    presentationUrl: String(commitResp?.presentationUrl || '')
  };
}

const wordpressPublishPlugin = {
  defaultEnabled: false,
  priority: 102,
  version: '1.0.4-beta3',
  exposeToBrowser: true,
  clientHookJS: 'client.js',
  configTemplate: [
    {
      name: 'pairings',
      type: 'json',
      description: 'Stored WordPress pairing records',
      default: []
    },
    {
      name: 'maxUploadRequestBytes',
      type: 'number',
      description: 'Maximum estimated JSON request size per uploaded file. Set 0 to disable guard. Default: 921600',
      default: 921600
    },
    {
      name: 'uploadChunkSizeBytes',
      type: 'number',
      description: 'Chunk size in bytes for presentation and media uploads. Default: 8388608 (8 MB).',
      default: 8388608
    }
  ],
  pluginButtons: [
    //  { title: 'WordPress Publish Pairing', page: 'pairing.html' }
  ],

  register(AppContext) {
    AppCtx = AppContext;
    ensurePluginConfig();
    AppContext.log('[wordpress_publish] Registered');
  },

  api: {
    async 'open-pairing-window'(_event, data = {}) {
      createPairingWindow(data);
      return { success: true };
    },

    async 'get-pairings'() {
      const cfg = ensurePluginConfig();
      return { pairings: Array.isArray(cfg.pairings) ? cfg.pairings : [] };
    },

    async 'remove-pairing'(_event, data = {}) {
      const siteBaseUrl = normalizeSiteBaseUrl(data.siteBaseUrl || '');
      const pairings = removePairingBySiteBaseUrl(siteBaseUrl);
      return { success: true, pairings };
    },

    async 'pair-site'(_event, data = {}) {
      const siteBaseUrl = normalizeSiteBaseUrl(data.pairingUrl || data.siteBaseUrl || '');
      // PSK mode is intentionally disabled for now; RSA challenge-response only.
      const authMode = 'rsa';
      const response = await pairWithRsa(siteBaseUrl);
      if (response?.pending) {
        return {
          success: true,
          pending: true,
          siteBaseUrl,
          pairingRequestId: String(response?.pairingRequestId || ''),
          oneTimeCode: String(response?.oneTimeCode || ''),
          message: String(response?.message || '')
        };
      }

      const nowIso = new Date().toISOString();
      const pairingRecord = {
        siteBaseUrl,
        siteName: String(response?.siteName || siteBaseUrl),
        siteUrl: String(response?.siteUrl || siteBaseUrl),
        pairingId: String(response?.pairingId || ''),
        publishEndpoint: String(response?.publishEndpoint || ''),
        publishToken: String(response?.publishToken || ''),
        authMode,
        insecureTransport: siteBaseUrl.startsWith('http://'),
        pairedAt: nowIso,
        localPublicKeyFingerprint: fingerprintPublicKey(AppCtx.config?.rsaPublicKey || '')
      };

      const pairings = upsertPairingRecord(pairingRecord);
      return {
        success: true,
        pairing: pairingRecord,
        pairings,
        server: {
          supportedAuthMode: response?.supportedAuthMode || null
        }
      };
    },

    async 'pair-status'(_event, data = {}) {
      const siteBaseUrl = normalizeSiteBaseUrl(data.siteBaseUrl || data.pairingUrl || '');
      const pairingRequestId = String(data.pairingRequestId || '').trim();
      const response = await checkPairingStatus(siteBaseUrl, pairingRequestId);
      if (response?.pending) {
        return {
          success: true,
          pending: true,
          status: 'pending',
          message: String(response?.message || 'Awaiting admin approval.')
        };
      }
      if (response?.rejected) {
        return {
          success: true,
          rejected: true,
          status: 'rejected',
          message: String(response?.message || 'Pairing request was rejected.')
        };
      }
      if (!response?.paired) {
        return {
          success: true,
          pending: true,
          status: String(response?.status || 'pending')
        };
      }

      const nowIso = new Date().toISOString();
      const pairingRecord = {
        siteBaseUrl,
        siteName: String(response?.siteName || siteBaseUrl),
        siteUrl: String(response?.siteUrl || siteBaseUrl),
        pairingId: String(response?.pairingId || ''),
        publishEndpoint: String(response?.publishEndpoint || ''),
        publishToken: String(response?.publishToken || ''),
        authMode: 'rsa',
        insecureTransport: siteBaseUrl.startsWith('http://'),
        pairedAt: nowIso,
        localPublicKeyFingerprint: fingerprintPublicKey(AppCtx.config?.rsaPublicKey || '')
      };
      const pairings = upsertPairingRecord(pairingRecord);
      return {
        success: true,
        paired: true,
        pairing: pairingRecord,
        pairings
      };
    },

    async 'publish-presentation'(_event, data = {}) {
      try {
        const siteBaseUrl = normalizeSiteBaseUrl(data.siteBaseUrl || '');
        const pairingRecord = findPairingBySiteBaseUrl(siteBaseUrl);
        if (!pairingRecord) {
          throw new Error('Paired site not found. Pair this site first.');
        }
        const presentation = resolvePresentationContext(data);
        const result = await publishPresentationToSite(siteBaseUrl, pairingRecord, presentation);
        return { success: true, ...result };
      } catch (err) {
        return { success: false, error: err?.message || 'Publish failed.' };
      }
    },

    async 'sync-media-library'(_event, data = {}) {
      try {
        const siteBaseUrl = normalizeSiteBaseUrl(data.siteBaseUrl || '');
        const pairingRecord = findPairingBySiteBaseUrl(siteBaseUrl);
        if (!pairingRecord) {
          throw new Error('Paired site not found. Pair this site first.');
        }
        const result = await syncMediaLibraryToSite(siteBaseUrl, pairingRecord, {
          onProgress: (progress) => {
            emitPluginProgress(_event, 'sync-media-library', {
              siteBaseUrl,
              ...progress
            });
          }
        });
        return { success: true, ...result };
      } catch (err) {
        return { success: false, error: err?.message || 'Media library sync failed.' };
      }
    }
  }
};

module.exports = wordpressPublishPlugin;
