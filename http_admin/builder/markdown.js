/*
 * Markdown parsing and snippet helpers for the builder.
 *
 * Sections:
 * - Slide splitting/joining
 * - Slide parsing/building
 * - Markdown snippet builders
 * - Front matter helpers
 * - Validation/cleanup utilities
 */

// --- Slide splitting/joining ---
// Split a markdown document on marker lines (e.g. '---' or '***') while trimming edges.
function splitByMarkerLines(text, marker) {
  const lines = text.split(/\r?\n/);
  const chunks = [[]];
  for (const line of lines) {
    if (line === marker) {
      const current = chunks[chunks.length - 1];
      while (current.length && current[current.length - 1].trim() === '') {
        current.pop();
      }
      chunks.push([]);
    } else {
      chunks[chunks.length - 1].push(line);
    }
  }
  const cleaned = chunks.map((chunk) => {
    while (chunk.length && chunk[0].trim() === '') {
      chunk.shift();
    }
    while (chunk.length && chunk[chunk.length - 1].trim() === '') {
      chunk.pop();
    }
    return chunk.join('\n');
  });
  return cleaned;
}

// Parse a deck body into a 2D array of slide objects [column][slide].
function parseSlides(body) {
  const horizontal = splitByMarkerLines(body, '***');
  return horizontal.map((h) => splitByMarkerLines(h, '---').map((slide) => parseSlide(slide)));
}

// Join slide stacks back into a markdown body string.
function joinSlides(stacks) {
  const joinerV = '\n\n---\n\n';
  const joinerH = '\n\n***\n\n';
  return stacks
    .map((vertical) => vertical.map((slide) => buildSlide(slide)).join(joinerV))
    .join(joinerH);
}

// Extract a display title from slide markdown (first non-empty line).
function titleFromSlide(md) {
  const lines = md.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      return trimmed.replace(/^#+\s*/, '').slice(0, 60);
    }
    return trimmed.slice(0, 60);
  }
  return tr('(blank slide)');
}

// True if the top-matter block has any content.
function hasTopMatterContent(value) {
  return !!(value && value.trim());
}

// --- Slide parsing/building ---
// Create an empty slide shape.
function createEmptySlide() {
  return { top: '', body: '', notes: '' };
}

// Recognize lines that should be treated as top-matter macros.
function isTopMatterLine(trimmed) {
  const prefixes = [
    '![background:sticky',
    '{{attrib',
    '{{ai}}',
    '{{bgtint',
    '{{darkbg}}',
    '{{lightbg}}',
    '{{darktext}}',
    '{{lighttext}}',
    '{{shiftright}}',
    '{{shiftleft}}',
    '{{lowerthird}}',
    '{{upperthird}}',
    '{{info}}',
    '{{audio',
    '{{animate',
    '{{transition',
    '{{autoslide',
    '{{}}'
  ];
  return prefixes.some((prefix) => trimmed.startsWith(prefix));
}

// Trim blank lines from both ends of an array of lines.
function trimEmptyEdges(lines) {
  const cleaned = [...lines];
  while (cleaned.length && cleaned[0].trim() === '') {
    cleaned.shift();
  }
  while (cleaned.length && cleaned[cleaned.length - 1].trim() === '') {
    cleaned.pop();
  }
  return cleaned;
}

// Parse a single slide's markdown into { top, body, notes } parts.
function parseSlide(raw) {
  const lines = raw.split(/\r?\n/);
  let idx = 0;
  let sawTop = false;
  const topLines = [];

  while (idx < lines.length) {
    const line = lines[idx];
    const trimmed = line.trim();
    if (trimmed === '') {
      if (sawTop) topLines.push(line);
      idx += 1;
      continue;
    }
    if (isTopMatterLine(trimmed)) {
      sawTop = true;
      topLines.push(line);
      idx += 1;
      continue;
    }
    break;
  }

  if (!sawTop) {
    idx = 0;
    topLines.length = 0;
  }

  const remaining = lines.slice(idx);
  const noteIndex = remaining.findIndex((line) => line.trim() === 'Note:');
  let bodyLines = [];
  let notesLines = [];
  if (noteIndex >= 0) {
    bodyLines = remaining.slice(0, noteIndex);
    notesLines = remaining.slice(noteIndex + 1);
  } else {
    bodyLines = remaining;
  }

  bodyLines = trimEmptyEdges(bodyLines);
  notesLines = trimEmptyEdges(notesLines);

  return {
    top: topLines.join('\n'),
    body: bodyLines.join('\n'),
    notes: notesLines.join('\n')
  };
}

// Build a single slide's markdown from { top, body, notes }.
function buildSlide(slide) {
  const top = slide.top ? slide.top.trimEnd() : '';
  const body = slide.body ? slide.body.trim() : '';
  const notes = slide.notes ? slide.notes.trim() : '';
  const parts = [];
  if (top) parts.push(top);
  if (body) parts.push(body);
  if (notes) parts.push(`Note:\n${notes}`);
  return parts.join('\n\n');
}

