/**
 * builder-markdown.js — Markdown → HTML Conversion Pipeline
 *
 * Converts REVELation slide markdown into the rich-editor DOM.
 * Processing order inside `markdownToHtml`:
 *   blank lines → two-column `||` blocks → table rows → lists →
 *   blockquotes → cite lines → standalone images → headings → paragraphs
 *
 * Inline formatting (bold, italic, underline, cite, images) is handled by
 * `inlineMarkdownToHtml`, which is also used by list and table cell renderers.
 *
 * `createChecklistLabel` builds the checkbox DOM structure shared with the
 * formatting module's checklist repair logic.
 */

import { escapeHtml, escapeAttribute, rbDebug, previewText, countImageMarkdownTokens, splitHardBreakSuffix } from './builder-utils.js';
import { imageMarkdownToHtml, parseSingleImageLine, buildImageMarkdownToken, buildImageHtmlTag } from './builder-media.js';

/**
 * inlineMarkdownToHtml — Convert inline markdown syntax to HTML fragments.
 *
 * Processes a single inline text string, applying image token replacement
 * first (via `imageMarkdownToHtml`) then bold, italic, underline, and cite
 * patterns.  Returns an HTML string suitable for use as `innerHTML`.
 */
export function inlineMarkdownToHtml(text) {
  let html = imageMarkdownToHtml(text || '');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/__([^_](?:[\s\S]*?[^_])?)__/g, '<u>$1</u>');
  // Match loader underscore-cite behavior: only convert true delimiter underscores,
  // not filename/path underscores like my_file_name.txt.
  html = html.replace(
    /(^|[\s([{<'"])_([^\s_](?:[^_]*?[^\s_])?)_(?=$|[\s)\]}'".,!?;:])/g,
    (_, prefix, inner) => `${prefix}<cite>${inner}</cite>`
  );
  return html;
}

/**
 * parseStandaloneCiteLine — Detect a line that is entirely a `_cite_` token.
 *
 * Returns the inner text when the trimmed line matches `_…_` exactly, or
 * `null` otherwise.  Used by `markdownToHtml` to emit a `<cite>` block element
 * instead of treating the underscores as inline formatting inside a paragraph.
 */
export function parseStandaloneCiteLine(line) {
  const trimmed = String(line || '').trim();
  const match = trimmed.match(/^_([^\s_](?:[^_]*?[^\s_])?)_$/);
  return match ? match[1] : null;
}

/**
 * parseListLine — Parse a single markdown list line into its components.
 *
 * Returns `{ level, type, text, isChecklist, checked }` for unordered (`-`,
 * `*`, `+`) and ordered (`1.`) list items, or `null` for non-list lines.
 * `level` is the zero-based nesting depth calculated from leading whitespace.
 */
export function parseListLine(line) {
  const raw = String(line || '');
  const unordered = raw.match(/^(\s*)[-*+]\s+(.*)$/);
  const ordered = raw.match(/^(\s*)\d+\.\s+(.*)$/);
  const match = unordered || ordered;
  if (!match) return null;

  const indent = match[1] || '';
  const indentSize = indent.replace(/\t/g, '  ').length;
  const level = Math.floor(indentSize / 2);
  const type = unordered ? 'ul' : 'ol';
  const content = String(match[2] || '');
  const checklistMatch = type === 'ul' ? content.match(/^\[( |x|X)\]\s+(.*)$/) : null;
  const isChecklist = !!checklistMatch;
  const checked = !!checklistMatch && checklistMatch[1].toLowerCase() === 'x';
  const text = checklistMatch ? checklistMatch[2] : content;

  return { level, type, text, isChecklist, checked };
}

/**
 * createChecklistLabel — Build the DOM structure for a checklist list item.
 *
 * Returns a `<label class="richbuilder-check-item">` containing a checkbox
 * input and a text span.  The text span's innerHTML is set via
 * `inlineMarkdownToHtml` so inline formatting inside checklist items is
 * preserved.  Also used by `fixBareChecklistItems` in builder-format.js.
 */
export function createChecklistLabel(text, checked) {
  const label = document.createElement('label');
  label.className = 'richbuilder-check-item';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!checked;
  if (checked) input.setAttribute('checked', '');
  input.setAttribute('contenteditable', 'false');

  const textSpan = document.createElement('span');
  textSpan.className = 'richbuilder-check-text';
  textSpan.innerHTML = inlineMarkdownToHtml(text);

  label.appendChild(input);
  label.appendChild(textSpan);
  return label;
}

/**
 * buildListBlock — Convert a run of list lines into a nested list DOM string.
 *
 * Reads consecutive list lines from `lines` starting at `startIndex` and
 * builds a properly nested `<ul>`/`<ol>` structure.  Returns
 * `{ html, nextIndex }` where `html` is the serialised list HTML and
 * `nextIndex` is the first line index that was not consumed.
 */
export function buildListBlock(lines, startIndex) {
  const container = document.createElement('div');
  const stack = [];
  let idx = startIndex;

  const openList = (parentEl, type, level) => {
    const list = document.createElement(type);
    parentEl.appendChild(list);
    stack.push({ level, type, list, lastLi: null, parentEl });
    return stack[stack.length - 1];
  };

  while (idx < lines.length) {
    const token = parseListLine(lines[idx]);
    if (!token) break;

    if (!stack.length) {
      openList(container, token.type, token.level);
    }

    let current = stack[stack.length - 1];
    let targetLevel = token.level;
    if (targetLevel > current.level + 1) {
      targetLevel = current.level + 1;
    }

    while (stack.length && targetLevel < stack[stack.length - 1].level) {
      stack.pop();
    }

    current = stack[stack.length - 1];

    while (current && targetLevel > current.level) {
      const parentLi = current.lastLi;
      if (!parentLi) {
        targetLevel = current.level;
        break;
      }
      current = openList(parentLi, token.type, current.level + 1);
    }

    current = stack[stack.length - 1];
    if (!current) {
      current = openList(container, token.type, targetLevel);
    }

    if (current.level === targetLevel && current.type !== token.type) {
      stack.pop();
      const parentCtx = stack[stack.length - 1];
      const parentEl = parentCtx ? parentCtx.lastLi : container;
      current = openList(parentEl || container, token.type, targetLevel);
    }

    const li = document.createElement('li');
    if (token.isChecklist) {
      li.dataset.checklist = 'true';
      li.dataset.checked = token.checked ? 'true' : 'false';
      li.appendChild(createChecklistLabel(token.text, token.checked));
    } else {
      li.innerHTML = inlineMarkdownToHtml(token.text);
    }

    current.list.appendChild(li);
    current.lastLi = li;
    idx += 1;
  }

  return {
    html: container.innerHTML,
    nextIndex: idx
  };
}

/**
 * isTableLine — Return true if a line is part of a markdown table.
 *
 * A table line starts with `|` and contains at least one more `|`.
 */
export function isTableLine(line) {
  const t = String(line || '').trim();
  return t.startsWith('|') && t.indexOf('|', 1) !== -1;
}

/**
 * isTableSeparatorRow — Return true if an array of cell strings is a separator row.
 *
 * All cells in a separator row consist only of dashes and optional colons
 * (e.g. `---`, `:---:`, `---:`).
 */
export function isTableSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.trim()));
}

/**
 * parseTableRow — Split a markdown table row string into cell strings.
 *
 * Strips the leading and trailing `|` delimiters, splits on `|`, and trims
 * each cell.  Returns an array of cell content strings.
 */
export function parseTableRow(line) {
  const t = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|').map((c) => c.trim());
}

/**
 * getColumnAlignment — Derive text alignment from a separator cell string.
 *
 * Returns `'center'` for `:---:`, `'right'` for `---:`, or `'left'`
 * otherwise.  Used to set `data-align` and `style="text-align:…"` on cells.
 */
export function getColumnAlignment(separatorCell) {
  const c = String(separatorCell || '').trim();
  if (c.startsWith(':') && c.endsWith(':')) return 'center';
  if (c.endsWith(':')) return 'right';
  return 'left';
}

/**
 * buildTableHtml — Convert an array of raw table lines into a `<table>` HTML string.
 *
 * Requires at least two lines (header + separator).  If the second line is not
 * a valid separator row the lines are rendered as plain `<div>` elements.
 * Column alignments are stored as both `data-align` and inline style so they
 * are immediately visible and survive serialization round-trips.
 */
export function buildTableHtml(tableLines) {
  if (tableLines.length < 2) {
    return tableLines.map((l) => `<div>${escapeHtml(l)}</div>`).join('');
  }
  const headerCells = parseTableRow(tableLines[0]);
  const separatorCells = parseTableRow(tableLines[1]);
  if (!isTableSeparatorRow(separatorCells)) {
    return tableLines.map((l) => `<div>${escapeHtml(l)}</div>`).join('');
  }
  const colCount = headerCells.length;
  const alignments = separatorCells.map(getColumnAlignment);
  let html = '<table><thead><tr>';
  for (let c = 0; c < colCount; c++) {
    const content = inlineMarkdownToHtml(headerCells[c] || '');
    const align = alignments[c] || 'left';
    html += `<th data-align="${escapeAttribute(align)}" style="text-align:${escapeAttribute(align)}">${content || '<br>'}</th>`;
  }
  html += '</tr></thead><tbody>';
  for (let r = 2; r < tableLines.length; r++) {
    const rowCells = parseTableRow(tableLines[r]);
    html += '<tr>';
    for (let c = 0; c < colCount; c++) {
      const content = inlineMarkdownToHtml(rowCells[c] || '');
      const align = alignments[c] || 'left';
      html += `<td data-align="${escapeAttribute(align)}" style="text-align:${escapeAttribute(align)}">${content || '<br>'}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

/**
 * markdownToHtml — Convert REVELation slide markdown to rich-editor HTML.
 *
 * The main markdown → HTML entry point.  Processes the input line by line,
 * dispatching to the appropriate block handler (two-column, table, list,
 * blockquote, cite, image, heading, paragraph).  Returns an HTML string
 * suitable for assignment to `editor.innerHTML`.
 */
export function markdownToHtml(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  rbDebug('markdownToHtml:start', {
    lineCount: lines.length,
    imageTokenCount: countImageMarkdownTokens(markdown),
    markdown: previewText(markdown, 420)
  });
  const chunks = [];
  let idx = 0;

  while (idx < lines.length) {
    const line = lines[idx];
    const trimmed = String(line || '').trim();

    if (!trimmed) {
      // Blank markdown lines separate paragraphs; they should not render
      // as explicit empty blocks in the rich editor.
      idx += 1;
      continue;
    }

    if (trimmed === '||') {
      idx += 1; // skip opening ||
      const leftLines = [];
      const rightLines = [];
      let inRight = false;
      while (idx < lines.length) {
        const colLine = lines[idx];
        const colTrimmed = String(colLine || '').trim();
        if (colTrimmed === '||') {
          if (!inRight) {
            inRight = true;
          } else {
            idx += 1; // skip closing ||
            break;
          }
        } else if (inRight) {
          rightLines.push(colLine);
        } else {
          leftLines.push(colLine);
        }
        idx += 1;
      }
      const leftHtml = markdownToHtml(leftLines.join('\n'));
      const rightHtml = markdownToHtml(rightLines.join('\n'));
      chunks.push(`<div class="richbuilder-twocol" data-twocol="true"><div class="richbuilder-col" data-col="left">${leftHtml || '<div><br></div>'}</div><div class="richbuilder-col" data-col="right">${rightHtml || '<div><br></div>'}</div></div>`);
      continue;
    }

    if (isTableLine(line)) {
      const tableLines = [];
      while (idx < lines.length && isTableLine(lines[idx])) {
        tableLines.push(lines[idx]);
        idx += 1;
      }
      chunks.push(buildTableHtml(tableLines));
      continue;
    }

    if (parseListLine(line)) {
      const block = buildListBlock(lines, idx);
      chunks.push(block.html);
      idx = block.nextIndex;
      continue;
    }

    if (/^>\s*/.test(trimmed)) {
      const bqContent = trimmed.replace(/^>\s*/, '');
      chunks.push(`<blockquote>${inlineMarkdownToHtml(bqContent)}</blockquote>`);
      idx += 1;
      continue;
    }

    const citeLine = parseStandaloneCiteLine(line);
    if (citeLine !== null) {
      chunks.push(`<cite>${inlineMarkdownToHtml(citeLine)}</cite>`);
      idx += 1;
      continue;
    }

    const singleImage = parseSingleImageLine(line);
    if (singleImage) {
      const token = buildImageMarkdownToken(singleImage.alt, singleImage.src);
      rbDebug('markdownToHtml:single-image-line', {
        line: previewText(line),
        token
      });
      chunks.push(`<div><span class="richbuilder-image-token" contenteditable="false" data-md-image="${escapeAttribute(token)}">${buildImageHtmlTag(singleImage.alt, singleImage.src)}</span></div>`);
      idx += 1;
      continue;
    }

    if (/^#####\s+/.test(line)) {
      chunks.push(`<h5>${inlineMarkdownToHtml(line.replace(/^#####\s+/, ''))}</h5>`);
      idx += 1;
      continue;
    }
    if (/^####\s+/.test(line)) {
      chunks.push(`<h4>${inlineMarkdownToHtml(line.replace(/^####\s+/, ''))}</h4>`);
      idx += 1;
      continue;
    }
    if (/^###\s+/.test(line)) {
      chunks.push(`<h3>${inlineMarkdownToHtml(line.replace(/^###\s+/, ''))}</h3>`);
      idx += 1;
      continue;
    }
    if (/^##\s+/.test(line)) {
      chunks.push(`<h2>${inlineMarkdownToHtml(line.replace(/^##\s+/, ''))}</h2>`);
      idx += 1;
      continue;
    }
    if (/^#\s+/.test(line)) {
      chunks.push(`<h1>${inlineMarkdownToHtml(line.replace(/^#\s+/, ''))}</h1>`);
      idx += 1;
      continue;
    }

    const paragraphParts = [];
    while (idx < lines.length) {
      const paragraphLine = String(lines[idx] || '');
      const paragraphTrimmed = paragraphLine.trim();
      if (!paragraphTrimmed) break;
      if (parseListLine(paragraphLine) || /^#{1,5}\s+/.test(paragraphLine) || parseSingleImageLine(paragraphLine) || /^>\s*/.test(paragraphTrimmed) || paragraphTrimmed === '||' || isTableLine(paragraphLine)) {
        break;
      }

      const piece = splitHardBreakSuffix(paragraphLine);
      paragraphParts.push(piece);
      idx += 1;
      if (piece.hasHardBreak) continue;
    }

    if (!paragraphParts.length) {
      idx += 1;
      continue;
    }

    let inlineHtml = '';
    paragraphParts.forEach((part, partIndex) => {
      if (partIndex > 0) {
        const prev = paragraphParts[partIndex - 1];
        inlineHtml += prev.hasHardBreak ? '<br>' : ' ';
      }
      inlineHtml += inlineMarkdownToHtml(part.text);
    });
    chunks.push(`<div>${inlineHtml}</div>`);

    // Consume one or more blank lines between paragraphs.
    while (idx < lines.length && !String(lines[idx] || '').trim()) {
      idx += 1;
    }
  }

  const html = chunks.join('');
  rbDebug('markdownToHtml:end', {
    html: previewText(html, 420),
    htmlImageTokenCount: (html.match(/data-md-image=/g) || []).length
  });
  return html;
}
