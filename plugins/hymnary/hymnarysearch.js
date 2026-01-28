const searchInput = document.getElementById('search');
const searchBtn = document.getElementById('searchBtn');
const resultsBody = document.querySelector('#results tbody');
const lyricsBox = document.getElementById('lyrics-box');
const insertBtn = document.getElementById('insertBtn');
const copyBtn = document.getElementById('copyBtn');
const languageSelect = document.getElementById('language');

let currentLyrics = '';
let currentTitle = '';

async function searchHymns() {
    const query = searchInput.value.trim();
    if (!query) return;
    resultsBody.innerHTML = '<tr><td colspan="4">Searching...</td></tr>';
    lyricsBox.hidden = true;
    insertBtn.hidden = true;
    copyBtn.hidden = true;

    const limit = 20;
    const language = languageSelect.value || 'English'; 

    try {
        const results = await electronAPI.pluginTrigger('hymnary', 'searchHymns', { query, language, limit } );
        renderResults(results);
    } catch (err) {
        resultsBody.innerHTML = `<tr><td colspan="4" style="color:#f55">Error: ${err.message}</td></tr>`;
    }
}

function renderResults(results) {
    resultsBody.innerHTML = '';
    results.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>${row.displayTitle || row.textTitle || 'Untitled'}</td>
        <td>${row.authors || ''}</td>
        <td>${row.meter || ''}</td>
        <td>${row.languages || ''}</td>
        <td><a href="https://hymnary.org/text/${row.textAuthNumber}">Hymnary</a></td>
    `;
    const fetchCell = document.createElement('td');
    const fetchButton = document.createElement('button');
    fetchButton.textContent = 'Get Lyrics';
    fetchButton.onclick = (event) => {
        fetchLyrics(row);
    };
    fetchCell.appendChild(fetchButton);
    tr.appendChild(fetchCell);
    resultsBody.appendChild(tr);
    });
}

async function fetchLyrics(row) {
    resultsBody.querySelectorAll('tr').forEach(r => r.style.background = '');
    event.currentTarget.style.background = '#333';
    lyricsBox.innerHTML = 'Loading lyrics...';
    lyricsBox.hidden = false;
    insertBtn.hidden = true;
    try {
        const result = await electronAPI.pluginTrigger('hymnary', 'getLyrics', row.textAuthNumber);
        if (!result || !result.lyrics) {
            lyricsBox.innerHTML = 'No lyrics found or access restricted.';
            return;
        }
        currentLyrics = result.lyrics;
        currentTitle = row.displayTitle || row.textTitle || 'Untitled Hymn';
        lyricsBox.textContent = result.lyrics;
        insertBtn.hidden = false;
        copyBtn.hidden = false;
        // Scroll to lyrics
        lyricsBox.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
        lyricsBox.innerHTML = `<span style="color:#f55">Error: ${err.message}</span>`;
    }
}

async function populateLanguageSelect() {
  const select = document.getElementById('language');
  try {
    // Adjust path as needed — this assumes hymnarysearch.html and languages.json are in the same folder
    const response = await fetch('languages.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const languages = await response.json();

    // Sort alphabetically by Name
    const entries = Object.entries(languages).sort((a, b) =>
      a[0].localeCompare(b[0], undefined, { sensitivity: 'base' })
    );

    // Populate dropdown
    for (const [key, value] of entries) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = `${value.NativeName} (${value.Name})`;
      if (key === 'English') opt.selected = true;
      select.appendChild(opt);
    }
  } catch (err) {
    console.error('Failed to load languages.json:', err);
    // fallback if file missing
    const opt = document.createElement('option');
    opt.value = 'English';
    opt.textContent = 'English (English)';
    opt.selected = true;
    select.appendChild(opt);
  }
}

insertBtn.onclick = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const slug = urlParams.get('slug');
    const mdFile = urlParams.get('md');
    const returnKey = urlParams.get('returnKey');

    if (!currentLyrics) {
        alert('No lyrics to insert.');
        return;
    }
    if (returnKey) {
        localStorage.setItem(returnKey, JSON.stringify({ markdown: currentLyrics }));
        window.close();
        return;
    }
    const result = await electronAPI.pluginTrigger('hymnary', 'appendLyricsToMarkdown', {
        slug: slug,
        mdFile: mdFile,
        lyrics: currentLyrics
    });
    if(result && result.success) {
        window.close();
    } else {
        alert('Failed to insert lyrics.');
    }
};

copyBtn.onclick = async () => {
    if (!currentLyrics) {
        alert('No lyrics to copy.');
        return;
    }

    try {
        // Prefer modern clipboard API when available
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(currentLyrics);
        } else {
            // Fallback: use a hidden textarea and execCommand('copy')
            const ta = document.createElement('textarea');
            ta.value = currentLyrics;
            ta.setAttribute('readonly', '');
            ta.style.position = 'absolute';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            const successful = document.execCommand('copy');
            document.body.removeChild(ta);
            if (!successful) throw new Error('Copy command failed');
        }

        alert('Lyrics copied to clipboard.');
    } catch (err) {
        // Final fallback: show a prompt so user can copy manually
        const manual = prompt('Your browser did not allow copying automatically. Please copy the lyrics below (Ctrl+C / Cmd+C):', currentLyrics);
        if (manual === null) {
            alert('Failed to copy lyrics: ' + (err && err.message ? err.message : err));
        } else {
            alert('Lyrics ready (manual copy).');
        }
    }
};

searchBtn.onclick = searchHymns;
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') searchHymns(); });

document.addEventListener('DOMContentLoaded', () => {
    populateLanguageSelect();
});
