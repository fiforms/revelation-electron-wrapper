(() => {
  const key = new URLSearchParams(location.search).get('key') || '';

  // Create sidebar container
  const nav = document.createElement('nav');
  nav.classList.add('sidebar');
  nav.innerHTML = `
    <div class="hint">Library</div>
    <button type="button" class="tab-btn" data-target="presentations">Presentation List</button>
    <button type="button" class="tab-btn" data-target="media">Media Library</button>
    <div class="hint" style="margin-top:10px;">Plugins</div>
    <div id="plugin-tabs"></div>
    <div class="spacer"></div>
    <button type="button" class="tab-btn" data-target="settings">Settings</button>
  `;

  // Insert sidebar at start of body
  document.body.insertAdjacentElement('afterbegin', nav);

  // Highlight current page
  const page = location.pathname.includes('media-library') ? 'media'
             : location.pathname.includes('settings') ? 'settings'
             : 'presentations';

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
if (window.electronAPI?.getPluginList) {
  window.electronAPI.getPluginList(true).then(list => {
    const mount = nav.querySelector('#plugin-tabs');
    Object.entries(list)
      .sort((a, b) => (a[1].priority ?? 100) - (b[1].priority ?? 100))
      .forEach(([name, meta]) => {
        if (!meta?.pluginButtons) {
          return; // skip plugins without pluginButtons
        }
        meta.pluginButtons.forEach(button => {
          const href = `${meta.baseURL}/${button.page}?key=${encodeURIComponent(key)}`;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'tab-btn';
          btn.textContent = button.title;
          btn.addEventListener('click', () => location.href = href);
          mount.appendChild(btn);
        });
      });
  });
}
})();
