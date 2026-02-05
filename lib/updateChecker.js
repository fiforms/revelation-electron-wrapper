const { app, dialog, shell } = require('electron');
const { saveConfig } = require('./configManager');

const UPDATE_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const UPDATE_API_URL = 'https://api.github.com/repos/fiforms/revelation-electron-wrapper/releases/latest';
const UPDATE_PAGE_URL = 'https://github.com/fiforms/revelation-electron-wrapper/releases/latest';
const PRE_RELEASE_ORDER = {
  alpha: 0,
  beta: 1,
  rc: 2
};

function parseTimestamp(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeVersion(raw) {
  return (raw || '').toString().trim().replace(/^v/i, '');
}

function parseVersion(version) {
  const normalized = normalizeVersion(version);
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:[-_.]?([a-zA-Z]+)(\d*)?)?$/);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);
  const tag = match[4] ? match[4].toLowerCase() : null;
  const tagNum = match[5] ? Number.parseInt(match[5], 10) : 0;
  return { major, minor, patch, tag, tagNum, normalized };
}

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) {
    return normalizeVersion(a).localeCompare(normalizeVersion(b), undefined, { numeric: true });
  }

  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;

  if (!pa.tag && !pb.tag) return 0;
  if (!pa.tag && pb.tag) return 1;
  if (pa.tag && !pb.tag) return -1;

  const aOrder = Object.prototype.hasOwnProperty.call(PRE_RELEASE_ORDER, pa.tag)
    ? PRE_RELEASE_ORDER[pa.tag]
    : -1;
  const bOrder = Object.prototype.hasOwnProperty.call(PRE_RELEASE_ORDER, pb.tag)
    ? PRE_RELEASE_ORDER[pb.tag]
    : -1;

  if (aOrder !== bOrder) return aOrder > bOrder ? 1 : -1;
  if (pa.tag !== pb.tag) return pa.tag > pb.tag ? 1 : -1;
  if (pa.tagNum !== pb.tagNum) return pa.tagNum > pb.tagNum ? 1 : -1;
  return 0;
}

function isUpdateCheckDue(config) {
  const lastChecked = parseTimestamp(config.updateCheckLastCheckedAt);
  if (!lastChecked) return true;
  return Date.now() - lastChecked >= UPDATE_CHECK_INTERVAL_MS;
}

async function fetchLatestRelease() {
  const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (await import('node-fetch')).default;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetchFn(UPDATE_API_URL, {
      headers: {
        'User-Agent': 'RevelationSnapshotBuilder',
        'Accept': 'application/vnd.github+json'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Update check failed with status ${response.status}`);
    }

    const data = await response.json();
    const tag = (data.tag_name || '').toString().trim();
    const version = tag.replace(/^v/i, '').trim();

    if (!version) {
      throw new Error('Update check response missing version tag.');
    }

    return {
      version,
      url: data.html_url || UPDATE_PAGE_URL
    };
  } finally {
    clearTimeout(timeout);
  }
}

function markCheckAsNow(AppContext) {
  AppContext.config.updateCheckLastCheckedAt = new Date().toISOString();
  saveConfig(AppContext.config);
}

function markCheckForNextStartup(AppContext) {
  const forcedPast = new Date(Date.now() - UPDATE_CHECK_INTERVAL_MS - 1000).toISOString();
  AppContext.config.updateCheckLastCheckedAt = forcedPast;
  saveConfig(AppContext.config);
}

async function checkForUpdates(AppContext, { force = false } = {}) {
  if (!force && !AppContext?.config?.updateCheckEnabled) {
    return { status: 'disabled' };
  }

  if (!force && !isUpdateCheckDue(AppContext.config)) {
    return { status: 'skipped' };
  }

  let latest;
  try {
    latest = await fetchLatestRelease();
  } catch (err) {
    AppContext.error('Update check failed:', err.message);
    return { status: 'error', error: err };
  }

  markCheckAsNow(AppContext);

  const currentVersion = app.getVersion();
  if (compareVersions(latest.version, currentVersion) <= 0) {
    return { status: 'up-to-date', latest };
  }

  if (AppContext.config.updateCheckIgnoredVersion === latest.version) {
    return { status: 'ignored', latest };
  }

  if (!AppContext.win || AppContext.win.isDestroyed()) {
    AppContext.log(`Update available: ${latest.version} (current ${currentVersion})`);
    return { status: 'update-available', latest };
  }

  const { response } = await dialog.showMessageBox(AppContext.win, {
    type: 'info',
    title: AppContext.translate('Update Available'),
    message: AppContext.translate('A new version of REVELation Snapshot Builder is available.'),
    detail: `${AppContext.translate('Current version')}: ${currentVersion}\n${AppContext.translate('Latest version')}: ${latest.version}`,
    buttons: [
      AppContext.translate('Download'),
      AppContext.translate('Ignore for now'),
      AppContext.translate('Ignore this version')
    ],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });

  if (response === 0) {
    shell.openExternal(latest.url);
  } else if (response === 1) {
    markCheckForNextStartup(AppContext);
  } else if (response === 2) {
    AppContext.config.updateCheckIgnoredVersion = latest.version;
    saveConfig(AppContext.config);
  }

  return { status: 'update-available', latest, response };
}

module.exports = {
  checkForUpdates,
  UPDATE_CHECK_INTERVAL_MS
};
