function createDemoSlide(title, body = '') {
  return {
    top: '',
    body: `# ${title}\n\n${body}`.trim(),
    notes: ''
  };
}

function showBuilderStatusCard(root, text) {
  root.textContent = text;
  root.style.cssText = [
    'position:absolute',
    'right:12px',
    'top:12px',
    'z-index:30',
    'padding:8px 10px',
    'border-radius:8px',
    'background:rgba(18,24,35,0.92)',
    'color:#fff',
    'font:12px/1.4 sans-serif',
    'border:1px solid rgba(122,162,247,0.5)',
    'box-shadow:0 8px 20px rgba(0,0,0,0.35)',
    'pointer-events:none'
  ].join(';');
}

export function getBuilderExtensions(ctx = {}) {
  const host = ctx.host;
  if (!host) return [];

  return [
    {
      kind: 'toolbar-action',
      id: 'test-toolbar-add-slide',
      label: 'Test Add Slide',
      icon: '🧪',
      onClick() {
        const selection = host.getSelection();
        host.transact('Test plugin add slide', (tx) => {
          tx.insertSlides(selection, [
            createDemoSlide(
              'Test Plugin Slide',
              'Inserted via `registerToolbarAction` and `host.transact(...)`.'
            )
          ]);
        });
        host.notify('Test plugin inserted a slide.', 'info');
      }
    },
    {
      kind: 'panel',
      id: 'test-builder-panel',
      mount(panelCtx) {
        const { root } = panelCtx;
        const container = document.createElement('div');
        container.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

        const title = document.createElement('h4');
        title.textContent = 'Test Builder Panel';
        title.style.cssText = 'margin:0;font:600 13px/1.2 sans-serif;';
        container.appendChild(title);

        const selectionInfo = document.createElement('div');
        selectionInfo.style.cssText = 'font:12px/1.3 sans-serif;opacity:.85;';
        container.appendChild(selectionInfo);

        const addButton = document.createElement('button');
        addButton.type = 'button';
        addButton.className = 'panel-button';
        addButton.textContent = 'Insert Panel Demo Slide';
        addButton.addEventListener('click', () => {
          const sel = host.getSelection();
          host.transact('Test panel insert', (tx) => {
            tx.insertSlides(sel, [
              createDemoSlide('Panel Insert', 'Created from the test panel contribution.')
            ]);
          });
        });
        container.appendChild(addButton);

        const moveButton = document.createElement('button');
        moveButton.type = 'button';
        moveButton.className = 'panel-button';
        moveButton.textContent = 'Move Current Slide To Top';
        moveButton.addEventListener('click', () => {
          const sel = host.getSelection();
          host.transact('Test panel move slide', (tx) => {
            tx.moveSlide({ h: sel.h, v: sel.v }, { h: sel.h, v: 0 });
          });
        });
        container.appendChild(moveButton);

        const inspectButton = document.createElement('button');
        inspectButton.type = 'button';
        inspectButton.className = 'panel-button';
        inspectButton.textContent = 'Show Host Snapshot';
        inspectButton.addEventListener('click', () => {
          const doc = host.getDocument();
          const selection = host.getSelection();
          host.openDialog({
            title: 'Builder Host Snapshot',
            message: `slug=${doc.slug}\nmd=${doc.mdFile}\ncolumns=${doc.stacks.length}\nselection=${selection.h}/${selection.v}`
          });
        });
        container.appendChild(inspectButton);

        const renderSelection = (payload) => {
          const h = Number(payload?.h ?? host.getSelection().h) + 1;
          const v = Number(payload?.v ?? host.getSelection().v) + 1;
          selectionInfo.textContent = `Selection: column ${h}, slide ${v}`;
        };
        renderSelection();
        const offSelection = host.on('selection:changed', renderSelection);

        root.appendChild(container);
        return () => {
          offSelection();
          container.remove();
        };
      }
    },
    {
      kind: 'preview-overlay',
      id: 'test-preview-overlay',
      mount(overlayCtx) {
        const overlayEl = document.createElement('div');
        const draw = (payload = {}) => {
          const indices = payload.indices || host.getSelection();
          showBuilderStatusCard(
            overlayEl,
            `Test Overlay: H${Number(indices.h) + 1} V${Number(indices.v) + 1}`
          );
        };
        draw();
        const offSlideChanged = host.on('preview:slidechanged', draw);
        overlayCtx.root.appendChild(overlayEl);
        return () => {
          offSlideChanged();
          overlayEl.remove();
        };
      }
    },
    {
      kind: 'mode',
      id: 'test-builder-mode',
      label: 'Test Mode',
      icon: '🧩',
      location: 'preview-header',
      mount(modeCtx) {
        const hostApi = modeCtx.host;
        let offDocChanged = null;
        let offSaveAfter = null;

        return {
          onActivate() {
            hostApi.notify('Test mode active.', 'info');
            offDocChanged = hostApi.on('document:changed', () => {
              const ui = hostApi.getUiState();
              console.log('[test plugin] document:changed (dirty=%s)', ui.dirty);
            });
            offSaveAfter = hostApi.on('save:after', (event) => {
              if (event?.success) {
                hostApi.notify('Test mode observed successful save.', 'info');
              }
            });
          },
          onDeactivate() {
            if (offDocChanged) offDocChanged();
            if (offSaveAfter) offSaveAfter();
            offDocChanged = null;
            offSaveAfter = null;
          },
          onSelectionChanged(payload) {
            const h = Number(payload?.h ?? 0) + 1;
            const v = Number(payload?.v ?? 0) + 1;
            console.log('[test plugin] mode selection H%s V%s', h, v);
          }
        };
      }
    }
  ];
}
