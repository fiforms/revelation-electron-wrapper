// Theme thumbnails: the generator's sample slide count must match what the Theme tab strip asks for.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('themeThumbnailer sample slide count matches THEME_SAMPLE_COUNT in the Theme tab', () => {
  const { SAMPLE_SLIDES } = require('../lib/themeThumbnailer');
  const slides = SAMPLE_SLIDES('Black');
  const tab = fs.readFileSync(path.join(__dirname, '..', 'http_admin', 'create', 'tab-presentation.js'), 'utf8');
  const count = Number(/THEME_SAMPLE_COUNT = (\d+)/.exec(tab)?.[1]);
  assert.strictEqual(slides.length, count);
  assert.match(slides[0], /^# Black/);
  assert.match(slides[3], /^:info:/, 'the 4th slide uses the info layout');
  assert.ok(slides.every((s) => !/^---$/m.test(s)), 'no slide body may contain a --- separator');
});
