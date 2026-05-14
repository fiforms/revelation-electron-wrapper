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
 * isMacroLine — Return true if a line is the start of a macro.
 *
 * A macro line starts with `:identifier:` (either inline-param or YAML-block form).
 */
export function isMacroLine(line) {
  const trimmed = String(line || '').trim();
  return /^:[A-Za-z0-9_-]+:/.test(trimmed);
}

/**
 * isInlineParamMacro — Return true if a line is an inline-parameter macro.
 *
 * Matches `:tag:param1:param2:` — tag followed by at least one colon-delimited parameter.
 */
export function isInlineParamMacro(line) {
  const trimmed = String(line || '').trim();
  return /^:[A-Za-z0-9_-]+:(?:[^:\n]+:)+\s*$/.test(trimmed);
}

/**
 * isYamlBlockMacroHeader — Return true if a line is a YAML-block macro header.
 *
 * Matches `:tag:` with optional trailing whitespace (no parameters after the tag).
 */
export function isYamlBlockMacroHeader(line) {
  const trimmed = String(line || '').trim();
  return /^:[A-Za-z0-9_-]+:\s*$/.test(trimmed);
}

/**
 * extractTagLabel — Extract just the `:tag:` part from a macro line.
 *
 * For `:lt:` returns `:lt:`. For `:audio:file.mp3:` also returns `:audio:`.
 */
export function extractTagLabel(line) {
  const match = String(line || '').trim().match(/^(:[A-Za-z0-9_-]+:)/);
  return match ? match[1] : ':macro:';
}

/**
 * parseMacroBlock — Extract a macro (inline or YAML block) starting at lines[idx].
 *
 * Returns `{ tagLabel, rawContent, nextIndex }` if a macro is detected,
 * otherwise `null`. `rawContent` includes the entire macro text (tag + body).
 */
export function parseMacroBlock(lines, startIdx) {
  if (startIdx >= lines.length) return null;
  const line = lines[startIdx];
  const trimmed = String(line || '').trim();

  // Inline-parameter macro: `:tag:param1:param2:` on a single line
  if (isInlineParamMacro(line)) {
    const tagLabel = extractTagLabel(line);
    return {
      tagLabel,
      rawContent: trimmed,
      nextIndex: startIdx + 1
    };
  }

  // YAML-block macro: `:tag:` followed by optional indented lines
  if (isYamlBlockMacroHeader(line)) {
    const tagLabel = extractTagLabel(line);
    const macroLines = [line];
    const baseIndent = (line.match(/^(\s*)/) || ['', ''])[1].length;
    let idx = startIdx + 1;

    // Collect indented body lines
    while (idx < lines.length) {
      const nextLine = lines[idx];
      if (!nextLine.trim()) {
        // Blank line: might be part of YAML block
        macroLines.push(nextLine);
        idx += 1;
        continue;
      }
      const nextIndent = (nextLine.match(/^(\s*)/) || ['', ''])[1].length;
      if (nextIndent <= baseIndent) break;
      // Line is indented more than header: part of YAML body
      macroLines.push(nextLine);
      idx += 1;
    }

    // Trim trailing blank lines from the macro block
    while (macroLines.length > 1 && !macroLines[macroLines.length - 1].trim()) {
      macroLines.pop();
    }

    return {
      tagLabel,
      rawContent: macroLines.join('\n'),
      nextIndex: idx
    };
  }

  return null;
}

/**
 * isHtmlOpeningLine — Return true if a line starts with an HTML tag or comment.
 */
export function isHtmlOpeningLine(line) {
  const trimmed = String(line || '').trim();
  return /^<[A-Za-z!]/.test(trimmed);
}

/**
 * isSingleLineHtml — Return true if a line is a complete HTML element.
 *
 * Covers: self-closing tags (/>), comments on one line, or open+close on same line.
 */
