// plugins/bibletext/plugin.js
const { info } = require('console');
const fs = require('fs/promises');
const path = require('path');
const xml2js = require('xml2js');
const zlib = require('zlib');


const parser = new xml2js.Parser({
    explicitArray: false,
    explicitChildren: true,      // REQUIRED to get $$ array
    preserveChildrenOrder: true, // REQUIRED to keep text order
    charsAsChildren: true,       // REQUIRED so xml2js puts text nodes in $$ as { '#name': '__text', '_': 'text' }
    trim: true,
    mergeAttrs: true
});


const localBibleManager = {
    biblelist: [],

    async loadBibles(dirPath) {
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

                this.biblelist.push({
                    id: bible.id,
                    name: bible.name,
                    info: bible.info,
                    path: jsonPath,
                    books: bible.books
                });

            } catch (err) {
                console.error(`❌ Failed to load ${jsonPath}:`, err);
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
            await fs.writeFile(jsonFile, JSON.stringify(result, null, 2));
            console.log(`✔ Wrote ${jsonFile}`);
        } catch (err) {
            console.error(`❌ Failed to write ${jsonFile}:`, err);
        }
    },

    // -------------------------
    // XMLBIBLE PARSER (easy)
    // -------------------------
    _parseXMLBIBLE(xml, shortTags = false, fallbackName = "Unknown Translation") {
        let info = xml.INFORMATION ? this._parseInfo(xml.INFORMATION) : null;
        let biblename = xml.biblename || fallbackName;
        // If biblename begins with the word ENGLISH, trim it
        biblename = biblename.replace(/^ENGLISH\s*/i, '');
        if(!info) {
            console.warn("⚠️  No INFORMATION section found in XMLBIBLE.");

            // Fill in with minimal info
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
        const booksIn = shortTags ? xml.b : xml.BIBLEBOOK;
        const outBooks = [];

        const books = Array.isArray(booksIn) ? booksIn : [booksIn];

        let bCount = 0;
        for (const book of books) {
            bCount += 1;
            const bookNum = Number(shortTags ? bCount : book.bnumber);
            const bookName = (shortTags ? book.n : book.bname) || `Book ${bookNum}`;

            const chaptersIn = (shortTags ? book.c : book.CHAPTER) || [];
            const chapters = Array.isArray(chaptersIn) ? chaptersIn : [chaptersIn];

            const outChapters = [];

            for (const chapter of chapters) {
                const versesIn = (shortTags ? chapter.v : chapter.VERS) || [];
                const verses = Array.isArray(versesIn) ? versesIn : [versesIn];

                const outVerses = verses.map(v =>
                    this._sanitizeText(v._ || v) // xml2js puts content in "_" sometimes
                );

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
            id: xml.biblename ? xml.biblename.toLowerCase() : fallbackName.toLowerCase().replace(/\s+/g, '_'),
            name: biblename,
            info,
            books: outBooks
        };
    },


    // -------------------------
    // HELPERS
    // -------------------------
    _extractText(node) {
        if (node == null) return null;

        // If xml2js gave you { _: "text" }
        if (typeof node === 'object' && typeof node._ === 'string') {
            return node._.trim();
        }

        // If xml2js gave you an array
        if (Array.isArray(node)) {
            return this._extractText(node[0]);
        }

        // If xml2js gave you a bare string
        if (typeof node === 'string') {
            return node.trim();
        }

        // If xml2js gave you objects like { "#name": "...", "$$": [...] }
        if (typeof node === 'object' && Array.isArray(node.$$)) {
            // Find first text node
            const textChild = node.$$.find(c => typeof c._ === 'string');
            if (textChild) return textChild._.trim();
        }

        return null;
    },

    _parseInfo(infoNode) {
        const get = key => this._extractText(infoNode[key]);

        return {
            title: get('title'),
            creator: get('creator'),
            subject: get('subject'),
            description: get('description'),
            publisher: get('publisher'),
            contributors: get('contributors'),
            date: get('date'),
            type: get('type'),
            format: get('format'),
            identifier: get('identifier'),
            source: get('source'),
            language: get('language'),
            coverage: get('coverage'),
            rights: get('rights')
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

    getVerse(translation, reference) {
        const bible = this.biblelist.find(b => 
            b.id.toLowerCase() === translation.toLowerCase()
        );

        if (!bible) {
            return { error: `Translation '${translation}' not loaded.` };
        }

        const parsed = this._parseReference(reference);
        if (parsed.error) return parsed;

        const { book, chapter, ranges } = parsed;

        const bookObj = bible.books.find(b =>
            b.name.toLowerCase() === book.toLowerCase() ||
            b.abbr.toLowerCase() === book.toLowerCase()
        );

        if (!bookObj) {
            return { error: `Book '${book}' not found in ${translation}.` };
        }

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

        const book = bookMatch[0].replace(/\s+/g, "");
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
    }

};

module.exports = localBibleManager;
