// revelation/js/plugin-url-params.js: plugin-contributed presentation URL params are validated and merged by priority.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const modUrl = pathToFileURL(path.join(__dirname, '..', 'revelation', 'js', 'plugin-url-params.js')).href;

test('collectPluginPresentationParams validates names and values and honours priority', async () => {
  const { collectPluginPresentationParams } = await import(modUrl);
  const warn = console.warn;
  console.warn = () => {};
  global.window = {
    RevelationPlugins: {
      late: { priority: 900, getPresentationUrlParams: () => ({ license: 'LATE', extra: 'x' }) },
      early: {
        priority: 10,
        getPresentationUrlParams: ({ appConfig }) => ({
          license: appConfig.id, lang: 'xx', 'Bad Name': 'y', empty: '  ', big: 'z'.repeat(500)
        })
      },
      broken: { priority: 50, getPresentationUrlParams: () => { throw new Error('boom'); } },
      none: { priority: 1 }
    }
  };
  try {
    const out = collectPluginPresentationParams({ id: 'EARLY' });
    assert.equal(out.license, 'EARLY');
    assert.equal(out.extra, 'x');
    assert.equal(out.big.length, 200);
    assert.deepEqual(Object.keys(out).sort(), ['big', 'extra', 'license']);
  } finally {
    console.warn = warn;
    delete global.window;
  }
});
