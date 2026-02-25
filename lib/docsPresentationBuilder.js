const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function copyTemplateRecursiveSync(src, dest, overwriteNames = new Set()) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    const srcPath = path.join(src, item);
    const destPath = path.join(dest, item);
    if (fs.lstatSync(srcPath).isDirectory()) {
      copyTemplateRecursiveSync(srcPath, destPath, overwriteNames);
      continue;
    }
    if (overwriteNames.has(item) || !fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function ensureDocsPresentationScaffold({ presentationsDir, revelationDir }) {
  const templateReadmePath = path.join(revelationDir, 'templates', 'readme');
  const readmePresDir = path.join(presentationsDir, 'readme');
  copyTemplateRecursiveSync(templateReadmePath, readmePresDir, new Set(['header.yaml']));
  return {
    readmePresDir,
    readmeYamlPath: path.join(readmePresDir, 'header.yaml')
  };
}

function getDefaultDocSources({ wrapperRoot, revelationDir }) {
  const pluginsDir = path.join(wrapperRoot, 'plugins');
  const pluginReadmes = fs.existsSync(pluginsDir)
    ? fs.readdirSync(pluginsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
          key: `plugins/${entry.name}/README.md`,
          absPath: path.join(pluginsDir, entry.name, 'README.md')
        }))
        .filter((entry) => fs.existsSync(entry.absPath))
        .sort((a, b) => a.key.localeCompare(b.key))
    : [];

  const i18nSources = collectI18nDocSources(wrapperRoot, revelationDir);

  return [
    { key: 'QUICKSTART.md', absPath: path.join(wrapperRoot, 'QUICKSTART.md') },
    { key: 'README.md', absPath: path.join(wrapperRoot, 'README.md') },
    { key: 'LICENSE.md', absPath: path.join(wrapperRoot, 'LICENSE.md') },
    { key: 'doc/GUI_REFERENCE.md', absPath: path.join(wrapperRoot, 'doc', 'GUI_REFERENCE.md') },
    { key: 'doc/TROUBLESHOOTING.md', absPath: path.join(wrapperRoot, 'doc', 'TROUBLESHOOTING.md') },
    { key: 'doc/dev/INSTALLING.md', absPath: path.join(wrapperRoot, 'doc', 'dev', 'INSTALLING.md') },
    { key: 'doc/dev/BUILDING.md', absPath: path.join(wrapperRoot, 'doc', 'dev', 'BUILDING.md') },
    { key: 'doc/dev/PEERING.md', absPath: path.join(wrapperRoot, 'doc', 'dev', 'PEERING.md') },
    { key: 'doc/dev/PLUGINS.md', absPath: path.join(wrapperRoot, 'doc', 'dev', 'PLUGINS.md') },
    { key: 'doc/dev/README-PDF.md', absPath: path.join(wrapperRoot, 'doc', 'dev', 'README-PDF.md') },
    ...pluginReadmes,
    { key: 'revelation/README.md', absPath: path.join(revelationDir, 'README.md') },
    { key: 'revelation/LICENSE.md', absPath: path.join(revelationDir, 'LICENSE.md') },
    { key: 'revelation/doc/REFERENCE.md', absPath: path.join(revelationDir, 'doc', 'REFERENCE.md') },
    { key: 'revelation/doc/AUTHORING_REFERENCE.md', absPath: path.join(revelationDir, 'doc', 'AUTHORING_REFERENCE.md') },
    { key: 'revelation/doc/VARIANTS_REFERENCE.md', absPath: path.join(revelationDir, 'doc', 'VARIANTS_REFERENCE.md') },
    { key: 'revelation/doc/MARKDOWN_REFERENCE.md', absPath: path.join(revelationDir, 'doc', 'MARKDOWN_REFERENCE.md') },
    { key: 'revelation/doc/METADATA_REFERENCE.md', absPath: path.join(revelationDir, 'doc', 'METADATA_REFERENCE.md') },
    { key: 'revelation/doc/ARCHITECTURE.md', absPath: path.join(revelationDir, 'doc', 'ARCHITECTURE.md') },
    ...i18nSources
  ];
}

function collectI18nDocSources(wrapperRoot, revelationDir) {
  const sources = [];
  const walk = (absDir, relDir = '', keyPrefix = '') => {
    if (!fs.existsSync(absDir)) return;
    const entries = fs.readdirSync(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(absDir, entry.name);
      const relPath = relDir ? path.posix.join(relDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(absPath, relPath, keyPrefix);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith('.md')) continue;
      sources.push({ key: `${keyPrefix}${relPath}`, absPath });
    }
  };

  walk(path.join(wrapperRoot, 'doc', 'i18n'), '', 'doc/i18n/');
  walk(path.join(revelationDir, 'doc', 'i18n'), '', 'revelation/doc/i18n/');
  sources.sort((a, b) => a.key.localeCompare(b.key));
  return sources;
}