// --- Markdown snippet builders ---
// Build a markdown image reference for a linked media tag.
function buildMediaMarkdown(tagType, tag) {
  if (!tag) return '';
  const prefix = `media:${tag}`;
  if (tagType === 'background') return `![background](${prefix})`;
  if (tagType === 'backgroundsticky') return `![background:sticky](${prefix})`;
  if (tagType === 'fit') return `![fit](${prefix})`;
  if (tagType === 'normal') return `![](${prefix})`;
  return '';
}

// Build a markdown image reference for a file selection.
function buildFileMarkdown(tagType, encoded, attribution, ai) {
  if (!encoded) return '';
  const attribLine = attribution ? `\n\n:ATTRIB:${attribution}` : '';
  const aiLine = ai ? `${attribLine ? '\n' : '\n\n'}:AI:` : '';
  const stickyAttribLine = attribution ? `\n\n{{attrib:${attribution}}}` : '';
  const stickyAiLine = ai ? `${stickyAttribLine ? '\n' : '\n\n'}{{ai}}` : '';
  if (tagType === 'background') return `![background](${encoded})${attribLine}${aiLine}`;
  if (tagType === 'backgroundsticky') return `![background:sticky](${encoded})${stickyAttribLine}${stickyAiLine}`;
  if (tagType === 'fit') return `![fit](${encoded})${attribLine}${aiLine}`;
  if (tagType === 'normal') return `![](${encoded})${attribLine}${aiLine}`;
  return '';
}

// Build the default two-column layout block.
function buildTwoColumnLayout(content) {
  const trimmed = (content || '').trim();
  const left = trimmed ? trimmed : '';
  return `||\n${left}\n\n||\n\n||`;
}

// Build a markdown table with the requested dimensions.
function buildTableMarkdown(rows, cols) {
  const safeRows = Math.max(1, rows);
  const safeCols = Math.max(1, cols);
  const headers = Array.from({ length: safeCols }, (_, index) => `Column ${index + 1}`);
  const divider = Array.from({ length: safeCols }, () => '---');
  const headerRow = `| ${headers.join(' | ')} |`;
  const dividerRow = `| ${divider.join(' | ')} |`;
  const bodyRows = Array.from({ length: Math.max(safeRows - 1, 0) }, () => {
    return `| ${Array.from({ length: safeCols }, () => ' ').join(' | ')} |`;
  });
  return [headerRow, dividerRow, ...bodyRows].join('\n');
}

// --- Front matter helpers ---
// Extract YAML front matter, returning { frontmatter, body }.
function extractFrontMatter(raw) {
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) return { frontmatter: '', body: raw };
  return { frontmatter: match[0], body: raw.slice(match[0].length) };
}

// Return the YAML parser if available.
function getYaml() {
  return window.jsyaml || null;
}

// Parse YAML front matter into an object (null on parse error).
function parseFrontMatterText(frontmatter) {
  const yaml = getYaml();
  if (!yaml) return null;
  if (!frontmatter) return {};
  const match = frontmatter.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?$/);
  const yamlText = match ? match[1] : frontmatter.replace(/^---\r?\n/, '').replace(/\r?\n---\r?\n?$/, '');
  try {
    return yaml.load(yamlText) || {};
  } catch (err) {
    console.warn('Failed to parse frontmatter:', err);
    return null;
  }
}

// Serialize a JS object into YAML front matter.
function stringifyFrontMatter(data) {
  const yaml = getYaml();
  if (!yaml) return '';
  return `---\n${yaml.dump(data)}---\n`;
}

// --- Validation/cleanup utilities ---
// True if a slide has no non-empty fields.
function isSlideEmpty(slide) {
  if (!slide) return true;
  return [slide.top, slide.body, slide.notes].every((value) => !value || !value.trim());
}

// Remove empty slides/columns from a stack list.
function sanitizeStacks(stacks) {
  if (!Array.isArray(stacks)) return [];
  return stacks
    .map((column) => (Array.isArray(column) ? column.filter((slide) => !isSlideEmpty(slide)) : []))
    .filter((column) => column.length > 0);
}

export {
  splitByMarkerLines,
  parseSlides,
  joinSlides,
  titleFromSlide,
  hasTopMatterContent,
  createEmptySlide,
  isTopMatterLine,
  trimEmptyEdges,
  parseSlide,
  buildSlide,
  buildMediaMarkdown,
  buildFileMarkdown,
  buildTwoColumnLayout,
  buildTableMarkdown,
  extractFrontMatter,
  getYaml,
  parseFrontMatterText,
  stringifyFrontMatter,
  isSlideEmpty,
  sanitizeStacks
};
