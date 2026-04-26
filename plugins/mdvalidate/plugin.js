'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

let AppCtx = null;

function decodePathSrc(src) {
  try { return decodeURIComponent(src); } catch { return src; }
}

// Each check: { id, label, level: 'pass'|'warn'|'fail', errors: string[] }
function check(id, label) {
  return { id, label, level: 'pass', errors: [] };
}
function setLevel(c) {
  if (c.errors.length > 0 && c.level === 'pass') c.level = 'fail';
}

function validatePresentation(slug, mdFile, AppContext) {
  const presDir = path.join(AppContext.config.presentationsDir, slug);
  const mdPath = path.join(presDir, mdFile);

  if (!fs.existsSync(mdPath)) {
    return { error: `File not found: ${mdPath}` };
  }

  const raw = fs.readFileSync(mdPath, 'utf-8');
  const lines = raw.split('\n');
  const checks = [];

  // ── 1 & 2: YAML header validity + delimiter format ────────────────────────

  const yamlHeaderCheck = check('yaml-header', 'Valid YAML header');
  const yamlDelimCheck  = check('yaml-delimiters', 'Proper --- delimiters around YAML block');

  let parsedYaml = {};
  let yamlEndLine = -1;

  const firstLine = lines[0] || '';
  if (firstLine.trimEnd() !== '---') {
    yamlHeaderCheck.errors.push('File does not begin with --- (line 1)');
    yamlDelimCheck.errors.push('File does not begin with --- (line 1)');
  } else {
    if (firstLine !== '---' && firstLine !== '---\r') {
      yamlDelimCheck.errors.push('Line 1: Opening --- has trailing spaces');
    }

    let closerFound = false;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trimEnd() === '---') {
        yamlEndLine = i;
        closerFound = true;
        if (lines[i] !== '---' && lines[i] !== '---\r') {
          yamlDelimCheck.errors.push(`Line ${i + 1}: Closing --- has trailing spaces`);
        }
        const yamlSrc = lines.slice(1, i).join('\n');
        try {
          const parsed = yaml.load(yamlSrc);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            parsedYaml = parsed;
            if (!parsedYaml.title) yamlHeaderCheck.errors.push('Missing required field: title');
            if (!parsedYaml.theme) yamlHeaderCheck.errors.push('Missing required field: theme');
          } else {
            yamlHeaderCheck.errors.push('YAML does not parse to a key/value object');
          }
        } catch (e) {
          yamlHeaderCheck.errors.push(`YAML parse error: ${e.message}`);
        }
        break;
      }
    }

    if (!closerFound) {
      yamlDelimCheck.errors.push('No closing --- found for YAML block');
      yamlHeaderCheck.errors.push('YAML block is not properly closed with ---');
    }
  }

  setLevel(yamlHeaderCheck);
  setLevel(yamlDelimCheck);
  checks.push(yamlHeaderCheck, yamlDelimCheck);

  // Content starts on the line immediately after the YAML closing ---
  const contentStart = yamlEndLine >= 0 ? yamlEndLine + 1 : 1;

  // ── Build code-block map (shared by checks 3 & 4) ────────────────────────
  // lineInsideCode[i] === 1 means line i is inside a code fence body.

  const lineInsideCode = new Uint8Array(lines.length);
  {
    let inCode = false;
    let fenceChar = '';
    let fenceLen = 0;
    for (let i = contentStart; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!inCode) {
        const m = trimmed.match(/^(`{3,}|~{3,})/);
        if (m) { inCode = true; fenceChar = m[1][0]; fenceLen = m[1].length; }
      } else {
        lineInsideCode[i] = 1;
        const closeRe = fenceChar === '`'
          ? new RegExp(`^\`{${fenceLen},}\\s*$`)
          : new RegExp(`^~{${fenceLen},}\\s*$`);
        if (closeRe.test(trimmed)) { inCode = false; fenceChar = ''; fenceLen = 0; }
      }
    }
  }

  // ── 3: Blank lines around slide separators + no trailing spaces ───────────

  const slideSepCheck = check(
    'slide-separators',
    'Slide separators have blank lines before/after and no trailing spaces'
  );

  for (let i = contentStart; i < lines.length; i++) {
    if (lineInsideCode[i]) continue;
    const trimmed = lines[i].trimEnd();
    if (trimmed !== '---' && trimmed !== '***') continue;

    if (lines[i] !== trimmed && lines[i] !== trimmed + '\r') {
      slideSepCheck.errors.push(`Line ${i + 1}: Separator "${trimmed}" has trailing spaces`);
    }
    if (i > contentStart) {
      const prev = lines[i - 1];
      if (prev !== undefined && prev.trim() !== '') {
        slideSepCheck.errors.push(
          `Line ${i + 1}: No blank line before "${trimmed}" (previous: "${prev.trim()}")`
        );
      }
    }
    const next = lines[i + 1];
    if (next !== undefined && next.trim() !== '') {
      slideSepCheck.errors.push(
        `Line ${i + 1}: No blank line after "${trimmed}" (next: "${next.trim()}")`
      );
    }
  }

  setLevel(slideSepCheck);
  checks.push(slideSepCheck);

  // ── 4: Code block closures ────────────────────────────────────────────────

  const codeBlockCheck = check('code-blocks', 'Code blocks are properly closed');

  {
    let openAtLine = null;
    let fenceChar = '';
    let fenceLen = 0;
    for (let i = contentStart; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (fenceChar === '') {
        const m = trimmed.match(/^(`{3,}|~{3,})/);
        if (m) { fenceChar = m[1][0]; fenceLen = m[1].length; openAtLine = i + 1; }
      } else {
        const closeRe = fenceChar === '`'
          ? new RegExp(`^\`{${fenceLen},}\\s*$`)
          : new RegExp(`^~{${fenceLen},}\\s*$`);
        if (closeRe.test(trimmed)) { fenceChar = ''; fenceLen = 0; openAtLine = null; }
      }
    }
    if (openAtLine !== null) {
      codeBlockCheck.errors.push(`Unclosed code block opened at line ${openAtLine}`);
    }
  }

  setLevel(codeBlockCheck);
  checks.push(codeBlockCheck);

  // ── Shared setup for checks 5, 6, 7, 8 ───────────────────────────────────

  const contentBody = lines.slice(contentStart).join('\n');

  const yamlMedia = (parsedYaml.media && typeof parsedYaml.media === 'object' && !Array.isArray(parsedYaml.media))
    ? parsedYaml.media : {};
  const yamlAliases = new Set(Object.keys(yamlMedia));

  function fileLineNum(offset) {
    return contentStart + contentBody.slice(0, offset).split('\n').length;
  }

  // ── 5: Direct media files exist ───────────────────────────────────────────

  const mediaFileCheck = check('media-files', 'Linked media files exist on disk');

  // ── 6: media:alias refs match YAML entries ────────────────────────────────

  const aliasRefCheck = check(
    'media-alias-refs',
    'media:alias references match YAML media entries'
  );

  const reportedMissingFiles   = new Set();
  const reportedMissingAliases = new Set();
  const usedAliases            = new Set(); // tracks which YAML aliases are referenced
  const reportedBadPaths       = new Set();

  const BAD_CHARS_RE = /[)"*?<>|\\]/;
  const mediaPathCheck = check('media-path-validity', 'Media paths are relative, safe, and use forward slashes');

  function checkMediaSrc(src, offset, kind) {
    if (!src) return;
    const lower = src.toLowerCase();
    if (lower.startsWith('http://') || lower.startsWith('https://') ||
        lower.startsWith('data:')   || lower.startsWith('blob:')) return;

    if (src.startsWith('media:')) {
      const alias = src.slice(6).trim();
      if (!alias) return;
      usedAliases.add(alias);
      if (!yamlAliases.has(alias) && !reportedMissingAliases.has(alias)) {
        reportedMissingAliases.add(alias);
        aliasRefCheck.errors.push(
          `Line ${fileLineNum(offset)}: media:${alias} is not defined in YAML`
        );
      }
      return;
    }

    if (!reportedBadPaths.has(src)) {
      if (src.startsWith('../') || src.startsWith('/')) {
        reportedBadPaths.add(src);
        const prefix = src.startsWith('../') ? '../' : '/';
        mediaPathCheck.errors.push(`Line ${fileLineNum(offset)}: ${kind} path starts with "${prefix}" — use a relative path within the presentation folder`);
      } else {
        const badMatch = src.match(BAD_CHARS_RE);
        if (badMatch) {
          reportedBadPaths.add(src);
          mediaPathCheck.errors.push(`Line ${fileLineNum(offset)}: ${kind} path "${src}" contains invalid character: '${badMatch[0]}'`);
        }
      }
    }

    const decoded = decodePathSrc(src);
    const absPath = path.join(presDir, decoded);
    if (!reportedMissingFiles.has(decoded) && !fs.existsSync(absPath)) {
      reportedMissingFiles.add(decoded);
      mediaFileCheck.errors.push(
        `Line ${fileLineNum(offset)}: ${kind} file not found: "${decoded}"`
      );
    }
  }

  const imgRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let m;
  while ((m = imgRe.exec(contentBody)) !== null) {
    const alt = m[1].trim().toLowerCase();
    if (/^(youtube|web)(?::|$)/.test(alt)) continue;
    checkMediaSrc(m[2].trim(), m.index, 'image/video');
  }

  const audioRe = /:audio:(?:play|playloop):(.+):\s*$/gm;
  while ((m = audioRe.exec(contentBody)) !== null) {
    checkMediaSrc(m[1].trim(), m.index, 'audio');
  }

  setLevel(mediaFileCheck);
  setLevel(aliasRefCheck);
  setLevel(mediaPathCheck);
  checks.push(mediaFileCheck, aliasRefCheck, mediaPathCheck);

  // ── 7: YAML media aliases point to files in _media/ ──────────────────────

  const yamlMediaFileCheck = check(
    'yaml-media-files',
    'YAML media aliases point to files in the media library (_media/)'
  );

  const mediaLibDir = path.join(AppContext.config.presentationsDir, '_media');

  for (const [alias, entry] of Object.entries(yamlMedia)) {
    const filename = (entry && typeof entry.filename === 'string') ? entry.filename.trim() : '';
    if (!filename) {
      yamlMediaFileCheck.errors.push(`media.${alias}: missing filename field`);
      continue;
    }
    if (!fs.existsSync(path.join(mediaLibDir, filename))) {
      yamlMediaFileCheck.errors.push(`media.${alias}: _media/${filename} not found`);
    }
  }

  setLevel(yamlMediaFileCheck);
  checks.push(yamlMediaFileCheck);

  // ── 8: Unused YAML media aliases (warn) ──────────────────────────────────

  const unusedAliasCheck = check(
    'unused-yaml-aliases',
    'YAML media aliases are all referenced in the presentation'
  );

  for (const alias of Object.keys(yamlMedia)) {
    if (!usedAliases.has(alias)) {
      unusedAliasCheck.errors.push(`media.${alias} is defined in YAML but never used`);
    }
  }

  if (unusedAliasCheck.errors.length > 0) unusedAliasCheck.level = 'warn';
  checks.push(unusedAliasCheck);

  // ── Summary ───────────────────────────────────────────────────────────────

  const passCount = checks.filter(c => c.level === 'pass').length;
  const warnCount = checks.filter(c => c.level === 'warn').length;
  const failCount = checks.filter(c => c.level === 'fail').length;

  return {
    slug,
    mdFile,
    checks,
    summary: {
      total: checks.length,
      passed: passCount,
      warned: warnCount,
      failed: failCount,
      errorCount: checks.filter(c => c.level === 'fail').reduce((n, c) => n + c.errors.length, 0),
      warnCount:  checks.filter(c => c.level === 'warn').reduce((n, c) => n + c.errors.length, 0)
    }
  };
}

const mdValidatePlugin = {
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  priority: 50,
  version: '1.0.0',
  config: {},

  register(AppContext) {
    AppCtx = AppContext;
    AppContext.log('[mdvalidate] Registered');
  },

  api: {
    validate: async function (_event, data) {
      const { slug, mdFile } = data || {};
      if (!slug) return { error: 'slug is required' };
      if (!AppCtx) return { error: 'Plugin not initialized' };
      try {
        return validatePresentation(slug, mdFile || 'presentation.md', AppCtx);
      } catch (err) {
        AppCtx.error(`[mdvalidate] ${err.message}`);
        return { error: err.message };
      }
    }
  }
};

module.exports = mdValidatePlugin;