function parseI18nSourceKey(sourceKey) {
  const wrapperMatch = sourceKey.match(/^doc\/i18n\/([a-z]{2,8}(?:-[a-z0-9]{2,8})?)\/(.+\.md)$/i);
  if (wrapperMatch) {
    const lang = String(wrapperMatch[1] || '').toLowerCase();
    const relDocPath = wrapperMatch[2];
    return {
      lang,
      relDocPath,
      outputPath: path.posix.join('i18n', lang, relDocPath),
      canonicalCandidates: [
        path.posix.normalize(relDocPath),
        path.posix.normalize(`doc/${relDocPath}`)
      ]
    };
  }

  const revelationMatch = sourceKey.match(/^revelation\/doc\/i18n\/([a-z]{2,8}(?:-[a-z0-9]{2,8})?)\/(.+\.md)$/i);
  if (revelationMatch) {
    const lang = String(revelationMatch[1] || '').toLowerCase();
    const relDocPath = revelationMatch[2];
    return {
      lang,
      relDocPath,
      outputPath: path.posix.join('i18n', lang, 'revelation', 'doc', relDocPath),
      canonicalCandidates: [path.posix.normalize(`revelation/doc/${relDocPath}`)]
    };
  }

  return null;
}

function buildHeaderFromTemplate(templateText, { title, description, hidden = false, alternatives = null }) {
  const match = String(templateText || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    throw new Error('Invalid docs header template: missing YAML front matter block');
  }
  const parsed = yaml.load(match[1]) || {};
  if (title) parsed.title = title;
  if (description) parsed.description = description;
  if (alternatives && typeof alternatives === 'object' && !Array.isArray(alternatives)) {
    const mergedAlternatives = { ...alternatives };
    if (hidden) {
      mergedAlternatives.self = 'hidden';
    } else if (String(mergedAlternatives.self || '').trim().toLowerCase() === 'hidden') {
      delete mergedAlternatives.self;
    }
    parsed.alternatives = mergedAlternatives;
  } else if (hidden) {
    parsed.alternatives = { self: 'hidden' };
  } else if (parsed.alternatives === 'hidden') {
    delete parsed.alternatives;
  } else if (
    parsed.alternatives &&
    typeof parsed.alternatives === 'object' &&
    !Array.isArray(parsed.alternatives) &&
    String(parsed.alternatives.self || '').trim().toLowerCase() === 'hidden'
  ) {
    delete parsed.alternatives.self;
    if (!Object.keys(parsed.alternatives).length) {
      delete parsed.alternatives;
    }
  }

  const yamlText = yaml.dump(parsed, { lineWidth: -1, noRefs: true, sortKeys: false }).trimEnd();
  const remainder = String(templateText || '').slice(match[0].length).trim();
  return `---\n${yamlText}\n---\n${remainder ? `\n${remainder}\n` : ''}`;
}

