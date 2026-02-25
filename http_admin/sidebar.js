
(() => {

  if(!window.translationsources) {
    window.translationsources = [];
  }
  window.translationsources.push('/admin/locales/translations.json');

  // --- sidebar.js: optional disabling via ?nosidebar ---

  const params = new URLSearchParams(window.location.search);
  if (params.has('nosidebar')) {
    console.log('[sidebar] Skipping sidebar creation due to ?nosidebar param');
    return; // ⛔ Exit before sidebar is built
  }

  const key = new URLSearchParams(location.search).get('key') || '';

  // Create sidebar container
  const nav = document.createElement('nav');
  nav.classList.add('sidebar');
  nav.innerHTML = `
    <div class="hint" data-translate>Library</div>
    <button type="button" class="tab-btn" data-target="presentations" data-translate>Presentation List</button>
    <button type="button" class="tab-btn" data-target="media" data-translate>Media Library</button>
    <div class="hint" style="margin-top:10px;" data-translate>Plugins</div>
    <div id="plugin-tabs"></div>
    <div id="sidebar-current-presentation"></div>
    <div class="spacer"></div>
    <button type="button" class="tab-btn" data-target="settings" data-translate>Settings</button>
  `;

  // Insert sidebar at start of body
  document.body.insertAdjacentElement('afterbegin', nav);

  // Move body content to the right
  document.body.style.paddingLeft = '360px';
  document.body.style.boxSizing = 'border-box';

  // Highlight current page
  const page = location.pathname.includes('presentation') ? 'presentations' 
             : location.pathname.includes('media-library') ? 'media'
             : location.pathname.includes('settings') ? 'settings'
             : 'nonexistent';

  nav.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.target === page);
    b.addEventListener('click', () => {
      switch (b.dataset.target) {
        case 'presentations':
          location.href = `/presentations.html?key=${encodeURIComponent(key)}`;
          break;
        case 'media':
          location.href = `/media-library.html?key=${encodeURIComponent(key)}`;
          break;
        case 'settings':
          location.href = `/admin/settings.html?key=${encodeURIComponent(key)}`;
          break;
      }
    });
  });

// Load plugin tabs if Electron API available
function loadPluginTabs() {
  if (!window.electronAPI?.getPluginList) return;
  window.electronAPI.getPluginList(true).then(async list => {
    const mount = nav.querySelector('#plugin-tabs');
    Object.entries(list)
      .sort((a, b) => (a[1].priority ?? 100) - (b[1].priority ?? 100))
      .forEach(([name, meta]) => {
        if (!meta?.pluginButtons) {
          return; // skip plugins without pluginButtons
        }
        if (meta.baseURL) {
          window.translationsources ||= [];
          window.translationsources.push(`${meta.baseURL}/locales/translations.json`);
        }
        meta.pluginButtons.forEach(button => {
          const href = `${meta.baseURL}/${button.page}?key=${encodeURIComponent(key)}`;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'tab-btn';
          btn.textContent = button.title;
          btn.setAttribute('data-translate', '');
          const basePath = new URL(meta.baseURL, location.origin).pathname;
          if(location.pathname.includes(basePath) && location.pathname.includes(button.page)) {
            btn.classList.add('active');
          }
          btn.addEventListener('click', () => location.href = href);
          mount.appendChild(btn);
        });
      });
    if (typeof window.loadTranslations === 'function') {
      await window.loadTranslations();
    }
    if (typeof window.translatePage === 'function') {
      window.translatePage(navigator.language.slice(0, 2));
    }
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadPluginTabs);
} else {
  loadPluginTabs();
}
})();

(function() {
  const sidebar = document.querySelector('#sidebar-current-presentation');

  function renderCurrentPresentation(data) {
    let existing = sidebar.querySelector('#current-presentation');
    if (existing) existing.remove();

    if (!data) return;

    const container = document.createElement('div');
    container.id = 'current-presentation';
    container.style = 'margin-top:1rem;padding:0.5rem;border-top:1px solid #333;';

    container.innerHTML = `
      <h3 style="margin-bottom:.5rem;">📖 ${tr('Current Presentation')}</h3>
      <img src="${data.thumbnail}" alt="" style="width:100%;border-radius:8px;">
      <div style="font-weight:700;margin-top:.3rem;">${data.title}</div>
      <button id="clear-current" style="margin-top:.5rem;">Clear</button>
    `;
    sidebar.appendChild(container);

    container.querySelector('#clear-current').onclick = async () => {
      if (window.electronAPI?.clearCurrentPresentation) {
        await window.electronAPI.clearCurrentPresentation();
      } else {
        localStorage.removeItem('currentPresentation');
      }
      window.dispatchEvent(new CustomEvent('current-presentation-changed'));
    };
  }

  async function loadAndRender() {
    try {
      let data = null;
      if (window.electronAPI?.getCurrentPresentation) {
        data = await window.electronAPI.getCurrentPresentation();
      } else {
        const stored = localStorage.getItem('currentPresentation');
        if (stored) data = JSON.parse(stored);
      }
      renderCurrentPresentation(data);
    } catch (err) {
      console.warn('Failed to load current presentation:', err);
    }
  }

  // 🔁 React to selection changes
  window.addEventListener('current-presentation-changed', loadAndRender);

  // 🚀 Initial render
  loadAndRender();
})();
