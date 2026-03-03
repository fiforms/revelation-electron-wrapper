function ensureStyles() {
  if (document.getElementById('richbuilder-style')) return;
  const style = document.createElement('style');
  style.id = 'richbuilder-style';
  style.textContent = `
    .richbuilder-root {
      display: none;
      height: 100%;
      min-height: 0;
      flex: 1;
      background: #0f131b;
      color: #e5ebf5;
      border-top: 1px solid #2a2f39;
      flex-direction: column;
    }
    .richbuilder-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 10px;
      border-bottom: 1px solid #2a2f39;
      background: #171d29;
    }
    .richbuilder-toolbar-group {
      display: inline-flex;
      gap: 6px;
      align-items: center;
    }
    .richbuilder-btn {
      border: 1px solid #3a4456;
      background: #20283a;
      color: #ecf2ff;
      border-radius: 6px;
      padding: 4px 10px;
      font: 600 12px/1.2 "Source Sans Pro", sans-serif;
      cursor: pointer;
    }
    .richbuilder-btn:hover {
      background: #2a3550;
    }
    .richbuilder-btn[data-active="true"] {
      border-color: #66a2ff;
      background: #264c82;
    }
    .richbuilder-stage {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 20px;
      background:
        radial-gradient(circle at 90% 10%, rgba(83, 125, 213, 0.12), transparent 45%),
        radial-gradient(circle at 10% 90%, rgba(75, 159, 130, 0.12), transparent 42%),
        #0f131b;
    }
    .richbuilder-editor {
      min-height: 100%;
      background: #0b0f17;
      border: 1px solid #2e3544;
      border-radius: 10px;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.01);
      padding: 26px;
      font: 400 36px/1.35 "Noto Serif", serif;
      white-space: pre-wrap;
      word-break: break-word;
      outline: none;
    }
    .richbuilder-editor h1,
    .richbuilder-editor h2,
    .richbuilder-editor h3,
    .richbuilder-editor p,
    .richbuilder-editor div {
      margin: 0 0 0.3em 0;
    }
    .richbuilder-editor ul,
    .richbuilder-editor ol {
      margin: 0 0 0.5em 0;
      padding-left: 1.25em;
    }
    .richbuilder-editor li {
      margin: 0.08em 0;
    }
    .richbuilder-check-item {
      display: inline-flex;
      align-items: center;
      gap: 0.45em;
    }
    .richbuilder-check-item input[type="checkbox"] {
      width: 0.95em;
      height: 0.95em;
      margin: 0;
    }
    .richbuilder-check-item input[type="checkbox"]:checked + .richbuilder-check-text {
      text-decoration: line-through;
      opacity: 0.82;
    }
    .richbuilder-editor h1 { font-size: 1.35em; }
    .richbuilder-editor h2 { font-size: 1.2em; }
    .richbuilder-editor h3 { font-size: 1.05em; }
    .richbuilder-hint {
      margin-left: auto;
      font: 500 11px/1.2 "Source Sans Pro", sans-serif;
      opacity: 0.72;
      align-self: center;
    }
  `;
  document.head.appendChild(style);
}

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function inlineMarkdownToHtml(text) {
  let html = escapeHtml(text || '');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/\+\+(.+?)\+\+/g, '<u>$1</u>');
  return html;
}

