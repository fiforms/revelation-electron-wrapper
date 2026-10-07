// http_admin/shared/gradient-picker.js: the pure model (parse/build) behind the builder's Background Tint menu
// and the Style tab. The widget itself needs a DOM and is not exercised here.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'http_admin', 'shared', 'gradient-picker.js')).href);

test('cssColorToRgba reads hex and rgb()/rgba() without a DOM', async () => {
  const { cssColorToRgba } = await load();
  assert.deepStrictEqual(cssColorToRgba('#ff8000'), { r: 255, g: 128, b: 0, a: 1 });
  assert.deepStrictEqual(cssColorToRgba('#f80'), { r: 255, g: 136, b: 0, a: 1 });
  assert.deepStrictEqual(cssColorToRgba('rgba(1, 2, 3, 0.5)'), { r: 1, g: 2, b: 3, a: 0.5 });
  assert.deepStrictEqual(cssColorToRgba('rgb(1,2,3)'), { r: 1, g: 2, b: 3, a: 1 });
  assert.strictEqual(cssColorToRgba('not a colour'), null);
  assert.strictEqual(cssColorToRgba(''), null);
  assert.strictEqual(cssColorToRgba(null), null);
});

test('buildGradient writes the builder\'s existing rgba format', async () => {
  const { buildGradient } = await load();
  const stops = [
    { hex: '#000000', alpha: 0.5, position: 0 },
    { hex: '#ffffff', alpha: 1, position: 100 }
  ];
  assert.strictEqual(
    buildGradient({ gradientType: 'linear', linearDirection: 'to right', stops }),
    'linear-gradient(to right,rgba(0,0,0,0.50) 0%,rgba(255,255,255,1.00) 100%)'
  );
  assert.strictEqual(
    buildGradient({ gradientType: 'radial', radialShape: 'ellipse', stops }),
    'radial-gradient(ellipse,rgba(0,0,0,0.50) 0%,rgba(255,255,255,1.00) 100%)'
  );
  assert.strictEqual(buildGradient({ stops: [stops[0]] }), 'rgba(0,0,0,0.50)');
  assert.strictEqual(buildGradient({ stops: [] }), 'rgba(64,95,95,0.60)');
});

test('buildGradient with alpha:false writes opaque #rrggbb stops', async () => {
  const { buildGradient } = await load();
  const stops = [
    { hex: '#102030', alpha: 0.2, position: 0 },
    { hex: '#a0b0c0', alpha: 0.9, position: 100 }
  ];
  assert.strictEqual(buildGradient({ gradientType: 'linear', linearDirection: 'to bottom', stops }, { alpha: false }),
    'linear-gradient(to bottom,#102030 0%,#a0b0c0 100%)');
  assert.strictEqual(buildGradient({ stops: [stops[0]] }, { alpha: false }), '#102030');
  assert.strictEqual(buildGradient({ stops: [] }, { alpha: false }), '#405f5f');
});

test('parseGradient and buildGradient round-trip linear and radial gradients', async () => {
  const { parseGradient, buildGradient } = await load();
  for (const value of [
    'linear-gradient(to top left,rgba(10,20,30,0.25) 0%,rgba(40,50,60,0.75) 40.5%,rgba(70,80,90,1.00) 100%)',
    'radial-gradient(circle,rgba(0,0,0,0.60) 0%,rgba(255,255,255,0.10) 100%)',
    'rgba(64,95,95,0.60)'
  ]) {
    assert.strictEqual(buildGradient(parseGradient(value)), value);
  }
});

test('parseGradient fills in missing positions and defaults the direction and shape', async () => {
  const { parseGradient } = await load();
  const linear = parseGradient('linear-gradient(#000000, #888888, #ffffff)');
  assert.strictEqual(linear.gradientType, 'linear');
  assert.strictEqual(linear.linearDirection, 'to bottom');
  assert.deepStrictEqual(linear.stops.map((s) => s.position), [0, 50, 100]);
  assert.strictEqual(linear.stops[1].hex, '#888888');

  const radial = parseGradient('radial-gradient(#000, #fff)');
  assert.strictEqual(radial.gradientType, 'radial');
  assert.strictEqual(radial.radialShape, 'circle');
  assert.strictEqual(radial.stops.length, 2);
});

test('a plain colour becomes one stop; junk and empty input give the fallback stop', async () => {
  const { parseGradient } = await load();
  assert.deepStrictEqual(parseGradient('#112233').stops, [{ hex: '#112233', alpha: 1, position: 0 }]);
  assert.deepStrictEqual(parseGradient('').stops, [{ hex: '#405f5f', alpha: 0.6, position: 0 }]);
  assert.deepStrictEqual(parseGradient('linear-gradient(nonsense)').stops, [{ hex: '#405f5f', alpha: 0.6, position: 0 }]);
  assert.deepStrictEqual(parseGradient('', { r: 255, g: 0, b: 0, a: 1 }).stops, [{ hex: '#ff0000', alpha: 1, position: 0 }]);
});

test('commas inside rgba() do not split a stop', async () => {
  const { parseGradient } = await load();
  const g = parseGradient('linear-gradient(to right, rgba(0, 0, 0, 0.5) 10%, rgba(255, 255, 255, 0.5) 90%)');
  assert.deepStrictEqual(g.stops.map((s) => [s.hex, s.alpha, s.position]), [['#000000', 0.5, 10], ['#ffffff', 0.5, 90]]);
});

test("buildGradient alpha:'auto' keeps #rrggbb for opaque stops and rgba() only where translucent", async () => {
  const { buildGradient } = await load();
  const stops = [{ hex: '#102030', alpha: 1, position: 0 }, { hex: '#a0b0c0', alpha: 0.25, position: 100 }];
  assert.strictEqual(buildGradient({ gradientType: 'linear', linearDirection: 'to bottom', stops }, { alpha: 'auto' }),
    'linear-gradient(to bottom,#102030 0%,rgba(160,176,192,0.25) 100%)');
  assert.strictEqual(buildGradient({ stops: [stops[0]] }, { alpha: 'auto' }), '#102030');
});

test('tryParseGradient returns null for anything that is not a colour or gradient', async () => {
  const { tryParseGradient } = await load();
  for (const bad of ['', null, undefined, 'none', 'url(x.png)', 'linear-gradient(red)', 'red; }']) {
    assert.strictEqual(tryParseGradient(bad), null, String(bad));
  }
  assert.ok(tryParseGradient('#fff'));
});
