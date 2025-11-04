const searchInput = document.getElementById('search');
const searchBtn = document.getElementById('searchBtn');
const resultsBody = document.querySelector('#results tbody');
const lyricsBox = document.getElementById('lyrics-box');
const insertBtn = document.getElementById('insertBtn');

let currentLyrics = '';
let currentTitle = '';

async function searchHymns() {
    const query = searchInput.value.trim();
    if (!query) return;
    resultsBody.innerHTML = '<tr><td colspan="4">Searching...</td></tr>';
    lyricsBox.hidden = true;
    insertBtn.hidden = true;

    try {
    const results = await electronAPI.pluginTrigger('hymnary', 'searchHymns', query, 10);
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
    `;
    tr.style.cursor = 'pointer';
    tr.onclick = () => fetchLyrics(row);
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
    const lyrics = await electronAPI.pluginTrigger('hymnary', 'getLyrics', row.textAuthNumber);
    if (!lyrics) {
        lyricsBox.innerHTML = 'No lyrics found or access restricted.';
        return;
    }
    currentLyrics = lyrics;
    currentTitle = row.displayTitle || row.textTitle || 'Untitled Hymn';
    lyricsBox.textContent = lyrics;
    insertBtn.hidden = false;
    } catch (err) {
    lyricsBox.innerHTML = `<span style="color:#f55">Error: ${err.message}</span>`;
    }
}

insertBtn.onclick = () => {
    if (!currentLyrics) return;
    const md = `# ${currentTitle}\n\n${currentLyrics.replace(/\n+/g, '\n\n')}\n\n:ATTRIB:Source: Hymnary.org`;
    electronAPI.insertTextIntoEditor?.(md); // optional integration hook
    window.close();
};

searchBtn.onclick = searchHymns;
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') searchHymns(); });