function parseListLine(line) {
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

function createChecklistLabel(text, checked) {
  const label = document.createElement('label');
  label.className = 'richbuilder-check-item';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!checked;
  input.setAttribute('contenteditable', 'false');

  const textSpan = document.createElement('span');
  textSpan.className = 'richbuilder-check-text';
  textSpan.innerHTML = inlineMarkdownToHtml(text);

  label.appendChild(input);
  label.appendChild(textSpan);
  return label;
}

function buildListBlock(lines, startIndex) {
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

function markdownToHtml(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const chunks = [];
  let idx = 0;

  while (idx < lines.length) {
    const line = lines[idx];
    const trimmed = String(line || '').trim();

    if (!trimmed) {
      chunks.push('<div><br></div>');
      idx += 1;
      continue;
    }

    if (parseListLine(line)) {
      const block = buildListBlock(lines, idx);
      chunks.push(block.html);
      idx = block.nextIndex;
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

    chunks.push(`<div>${inlineMarkdownToHtml(line)}</div>`);
    idx += 1;
  }

  return chunks.join('');
}

function serializeInline(node) {
  if (!node) return '';
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const tag = node.tagName.toLowerCase();
  if (tag === 'br') return '';
  if (tag === 'input' && node.getAttribute('type') === 'checkbox') return '';

  const inner = Array.from(node.childNodes).map(serializeInline).join('');
  if (tag === 'em' || tag === 'i') return `*${inner}*`;
  if (tag === 'strong' || tag === 'b') return `**${inner}**`;
  if (tag === 'u') return `++${inner}++`;
  return inner;
}

function serializeListToMarkdown(listEl, depth = 0) {
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

      let content = Array.from(itemClone.childNodes).map(serializeInline).join('').replace(/\s+/g, ' ').trim();
      const checklistInput = item.querySelector(':scope > .richbuilder-check-item > input[type="checkbox"]');
      const checklistState = item.dataset.checklist === 'true' || !!checklistInput;
      const checked = item.dataset.checked === 'true' || !!checklistInput?.checked;
      if (!content && checklistInput) {
        const textEl = item.querySelector(':scope > .richbuilder-check-item > .richbuilder-check-text');
        content = Array.from(textEl?.childNodes || []).map(serializeInline).join('').replace(/\s+/g, ' ').trim();
      }

      const indent = '  '.repeat(depth);
      const bullet = listTag === 'ol' ? `${orderedIndex}. ` : '- ';
      const checklistPrefix = checklistState ? `[${checked ? 'x' : ' '}] ` : '';
      if (content || checklistState) {
        lines.push(`${indent}${bullet}${checklistPrefix}${content}`.trimEnd());
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

function htmlToMarkdown(rootEl) {
  if (!rootEl) return '';
  const lines = [];
  const blocks = Array.from(rootEl.children);

  if (!blocks.length) {
    return String(rootEl.textContent || '').trim();
  }

  blocks.forEach((node) => {
    const tag = node.tagName.toLowerCase();
    const childElements = Array.from(node.children || []);
    const directChildLists = childElements.filter((child) => {
      const childTag = child.tagName?.toLowerCase();
      return childTag === 'ul' || childTag === 'ol';
    });

    if (tag === 'ul' || tag === 'ol') {
      lines.push(...serializeListToMarkdown(node, 0));
      return;
    }

    if (tag === 'li') {
      const inline = Array.from(node.childNodes).map(serializeInline).join('').replace(/\s+/g, ' ').trim();
      if (inline) lines.push(`- ${inline}`);
      return;
    }

    if (directChildLists.length) {
      const nonListNodes = Array.from(node.childNodes).filter((child) => {
        if (child.nodeType !== Node.ELEMENT_NODE) return true;
        const childTag = child.tagName.toLowerCase();
        return childTag !== 'ul' && childTag !== 'ol';
      });
      const wrapperText = nonListNodes.map(serializeInline).join('').replace(/\s+/g, ' ').trim();
      if (wrapperText) {
        lines.push(wrapperText);
      }
      directChildLists.forEach((list) => {
        lines.push(...serializeListToMarkdown(list, 0));
      });
      return;
    }

    const content = Array.from(node.childNodes).map(serializeInline).join('').trim();

    if (!content) {
      lines.push('');
      return;
    }
    if (tag === 'h1') {
      lines.push(`# ${content}`);
      return;
    }
    if (tag === 'h2') {
      lines.push(`## ${content}`);
      return;
    }
    if (tag === 'h3') {
      lines.push(`### ${content}`);
      return;
    }
    lines.push(content);
  });

  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function applyHeadingTag(level) {
  const tag = level === 1 ? 'H1' : level === 2 ? 'H2' : level === 3 ? 'H3' : 'DIV';
  document.execCommand('formatBlock', false, tag);
}

function getSelectionListItem() {
  const selection = window.getSelection();
  let node = selection?.anchorNode || null;
  if (node && node.nodeType !== Node.ELEMENT_NODE) {
    node = node.parentElement;
  }
  return node && typeof node.closest === 'function' ? node.closest('li') : null;
}

function handleEditorTabIndent(event) {
  if (!event || event.key !== 'Tab') return false;
  const activeLi = getSelectionListItem();
  if (!activeLi) return false;
  event.preventDefault();
  if (event.shiftKey) {
    document.execCommand('outdent', false);
  } else {
    document.execCommand('indent', false);
  }
  return true;
}

function toggleChecklistAtSelection(editor) {
  if (!editor) return;
  let li = getSelectionListItem();

  if (!li) {
    document.execCommand('insertUnorderedList', false);
    li = getSelectionListItem();
  }
  if (!li) return;

  const existingInput = li.querySelector(':scope > .richbuilder-check-item > input[type="checkbox"]');
  if (existingInput) {
    existingInput.checked = !existingInput.checked;
    li.dataset.checklist = 'true';
    li.dataset.checked = existingInput.checked ? 'true' : 'false';
    return;
  }

  const nestedLists = Array.from(li.children).filter((child) => {
    const tag = child.tagName?.toLowerCase();
    return tag === 'ul' || tag === 'ol';
  });
  const inlineNodes = Array.from(li.childNodes).filter((child) => !nestedLists.includes(child));

  const label = createChecklistLabel('', false);
  const textSpan = label.querySelector('.richbuilder-check-text');
  inlineNodes.forEach((node) => textSpan.appendChild(node));
  li.insertBefore(label, li.firstChild);
  li.dataset.checklist = 'true';
  li.dataset.checked = 'false';
}

function updateTextareaMarkdown(markdown) {
  const editorEl = document.getElementById('slide-editor');
  if (!editorEl) return;
  if (editorEl.value === markdown) return;
  editorEl.value = markdown;
  editorEl.dispatchEvent(new Event('input', { bubbles: true }));
}

function getCurrentSlideBody(host) {
  const doc = host.getDocument();
  const selection = host.getSelection();
  return String(doc?.stacks?.[selection.h]?.[selection.v]?.body || '');
}

function updateToolbarState(editorEl, toolbarEl) {
  const blocks = ['h1', 'h2', 'h3'];
  const activeTag = String(document.queryCommandValue('formatBlock') || '').toLowerCase();
  blocks.forEach((tag) => {
    const btn = toolbarEl.querySelector(`[data-role="heading-${tag}"]`);
    if (btn) {
      btn.dataset.active = String(activeTag === tag);
    }
  });

  const isItalic = document.queryCommandState('italic');
  const isUnderline = document.queryCommandState('underline');
  const isBold = document.queryCommandState('bold');
  const isUl = document.queryCommandState('insertUnorderedList');
  const isOl = document.queryCommandState('insertOrderedList');
  const activeChecklist = getSelectionListItem()?.dataset?.checklist === 'true';

  const italicBtn = toolbarEl.querySelector('[data-role="italic"]');
  const underlineBtn = toolbarEl.querySelector('[data-role="underline"]');
  const boldBtn = toolbarEl.querySelector('[data-role="bold"]');
  const ulBtn = toolbarEl.querySelector('[data-role="ul"]');
  const olBtn = toolbarEl.querySelector('[data-role="ol"]');
  const checklistBtn = toolbarEl.querySelector('[data-role="checklist"]');

  if (italicBtn) italicBtn.dataset.active = String(!!isItalic);
  if (underlineBtn) underlineBtn.dataset.active = String(!!isUnderline);
  if (boldBtn) boldBtn.dataset.active = String(!!isBold);
  if (ulBtn) ulBtn.dataset.active = String(!!isUl);
  if (olBtn) olBtn.dataset.active = String(!!isOl);
  if (checklistBtn) checklistBtn.dataset.active = String(activeChecklist);

  if (!editorEl.contains(document.activeElement)) {
    [italicBtn, underlineBtn, boldBtn, ulBtn, olBtn, checklistBtn].forEach((btn) => {
      if (btn) btn.dataset.active = 'false';
    });
  }
}

export function getBuilderExtensions(ctx = {}) {
  const host = ctx.host;
  if (!host) return [];

  return [
    {
      kind: 'mode',
      id: 'rich-builder-mode',
      label: 'Rich',
      icon: 'R',
      location: 'preview-header',
      mount(modeCtx) {
        ensureStyles();

        const previewFrame = document.getElementById('preview-frame');
        const previewPanel = document.querySelector('.builder-preview .panel-body') || previewFrame?.parentElement;

        const root = document.createElement('div');
        root.className = 'richbuilder-root';

        const toolbar = document.createElement('div');
        toolbar.className = 'richbuilder-toolbar';
        toolbar.innerHTML = `
          <div class="richbuilder-toolbar-group">
            <button type="button" class="richbuilder-btn" data-role="heading-h1">H1</button>
            <button type="button" class="richbuilder-btn" data-role="heading-h2">H2</button>
            <button type="button" class="richbuilder-btn" data-role="heading-h3">H3</button>
          </div>
          <div class="richbuilder-toolbar-group">
            <button type="button" class="richbuilder-btn" data-role="bold"><b>B</b></button>
            <button type="button" class="richbuilder-btn" data-role="italic"><i>I</i></button>
            <button type="button" class="richbuilder-btn" data-role="underline"><u>U</u></button>
          </div>
          <div class="richbuilder-toolbar-group">
            <button type="button" class="richbuilder-btn" data-role="ul">UL</button>
            <button type="button" class="richbuilder-btn" data-role="ol">OL</button>
            <button type="button" class="richbuilder-btn" data-role="checklist">Task</button>
          </div>
          <div class="richbuilder-hint">Rich editing updates slide markdown</div>
        `;

        const stage = document.createElement('div');
        stage.className = 'richbuilder-stage';

        const editor = document.createElement('div');
        editor.className = 'richbuilder-editor';
        editor.contentEditable = 'true';
        editor.spellcheck = true;

        stage.appendChild(editor);
        root.appendChild(toolbar);
        root.appendChild(stage);

        if (previewPanel) {
          previewPanel.appendChild(root);
        }

        let isActive = false;
        let syncing = false;
        let rafToken = 0;
        let lastSyncedMarkdown = '';

        const syncToMarkdown = () => {
          if (!isActive || syncing) return;
          const markdown = htmlToMarkdown(editor);
          lastSyncedMarkdown = markdown;
          updateTextareaMarkdown(markdown);
          updateToolbarState(editor, toolbar);
        };

        const scheduleSync = () => {
          if (rafToken) cancelAnimationFrame(rafToken);
          rafToken = requestAnimationFrame(() => {
            rafToken = 0;
            syncToMarkdown();
          });
        };

        const syncFromCurrentSlide = () => {
          if (!isActive) return;
          const markdown = getCurrentSlideBody(host);
          if (markdown === lastSyncedMarkdown) return;
          syncing = true;
          editor.innerHTML = markdownToHtml(markdown);
          if (!editor.textContent?.trim()) {
            editor.innerHTML = '<div><br></div>';
          }
          lastSyncedMarkdown = markdown;
          syncing = false;
        };

        toolbar.addEventListener('click', (event) => {
          const btn = event.target.closest('button[data-role]');
          if (!btn || !isActive) return;

          const role = btn.dataset.role;
          editor.focus();

          if (role === 'heading-h1') applyHeadingTag(1);
          if (role === 'heading-h2') applyHeadingTag(2);
          if (role === 'heading-h3') applyHeadingTag(3);
          if (role === 'bold') document.execCommand('bold', false);
          if (role === 'italic') document.execCommand('italic', false);
          if (role === 'underline') document.execCommand('underline', false);
          if (role === 'ul') document.execCommand('insertUnorderedList', false);
          if (role === 'ol') document.execCommand('insertOrderedList', false);
          if (role === 'checklist') toggleChecklistAtSelection(editor);

          scheduleSync();
        });

        editor.addEventListener('input', scheduleSync);
        editor.addEventListener('keydown', (event) => {
          if (handleEditorTabIndent(event)) {
            scheduleSync();
          }
        });
        editor.addEventListener('change', (event) => {
          const target = event.target;
          if (target instanceof HTMLInputElement && target.type === 'checkbox') {
            const li = target.closest('li');
            if (li) {
              li.dataset.checklist = 'true';
              li.dataset.checked = target.checked ? 'true' : 'false';
            }
            scheduleSync();
          }
        });
        editor.addEventListener('keyup', () => updateToolbarState(editor, toolbar));
        editor.addEventListener('mouseup', () => updateToolbarState(editor, toolbar));

        const onSelectionChanged = () => {
          syncFromCurrentSlide();
        };

        const onDocumentChanged = (payload) => {
          if (payload?.source === 'dirty') return;
          if (editor.contains(document.activeElement)) return;
          syncFromCurrentSlide();
        };

        return {
          onActivate() {
            isActive = true;
            root.style.display = 'flex';
            if (previewFrame) {
              previewFrame.style.display = 'none';
            }
            syncFromCurrentSlide();
            editor.focus();
          },
          onDeactivate() {
            isActive = false;
            if (rafToken) cancelAnimationFrame(rafToken);
            rafToken = 0;
            root.style.display = 'none';
            if (previewFrame) {
              previewFrame.style.display = '';
            }
          },
          onSelectionChanged,
          onDocumentChanged,
          dispose() {
            if (rafToken) cancelAnimationFrame(rafToken);
            root.remove();
          }
        };
      }
    }
  ];
}
