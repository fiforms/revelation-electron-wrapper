/**
 * builder-serialize.js — HTML → Markdown Serialization Pipeline
 *
 * Converts the rich editor's live DOM back to REVELation slide markdown.
 * `htmlToMarkdown` is the inverse of `markdownToHtml` in builder-markdown.js.
 *
 * Walk order inside `htmlToMarkdown`:
 *   two-column blocks → tables → lists → headings → blockquote → cite →
 *   plain div/paragraph
 *
 * `serializeInline` recurses into DOM nodes to produce inline markdown
 * (bold, italic, underline, cite, image tokens).  `serializeListToMarkdown`
 * and `serializeTableToMarkdown` handle their respective block structures.
 */

import { trimEmptyEdgeLines, rbDebug, previewText, countImageMarkdownTokens } from './builder-utils.js';

/**
 * serializeInline — Recursively convert a DOM node to inline markdown text.
 *
 * Handles text nodes, `<br>` (hard break), image/video elements (via
 * `data-md-*` attributes), and inline formatting tags (`<strong>`, `<em>`,
 * `<u>`, `<cite>`).  Returns a markdown string fragment.
 */
export function serializeInline(node) {
  if (!node) return '';
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const tag = node.tagName.toLowerCase();
  if (tag === 'br') return '  \n';
  if (tag === 'input' && node.getAttribute('type') === 'checkbox') return '';
  if (tag === 'span' && node.hasAttribute('data-md-image')) {
    const token = node.getAttribute('data-md-image') || '';
    rbDebug('serializeInline:image-span', { token });
    return token;
  }
  if (tag === 'img') {
    const alt = node.getAttribute('data-md-alt') ?? node.getAttribute('alt') ?? '';
    const src = node.getAttribute('data-md-src') ?? node.getAttribute('src') ?? '';
    rbDebug('serializeInline:image-tag', { alt, src });
    return src ? `![${alt}](${src})` : '';
  }
  if (tag === 'video') {
    const alt = node.getAttribute('data-md-alt') ?? '';
    const src = node.getAttribute('data-md-src') ?? node.getAttribute('src') ?? '';
    rbDebug('serializeInline:video-tag', { alt, src });
    return src ? `![${alt}](${src})` : '';
  }

  const inner = Array.from(node.childNodes).map(serializeInline).join('');
  if (tag === 'cite') return `\n_${inner}_\n`;
  if (tag === 'em' || tag === 'i') return `*${inner}*`;
  if (tag === 'strong' || tag === 'b') return `**${inner}**`;
  if (tag === 'u') return `__${inner}__`;
  return inner;
}

/**
 * serializeListToMarkdown — Convert a `<ul>` or `<ol>` element to markdown lines.
 *
 * Recursively processes nested lists, incrementing `depth` for each level.
 * Checklist items are detected via `data-checklist` / `data-checked` dataset
 * attributes and the `.richbuilder-check-item` child structure, producing the
 * `- [x] text` / `- [ ] text` syntax.
 */
