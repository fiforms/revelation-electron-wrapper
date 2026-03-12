// plugins/bibletext/plugin.js
const { info } = require('console');
const fs = require('fs/promises');
const path = require('path');
const xml2js = require('xml2js');
const zlib = require('zlib');

const parser = new xml2js.Parser({
    explicitChildren: true,
    preserveChildrenOrder: true,
    charsAsChildren: true,
    explicitArray: true,
    trim: false,
    normalize: false,
    normalizeTags: false
});

const localBibleManager = {
    biblelist: [],

    async loadBibles(dirPath) {
        // Rebuild the in-memory list from disk each time this is called.
        this.biblelist = [];
        const seenTranslationIds = new Set();
        const files = await fs.readdir(dirPath);

        const xmlFiles = files.filter(f => (f.toLowerCase().endsWith('.xml') || f.toLowerCase().endsWith('.xml.gz')));

        for (const xmlFile of xmlFiles) {
            const xmlPath = path.join(dirPath, xmlFile);
            const jsonPath = xmlPath.replace(/\.xml(?:\.gz)?$/i, '.json');

            let needsConvert = false;

            try {
                const [xmlStat, jsonStat] = await Promise.all([
                    fs.stat(xmlPath),
                    fs.stat(jsonPath).catch(() => null)   // if json doesn't exist → null
                ]);

                if (!jsonStat) {
                    needsConvert = true;
                } else if (xmlStat.mtimeMs > jsonStat.mtimeMs) {
                    needsConvert = true;
                }

            } catch (err) {
                console.error(`Stat error for ${xmlFile}:`, err);
                needsConvert = true;
            }

            if (needsConvert) {
                console.log(`📘 Converting ${xmlFile} → JSON…`);
                await this.convertXMLtoJSON(xmlPath, jsonPath);
            }

            // Load the newly-created or existing JSON
            try {
                const jsonText = await fs.readFile(jsonPath, 'utf8');
                const bible = JSON.parse(jsonText);
                const translationId = String(bible?.info?.identifier || bible?.id || '').toLowerCase();
                if (!translationId) {
                    console.warn(`⚠️  Skipping ${jsonPath}: missing translation identifier.`);
                    continue;
                }
                if (seenTranslationIds.has(translationId)) {
                    console.warn(`⚠️  Skipping duplicate local translation id "${translationId}" from ${jsonPath}.`);
                    continue;
                }
                seenTranslationIds.add(translationId);

                this.biblelist.push({
                    id: bible.id,
                    name: bible.name,
                    info: bible.info,
                    path: jsonPath,
                });

            } catch (err) {
                console.error(`❌ Failed to load ${jsonPath}:`, err);
                console.warn(`⚠️  Rebuilding ${jsonPath} from source XML...`);
                try {
                    await this.convertXMLtoJSON(xmlPath, jsonPath);
                    const rebuiltText = await fs.readFile(jsonPath, 'utf8');
                    const bible = JSON.parse(rebuiltText);
                    const translationId = String(bible?.info?.identifier || bible?.id || '').toLowerCase();
                    if (!translationId) {
                        console.warn(`⚠️  Skipping rebuilt ${jsonPath}: missing translation identifier.`);
                        continue;
                    }
                    if (seenTranslationIds.has(translationId)) {
                        console.warn(`⚠️  Skipping duplicate rebuilt local translation id "${translationId}" from ${jsonPath}.`);
                        continue;
                    }
                    seenTranslationIds.add(translationId);
                    this.biblelist.push({
                        id: bible.id,
                        name: bible.name,
                        info: bible.info,
                        path: jsonPath,
                    });
                    console.log(`✔ Rebuilt and loaded ${jsonPath}`);
                } catch (rebuildErr) {
                    console.error(`❌ Rebuild failed for ${jsonPath}:`, rebuildErr);
                }
            }
        }

        console.log(`📚 Loaded ${this.biblelist.length} Bible(s).`);
    },

    async convertXMLtoJSON(xmlFile, jsonFile) {
        let xmlText;
        const isGz = /\.xml\.gz$/i.test(xmlFile);

        try {
            if (isGz) {
                // Read raw buffer
                const buf = await fs.readFile(xmlFile);

                // gunzip with callback
                xmlText = await new Promise((resolve, reject) => {
                    zlib.gunzip(buf, (err, data) => {
                    if (err) return reject(err);
                    resolve(data.toString('utf8'));
                    });
                });
            } else {
                xmlText = await fs.readFile(xmlFile, 'utf8');
            }
        } catch (err) {
            console.error(`❌ Could not read ${xmlFile}:`, err);
            return;
        }

        // Fallback name from filename
        const fallbackName = path.basename(xmlFile).replace(/\.xml(?:\.gz)?$/i, '');

        let doc;
        try {
            doc = await parser.parseStringPromise(xmlText);
        } catch (err) {
            console.error(`❌ XML parse error in ${xmlFile}:`, err);
            return;
        }

        const root = Object.keys(doc)[0].toLowerCase();

        let result;

        if (root === 'xmlbible') {
            result = this._parseXMLBIBLE(doc.XMLBIBLE, false, fallbackName);
        } else if (root === 'bible') {
            result = this._parseXMLBIBLE(doc.bible, true, fallbackName);
        } else {
            console.error(`❌ Unknown Bible XML root element in ${xmlFile}: ${root}`);
            return;
        }

        // Save JSON
        try {
            const tmpFile = `${jsonFile}.tmp`;
            await fs.writeFile(tmpFile, JSON.stringify(result, null, 2), 'utf8');
            await fs.rename(tmpFile, jsonFile);
            console.log(`✔ Wrote ${jsonFile}`);
        } catch (err) {
            console.error(`❌ Failed to write ${jsonFile}:`, err);
        }
    },

    // -------------------------
    // XMLBIBLE PARSER (easy)
    // -------------------------
    _parseXMLBIBLE(xml, shortTags = false, fallbackName = "Unknown Translation") {
        const infoNode = (xml.$$ || []).find(n => n['#name'] === 'INFORMATION');
        let info = infoNode ? this._parseInfo(infoNode) : null;


        // Normalize Bible name
        const attrs = xml.$ || {};
        let biblename = attrs.biblename || fallbackName;
        biblename = biblename.replace(/^ENGLISH\s*/i, '');

        // Fallback metadata (unchanged)
        if (!info) {
            console.warn("⚠️  No INFORMATION section found in XMLBIBLE.");
            info = {
                title: biblename + ' Bible',
                creator: null,
                subject: null,
                description: null,
                publisher: null,
                contributors: null,
                date: null,
                type: null,
                format: null,
                identifier: biblename.toLowerCase().replace(/\s+/g, '_'),
                source: null,
                language: 'ENG'
            };
        }

        // Books
        const booksIn = shortTags ? xml.b : xml.BIBLEBOOK;
        const books = Array.isArray(booksIn) ? booksIn : [booksIn];
        const outBooks = [];

        let bCount = 0;

        for (const book of books) {
            bCount += 1;
            const attrs = book.$ || {};
            const bookNum = Number(shortTags ? bCount : attrs.bnumber);
            const bookName = (shortTags ? attrs.n : attrs.bname) || `Book ${bookNum}`;


            const chaptersIn = (shortTags ? book.c : book.CHAPTER) || [];
            const chapters = Array.isArray(chaptersIn) ? chaptersIn : [chaptersIn];

            const outChapters = [];

            for (const chapter of chapters) {
                const children = chapter.$$ || [];
                const versesIn = children.filter(n => n['#name'] === (shortTags ? 'v' : 'VERS'));
                const verses = Array.isArray(versesIn) ? versesIn : [versesIn];

                const outVerses = verses.map(v => {
                    // -------------------------
                    // Hebrew OR English verse extraction
                    // -------------------------

                    // xml2js child nodes (words or punctuation)
                    const kids = Array.isArray(v.$$) ? v.$$ : [];
                    let buf = "";

                    // Case 1: Hebrew-style <gr> elements present
                    let hasGR = kids.some(k => k['#name'] === 'gr');

                    if (hasGR) {
                        for (const child of kids) {

                            // <gr> element → Hebrew word
                            if (child['#name'] === 'gr') {
                                const t = this._extractText(child);
                                if (t) buf += t + " ";
                                continue;
                            }

                            // "__text__" nodes → punctuation or whitespace
                            if (child['#name'] === '__text__') {
                                const t = (child._ || "").trim();
                                if (t) buf += t + " ";
                                continue;
                            }
                        }

                        return buf.replace(/\s+/g, " ").trim();
                    }

                    // Case 2: Normal Bible modules (no <gr>)
                    // Either simple string, array, or object with "_"
                    return this._extractText(v) || "";
                });

                outChapters.push(outVerses);
            }

            outBooks.push({
                num: bookNum,
                name: bookName,
                abbr: this._canonicalAbbr(bookName),
                chapters: outChapters
            });
        }

        return {
            id: xml.biblename
                ? xml.biblename.toLowerCase()
                : fallbackName.toLowerCase().replace(/\s+/g, '_'),
            name: biblename,
            info,
            books: outBooks
        };
    },


    // -------------------------
    // HELPERS
    // -------------------------
    _extractText(node) {
        if (!node) return null;

        // Case 1: xml2js: { _: "text" }
        if (typeof node._ === 'string') {
            return node._.trim();
        }

        // Case 2: xml2js splits text into $$ children
        if (Array.isArray(node.$$)) {
            let out = "";
            for (const c of node.$$) {
                if (typeof c._ === 'string') out += c._;
            }
            return out.trim() || null;
        }

        // Case 3: direct string
        if (typeof node === 'string') {
            return node.trim();
        }

        return null;
    },

    _parseInfo(infoNode) {

        const children = infoNode.$$ || [];

        const getNode = (tag) => {
            const n = children.find(ch => ch['#name'] === tag);
            return n ? this._extractText(n) : null;
        };

        return {
            title:       getNode('title'),
            creator:     getNode('creator'),
            subject:     getNode('subject'),
            description: getNode('description'),
            publisher:   getNode('publisher'),
            contributors:getNode('contributors'),
            date:        getNode('date'),
            type:        getNode('type'),
            format:      getNode('format'),
            identifier:  getNode('identifier'),
            source:      getNode('source'),
            language:    getNode('language'),
            coverage:    getNode('coverage'),
            rights:      getNode('rights')
        };
    },


    _canonicalAbbr(name) {
        if (!name) return "";
        if (typeof name !== "string") {
            // xml2js sometimes gives { _: "Genesis" }
            if (name._) name = name._;
            else return "";
        }

        name = name.trim();
        if (!name) return "";

        // First word, letters only
        return name.split(/\s+/)[0].replace(/[^A-Za-z]/g, '').slice(0, 3);
    },

    _sanitizeText(text) {
        if (!text) return "";
        let t = text;

        if(typeof t !== "string") {
            // xml2js sometimes gives { _: "text" }
            if (t._) t = t._;
            else return "";
        }

        // Remove OSIS tags literally if they remain
        t = t.replace(/<\/?[^>]+>/g, " ");

        // Collapse whitespace
        t = t.replace(/\s+/g, " ").trim();

        return t;
    },

    _splitIntoVerseChunks(text, count) {
        if (count <= 1) return [text];
        const avg = Math.floor(text.length / count);
        const chunks = [];
        let pos = 0;
        for (let i = 0; i < count - 1; i++) {
            chunks.push(text.slice(pos, pos + avg).trim());
            pos += avg;
        }
        chunks.push(text.slice(pos).trim());
        return chunks;
    },

    _stripLocalSuffix(value) {
        const t = String(value || '').trim();
        if (t.toLowerCase().endsWith('.local')) {
            return t.slice(0, -6);
        }
        return t;
    },

    _findBibleInfo(translation) {
        const raw = this._stripLocalSuffix(translation).toLowerCase();
        return this.biblelist.find(b =>
            String(b?.id || '').toLowerCase() === raw ||
            String(b?.info?.identifier || '').toLowerCase() === raw
        ) || null;
    },

    _loadBibleJSON(bibleInfo) {
        if (!bibleInfo?.path) {
            return { error: 'Bible path is missing.' };
        }
        try {
            const jsonText = require('fs').readFileSync(bibleInfo.path, 'utf8');
            return { bible: JSON.parse(jsonText) };
        } catch (_err) {
            return { error: `Failed to load Bible data for '${bibleInfo?.id || 'unknown'}'.` };
        }
    },

    _resolveBookInBible(bible, book) {
        if (!bible || !Array.isArray(bible.books)) return null;
        const bookKey = this._normalizeBookKey(book);
        if (!bookKey) return null;

        let bookObj = bible.books.find(b => {
            const nameKey = this._normalizeBookKey(b.name);
            const abbrKey = this._normalizeBookKey(b.abbr);
            return nameKey === bookKey || abbrKey === bookKey;
        });

        if (bookObj) return bookObj;

        const matches = bible.books.filter(b => {
            const nameKey = this._normalizeBookKey(b.name);
            const abbrKey = this._normalizeBookKey(b.abbr);
            return (nameKey && nameKey.startsWith(bookKey)) ||
                   (abbrKey && abbrKey.startsWith(bookKey));
        });

        if (matches.length === 1) return matches[0];
        if (matches.length > 1) {
            return { error: `Book '${book}' is ambiguous (${matches.map(b => b.name).join(', ')}).` };
        }
        return { error: `Book '${book}' not found.` };
    },

    getBookCatalog(translation) {
        const bibleInfo = this._findBibleInfo(translation);
        if (!bibleInfo) {
            return { error: `Translation '${translation}' not loaded.` };
        }
        const loaded = this._loadBibleJSON(bibleInfo);
        if (loaded.error) return loaded;
        const bible = loaded.bible;
        const books = Array.isArray(bible?.books) ? bible.books : [];
        return {
            translation: String(bibleInfo.info?.identifier || bibleInfo.id || ''),
            translationName: String(bible?.name || bibleInfo.name || ''),
            books: books.map((book, idx) => ({
                index: idx + 1,
                num: Number(book?.num),
                name: String(book?.name || ''),
                abbr: String(book?.abbr || ''),
                chapterCount: Array.isArray(book?.chapters) ? book.chapters.length : 0
            }))
        };
    },

    getChapter(translation, book, chapter) {
        const bibleInfo = this._findBibleInfo(translation);
        if (!bibleInfo) {
            return { error: `Translation '${translation}' not loaded.` };
        }

        const loaded = this._loadBibleJSON(bibleInfo);
        if (loaded.error) return loaded;
        const bible = loaded.bible;

        const resolved = this._resolveBookInBible(bible, book);
        if (!resolved) {
            return { error: `Book '${book}' not found.` };
        }
        if (resolved.error) return resolved;

        const chapterNum = Number(chapter);
        if (!Number.isInteger(chapterNum) || chapterNum < 1) {
            return { error: `Invalid chapter '${chapter}'.` };
        }

        const chapters = Array.isArray(resolved.chapters) ? resolved.chapters : [];
        if (chapterNum > chapters.length) {
            return { error: `Chapter '${chapterNum}' out of range for ${resolved.name}.` };
        }

        const chapterArr = Array.isArray(chapters[chapterNum - 1]) ? chapters[chapterNum - 1] : [];
        const verses = chapterArr
            .map((text, idx) => ({ num: idx + 1, text: String(text || '').trim() }))
            .filter(v => v.text.length > 0);

        return {
            translation: String(bibleInfo.info?.identifier || bibleInfo.id || ''),
            translationName: String(bible?.name || bibleInfo.name || ''),
            book: String(resolved.name || book),
            chapter: chapterNum,
            verses
        };
    },

    searchVerses(translation, query, { maxResults = 200 } = {}) {
        const bibleInfo = this._findBibleInfo(translation);
        if (!bibleInfo) {
            return { error: `Translation '${translation}' not loaded.` };
        }

        const loaded = this._loadBibleJSON(bibleInfo);
        if (loaded.error) return loaded;
        const bible = loaded.bible;

        const normalizedQuery = this._normalizeSearchText(query);
        if (!normalizedQuery) {
            return { error: 'Search query is required.' };
        }

        const safeMax = Number.isInteger(maxResults) && maxResults > 0
            ? Math.min(maxResults, 1000)
            : 200;

        const books = Array.isArray(bible?.books) ? bible.books : [];
        const matches = [];

        for (let bIdx = 0; bIdx < books.length; bIdx += 1) {
            const book = books[bIdx] || {};
            const bookName = String(book?.name || '');
            const chapters = Array.isArray(book?.chapters) ? book.chapters : [];

            for (let cIdx = 0; cIdx < chapters.length; cIdx += 1) {
                const chapter = Array.isArray(chapters[cIdx]) ? chapters[cIdx] : [];

                for (let vIdx = 0; vIdx < chapter.length; vIdx += 1) {
                    const text = String(chapter[vIdx] || '').trim();
                    if (!text) continue;

                    const normalizedText = this._normalizeSearchText(text);
                    if (!normalizedText.includes(normalizedQuery)) continue;

                    matches.push({
                        book: bookName,
                        chapter: cIdx + 1,
                        verse: vIdx + 1,
                        text
                    });

                    if (matches.length >= safeMax) {
                        return {
                            translation: String(bibleInfo.info?.identifier || bibleInfo.id || ''),
                            translationName: String(bible?.name || bibleInfo.name || ''),
                            query: String(query || '').trim(),
                            normalizedQuery,
                            maxResults: safeMax,
                            truncated: true,
                            matches
                        };
                    }
                }
            }
        }

        return {
            translation: String(bibleInfo.info?.identifier || bibleInfo.id || ''),
            translationName: String(bible?.name || bibleInfo.name || ''),
            query: String(query || '').trim(),
            normalizedQuery,
            maxResults: safeMax,
            truncated: false,
            matches
        };
    },

    getVerse(translation, reference) {
        const bibleInfo = this._findBibleInfo(translation);

        if (!bibleInfo) {
            return { error: `Translation '${translation}' not loaded.` };
        }

        const parsed = this._parseReference(reference);
        if (parsed.error) return parsed;

        const { book, chapter, ranges } = parsed;

        const loaded = this._loadBibleJSON(bibleInfo);
        if (loaded.error) return loaded;
        const bible = loaded.bible;
        const bookObj = this._resolveBookInBible(bible, book);
        if (!bookObj) return { error: `Book '${book}' not found in ${translation}.` };
        if (bookObj.error) return bookObj;

        if (chapter < 1 || chapter > bookObj.chapters.length) {
            return { error: `Chapter '${chapter}' out of range for ${book}.` };
        }

        const chapterArr = bookObj.chapters[chapter - 1];

        const results = [];
        for (const r of ranges) {
            for (let v = r.start; v <= r.end; v++) {
                const text = chapterArr[v - 1];
                if (!text) continue;
                results.push({ num: v, text });
            }
        }

        return {
            translation,
            book: bookObj.name,
            chapter,
            verses: results
        };
    },

    _parseReference(ref) {
        if (!ref || typeof ref !== "string") {
            return { error: "Invalid reference." };
        }

        // Normalize whitespace
        ref = ref.trim().replace(/\s+/g, " ");

        // Extract book name (including numeric prefixes)
        const bookMatch = ref.match(/^(1|2|3)\s*\w+|\w+/);
        if (!bookMatch) return { error: `Could not parse book name from '${ref}'.` };

        const book = bookMatch[0].trim();
        const remainder = ref.slice(bookMatch[0].length).trim();

        // Expect chapter:verse or chapter:range
        const chapMatch = remainder.match(/^(\d+)\s*[:.]\s*(.+)$/);
        if (!chapMatch) {
            return { error: `Could not parse chapter/verses in '${ref}'.` };
        }

        const chapter = Number(chapMatch[1]);
        const versePart = chapMatch[2].trim();

        const ranges = this._parseVerseRanges(versePart);
        if (ranges.error) return ranges;

        return { book, chapter, ranges };
    },

    _parseVerseRanges(text) {
        const parts = text.split(",").map(s => s.trim());
        const out = [];

        for (const p of parts) {
            // single verse
            if (/^\d+$/.test(p)) {
                const n = Number(p);
                out.push({ start: n, end: n });
                continue;
            }

            // range a-b
            const m = p.match(/^(\d+)\s*[-–]\s*(\d+)$/);
            if (m) {
                const a = Number(m[1]);
                const b = Number(m[2]);
                if (b < a) return { error: `Invalid verse range '${p}'.` };
                out.push({ start: a, end: b });
                continue;
            }

            return { error: `Invalid verse/range '${p}'.` };
        }

        return out;
    },

    _normalizeBookName(name) {
        name = name.toLowerCase().replace(/\s+/g, "");

        const map = {
            "gen": "Gen",
            "ge": "Gen",
            "gn": "Gen",
            "ex": "Exod",
            "exo": "Exod",
            "ps": "Ps",
            "psa": "Ps",
            "psalm": "Ps",
            "psalms": "Ps",
            "jn": "John",
            "jhn": "John",
            // Add as needed
        };

        return map[name] || name;
    },

    _normalizeBookKey(name) {
        if (!name) return "";
        if (typeof name !== "string") {
            if (name._) name = name._;
            else return "";
        }

        return name.toLowerCase().replace(/\s+/g, "");
    },

    _normalizeSearchText(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[\p{P}\p{S}]+/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

};

module.exports = localBibleManager;
