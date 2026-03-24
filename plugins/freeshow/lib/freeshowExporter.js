/**
 * freeshowExporter.js
 * Converts a REVELation presentation (markdown + YAML front matter)
 * to a FreeShow project JSON file.
 *
 * FreeShow project format reference: derived from observed .project files.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// ---------------------------------------------------------------------------
// Unique ID generation (FreeShow uses short hex IDs)
// ---------------------------------------------------------------------------

let _idCounter = 0;
function makeId() {
    _idCounter += 1;
    const ts = Date.now().toString(16).slice(-8);
    const n = (_idCounter).toString(16).padStart(3, '0');
    return `${ts}${n}`;
}

// ---------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------

/**
 * Strip markdown bold/italic/code markers from a line, returning plain text
 * and a simple style hint.
 */
function parseInlineMarkdown(raw) {
    let text = raw;
    let style = '';

    // Bold-italic: ***text***
    if (/^\*{3}.+\*{3}$/.test(text.trim())) {
        text = text.replace(/\*{3}(.+)\*{3}/, '$1');
        style = 'font-weight:bold;font-style:italic;';
    }
    // Bold: **text**
    else if (/\*{2}.+\*{2}/.test(text)) {
        text = text.replace(/\*{2}(.+)\*{2}/g, '$1');
        style = 'font-weight:bold;';
    }
    // Italic: _text_ or *text*
    else if (/^[_*].+[_*]$/.test(text.trim())) {
        text = text.replace(/^[_*](.+)[_*]$/, '$1');
        style = 'font-style:italic;opacity:0.8;';
    }

    return { value: text.trim(), style };
}

/**
 * Determine a FreeShow group name and color from slide content.
 * Heuristic: first non-empty line drives the group type.
 */
function detectGroup(lines) {
    const first = lines.find(l => l.trim());
    if (!first) return { group: 'Slide', color: '#5825f5', globalGroup: 'verse' };

    if (first.startsWith('#')) return { group: 'Intro', color: '#d525f5', globalGroup: 'intro' };
    if (first.startsWith('>')) return { group: 'Quote', color: '#25a5f5', globalGroup: 'verse' };
    if (first.startsWith(':')) return { group: 'Info', color: '#25f57a', globalGroup: 'verse' };
    return { group: 'Verse', color: '#5825f5', globalGroup: 'verse' };
}

/**
 * Convert a single raw line to a FreeShow line entry.
 * Returns null for lines that should be skipped entirely.
 */
function convertLine(raw) {
    const line = raw.trimEnd();

    // Skip :credits: / :xxx: blocks (REVELation plugin shortcodes)
    if (/^:[a-z_]+:/.test(line)) return null;

    let text = line;
    let style = 'font-size:80px;';
    let align = ';;';

    // Heading → large title
    const headingMatch = text.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
        const level = headingMatch[1].length;
        const sizes = { 1: '100px', 2: '85px', 3: '70px' };
        text = headingMatch[2];
        style = `font-size: ${sizes[level] || '80px'};font-weight: bold;`;
    }

    // Blockquote → indented italic
    else if (text.startsWith('> ')) {
        text = text.slice(2);
        style = 'font-size: 60px;opacity: 0.8;padding: 0.5em;background-color: rgba(255,255,255,0.3);font-style:italic;';
    }

    // Horizontal rule separators → skip
    else if (/^---+$/.test(text.trim())) return null;

    const inline = parseInlineMarkdown(text);
    if (inline.style) style = inline.style + style;

    return {
        align,
        text: [{ value: inline.value, style }]
    };
}

/**
 * Parse markdown body (no frontmatter) into an array of slide content blocks.
 * Slides are separated by `---` lines.
 */
function parseSlides(body) {
    const rawSlides = body.split(/\n---\n/);
    return rawSlides.map(block => block.trim().split('\n'));
}

/**
 * Build a single FreeShow slide object from an array of raw content lines.
 */
function buildFreeshowSlide(rawLines, slideId) {
    const { group, color, globalGroup } = detectGroup(rawLines);
    const freeShowLines = rawLines
        .map(l => convertLine(l))
        .filter(l => l !== null && l.text[0].value !== '');

    const item = {
        type: 'text',
        lines: freeShowLines.length > 0 ? freeShowLines : [{ align: ';;', text: [{ value: '', style: 'font-size:80px;' }] }],
        style: 'top:88px;left:50px;height:904px;width:1820px;',
        align: '',
        auto: false,
        id: slideId
    };

    return {
        group,
        color,
        notes: '',
        items: [item],
        globalGroup,
        children: []
    };
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

/**
 * Export a REVELation presentation to a FreeShow project JSON file.
 *
 * @param {object} AppContext  - The REVELation AppContext
 * @param {string} slug        - Presentation slug (folder name)
 * @param {object} options     - Plugin options (e.g. { includeSpeakerNotes })
 * @param {string} destPath    - Destination file path (.json)
 */
async function exportFreeshow(AppContext, slug, options = {}, destPath) {
    const presentationsDir = AppContext.config.presentationsDir;
    if (!presentationsDir) throw new Error('presentationsDir not configured in AppContext');

    const folderPath = path.join(presentationsDir, slug);
    if (!fs.existsSync(folderPath)) throw new Error(`Presentation folder not found: ${folderPath}`);

    // Resolve markdown file
    const mdFile = fs.existsSync(path.join(folderPath, 'presentation.md'))
        ? 'presentation.md'
        : fs.readdirSync(folderPath).find(f => f.endsWith('.md') && !f.startsWith('__'));
    if (!mdFile) throw new Error(`No markdown file found in: ${folderPath}`);

    const mdContent = fs.readFileSync(path.join(folderPath, mdFile), 'utf-8');

    // Split frontmatter from body
    let frontmatter = {};
    let body = mdContent;
    const fmMatch = mdContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (fmMatch) {
        try { frontmatter = yaml.load(fmMatch[1]) || {}; } catch (_) {}
        body = fmMatch[2];
    }

    const title = frontmatter.title || slug;
    const now = Date.now();

    // Parse slides
    const slideBlocks = parseSlides(body);
    const slides = {};
    const slideOrder = [];

    for (const block of slideBlocks) {
        if (block.every(l => !l.trim())) continue;
        const slideId = makeId();
        slideOrder.push(slideId);
        slides[slideId] = buildFreeshowSlide(block, slideId);
    }

    // Speaker notes: if includeSpeakerNotes, attach to first slide
    if (options.includeSpeakerNotes && frontmatter.description) {
        const firstId = slideOrder[0];
        if (firstId) slides[firstId].notes = frontmatter.description;
    }

    const showId = makeId();
    const layoutId = makeId();
    const projectId = makeId();

    const projectData = {
        project: {
            name: title,
            created: now,
            parent: '/',
            shows: [{ id: showId, index: 0 }],
            modified: now,
            used: now,
            id: projectId
        },
        shows: {
            [showId]: {
                name: title,
                private: false,
                category: null,
                settings: { activeLayout: layoutId, template: null },
                timestamps: { created: now, modified: now, used: now },
                quickAccess: {},
                meta: {},
                slides,
                layouts: {
                    [layoutId]: {
                        name: 'Default',
                        notes: '',
                        slides: slideOrder.map(id => ({ id }))
                    }
                },
                media: {}
            }
        }
    };

    fs.writeFileSync(destPath, JSON.stringify(projectData, null, 2), 'utf-8');
}

module.exports = { exportFreeshow };