function extractTitleFromMarkdown(markdown, fallback) {
  const match = String(markdown || '').match(/^#\s+(.+)$/m);
  return (match && match[1] ? match[1].trim() : fallback).trim();
}

function keyToFilename(key, used = new Set()) {
  const base = key
    .replace(/\.md$/i, '')
    .replace(/[\\/]+/g, '--')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

  let candidate = `${base || 'doc'}.md`;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base || 'doc'}-${index}.md`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function resolveSourceKey(currentKey, hrefPath) {
  const posix = path.posix;
  const normalized = hrefPath.startsWith('/')
    ? posix.normalize(hrefPath.slice(1))
    : posix.normalize(posix.join(posix.dirname(currentKey), hrefPath));

  if (!normalized || normalized === '.' || normalized.startsWith('..')) {
    return null;
  }
  return normalized;
}

function rewriteMarkdownLinks(markdown, sourceKey, keyToOutput) {
  return String(markdown || '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, (full, label, rawHref) => {
    const href = String(rawHref || '').trim();
    if (!href || href.startsWith('#')) return full;
    if (/^(https?:|mailto:|tel:|data:|javascript:)/i.test(href)) return full;

    // strip optional markdown title by taking first token only
    const hrefToken = href.split(/\s+/)[0].replace(/^<|>$/g, '');
    const hashIndex = hrefToken.indexOf('#');
    const hrefPath = hashIndex >= 0 ? hrefToken.slice(0, hashIndex) : hrefToken;
    const hash = hashIndex >= 0 ? hrefToken.slice(hashIndex + 1) : '';

    if (!/\.md$/i.test(hrefPath)) return full;

    const resolvedKey = resolveSourceKey(sourceKey, hrefPath);
    const absoluteLikeKey = path.posix.normalize(hrefPath.replace(/^\/+/, ''));
    const i18nMeta = parseI18nSourceKey(sourceKey);
    const fallbackResolvedKeys = i18nMeta
      ? i18nMeta.canonicalCandidates
          .map((candidate) => resolveSourceKey(candidate, hrefPath))
          .filter(Boolean)
      : [];
    const target = (resolvedKey ? keyToOutput.get(resolvedKey) : null)
      || fallbackResolvedKeys.map((candidate) => keyToOutput.get(candidate)).find(Boolean)
      || keyToOutput.get(absoluteLikeKey);
    if (!target) return full;

    const rewritten = `index.html?p=${encodeURIComponent(target)}${hash ? `#${hash}` : ''}`;
    return `[${label}](${rewritten})`;
  });
}

function appendBackToHubSlide(markdown) {
  const body = String(markdown || '').trimEnd();
  return [
    body,
    '',
    '***',
    '',
    '<h2 data-translate>Documentation Hub</h2>',
    '',
    '<a data-translate href="index.html?p=presentation.md">Back to Documentation Hub</a>',
    ''
  ].join('\n');
}

function generateDocumentationPresentations({ presentationsDir, revelationDir, wrapperRoot }) {
  const { readmePresDir, readmeYamlPath } = ensureDocsPresentationScaffold({
    presentationsDir,
    revelationDir
  });

  if (!fs.existsSync(readmeYamlPath)) {
    throw new Error(`Missing README header template at ${readmeYamlPath}`);
  }

  const headerTemplate = fs.readFileSync(readmeYamlPath, 'utf-8');
  const sourceCandidates = getDefaultDocSources({ wrapperRoot, revelationDir });
  const sources = sourceCandidates.filter((entry) => fs.existsSync(entry.absPath));
  if (!sources.some((entry) => entry.key === 'QUICKSTART.md')) {
    throw new Error('Missing QUICKSTART.md; this file is required as the documentation hub index.');
  }

  const usedNames = new Set();
  const keyToOutput = new Map();
  const i18nEntries = [];
  for (const entry of sources) {
    if (entry.key === 'QUICKSTART.md') {
      keyToOutput.set(entry.key, 'presentation.md');
      usedNames.add('presentation.md');
      continue;
    }
    const i18nMeta = parseI18nSourceKey(entry.key);
    if (i18nMeta) {
      keyToOutput.set(entry.key, i18nMeta.outputPath);
      i18nEntries.push({ sourceKey: entry.key, ...i18nMeta });
      continue;
    }
    keyToOutput.set(entry.key, keyToFilename(entry.key, usedNames));
  }

  const canonicalToAlternatives = new Map();
  const sourceKeySet = new Set(sources.map((entry) => entry.key));
  for (const entry of i18nEntries) {
    const canonicalKey = entry.canonicalCandidates.find((candidate) => sourceKeySet.has(candidate));
    if (!canonicalKey) continue;
    if (!canonicalToAlternatives.has(canonicalKey)) {
      canonicalToAlternatives.set(canonicalKey, {});
    }
    const outputPath = keyToOutput.get(entry.sourceKey);
    if (!outputPath) continue;
    canonicalToAlternatives.get(canonicalKey)[outputPath] = entry.lang;
  }

  const generatedEntries = [];
  for (const entry of sources) {
    const original = fs.readFileSync(entry.absPath, 'utf-8');
    const rewritten = rewriteMarkdownLinks(original, entry.key, keyToOutput);
    const outputFile = keyToOutput.get(entry.key);
    const isHub = outputFile === 'presentation.md';
    const finalBody = isHub ? rewritten : appendBackToHubSlide(rewritten);
    const title = extractTitleFromMarkdown(finalBody, path.basename(entry.key));
    const alternatives = canonicalToAlternatives.get(entry.key) || null;
    const header = buildHeaderFromTemplate(headerTemplate, {
      title,
      description: entry.key,
      hidden: !isHub,
      alternatives
    });
    const finalText = `${header}\n\n${finalBody.trim()}\n`;
    const absOutPath = path.join(readmePresDir, outputFile);
    fs.mkdirSync(path.dirname(absOutPath), { recursive: true });
    fs.writeFileSync(absOutPath, finalText, 'utf-8');
    generatedEntries.push({ key: entry.key, outputFile, title });
  }

  return {
    readmePresDir,
    generatedCount: generatedEntries.length,
    landingFile: path.join(readmePresDir, 'presentation.md'),
    generatedEntries
  };
}

module.exports = {
  ensureDocsPresentationScaffold,
  generateDocumentationPresentations
};
