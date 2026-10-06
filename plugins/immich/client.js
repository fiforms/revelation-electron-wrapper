// plugins/immich/client.js  (browser)
// Hook: init (admin/list pages only; skipped in builder and presentation). Builds a
// floating "Immich" button + panel to start/stop a synced slideshow via
// pluginTrigger('immich', 'start-immich-sync' | 'stop-immich-sync' | 'get-sync-status').
(function () {
  'use strict';

  const PLUGIN_NAME = 'immich';

  window.RevelationPlugins = window.RevelationPlugins || {};
  window.RevelationPlugins[PLUGIN_NAME] = {
    name: PLUGIN_NAME,
    context: null,
    priority: 90,

    // DOM refs
    toggleBtnEl: null,
    panelEl: null,
    urlInputEl: null,
    startBtnEl: null,
    stopBtnEl: null,
    statusEl: null,

    isActive: false,

    // ------------------------------------------------------------------ init

    init(context) {
      this.context = context;
      const page = String(context?.page || '').trim().toLowerCase();
      // Only inject UI on admin/list pages, not inside the builder or presentation.
      if (page === 'builder' || page === 'presentation') return;
      if (!window.electronAPI?.pluginTrigger) return;

      this.buildUI();
      this.refreshStatus();
    },

    // ------------------------------------------------------------------ UI construction

    buildUI() {
      // ----- floating toggle button -----
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'immich-toggle-btn';
      btn.title = 'Immich Slideshow';
      btn.textContent = '📷 Immich';
      Object.assign(btn.style, {
        position: 'fixed',
        bottom: '18px',
        left: '18px',
        zIndex: '20000',
        padding: '8px 14px',
        borderRadius: '999px',
        border: '1px solid rgba(255,255,255,0.22)',
        background: 'rgba(20,28,44,0.82)',
        backdropFilter: 'blur(6px)',
        color: '#fff',
        font: '600 13px/1 system-ui, sans-serif',
        cursor: 'pointer',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        transition: 'background 120ms ease',
      });
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(40,55,85,0.92)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'rgba(20,28,44,0.82)';
      });
      btn.addEventListener('click', () => this.togglePanel());
      document.body.appendChild(btn);
      this.toggleBtnEl = btn;

      // ----- control panel -----
      const panel = document.createElement('div');
      panel.id = 'immich-panel';
      Object.assign(panel.style, {
        position: 'fixed',
        bottom: '58px',
        left: '18px',
        zIndex: '20001',
        width: '320px',
        padding: '16px',
        borderRadius: '14px',
        border: '1px solid rgba(255,255,255,0.18)',
        background: 'rgba(14,20,34,0.92)',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
        color: '#e8eaf0',
        font: '14px/1.5 system-ui, sans-serif',
        display: 'none',
        flexDirection: 'column',
        gap: '10px',
      });

      // Title row
      const title = document.createElement('div');
      title.textContent = 'Immich Slideshow';
      Object.assign(title.style, {
        font: '700 15px/1.2 system-ui, sans-serif',
        marginBottom: '2px',
      });
      panel.appendChild(title);

      // URL label + input
      const label = document.createElement('label');
      label.textContent = 'Share URL';
      Object.assign(label.style, {
        font: '600 11px/1 system-ui, sans-serif',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'rgba(200,210,230,0.7)',
      });
      panel.appendChild(label);

      const input = document.createElement('input');
      input.type = 'url';
      input.placeholder = 'https://your-immich-server/share/…';
      Object.assign(input.style, {
        width: '100%',
        boxSizing: 'border-box',
        padding: '8px 10px',
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.18)',
        background: 'rgba(255,255,255,0.07)',
        color: '#e8eaf0',
        font: '13px/1 monospace',
        outline: 'none',
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.startSync();
      });
      panel.appendChild(input);
      this.urlInputEl = input;

      // Button row
      const btnRow = document.createElement('div');
      Object.assign(btnRow.style, {
        display: 'flex',
        gap: '8px',
        marginTop: '2px',
      });

      const makeBtn = (label, color, handler) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        Object.assign(b.style, {
          flex: '1',
          padding: '8px 0',
          borderRadius: '8px',
          border: 'none',
          background: color,
          color: '#fff',
          font: '600 13px/1 system-ui, sans-serif',
          cursor: 'pointer',
          transition: 'opacity 120ms ease',
        });
        b.addEventListener('mouseenter', () => { b.style.opacity = '0.85'; });
        b.addEventListener('mouseleave', () => { b.style.opacity = '1'; });
        b.addEventListener('click', handler);
        return b;
      };

      const startBtn = makeBtn('Start Slideshow', '#2563eb', () => this.startSync());
      const stopBtn  = makeBtn('Stop', '#64748b', () => this.stopSync());
      stopBtn.style.display = 'none';

      btnRow.appendChild(startBtn);
      btnRow.appendChild(stopBtn);
      panel.appendChild(btnRow);
      this.startBtnEl = startBtn;
      this.stopBtnEl  = stopBtn;

      // Status line
      const status = document.createElement('div');
      Object.assign(status.style, {
        font: '12px/1.4 system-ui, sans-serif',
        color: 'rgba(180,200,230,0.75)',
        minHeight: '16px',
      });
      panel.appendChild(status);
      this.statusEl = status;

      // Info hint
      const hint = document.createElement('div');
      hint.textContent = 'Arrow keys and Space are relayed to all paired peers while active.';
      Object.assign(hint.style, {
        font: '11px/1.4 system-ui, sans-serif',
        color: 'rgba(160,175,205,0.55)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        paddingTop: '8px',
      });
      panel.appendChild(hint);

      document.body.appendChild(panel);
      this.panelEl = panel;
    },

    // ------------------------------------------------------------------ panel toggle

    togglePanel() {
      if (!this.panelEl) return;
      const shown = this.panelEl.style.display !== 'none';
      this.panelEl.style.display = shown ? 'none' : 'flex';
      if (!shown) {
        this.refreshStatus();
        this.urlInputEl && this.urlInputEl.focus();
      }
    },

    // ------------------------------------------------------------------ sync actions

    async startSync() {
      const url = this.urlInputEl?.value?.trim();
      if (!url) {
        this.setStatus('Please enter an Immich share URL.', 'warn');
        return;
      }
      try { new URL(url); } catch {
        this.setStatus('That does not look like a valid URL.', 'warn');
        return;
      }

      this.setStatus('Starting…', 'info');
      try {
        const result = await window.electronAPI.pluginTrigger('immich', 'start-immich-sync', { url });
        if (!result?.success) {
          this.setStatus(`Error: ${result?.error || 'Unknown error'}`, 'error');
          return;
        }
        this.isActive = true;
        this.setStatus('Active — arrow keys are syncing to peers.', 'ok');
        this.updateButtonStates();
      } catch (err) {
        this.setStatus(`Error: ${err.message}`, 'error');
      }
    },

    async stopSync() {
      try {
        await window.electronAPI.pluginTrigger('immich', 'stop-immich-sync', {});
      } catch (err) {
        this.setStatus(`Error: ${err.message}`, 'error');
        return;
      }
      this.isActive = false;
      this.setStatus('Stopped.', 'info');
      this.updateButtonStates();
    },

    async refreshStatus() {
      try {
        const result = await window.electronAPI.pluginTrigger('immich', 'get-sync-status', {});
        this.isActive = !!result?.active;
        if (this.isActive) {
          this.setStatus('Active — arrow keys are syncing to peers.', 'ok');
        } else {
          this.setStatus('', 'info');
        }
        this.updateButtonStates();
      } catch {
        // Ignore — plugin may not be ready yet.
      }
    },

    // ------------------------------------------------------------------ UI helpers

    setStatus(msg, level) {
      if (!this.statusEl) return;
      const colors = {
        ok:    'rgba(134,239,172,0.9)',
        warn:  'rgba(251,191,36,0.9)',
        error: 'rgba(252,165,165,0.9)',
        info:  'rgba(180,200,230,0.75)',
      };
      this.statusEl.textContent = msg;
      this.statusEl.style.color = colors[level] || colors.info;
    },

    updateButtonStates() {
      if (!this.startBtnEl || !this.stopBtnEl || !this.toggleBtnEl) return;
      if (this.isActive) {
        this.startBtnEl.style.display = 'none';
        this.stopBtnEl.style.display  = 'block';
        this.toggleBtnEl.textContent  = '📷 Immich ●';
        this.toggleBtnEl.style.borderColor = 'rgba(134,239,172,0.6)';
      } else {
        this.startBtnEl.style.display = 'block';
        this.stopBtnEl.style.display  = 'none';
        this.toggleBtnEl.textContent  = '📷 Immich';
        this.toggleBtnEl.style.borderColor = 'rgba(255,255,255,0.22)';
      }
    },
  };
})();