export function isSingleLineHtml(line) {
  const trimmed = String(line || '').trim();
  // Comments with closing marker on same line
  if (trimmed.startsWith('<!--')) {
    return trimmed.includes('-->');
  }
  // Self-closing tags like <hr/>, <br/>, <img ... />
  if (/\/>$/.test(trimmed)) {
    return true;
  }
  // Single line with opening and closing (e.g., <b>text</b>)
  if (/^<[A-Za-z][^>]*>.*<\/[A-Za-z][^>]*>$/.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * extractHtmlTagLabel — Extract the display label for an HTML block.
 *
 * For comments, returns the full comment text (truncated if very long).
 * For tags, returns `<tagname>`.
 */
export function extractHtmlTagLabel(line) {
  const trimmed = String(line || '').trim();
  // Comment: show full comment, but truncate if very long
  if (trimmed.startsWith('<!--')) {
    return trimmed.length > 60 ? trimmed.substring(0, 57) + '...' : trimmed;
  }
  // Extract tag name from <tagname or <tagname attr="..."
  const match = trimmed.match(/^<([A-Za-z][A-Za-z0-9]*)/);
  return match ? `<${match[1]}>` : '<html>';
}

/**
 * parseHtmlBlock — Extract an HTML block (single-line or multi-line) starting at lines[idx].
 *
 * Returns `{ tagLabel, rawContent, nextIndex }` if HTML is detected,
 * otherwise `null`. Handles nested tags via indentation tracking.
 */
export function parseHtmlBlock(lines, startIdx) {
  if (startIdx >= lines.length) return null;

  const firstLine = lines[startIdx];
  const trimmed = String(firstLine || '').trim();

  if (!trimmed.startsWith('<')) return null;

  // Single-line HTML (comment, self-closing, or open+close on same line)
  if (isSingleLineHtml(firstLine)) {
    return {
      tagLabel: extractHtmlTagLabel(firstLine),
      rawContent: trimmed,
      nextIndex: startIdx + 1
    };
  }

  // Multi-line HTML block: extract opening tag name and base indentation
  const openTagMatch = trimmed.match(/^<([A-Za-z][A-Za-z0-9]*)/);
  if (!openTagMatch) return null;

  const tagName = openTagMatch[1];
  const tagLabel = extractHtmlTagLabel(firstLine);
  const baseIndent = (firstLine.match(/^(\s*)/) || ['', ''])[1].length;

  const htmlLines = [firstLine];
  let idx = startIdx + 1;

  // Collect lines until we find the closing tag at base indentation or less
  while (idx < lines.length) {
    const nextLine = lines[idx];
    const nextTrimmed = String(nextLine || '').trim();
    const nextIndent = (nextLine.match(/^(\s*)/) || ['', ''])[1].length;

    // Check if this is a closing tag for our opening tag (at baseIndent or less)
    if (nextTrimmed === `</${tagName}>` && nextIndent <= baseIndent) {
      htmlLines.push(nextLine);
      idx += 1;
      break;
    }

    htmlLines.push(nextLine);
    idx += 1;
  }

  return {
    tagLabel,
    rawContent: htmlLines.join('\n'),
    nextIndex: idx
  };
}

/**
 * extractFragmentFromLine — Extract a fragment marker from the end of a line.
 *
 * Matches `++`, `++:modifiers`, or `==:modifiers` at the end of a line.
 * Returns `{ textWithoutFragment, fragmentMarker }` or `null` if no fragment found.
 */
export function extractFragmentFromLine(line) {
  const text = String(line || '');
  const match = text.match(/^(.*?)\s*((?:\+\+|==)(?::[a-zA-Z0-9_-]+)*)\s*$/);
  if (match) {
    return {
      textWithoutFragment: match[1].trimEnd(),
      fragmentMarker: match[2]
    };
  }
  return null;
}

/**
 * getFragmentMarkerSymbol — Extract the symbol (++ or ==) from a fragment marker.
 *
 * For `++:reveal` returns `++`. For `==:highlight` returns `==`.
 */
export function getFragmentMarkerSymbol(fragmentMarker) {
  const match = String(fragmentMarker || '').match(/^\+\+|==/);
  return match ? match[0] : '++';
}

/**
 * createHtmlTokenHtml — Generate HTML for an HTML code block token.
 *
 * Returns an HTML string for a `<div class="richbuilder-html-token">`.
 * The full HTML content is stored in `data-html-content` (URL-encoded),
 * but only the tag label is displayed.
 */
export function createHtmlTokenHtml(tagLabel, rawContent) {
  const encoded = encodeURIComponent(String(rawContent || ''));
  return `<div class="richbuilder-html-token" contenteditable="false" data-html-content="${escapeAttribute(encoded)}">${escapeHtml(tagLabel)}</div>`;
}

/**
 * createFragmentTokenHtml — Generate HTML for an inline fragment token.
 *
 * Returns an HTML string for a `<span class="richbuilder-fragment-token">`.
 * The full fragment content (with modifiers) is stored in `data-fragment-content`,
 * but only the marker symbol (`++` or `==`) is displayed.
 */
export function createFragmentTokenHtml(fragmentMarker) {
  const encoded = encodeURIComponent(String(fragmentMarker || ''));
  const symbol = getFragmentMarkerSymbol(fragmentMarker);
  return `<span class="richbuilder-fragment-token" contenteditable="false" data-fragment-content="${escapeAttribute(encoded)}">${escapeHtml(symbol)}</span>`;
}

/**
 * inlineMarkdownToHtml — Convert inline markdown syntax to HTML fragments.
 *
 * Processes a single inline text string, applying image token replacement
 * first (via `imageMarkdownToHtml`) then bold, italic, underline, and cite
 * patterns.  Returns an HTML string suitable for use as `innerHTML`.
 */
export function inlineMarkdownToHtml(text) {
  // Pre-process: extract [text](url) link tokens from raw markdown BEFORE
  // imageMarkdownToHtml HTML-escapes the surrounding text.  This prevents
  // double-escaping of special characters (& etc.) inside link text or URLs.
  // A control-char placeholder (invisible in normal markdown) stands in for
  // each link during the image/escape pass, then gets swapped for the real span.
  const links = [];
  const LINK_PH = '\x01L';
  const pre = String(text || '').replace(/(?<!!)\[([^\]]*)\]\(([^)]+)\)/g, (_, linkText, href) => {
    const idx = links.length;
    links.push({ linkText, href });
    return `${LINK_PH}${idx}\x01`;
  });

  let html = imageMarkdownToHtml(pre);

  if (links.length) {
    html = html.replace(/\x01L(\d+)\x01/g, (_, idxStr) => {
      const { linkText, href } = links[parseInt(idxStr, 10)];
      return `<span class="richbuilder-link-token" contenteditable="false" data-href="${escapeAttribute(href)}">${escapeHtml(linkText)}</span>`;
    });
  }

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

    let itemText = token.text;
    let fragmentMarker = null;
    const fragInfo = extractFragmentFromLine(itemText);
    if (fragInfo) {
      itemText = fragInfo.textWithoutFragment;
      fragmentMarker = fragInfo.fragmentMarker;
    }

    const li = document.createElement('li');
    if (token.isChecklist) {
      li.dataset.checklist = 'true';
      li.dataset.checked = token.checked ? 'true' : 'false';
      li.appendChild(createChecklistLabel(itemText, token.checked));
    } else {
      li.innerHTML = inlineMarkdownToHtml(itemText);
    }

    if (fragmentMarker) {
      const fragSpan = document.createElement('span');
      fragSpan.className = 'richbuilder-fragment-token';
      fragSpan.contentEditable = 'false';
      fragSpan.setAttribute('data-fragment-content', encodeURIComponent(fragmentMarker));
      fragSpan.textContent = getFragmentMarkerSymbol(fragmentMarker);
      li.appendChild(fragSpan);
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

    const htmlBlock = parseHtmlBlock(lines, idx);
    if (htmlBlock) {
      chunks.push(createHtmlTokenHtml(htmlBlock.tagLabel, htmlBlock.rawContent));
      idx = htmlBlock.nextIndex;
      continue;
    }

    const macroBlock = parseMacroBlock(lines, idx);
    if (macroBlock) {
      const encodedContent = encodeURIComponent(macroBlock.rawContent);
      chunks.push(`<div class="richbuilder-macro-token" contenteditable="false" data-macro-content="${escapeAttribute(encodedContent)}">${escapeHtml(macroBlock.tagLabel)}</div>`);
      idx = macroBlock.nextIndex;
      continue;
    }

    if (/^>\s*/.test(trimmed)) {
      let bqContent = trimmed.replace(/^>\s*/, '');
      let fragmentHtml = '';
      const bqFrag = extractFragmentFromLine(bqContent);
      if (bqFrag) {
        bqContent = bqFrag.textWithoutFragment;
        fragmentHtml = createFragmentTokenHtml(bqFrag.fragmentMarker);
      }
      chunks.push(`<blockquote>${inlineMarkdownToHtml(bqContent)}${fragmentHtml}</blockquote>`);
      idx += 1;
      continue;
    }

    const citeLine = parseStandaloneCiteLine(line);
    if (citeLine !== null) {
      let citeText = citeLine;
      let fragmentHtml = '';
      const citeFrag = extractFragmentFromLine(citeText);
      if (citeFrag) {
        citeText = citeFrag.textWithoutFragment;
        fragmentHtml = createFragmentTokenHtml(citeFrag.fragmentMarker);
      }
      chunks.push(`<cite>${inlineMarkdownToHtml(citeText)}${fragmentHtml}</cite>`);
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
      let content = line.replace(/^#####\s+/, '');
      let fragmentHtml = '';
      const h5Frag = extractFragmentFromLine(content);
      if (h5Frag) {
        content = h5Frag.textWithoutFragment;
        fragmentHtml = createFragmentTokenHtml(h5Frag.fragmentMarker);
      }
      chunks.push(`<h5>${inlineMarkdownToHtml(content)}${fragmentHtml}</h5>`);
      idx += 1;
      continue;
    }
    if (/^####\s+/.test(line)) {
      let content = line.replace(/^####\s+/, '');
      let fragmentHtml = '';
      const h4Frag = extractFragmentFromLine(content);
      if (h4Frag) {
        content = h4Frag.textWithoutFragment;
        fragmentHtml = createFragmentTokenHtml(h4Frag.fragmentMarker);
      }
      chunks.push(`<h4>${inlineMarkdownToHtml(content)}${fragmentHtml}</h4>`);
      idx += 1;
      continue;
    }
    if (/^###\s+/.test(line)) {
      let content = line.replace(/^###\s+/, '');
      let fragmentHtml = '';
      const h3Frag = extractFragmentFromLine(content);
      if (h3Frag) {
        content = h3Frag.textWithoutFragment;
        fragmentHtml = createFragmentTokenHtml(h3Frag.fragmentMarker);
      }
      chunks.push(`<h3>${inlineMarkdownToHtml(content)}${fragmentHtml}</h3>`);
      idx += 1;
      continue;
    }
    if (/^##\s+/.test(line)) {
      let content = line.replace(/^##\s+/, '');
      let fragmentHtml = '';
      const h2Frag = extractFragmentFromLine(content);
      if (h2Frag) {
        content = h2Frag.textWithoutFragment;
        fragmentHtml = createFragmentTokenHtml(h2Frag.fragmentMarker);
      }
      chunks.push(`<h2>${inlineMarkdownToHtml(content)}${fragmentHtml}</h2>`);
      idx += 1;
      continue;
    }
    if (/^#\s+/.test(line)) {
      let content = line.replace(/^#\s+/, '');
      let fragmentHtml = '';
      const h1Frag = extractFragmentFromLine(content);
      if (h1Frag) {
        content = h1Frag.textWithoutFragment;
        fragmentHtml = createFragmentTokenHtml(h1Frag.fragmentMarker);
      }
      chunks.push(`<h1>${inlineMarkdownToHtml(content)}${fragmentHtml}</h1>`);
      idx += 1;
      continue;
    }

    const paragraphParts = [];
    while (idx < lines.length) {
      const paragraphLine = String(lines[idx] || '');
      const paragraphTrimmed = paragraphLine.trim();
      if (!paragraphTrimmed) break;
      if (parseListLine(paragraphLine) || /^#{1,5}\s+/.test(paragraphLine) || parseSingleImageLine(paragraphLine) || /^>\s*/.test(paragraphTrimmed) || paragraphTrimmed === '||' || isTableLine(paragraphLine) || isMacroLine(paragraphLine) || isHtmlOpeningLine(paragraphLine)) {
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
    let lastFragmentMarker = null;
    paragraphParts.forEach((part, partIndex) => {
      if (partIndex > 0) {
        const prev = paragraphParts[partIndex - 1];
        inlineHtml += prev.hasHardBreak ? '<br>' : ' ';
      }
      let partText = part.text;

      // Only check the last part for a fragment
      if (partIndex === paragraphParts.length - 1) {
        const fragInfo = extractFragmentFromLine(partText);
        if (fragInfo) {
          partText = fragInfo.textWithoutFragment;
          lastFragmentMarker = fragInfo.fragmentMarker;
        }
      }

      inlineHtml += inlineMarkdownToHtml(partText);
    });

    if (lastFragmentMarker) {
      inlineHtml += createFragmentTokenHtml(lastFragmentMarker);
    }

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