export function serializeListToMarkdown(listEl, depth = 0) {
  const lines = [];
  if (!listEl) return lines;
  const listTag = listEl.tagName.toLowerCase();
  let orderedIndex = 1;
  let sawRealListItem = false;
  const childElements = Array.from(listEl.children || []);

  childElements.forEach((element) => {
    const tag = element.tagName?.toLowerCase();
    if (tag === 'li') {
      sawRealListItem = true;
      const item = element;
      const nestedLists = Array.from(item.querySelectorAll('ul, ol')).filter((listNode) => {
        return listNode.closest('li') === item;
      });

      const itemClone = item.cloneNode(true);
      Array.from(itemClone.querySelectorAll('ul, ol')).forEach((listNode) => {
        if (listNode.closest('li') === itemClone) {
          listNode.remove();
        }
      });

      let content = trimEmptyEdgeLines(Array.from(itemClone.childNodes).map(serializeInline).join(''));
      const checklistInput = item.querySelector(':scope > .richbuilder-check-item > input[type="checkbox"]');
      const checklistState = item.dataset.checklist === 'true' || !!checklistInput;
      const checked = item.dataset.checked === 'true' || !!checklistInput?.checked;
      if (!content && checklistInput) {
        const textEl = item.querySelector(':scope > .richbuilder-check-item > .richbuilder-check-text');
        content = trimEmptyEdgeLines(Array.from(textEl?.childNodes || []).map(serializeInline).join(''));
      }

      const indent = '  '.repeat(depth);
      const bullet = listTag === 'ol' ? `${orderedIndex}. ` : '- ';
      const checklistPrefix = checklistState ? `[${checked ? 'x' : ' '}] ` : '';
      if (content || checklistState) {
        lines.push(`${indent}${bullet}${checklistPrefix}${content}`);
      }
      if (listTag === 'ol') {
        orderedIndex += 1;
      }

      nestedLists.forEach((nested) => {
        lines.push(...serializeListToMarkdown(nested, depth + 1));
      });
      return;
    }

    if (tag === 'ul' || tag === 'ol') {
      // Some browsers create orphan nested lists when indenting in contenteditable.
      // Treat them as nested content so markdown does not lose indented items.
      lines.push(...serializeListToMarkdown(element, depth + (sawRealListItem ? 1 : 0)));
    }
  });

  return lines;
}

/**
 * serializeTableToMarkdown — Convert a `<table>` element to GFM table markdown.
 *
 * Reads column alignments from `data-align` attributes on header cells to
 * reproduce the correct separator row syntax (`:---:`, `---:`, `---`).
 * Cell content is serialized through `serializeInline` and pipe characters
 * inside cells are escaped as `\|`.
 */
export function serializeTableToMarkdown(tableEl) {
  if (!tableEl) return '';
  const thead = tableEl.querySelector(':scope > thead');
  const tbody = tableEl.querySelector(':scope > tbody');
  const headerRow = thead ? thead.querySelector('tr') : tableEl.querySelector('tr');
  if (!headerRow) return '';
  const headerCells = Array.from(headerRow.querySelectorAll('th, td'));
  const colCount = headerCells.length;
  if (colCount === 0) return '';
  const alignments = headerCells.map((th) => String(th.dataset?.align || 'left'));
  const separatorCells = alignments.map((align) =>
    align === 'center' ? ':---:' : align === 'right' ? '---:' : '---'
  );
  const serializeCells = (cells) => {
    const contents = Array.from({ length: colCount }, (_, i) => {
      const cell = cells[i];
      if (!cell) return '';
      return trimEmptyEdgeLines(Array.from(cell.childNodes).map(serializeInline).join(''))
        .replace(/\n/g, ' ')
        .replace(/\|/g, '\\|');
    });
    return '| ' + contents.join(' | ') + ' |';
  };
  const mdLines = [];
  mdLines.push(serializeCells(headerCells));
  mdLines.push('| ' + separatorCells.join(' | ') + ' |');
  if (tbody) {
    Array.from(tbody.querySelectorAll('tr')).forEach((row) => {
      mdLines.push(serializeCells(Array.from(row.querySelectorAll('td, th'))));
    });
  }
  return mdLines.join('\n');
}

/**
 * htmlToMarkdown — Convert the rich editor DOM to REVELation slide markdown.
 *
 * The main HTML → markdown entry point.  Walks the direct children of
 * `rootEl`, dispatching each block to the appropriate serializer.  Returns the
 * full markdown string ready to be written to the slide textarea.
 */
