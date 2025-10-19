document.getElementById('hymn-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const num = document.getElementById('hymn-number').value.trim();
  const status = document.getElementById('status');
  if (!num) return;

  status.textContent = `Fetching hymn ${num}...`;

  try {
    // Request Electron to fetch & parse hymn on backend
    const md = await window.electronAPI.pluginTrigger('adventisthymns', 'fetchHymnSlides', num);

    if (window.electronAPI?.appendToCurrentPresentation) {
      await window.electronAPI.appendToCurrentPresentation(md);
      status.textContent = `✅ Hymn ${num} added to current presentation.`;
      setTimeout(() => window.close(), 1500);
    } else {
      await navigator.clipboard.writeText(md);
      status.textContent = `✅ Hymn ${num} copied to clipboard.`;
    }
  } catch (err) {
    console.error(err);
    status.textContent = `❌ Failed: ${err.message}`;
  }
});
