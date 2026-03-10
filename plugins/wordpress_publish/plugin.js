const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const { URL } = require('url');
const os = require('os');
const { BrowserWindow } = require('electron');
const { signChallenge, fingerprintPublicKey } = require('../../lib/peerAuth');
const { saveConfig } = require('../../lib/configManager');
const { writePresentationManifest, MANIFEST_FILENAME } = require('../../lib/presentationManifest');

let AppCtx = null;

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
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeForSignature(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function createRequestSignatureMessage(action, pairingId, timestamp, nonce, payloadHash) {
  return [String(action || ''), String(pairingId || ''), String(timestamp || ''), String(nonce || ''), String(payloadHash || '')].join('\n');
}

function sha256Base64Url(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('base64url');
}

function buildSignedPublishAuth(action, pairingId, payload) {
  if (!AppCtx.config?.rsaPrivateKey || !AppCtx.config?.rsaPublicKey) {
    throw new Error('Local RSA keypair is not available in app config.');
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = new Date().toISOString();
  const payloadHash = sha256Base64Url(canonicalizeForSignature(payload));
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
  saveConfig(AppCtx.config);
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

  for (const item of neededFiles) {
    const filename = String(item?.filename || '').trim();
    if (!filename) continue;
    const absPath = safePresentationFilePath(presentationDir, filename);
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      throw new Error(`File listed in manifest is missing: ${filename}`);
    }
    const fileSizeBytes = fs.statSync(absPath).size;
    const estimatedRequestBytes = estimateUploadRequestBytes(filename, String(item?.modified || ''), fileSizeBytes);
    if (maxUploadRequestBytes > 0 && estimatedRequestBytes > maxUploadRequestBytes) {
      const sourceLabel = uploadLimit.source === 'server' ? 'server-advertised' : 'client-configured';
      throw new Error(
        `Upload blocked before request: "${filename}" (${formatBytes(fileSizeBytes)}) would exceed configured upload request limit (${formatBytes(maxUploadRequestBytes)}). ` +
        `Limit source: ${sourceLabel}. Increase wordpress_publish.maxUploadRequestBytes (if client limit) and server limits (nginx client_max_body_size, PHP post_max_size/upload_max_filesize).`
      );
    }
    const contentBase64 = fs.readFileSync(absPath).toString('base64');
    const uploadPayload = {
      pairingId: pairingRecord.pairingId,
      publishToken: pairingRecord.publishToken,
      localSlug: slug,
      remoteSlug,
      filename,
      modified: String(item?.modified || ''),
      contentBase64
    };
    uploadPayload.auth = buildSignedPublishAuth('publish-file', pairingRecord.pairingId, uploadPayload);
    await fetchJson(uploadEndpoint, {
      method: 'POST',
      body: uploadPayload
    });
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
  priority: 102,
  version: '0.1.0',
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
    }
  ],
  pluginButtons: [
    { title: 'WordPress Publish Pairing', page: 'pairing.html' }
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
    }
  }
};

module.exports = wordpressPublishPlugin;