export function htmlToMarkdown(rootEl) {
  if (!rootEl) return '';
  const lines = [];
  const blocks = Array.from(rootEl.children);
  rbDebug('htmlToMarkdown:start', {
    blockCount: blocks.length,
    rootHtml: previewText(rootEl.innerHTML, 520)
  });

  if (!blocks.length) {
    const fallback = String(rootEl.textContent || '').trim();
    rbDebug('htmlToMarkdown:no-blocks-fallback', {
      textContent: previewText(rootEl.textContent || '', 420),
      fallback
    });
    return fallback;
  }

  blocks.forEach((node, blockIndex) => {
    if (node instanceof Element && node.dataset?.twocol === 'true') {
      const leftCol = node.querySelector(':scope > [data-col="left"]');
      const rightCol = node.querySelector(':scope > [data-col="right"]');
      lines.push('||');
      lines.push('');
      const leftMd = leftCol ? htmlToMarkdown(leftCol).trim() : '';
      if (leftMd) lines.push(leftMd);
      lines.push('');
      lines.push('||');
      lines.push('');
      const rightMd = rightCol ? htmlToMarkdown(rightCol).trim() : '';
      if (rightMd) lines.push(rightMd);
      lines.push('');
      lines.push('||');
      lines.push('');
      return;
    }

    const tag = node.tagName.toLowerCase();
    rbDebug('htmlToMarkdown:block:start', {
      blockIndex,
      tag,
      html: previewText(node.outerHTML || '', 420)
    });
    const childElements = Array.from(node.children || []);
    const directChildLists = childElements.filter((child) => {
      const childTag = child.tagName?.toLowerCase();
      return childTag === 'ul' || childTag === 'ol';
    });

    if (tag === 'table') {
      const tableMarkdown = serializeTableToMarkdown(node);
      if (tableMarkdown) {
        lines.push(tableMarkdown);
        lines.push('');
      }
      return;
    }

    if (tag === 'ul' || tag === 'ol') {
      lines.push(...serializeListToMarkdown(node, 0));
      lines.push('');
      return;
    }

    if (tag === 'li') {
      const inline = trimEmptyEdgeLines(Array.from(node.childNodes).map(serializeInline).join(''));
      if (inline) {
        lines.push(`- ${inline}`);
        lines.push('');
      }
      return;
    }

    if (directChildLists.length) {
      const nonListNodes = Array.from(node.childNodes).filter((child) => {
        if (child.nodeType !== Node.ELEMENT_NODE) return true;
        const childTag = child.tagName.toLowerCase();
        return childTag !== 'ul' && childTag !== 'ol';
      });
      const wrapperText = trimEmptyEdgeLines(nonListNodes.map(serializeInline).join(''));
      if (wrapperText) {
        lines.push(wrapperText);
      }
      directChildLists.forEach((list) => {
        lines.push(...serializeListToMarkdown(list, 0));
      });
      lines.push('');
      return;
    }

    const content = trimEmptyEdgeLines(Array.from(node.childNodes).map(serializeInline).join(''));
    rbDebug('htmlToMarkdown:block:content', {
      blockIndex,
      tag,
      content
    });

    if (!content) {
      lines.push('');
      return;
    }
    if (tag === 'h1') {
      lines.push(`# ${content}`);
      lines.push('');
      return;
    }
    if (tag === 'h2') {
      lines.push(`## ${content}`);
      lines.push('');
      return;
    }
    if (tag === 'h3') {
      lines.push(`### ${content}`);
      lines.push('');
      return;
    }
    if (tag === 'h4') {
      lines.push(`#### ${content}`);
      lines.push('');
      return;
    }
    if (tag === 'h5') {
      lines.push(`##### ${content}`);
      lines.push('');
      return;
    }
    if (tag === 'blockquote') {
      lines.push(`> ${content}`);
      lines.push('');
      return;
    }
    if (tag === 'cite') {
      lines.push(`_${content}_`);
      lines.push('');
      return;
    }
    lines.push(content);
    lines.push('');
  });

  const markdown = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
  rbDebug('htmlToMarkdown:end', {
    blockCount: blocks.length,
    imageTokenCount: countImageMarkdownTokens(markdown),
    markdown: previewText(markdown, 420)
  });
  return markdown;
}
