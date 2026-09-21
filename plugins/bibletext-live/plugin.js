// plugins/bibletext-live/plugin.js
//
// Companion to the `bibletext` plugin: pushes a single verse to every "magic"
// live-verse slide (local projector + LAN browsers) over Socket.IO. Split out
// from bibletext so the ordinary passage-search/insert features can be used
// without also opting into the open-collaboration live-verse room. See
// revelation/doc/SECURITY.md for the collaboration model this room follows.
//
// Reuses bibletext's verse-fetch/formatting helpers via AppContext.plugins['bibletext']
// rather than duplicating them — pluginDirector requires and populates
// AppContext.plugins for every enabled plugin before calling any register(),
// so that reference is available here regardless of plugin priority order.

let AppCtx = null;

let liveVerse = { version: 0, html: '' };
let liveSocket = null;
let liveSocketRoomJoined = false;

function bibletextCore() {
  const core = AppCtx?.plugins?.['bibletext'];
  return (core && typeof core.getPassageData === 'function') ? core : null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Build a single safe HTML block for the magic slide. All verse text, references and
// attribution are HTML-escaped before any markup is added (the only `<`/`>` in the
// output are tags we insert ourselves), so verse content can never inject markup.
function buildLiveVerseHtml(core, data) {
  if (!data) return '';
  const verses = Array.isArray(data.verses) ? data.verses : [];
  if (!verses.length) return '';

  const ref = core.buildCanonicalReference(data);
  const abbr = String(data.translation_id || '').toUpperCase();
  const abbrHtml = abbr ? ` <span class="bibletext-live-abbr">(${escapeHtml(abbr)})</span>` : '';

  const versesHtml = verses.map(v => {
    const escaped = String(v.text || '')
      .replace(/\r/g, '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(escapeHtml)
      .join('<br>')
      // Bible-module italics markers [text] → <em>text</em> (matches markdown output).
      .replace(/\[/g, '<em>')
      .replace(/\]/g, '</em>');
    const book = v.book_name || (ref.split(' ')[0] ?? '');
    const chap = v.chapter || (ref.match(/\d+/)?.[0] ?? '');
    const verseRef = `${book} ${chap}:${v.verse}`.trim();
    return `<p class="bibletext-live-verse">${escaped} <span class="bibletext-live-ref"><em>${escapeHtml(verseRef)}</em>${abbrHtml}</span></p>`;
  }).join('');

  return `<div class="bibletext-live-inner">${versesHtml}</div>`;
}

// Per-session room id minted by serverManager at server start and handed to
// decks through reveal-remote.js. Previously this was `live-<access key>`,
// which put the install's master key into the socket server's room table —
// by default a public relay. See revelation/doc/SECURITY.md (F3).
function getLiveRoomId() {
  return String(AppCtx.presenterLiveRoomId || '').trim();
}

function getPresenterSocketEndpoint() {
  const usePublic = AppCtx?.config?.useRemotePublicServer === true;

  // Default: this machine's own Vite server. Decks resolve the relative path
  // against their own origin, but the main process has no window.location, so
  // build the loopback URL explicitly.
  if (!usePublic) {
    const port = AppCtx?.config?.viteServerPort;
    if (!port) return null;
    const scheme = AppCtx?.config?.httpsEnabled === true ? 'https' : 'http';
    return { connectUrl: `${scheme}://127.0.0.1:${port}`, socketPath: '/presenter-plugins-socket' };
  }

  const configured = String(AppCtx?.config?.presenterPluginsPublicServer || '').trim();
  if (!configured) return null;
  try {
    const parsed = new URL(configured);
    const socketPath = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    if (!socketPath) return null;
    return { connectUrl: parsed.origin, socketPath };
  } catch {
    return null;
  }
}

function loadSocketClient() {
  const path = require('path');
  try {
    return require('socket.io-client');
  } catch {
    return require(path.join(AppCtx.config.revelationDir, 'node_modules', 'socket.io-client'));
  }
}

function ensureLiveSocket() {
  if (liveSocket) return liveSocket;
  if (!getLiveRoomId()) {
    AppCtx.error('[bibletext-live] live verse disabled: no presenter room id for this session (server not started?)');
    return null;
  }
  const endpoint = getPresenterSocketEndpoint();
  if (!endpoint) {
    AppCtx.error('[bibletext-live] live verse disabled: no reachable presenter-plugins socket endpoint');
    return null;
  }
  let io;
  try {
    ({ io } = loadSocketClient());
  } catch (err) {
    AppCtx.error('[bibletext-live] live verse: socket.io-client unavailable:', err.message);
    return null;
  }

  const socket = io(endpoint.connectUrl, {
    path: endpoint.socketPath,
    transports: ['websocket', 'polling'],
    reconnection: true
  });
  liveSocket = socket;
  liveSocketRoomJoined = false;

  socket.on('connect', () => {
    socket.emit('presenter-plugin:join', { plugin: 'bibletext-live', roomId: getLiveRoomId() }, (res = {}) => {
      liveSocketRoomJoined = !!res.ok;
      if (res.ok) emitLiveVerse(); // (re)broadcast current state on connect/reconnect
    });
  });
  socket.on('disconnect', () => { liveSocketRoomJoined = false; });
  socket.on('connect_error', (err) => {
    AppCtx.error('[bibletext-live] live socket connect_error:', err?.message || 'unknown error');
  });
  // A newly opened slide deck asks for the current verse; reply with what we have.
  socket.on('presenter-plugin:event', (event) => {
    if (!event || event.plugin !== 'bibletext-live') return;
    if (event.type === 'live-verse-request') emitLiveVerse();
  });

  return socket;
}

function emitLiveVerse() {
  if (!liveSocket || !liveSocketRoomJoined) return;
  liveSocket.emit('presenter-plugin:event', {
    type: 'live-verse',
    payload: { version: liveVerse.version, html: liveVerse.html }
  });
}

function publishLiveVerse(html) {
  liveVerse = { version: liveVerse.version + 1, html: String(html || '') };
  if (!liveSocket) ensureLiveSocket();
  emitLiveVerse();
}

const bibleTextLivePlugin = {
  priority: 89,
  version: '1.0.0',
  clientHookJS: 'client.js',
  exposeToBrowser: true, // required so client.js loads in the slide deck (live verse follower)

  register(AppContext) {
    AppCtx = AppContext;
    if (bibletextCore()) {
      AppContext.log('[bibletext-live] Plugin registered.');
    } else {
      AppContext.error('[bibletext-live] The Bible Text plugin is not enabled; live verse features will not work.');
    }
  },

  api: {
    // Push a single verse / passage to every magic slide (local + LAN) over Socket.IO.
    'set-live-verse': async (_event, params = {}) => {
      const core = bibletextCore();
      if (!core) return { success: false, error: 'The Bible Text plugin must be enabled to use live verses.' };
      try {
        const cfg = AppCtx.plugins['bibletext'].getCfg();
        const translation = String(params.translation || cfg.defaultTranslation || 'KJV.local');
        let reference = String(params.reference || '').trim();
        if (!reference && params.book && (params.chapter || params.chapter === 0) && params.verse) {
          reference = `${params.book} ${params.chapter}:${params.verse}`;
        }
        if (!reference) return { success: false, error: 'Missing reference' };
        const res = await core.getPassageData(core.humanRefToOsis(reference), translation, params.translationLanguageCode || '');
        if (!res.success) return { success: false, error: res.error };
        publishLiveVerse(buildLiveVerseHtml(core, res.data));
        return { success: true, version: liveVerse.version, reference };
      } catch (err) {
        AppCtx.error('[bibletext-live] set-live-verse error:', err.message);
        return { success: false, error: err.message };
      }
    },

    // Blank every magic slide.
    'clear-live-verse': async () => {
      publishLiveVerse('');
      return { success: true, version: liveVerse.version };
    }
  }
};

module.exports = bibleTextLivePlugin;
