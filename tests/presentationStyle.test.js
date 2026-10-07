// Style tab: http_admin/create/style-block.js (CSS block model), revelation/css/fonts/fonts.json (font manifest),
// lib/presentationStyle.js (confined file IO) and the export rewrite of the block's font imports.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { readStyle, writeStyle, resolveStylePath } = require('../lib/presentationStyle');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'http_admin', 'create', 'style-block.js')).href);

test('buildStyleBlock and parseStyleBlock round-trip', async () => {
  const { buildStyleBlock, parseStyleBlock } = await load();
  const settings = {
    h1: { fontFamily: 'serif', fontSize: 2.5, color: '#FF0000', fontWeight: '700' },
    p: { fontSize: 1.1 },
    li: { color: '#00ff00' }
  };
  const css = buildStyleBlock(settings);
  assert.match(css, /\.reveal \.slides h1 \{ font-family: "Times New Roman"/);
  assert.deepStrictEqual(parseStyleBlock(css), {
    h1: { fontFamily: 'serif', fontSize: 2.5, color: '#ff0000', fontWeight: '700' },
    p: { fontSize: 1.1 },
    li: { color: '#00ff00' }
  });
});

test('empty settings build an empty block', async () => {
  const { buildStyleBlock } = await load();
  assert.strictEqual(buildStyleBlock({}), '');
  assert.strictEqual(buildStyleBlock({ h1: {}, p: { fontSize: '' } }), '');
});

test('invalid values are dropped so CSS cannot be injected', async () => {
  const { buildStyleBlock } = await load();
  const css = buildStyleBlock({
    h1: { color: 'red; } body { display:none', fontSize: '2em; x', fontWeight: 'bold', fontFamily: 'x}' },
    h2: { fontSize: 99 },
    h4: { fontSize: 0.5 },
    h5: { fontSize: 3.5 },
    h3: { color: '#abc' }
  });
  assert.strictEqual(css, '');
});

test('italic and uppercase round-trip, including the "off" values', async () => {
  const { buildStyleBlock, parseStyleBlock } = await load();
  const settings = { h1: { fontStyle: 'italic', textTransform: 'uppercase' }, h2: { fontStyle: 'normal', textTransform: 'none' } };
  const css = buildStyleBlock(settings);
  assert.match(css, /h1 \{ font-style: italic; text-transform: uppercase; \}/);
  assert.match(css, /h2 \{ font-style: normal; text-transform: none; \}/);
  assert.deepStrictEqual(parseStyleBlock(css), settings);
  assert.strictEqual(buildStyleBlock({ p: { fontStyle: 'oblique; x', textTransform: 'capitalize' } }), '');
});

test('the font size range is 0.8 to 3.0em', async () => {
  const { buildStyleBlock, FONT_SIZE_MIN, FONT_SIZE_MAX } = await load();
  assert.strictEqual(FONT_SIZE_MIN, 0.8);
  assert.strictEqual(FONT_SIZE_MAX, 3);
  assert.match(buildStyleBlock({ p: { fontSize: 0.8 } }), /font-size: 0\.8em;/);
  assert.match(buildStyleBlock({ p: { fontSize: '3' } }), /font-size: 3em;/);
});

test('nested list items do not compound a custom size', async () => {
  const { buildStyleBlock } = await load();
  assert.match(buildStyleBlock({ li: { fontSize: 0.9 } }), /\.reveal \.slides li li \{ font-size: 1em; \}/);
  assert.doesNotMatch(buildStyleBlock({ li: { color: '#000000' } }), /li li/);
});

test('mergeStyleBlock adds, replaces and removes the block, leaving other text alone', async () => {
  const { mergeStyleBlock, parseStyleBlock } = await load();
  const mine = '/* mine */\nbody { margin: 0; }\n';
  const added = mergeStyleBlock(mine, { h1: { color: '#112233' } });
  assert.ok(added.startsWith('/* >>>'), 'the block goes first');
  assert.ok(added.endsWith(mine), 'the user text follows unchanged');
  assert.deepStrictEqual(parseStyleBlock(added), { h1: { color: '#112233' } });

  const withTail = `${added}\n.after { color: blue; }\n`;
  const replaced = mergeStyleBlock(withTail, { p: { fontSize: 2 } });
  assert.deepStrictEqual(parseStyleBlock(replaced), { p: { fontSize: 2 } });
  assert.ok(replaced.includes('body { margin: 0; }'));
  assert.ok(replaced.includes('.after { color: blue; }'));
  assert.strictEqual(replaced.split('REVELation Style Editor').length - 1, 2); // start and end marks, once

  const removed = mergeStyleBlock(replaced, {});
  assert.ok(!removed.includes('REVELation Style Editor'));
  assert.ok(removed.includes('body { margin: 0; }'));
  assert.ok(removed.includes('.after { color: blue; }'));

  assert.strictEqual(mergeStyleBlock('', {}), '');
  assert.strictEqual(mergeStyleBlock('a{}', {}), 'a{}');
});

const FONTS_DIR = path.join(__dirname, '..', 'revelation', 'css', 'fonts');
const manifest = () => JSON.parse(fs.readFileSync(path.join(FONTS_DIR, 'fonts.json'), 'utf-8'));

test('fonts.json lists exactly the font folders, and each entry matches its css', async () => {
  const { bundledFonts } = await load();
  const { fonts } = manifest();
  const folders = fs.readdirSync(FONTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.readdirSync(path.join(FONTS_DIR, d.name)).some((f) => f.endsWith('.css')))
    .map((d) => d.name).sort();
  assert.deepStrictEqual(fonts.map((f) => f.id).sort(), folders);
  for (const f of fonts) {
    const css = fs.readFileSync(path.join(FONTS_DIR, f.css), 'utf-8');
    assert.ok(css.includes(`font-family: '${f.family}'`), `${f.id}: family ${f.family} not declared in ${f.css}`);
  }
  assert.strictEqual(bundledFonts(manifest()).length, fonts.length, 'every manifest entry passes validation');
});

test('a bundled font adds one @import at the top of the block and round-trips', async () => {
  const { bundledFonts, SYSTEM_FONTS, buildStyleBlock, parseStyleBlock } = await load();
  const fonts = [...SYSTEM_FONTS, ...bundledFonts(manifest())];
  const settings = { h1: { fontFamily: 'lato' }, h2: { fontFamily: 'lato', color: '#112233' }, p: { fontFamily: 'serif' } };
  const css = buildStyleBlock(settings, fonts);
  assert.strictEqual(css.split('@import').length - 1, 1);
  assert.match(css, /@import url\(\/css\/fonts\/lato\/lato\.css\);/);
  assert.match(css, /h1 \{ font-family: 'Lato', sans-serif; \}/);
  assert.deepStrictEqual(parseStyleBlock(css, fonts), settings);
  assert.deepStrictEqual(parseStyleBlock(css), { h2: { color: '#112233' }, p: { fontFamily: 'serif' } }, 'unknown fonts are ignored without the manifest');
  assert.doesNotMatch(buildStyleBlock({ p: { fontFamily: 'serif' } }, fonts), /@import/);
});

test('bundledFonts drops manifest entries that are not plain', async () => {
  const { bundledFonts } = await load();
  const good = { id: 'ok', label: 'Ok', family: 'Ok Font', css: 'ok/ok.css', fallback: 'serif' };
  const bad = [
    { ...good, id: 'a b' }, { ...good, id: 'sans' }, { ...good, family: "x'; } body {" },
    { ...good, css: '../x.css' }, { ...good, css: 'ok/ok.css);x' }, { ...good, fallback: 'x}' }
  ];
  assert.deepStrictEqual(bundledFonts({ fonts: [...bad, good] }).map((f) => f.key), ['ok']);
  assert.deepStrictEqual(bundledFonts(null), []);
});

test('mergeStyleBlock keeps the block first, so its @imports stay valid', async () => {
  const { bundledFonts, SYSTEM_FONTS, mergeStyleBlock, parseStyleBlock } = await load();
  const fonts = [...SYSTEM_FONTS, ...bundledFonts(manifest())];
  const user = '@charset "utf-8";\n@import url(other.css);\nbody { margin: 0; }\n';
  const first = mergeStyleBlock(user, { h1: { fontFamily: 'inter' } }, fonts);
  assert.ok(first.startsWith('@charset "utf-8";'));
  assert.ok(first.indexOf('@import url(/css/fonts/inter/inter.css)') < first.indexOf('body { margin'));
  assert.ok(first.indexOf('@import url(/css/fonts/inter/inter.css)') < first.indexOf('@import url(other.css)'));
  // second save with the block at the top, then a change: still one block, still before user rules
  const second = mergeStyleBlock(first, { h1: { fontFamily: 'lato' } }, fonts);
  assert.strictEqual(second.split('Style Editor (generated').length - 1, 1);
  assert.deepStrictEqual(parseStyleBlock(second, fonts), { h1: { fontFamily: 'lato' } });
  assert.ok(second.includes('@import url(other.css);') && second.includes('body { margin: 0; }'));
  // a block that an older version left at the end moves to the top
  const old = mergeStyleBlock('body { margin: 0; }\n', {}, fonts) + '\n' + first.slice(first.indexOf('/* >>>'), first.indexOf('/* <<<') + 40);
  const moved = mergeStyleBlock(old, { h1: { fontFamily: 'inter' } }, fonts);
  assert.ok(moved.indexOf('@import url(/css/fonts/inter') < moved.indexOf('body { margin'));
});

test('export rewrites the block\'s font imports to the CDN', () => {
  const { rewriteCssForExport } = require('../lib/exportPresentation');
  const out = rewriteCssForExport('@import url(/css/fonts/lato/lato.css);\nh1 { color: red; }');
  assert.match(out, /^@import url\(https:\/\/[^)]*\/fonts\/lato\/lato\.css\);/);
  assert.ok(!out.includes('/css/fonts/'));
  assert.match(rewriteCssForExport('@import url(./fonts/lato/lato.css);'), /https:\/\//);
});

test('presentationStyle reads and writes only .css files inside the presentation folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pstyle-'));
  try {
    fs.mkdirSync(path.join(root, 'demo'));
    assert.strictEqual(readStyle(root, 'demo'), '');
    writeStyle(root, 'demo', '', 'h1{}');
    assert.strictEqual(fs.readFileSync(path.join(root, 'demo', 'style.css'), 'utf-8'), 'h1{}');
    assert.strictEqual(readStyle(root, 'demo', 'style.css'), 'h1{}');

    for (const bad of ['../x.css', 'a/../../x.css', '/etc/x.css', 'style.txt', 'https://e.com/a.css', 'C:x.css']) {
      assert.throws(() => resolveStylePath(root, 'demo', bad), undefined, bad);
    }
    assert.throws(() => readStyle(root, '../demo'), /Unsafe/);
    assert.throws(() => writeStyle(root, 'missing', 'style.css', 'x'), /not found/);
    assert.throws(() => writeStyle(root, 'demo', 'style.css', 5), /string/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
