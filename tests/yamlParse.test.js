// lib/yamlParse.js: tolerant YAML parse (R1) — empty/comment-only gives {}, bad YAML still throws.
const test = require('node:test');
const assert = require('node:assert');
const { parseYamlOrEmpty } = require('../lib/yamlParse');

test('parseYamlOrEmpty handles empty, comment-only, real and malformed YAML', () => {
  assert.deepStrictEqual(parseYamlOrEmpty(''), {});
  assert.deepStrictEqual(parseYamlOrEmpty('# only a comment'), {});
  assert.deepStrictEqual(parseYamlOrEmpty(undefined), {});
  assert.deepStrictEqual(parseYamlOrEmpty('title: Hi\ntheme: night'), { title: 'Hi', theme: 'night' });
  assert.throws(() => parseYamlOrEmpty('a: [unclosed'));
});
