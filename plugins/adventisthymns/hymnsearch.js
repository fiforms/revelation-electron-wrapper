const urlParams = new URLSearchParams(window.location.search);
const params = JSON.parse(urlParams.get('params'));
const slug = params.slug;
const mdFile = params.mdFile;
const returnKey = params.returnKey;

const hymnNumberInput = document.getElementById('hymn-number');
const hymnForm = document.getElementById('hymn-form');
const fetchInsertBtn = document.getElementById('fetch-insert');
const statusBox = document.getElementById('status');

if (!mdFile && !returnKey) {
  // Hide insert button if not launched with a presentation context
  fetchInsertBtn.style.display = 'none';
}

if (returnKey) {
  fetchInsertBtn.textContent = '➕ Fetch and Insert';
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

async function handleFetchAndInsert() {
  const num = hymnNumberInput.value.trim();
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
      statusBox.textContent = '⚠️ Failed to append hymn.';
    }
  } catch (err) {
    console.error(err);
    statusBox.textContent = `❌ Error: ${err.message}`;
  }
}

fetchInsertBtn.addEventListener('click', handleFetchAndInsert);
hymnForm.addEventListener('submit', (event) => {
  event.preventDefault();
  handleFetchAndInsert();
});

hymnNumberInput.focus();
hymnNumberInput.select();
