document.addEventListener('DOMContentLoaded', async () => {
  const language = navigator.language.slice(0, 2);
  window.translationsources ||= [];
  window.translationsources.push(new URL('./locales/translations.json', window.location.href).pathname);
  if (typeof window.loadTranslations === 'function') {
    await window.loadTranslations();
  }
  if (typeof window.translatePage === 'function') {
    window.translatePage(language);
  }

  const t = (key) => (typeof window.tr === 'function' ? window.tr(key) : key);
  const esc = (value) =>
    String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const translationSelect = document.getElementById('translation');
  const bookSelect = document.getElementById('book');
  const chapterSelect = document.getElementById('chapter');
  const referenceInput = document.getElementById('reference');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const chapterHeader = document.getElementById('chapterHeader');
  const chapterMeta = document.getElementById('chapterMeta');
  const chapterText = document.getElementById('chapterText');
  const status = document.getElementById('status');

  referenceInput.placeholder = t('Enter chapter reference');

  let localTranslations = [];
  let bookCatalog = [];
  let currentTranslationName = '';
  let currentMode = 'chapter';

  const setStatus = (message = '') => {
    status.textContent = message;
  };

  const normalizeBookKey = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  const parseReferenceForFocus = (reference) => {
    const raw = String(reference || '').trim().replace(/\s+/g, ' ');
    if (!raw) return null;
    const match = raw.match(/^(.+?)\s+(\d+)(?:\s*[:.]\s*(\d+))?/);
    if (!match) return null;
    const chapter = Number(match[2]);
    const verse = match[3] ? Number(match[3]) : null;
    return {
      book: match[1].trim(),
      chapter: Number.isInteger(chapter) ? chapter : null,
      verse: Number.isInteger(verse) ? verse : null
    };
  };

  const focusVerseInChapter = (verseNum) => {
    if (!Number.isInteger(verseNum) || verseNum < 1) return;
    const verseNode = chapterText.querySelector(`.verse[data-verse="${verseNum}"]`);
    if (!verseNode) return;
    chapterText.querySelectorAll('.verse.highlight').forEach(node => node.classList.remove('highlight'));
    verseNode.classList.add('highlight');
    verseNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const selectReferenceText = () => {
    referenceInput.focus();
    referenceInput.select();
  };

  const renderBookOptions = (preferredBook = '', preferredChapter = 1) => {
    if (!bookCatalog.length) {
      bookSelect.innerHTML = `<option value="">${esc(t('No books available'))}</option>`;
      chapterSelect.innerHTML = `<option value="">-</option>`;
      bookSelect.disabled = true;
      chapterSelect.disabled = true;
      return;
    }
    bookSelect.disabled = false;
    chapterSelect.disabled = false;
    bookSelect.innerHTML = bookCatalog
      .map((book, idx) => `<option value="${idx}">${esc(book.name)}</option>`)
      .join('');
    const preferredKey = normalizeBookKey(preferredBook);
    const preferredIndex = preferredKey
      ? bookCatalog.findIndex(book =>
          normalizeBookKey(book.name) === preferredKey || normalizeBookKey(book.abbr) === preferredKey
        )
      : -1;
    bookSelect.selectedIndex = preferredIndex >= 0 ? preferredIndex : 0;
    renderChapterOptions(preferredChapter);
  };

  const renderChapterOptions = (preferredChapter = 1) => {
    const idx = Number(bookSelect.value);
    const selectedBook = Number.isInteger(idx) && idx >= 0 ? bookCatalog[idx] : null;
    const count = selectedBook?.chapterCount || 0;
    if (!count) {
      chapterSelect.innerHTML = `<option value="">-</option>`;
      return;
    }
    const options = [];
    for (let i = 1; i <= count; i += 1) {
      options.push(`<option value="${i}">${i}</option>`);
    }
    chapterSelect.innerHTML = options.join('');
    const preferred = String(Number(preferredChapter) || 1);
    chapterSelect.value = [...chapterSelect.options].some(o => o.value === preferred) ? preferred : '1';
  };

  const syncSelectorsFromReference = (bookName, chapterNum) => {
    const key = normalizeBookKey(bookName);
    const matchIndex = bookCatalog.findIndex((book) =>
      normalizeBookKey(book.name) === key || normalizeBookKey(book.abbr) === key
    );
    if (matchIndex < 0) return;
    bookSelect.value = String(matchIndex);
    renderChapterOptions();
    const chapterValue = String(chapterNum);
    if ([...chapterSelect.options].some(o => o.value === chapterValue)) {
      chapterSelect.value = chapterValue;
    }
  };

  const renderChapter = (chapterData) => {
    const verses = Array.isArray(chapterData?.verses) ? chapterData.verses : [];
    currentMode = 'chapter';
    chapterHeader.textContent = `${chapterData.book} ${chapterData.chapter}`;
    chapterMeta.textContent = `${chapterData.translationName || currentTranslationName}`;
    referenceInput.value = `${chapterData.book} ${chapterData.chapter}`;
    prevBtn.disabled = false;
    nextBtn.disabled = false;

    if (!verses.length) {
      chapterText.textContent = t('No verse text found for this chapter.');
      return;
    }

    chapterText.innerHTML = verses
      .map(v => `<span class="verse" data-verse="${v.num}"><span class="verse-num">${v.num}</span>${esc(v.text)}</span>`)
      .join('');
  };

  const renderSearchResults = (searchData) => {
    const query = String(searchData?.query || '').trim();
    const matches = Array.isArray(searchData?.matches) ? searchData.matches : [];
    const translationName = String(searchData?.translationName || currentTranslationName || '');
    currentMode = 'search';
    chapterHeader.textContent = `${t('Search Results')}: "${query}"`;
    chapterMeta.textContent = translationName;
    referenceInput.value = query;
    prevBtn.disabled = true;
    nextBtn.disabled = true;

    if (!matches.length) {
      chapterText.textContent = t('No matches found.');
      return;
    }

    chapterText.innerHTML = matches
      .map((m) => {
        const ref = `${m.book} ${m.chapter}:${m.verse}`;
        return `<span class="verse"><a href="#" class="verse-ref-link" data-book="${esc(m.book)}" data-chapter="${m.chapter}" data-verse="${m.verse}">${esc(ref)}</a>${esc(m.text)}</span>`;
      })
      .join('');
  };

  const runReferenceSearch = async (reference) => {
    setStatus(t('Searching verses...'));
    const res = await window.electronAPI.pluginTrigger('bibletext', 'search-local-verses', {
      translation: translationSelect.value,
      query: reference
    });
    if (!res?.success) {
      setStatus(`❌ ${t('Error:')} ${res?.error || t('Unknown error')}`);
      return false;
    }
    renderSearchResults(res.results);
    setStatus('');
    return true;
  };

  const canNavigateChapter = (delta) => {
    const idx = Number(bookSelect.value);
    const selectedBook = Number.isInteger(idx) && idx >= 0 ? bookCatalog[idx] : null;
    if (!selectedBook) return null;
    const chapter = Number(chapterSelect.value);
    if (!Number.isInteger(chapter)) return null;
    const nextChapter = chapter + delta;
    if (nextChapter < 1 || nextChapter > selectedBook.chapterCount) return null;
    return { book: selectedBook.name, chapter: nextChapter };
  };

  const readCurrentChapter = async ({ useReference = false, focusVerse = null } = {}) => {
    if (!translationSelect.value) {
      setStatus(`❌ ${t('No local translations found')}`);
      return;
    }

    const payload = { translation: translationSelect.value };
    let reference = '';
    if (useReference && referenceInput.value.trim()) {
      reference = referenceInput.value.trim();
      payload.reference = reference;
    } else {
      const idx = Number(bookSelect.value);
      const selectedBook = Number.isInteger(idx) && idx >= 0 ? bookCatalog[idx] : null;
      if (!selectedBook) {
        setStatus(`❌ ${t('Choose a book first.')}`);
        return;
      }
      payload.book = selectedBook.name;
      payload.chapter = Number(chapterSelect.value);
    }

    if (useReference && reference && !/\d$/.test(reference)) {
      return runReferenceSearch(reference);
    }

    let verseToFocus = Number.isInteger(focusVerse) ? focusVerse : null;
    if (useReference && reference && !verseToFocus) {
      const parsedRef = parseReferenceForFocus(reference);
      if (parsedRef?.verse) verseToFocus = parsedRef.verse;
    }

    setStatus(t('Loading chapter...'));
    const res = await window.electronAPI.pluginTrigger('bibletext', 'read-local-chapter', payload);
    if (!res?.success) {
      if (useReference && reference) {
        return runReferenceSearch(reference);
      }
      setStatus(`❌ ${t('Error:')} ${res?.error || t('Unknown error')}`);
      return;
    }

    const chapterData = res.chapter;
    renderChapter(chapterData);
    syncSelectorsFromReference(chapterData.book, chapterData.chapter);
    if (verseToFocus) {
      referenceInput.value = `${chapterData.book} ${chapterData.chapter}:${verseToFocus}`;
      focusVerseInChapter(verseToFocus);
    }
    setStatus('');
  };

  const loadBookCatalog = async ({ preferredBook = '', preferredChapter = 1 } = {}) => {
    const translation = translationSelect.value;
    if (!translation) {
      bookCatalog = [];
      renderBookOptions(preferredBook, preferredChapter);
      return;
    }

    setStatus(t('Loading books...'));
    const res = await window.electronAPI.pluginTrigger('bibletext', 'get-local-books', { translation });
    if (!res?.success) {
      bookCatalog = [];
      renderBookOptions();
      setStatus(`❌ ${t('Error:')} ${res?.error || t('Unknown error')}`);
      return;
    }

    currentTranslationName = String(res.translationName || '');
    bookCatalog = Array.isArray(res.books) ? res.books : [];
    renderBookOptions(preferredBook, preferredChapter);
    setStatus('');
  };

  const boot = async () => {
    setStatus(t('Loading local bibles...'));
    const res = await window.electronAPI.pluginTrigger('bibletext', 'get-local-translations');
    localTranslations = (res?.success && Array.isArray(res.translations)) ? res.translations : [];

    if (!localTranslations.length) {
      translationSelect.innerHTML = `<option value="">${esc(t('No local translations found'))}</option>`;
      translationSelect.disabled = true;
      setStatus(t('Add local XML bibles in the bibletext/bibles folder to use this reader.'));
      return;
    }

    translationSelect.disabled = false;
    translationSelect.innerHTML = localTranslations
      .map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`)
      .join('');
    translationSelect.selectedIndex = 0;

    await loadBookCatalog();
    await readCurrentChapter();
  };

  translationSelect.addEventListener('change', async () => {
    const selectedIdx = Number(bookSelect.value);
    const selectedBook = Number.isInteger(selectedIdx) && selectedIdx >= 0 ? bookCatalog[selectedIdx] : null;
    const preservedBook = selectedBook?.name || '';
    const preservedChapter = Number(chapterSelect.value) || 1;
    const preservedReference = referenceInput.value.trim();

    await loadBookCatalog({ preferredBook: preservedBook, preferredChapter: preservedChapter });
    if (preservedReference) {
      referenceInput.value = preservedReference;
      await readCurrentChapter({ useReference: true });
      return;
    }
    await readCurrentChapter();
  });

  bookSelect.addEventListener('change', async () => {
    renderChapterOptions();
    await readCurrentChapter({ useReference: false });
  });

  chapterSelect.addEventListener('change', async () => {
    await readCurrentChapter({ useReference: false });
  });

  referenceInput.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    await readCurrentChapter({ useReference: true });
  });
  referenceInput.addEventListener('click', () => {
    referenceInput.select();
  });

  chapterText.addEventListener('click', async (event) => {
    const link = event.target.closest('.verse-ref-link');
    if (!link) return;
    event.preventDefault();

    const book = String(link.dataset.book || '').trim();
    const chapter = Number(link.dataset.chapter);
    const verse = Number(link.dataset.verse);
    if (!book || !Number.isInteger(chapter) || chapter < 1) return;

    referenceInput.value = Number.isInteger(verse) && verse > 0
      ? `${book} ${chapter}:${verse}`
      : `${book} ${chapter}`;
    await readCurrentChapter({ useReference: true, focusVerse: Number.isInteger(verse) ? verse : null });
  });

  prevBtn.addEventListener('click', async () => {
    if (currentMode === 'search') return;
    const next = canNavigateChapter(-1);
    if (!next) return;
    referenceInput.value = `${next.book} ${next.chapter}`;
    await readCurrentChapter({ useReference: true });
  });

  nextBtn.addEventListener('click', async () => {
    if (currentMode === 'search') return;
    const next = canNavigateChapter(1);
    if (!next) return;
    referenceInput.value = `${next.book} ${next.chapter}`;
    await readCurrentChapter({ useReference: true });
  });

  await boot();
  setTimeout(() => {
    selectReferenceText();
  }, 0);
});
