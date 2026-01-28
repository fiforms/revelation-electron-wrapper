const urlParams = new URLSearchParams(window.location.search);
const params = JSON.parse(urlParams.get('params'));
const slug = params.slug;
const mdFile = params.mdFile;
const returnKey = params.returnKey;

const fetchCopyBtn = document.getElementById('fetch-copy');
const fetchAppendBtn = document.getElementById('fetch-append');
const statusBox = document.getElementById('status');

if (!mdFile && !returnKey) {
  // Hide append button if not launched with a presentation context
  fetchAppendBtn.style.display = 'none';
}

if (returnKey) {
  fetchAppendBtn.textContent = '➕ Fetch and Insert';
}

async function fetchHymn(number, options = {}) {
  statusBox.textContent = `🎵 Fetching hymn ${number}...`;
  try {
    const markdown = await window.electronAPI.pluginTrigger('adventisthymns', 'fetchHymnSlides', { number: number, ...options } );
    return markdown;
  } catch (err) {
    console.error(err);
    statusBox.textContent = `❌ Failed: ${err.message}`;
    throw err;
  }
}

fetchCopyBtn.addEventListener('click', async () => {
  const num = document.getElementById('hymn-number').value.trim();
  if (!num) return alert('Please enter a hymn number.');
  try {
    const md = await fetchHymn(num);
    await navigator.clipboard.writeText(md);
    statusBox.textContent = `✅ Hymn ${num} copied to clipboard.`;
  } catch {}
});

fetchAppendBtn.addEventListener('click', async () => {
  const num = document.getElementById('hymn-number').value.trim();
  if (!num) return alert('Please enter a hymn number.');
  try {
    if (returnKey) {
      const markdown = await fetchHymn(num);
      if (markdown) {
        localStorage.setItem(returnKey, JSON.stringify({ markdown }));
        window.close();
      }
      return;
    }
    const markdown = await window.electronAPI.pluginTrigger('adventisthymns', 'fetchHymnSlides', {number: num,
      slug: slug,
      mdFile: mdFile}
    );
    if (markdown) {
      statusBox.textContent = `✅ Hymn ${num} appended to ${mdFile}.`;
      setTimeout(() => window.close(), 1500);
    } else {
      statusBox.textContent = `⚠️ ${result?.error || 'Failed to append hymn.'}`;
    }
  } catch (err) {
    console.error(err);
    statusBox.textContent = `❌ Error: ${err.message}`;
  }
});
