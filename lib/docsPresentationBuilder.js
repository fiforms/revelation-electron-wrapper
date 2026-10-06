/**
 * docsPresentationBuilder.js -- builds the in-app documentation presentation (<presentationsDir>/readme).
 *
 * Collects markdown (QUICKSTART.md becomes the hub presentation.md; README, doc/*.md, plugin READMEs from
 * the active plugin folder (`pluginsDir`, default <wrapperRoot>/plugins), revelation/doc/*.md, doc/i18n translations and each plugin's i18n/<lang>/README.md), rewrites relative .md links, adds a
 * "back to hub" slide and wraps each in front matter from revelation/templates/readme/header.yaml; i18n files
 * become `alternatives` of their English source. Writes manifest.json with appVersion so startup can skip regeneration.
 *
 * Exports: ensureDocumentationPresentation (startup wrapper), generateDocumentationPresentations, isDocumentationPresentationCurrent, getDocsManifestPath,
 * ensureDocsPresentationScaffold, copyAgentDocsToPresDir, loadPluginManifests, generatePluginsIndexMarkdown.
 * Callers: main.js (startup, when manifest version != app version), otherEventHandlers (menu:regenerate-readme),
 * configManager (copyAgentDocsToPresDir when creating the default presentations folder).
 * The Help -> "Help Contents..." menu opens the 'readme' slug (handoutWindow.js).
 * The generated plugin index is an in-memory source (`content`), not a temp file.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { parseYamlOrEmpty } = require('./yamlParse');
const DOCS_MANIFEST_FILENAME = 'manifest.json';
const DOCS_MANIFEST_SCHEMA_VERSION = 1;

function getDocsPresentationDir(presentationsDir) {
  return path.join(presentationsDir, 'readme');
}

function getDocsManifestPath(presentationsDir) {
  return path.join(getDocsPresentationDir(presentationsDir), DOCS_MANIFEST_FILENAME);
}

function readDocsManifest(presentationsDir) {
  const manifestPath = getDocsManifestPath(presentationsDir);
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function isDocumentationPresentationCurrent({ presentationsDir, appVersion }) {
  const expectedVersion = String(appVersion || '').trim();
  if (!expectedVersion) return false;
  const docsDir = getDocsPresentationDir(presentationsDir);
  const hubPath = path.join(docsDir, 'presentation.md');
  if (!fs.existsSync(hubPath)) return false;
  const manifest = readDocsManifest(presentationsDir);
  const actualVersion = String(manifest?.appVersion || '').trim();
  return !!manifest && actualVersion === expectedVersion;
}

function writeDocsManifest({ presentationsDir, appVersion, generatedCount }) {
  const manifestPath = getDocsManifestPath(presentationsDir);
  const manifest = {
    schemaVersion: DOCS_MANIFEST_SCHEMA_VERSION,
    appVersion: String(appVersion || '').trim(),
    generatedCount: Number.isFinite(generatedCount) ? generatedCount : 0,
    generatedAt: new Date().toISOString()
  };
  try {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return manifestPath;
}

function copyTemplateRecursiveSync(src, dest, overwriteNames = new Set()) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) {
    try {
      fs.mkdirSync(dest, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
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

const AGENT_DOC_FILES = ['AGENTS.md', 'CLAUDE.md', 'README.md'];

const CUSTOM_INSTRUCTIONS_FILE = 'CUSTOM_INSTRUCTIONS.md';
const CUSTOM_INSTRUCTIONS_PLACEHOLDER = '# Custom Instructions\n\nAdd project-specific instructions for AI agents here.\nThese instructions take precedence over AGENTS.md\n';

function copyAgentDocsToPresDir(presentationsDir, revelationDir) {
  const srcDir = path.join(revelationDir, 'doc');
  for (const file of AGENT_DOC_FILES) {
    const src = path.join(srcDir, 'TEMPLATE.' + file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(presentationsDir, file));
    }
  }
  const customPath = path.join(presentationsDir, CUSTOM_INSTRUCTIONS_FILE);
  if (!fs.existsSync(customPath)) {
    fs.writeFileSync(customPath, CUSTOM_INSTRUCTIONS_PLACEHOLDER, 'utf-8');
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

// A plugin folder, not the `<id>.installing` staging folder a ZIP install briefly leaves beside it.
function isPluginDirEntry(entry) {
  return entry.isDirectory() && !entry.name.endsWith('.installing');
}

function loadPluginManifests(pluginsDir) {
  const manifests = [];
  if (!fs.existsSync(pluginsDir)) return manifests;

  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true })
    .filter(isPluginDirEntry);

  for (const entry of entries) {
    const manifestPath = path.join(pluginsDir, entry.name, 'plugin-manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const content = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      manifests.push({
        id: content.id || entry.name,
        title: content.title || entry.name,
        description: content.description || '',
        author: content.author || '',
        dirName: entry.name
      });
    } catch {
      // Skip manifests that fail to parse
    }
  }

  return manifests.sort((a, b) => a.title.localeCompare(b.title));
}

const PLUGIN_INDEX_STRINGS = {
  en: {
    title: 'Plugin Documentation Index',
    empty: 'No plugins are currently installed.',
    intro: (n) => `This documentation covers all ${n} installed plugins for REVELation Snapshot Presenter.`,
    author: 'Author'
  },
  es: {
    title: 'Índice de documentación de plugins',
    empty: 'No hay plugins instalados actualmente.',
    intro: (n) => `Esta documentación cubre los ${n} plugins instalados de REVELation Snapshot Presenter.`,
    author: 'Autor'
  }
};

// The plugin's own manifest strings, translated through its locales/translations.json (as Settings does).
function translatedManifestText(pluginsDir, plugin, lang, text) {
  if (!text || !lang || lang === 'en') return text;
  try {
    const table = JSON.parse(fs.readFileSync(path.join(pluginsDir, plugin.dirName, 'locales', 'translations.json'), 'utf-8'))?.[lang];
    const translated = table && table[text];
    return typeof translated === 'string' && translated ? translated : text;
  } catch {
    return text;
  }
}

function generatePluginsIndexMarkdown(plugins, lang = 'en', pluginsDir = '') {
  const t = PLUGIN_INDEX_STRINGS[lang] || PLUGIN_INDEX_STRINGS.en;
  if (plugins.length === 0) {
    return `# ${t.title}\n\n${t.empty}\n`;
  }

  const lines = [`# ${t.title}`, '', t.intro(plugins.length), ''];

  for (const plugin of plugins) {
    lines.push(`## [${translatedManifestText(pluginsDir, plugin, lang, plugin.title)}](plugins/${plugin.dirName}/README.md)`);
    if (plugin.description) {
      lines.push('');
      lines.push(translatedManifestText(pluginsDir, plugin, lang, plugin.description));
    }
    if (plugin.author) {
      lines.push('');
      lines.push(`*${t.author}: ${plugin.author}*`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

function getDefaultDocSources({ wrapperRoot, revelationDir, pluginsDir = path.join(wrapperRoot, 'plugins') }) {
  const pluginReadmes = fs.existsSync(pluginsDir)
    ? fs.readdirSync(pluginsDir, { withFileTypes: true })
        .filter(isPluginDirEntry)
        .map((entry) => ({
          key: `plugins/${entry.name}/README.md`,
          absPath: path.join(pluginsDir, entry.name, 'README.md')
        }))
        .filter((entry) => fs.existsSync(entry.absPath))
        .sort((a, b) => a.key.localeCompare(b.key))
    : [];

  const pluginManifests = loadPluginManifests(pluginsDir);
  const pluginIndexContent = generatePluginsIndexMarkdown(pluginManifests);

  const i18nSources = collectI18nDocSources(wrapperRoot, revelationDir, pluginsDir);
  // The index is generated, not a file, so each language gets its own generated copy (the viewer cannot link out of
  // i18n/<lang>/ to the English one).
  const langs = [...new Set(i18nSources.map((e) => parseI18nSourceKey(e.key)).filter((m) => m && PLUGIN_INDEX_STRINGS[m.lang] && m.lang !== 'en').map((m) => m.lang))];
  const pluginIndexTranslations = langs.map((lang) => ({
    key: `doc/i18n/${lang}/PLUGIN_INDEX.md`,
    content: generatePluginsIndexMarkdown(pluginManifests, lang, pluginsDir)
  }));

  return [
    { key: 'QUICKSTART.md', absPath: path.join(wrapperRoot, 'QUICKSTART.md') },
    { key: 'README.md', absPath: path.join(wrapperRoot, 'README.md') },
    { key: 'LICENSE.md', absPath: path.join(wrapperRoot, 'LICENSE.md') },
    { key: 'doc/GUI_REFERENCE.md', absPath: path.join(wrapperRoot, 'doc', 'GUI_REFERENCE.md') },
    { key: 'doc/API_REFERENCE.md', absPath: path.join(wrapperRoot, 'doc', 'API_REFERENCE.md') },
    { key: 'doc/BUILDER_REFERENCE.md', absPath: path.join(wrapperRoot, 'doc', 'BUILDER_REFERENCE.md') },
    { key: 'doc/SETTINGS.md', absPath: path.join(wrapperRoot, 'doc', 'SETTINGS.md') },
    { key: 'doc/TROUBLESHOOTING.md', absPath: path.join(wrapperRoot, 'doc', 'TROUBLESHOOTING.md') },
    { key: 'doc/dev/INSTALLING.md', absPath: path.join(wrapperRoot, 'doc', 'dev', 'INSTALLING.md') },
    { key: 'doc/dev/BUILDING.md', absPath: path.join(wrapperRoot, 'doc', 'dev', 'BUILDING.md') },
    { key: 'doc/dev/PEERING.md', absPath: path.join(wrapperRoot, 'doc', 'dev', 'PEERING.md') },
    { key: 'doc/dev/PLUGINS.md', absPath: path.join(wrapperRoot, 'doc', 'dev', 'PLUGINS.md') },
    { key: 'doc/MACOS_INSTALL.md', absPath: path.join(wrapperRoot, 'doc', 'MACOS_INSTALL.md') },
    { key: 'doc/dev/BUILDER.md', absPath: path.join(wrapperRoot, 'doc', 'dev', 'BUILDER.md') },
    { key: 'doc/dev/BUILDER_EXTENSIONS.md', absPath: path.join(wrapperRoot, 'doc', 'dev', 'BUILDER_EXTENSIONS.md') },
    { key: 'doc/dev/PUBLIC_RELAY.md', absPath: path.join(wrapperRoot, 'doc', 'dev', 'PUBLIC_RELAY.md') },
    { key: 'doc/dev/REVEL_FORMAT.md', absPath: path.join(wrapperRoot, 'doc', 'dev', 'REVEL_FORMAT.md') },
    { key: 'doc/dev/REVEL_IMPLEMENTATION.md', absPath: path.join(wrapperRoot, 'doc', 'dev', 'REVEL_IMPLEMENTATION.md') },
    { key: 'doc/dev/README-PDF.md', absPath: path.join(wrapperRoot, 'doc', 'dev', 'README-PDF.md') },
    { key: 'doc/PLUGIN_INDEX.md', content: pluginIndexContent },
    ...pluginReadmes,
    { key: 'revelation/README.md', absPath: path.join(revelationDir, 'README.md') },
    { key: 'revelation/LICENSE.md', absPath: path.join(revelationDir, 'LICENSE.md') },
    { key: 'revelation/doc/REFERENCE.md', absPath: path.join(revelationDir, 'doc', 'REFERENCE.md') },
    { key: 'revelation/doc/AUTHORING_REFERENCE.md', absPath: path.join(revelationDir, 'doc', 'AUTHORING_REFERENCE.md') },
    { key: 'revelation/doc/VARIANTS_REFERENCE.md', absPath: path.join(revelationDir, 'doc', 'VARIANTS_REFERENCE.md') },
    { key: 'revelation/doc/MARKDOWN_REFERENCE.md', absPath: path.join(revelationDir, 'doc', 'MARKDOWN_REFERENCE.md') },
    { key: 'revelation/doc/METADATA_REFERENCE.md', absPath: path.join(revelationDir, 'doc', 'METADATA_REFERENCE.md') },
    { key: 'revelation/doc/REVERSE_PROXY.md', absPath: path.join(revelationDir, 'doc', 'REVERSE_PROXY.md') },
    { key: 'revelation/doc/ARCHITECTURE.md', absPath: path.join(revelationDir, 'doc', 'ARCHITECTURE.md') },
    ...pluginIndexTranslations,
    ...i18nSources
  ];
}

function collectI18nDocSources(wrapperRoot, revelationDir, pluginsDir = path.join(wrapperRoot, 'plugins')) {
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
  // Plugin translations live with the plugin: plugins/<id>/i18n/<lang>/README.md.
  if (fs.existsSync(pluginsDir)) {
    for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true }).filter(isPluginDirEntry)) {
      walk(path.join(pluginsDir, entry.name, 'i18n'), '', `plugins/${entry.name}/i18n/`);
    }
  }
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

  const pluginMatch = sourceKey.match(/^plugins\/([^/]+)\/i18n\/([a-z]{2,8}(?:-[a-z0-9]{2,8})?)\/README\.md$/i);
  if (pluginMatch) {
    const lang = String(pluginMatch[2] || '').toLowerCase();
    return {
      lang,
      relDocPath: `plugins/${pluginMatch[1]}/README.md`,
      outputPath: path.posix.join('i18n', lang, 'plugins', pluginMatch[1], 'README.md'),
      canonicalCandidates: [`plugins/${pluginMatch[1]}/README.md`]
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
  const parsed = parseYamlOrEmpty(match[1]);
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

// The viewer treats a .md link as a path from the presentation folder's root (it becomes `?p=<path>`) and rejects `..`,
// so links are root-relative, not relative to the page they sit in. That matters for pages under i18n/<lang>/.
function buildRelativeMarkdownHref(_fromOutputPath, toOutputPath, hash = '') {
  const target = String(toOutputPath || 'presentation.md');
  return `${target}${hash ? `#${hash}` : ''}`;
}

// Source keys where the `lang` translation of the English doc `key` may live (see parseI18nSourceKey for the layouts).
function translationKeysFor(key, lang) {
  const plugin = key.match(/^plugins\/([^/]+)\/README\.md$/);
  if (plugin) return [`plugins/${plugin[1]}/i18n/${lang}/README.md`];
  if (key === 'revelation/README.md') return [`doc/i18n/${lang}/revelation/README.md`];
  const framework = key.match(/^revelation\/doc\/(.+)$/);
  if (framework) return [`revelation/doc/i18n/${lang}/${framework[1]}`];
  const wrapperDoc = key.match(/^doc\/(.+)$/);
  if (wrapperDoc) return [`doc/i18n/${lang}/${wrapperDoc[1]}`];
  return [`doc/i18n/${lang}/${key}`];
}

function rewriteMarkdownLinks(markdown, sourceKey, currentOutputPath, keyToOutput) {
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
    // A link from a translated doc goes to the same-language translation of its target when there is one. The
    // viewer rejects `..` in .md links, so a link out of i18n/<lang>/ to the English page would be dead anyway.
    const lookup = (key) => {
      if (!key) return null;
      const translated = i18nMeta ? translationKeysFor(key, i18nMeta.lang).find((k) => keyToOutput.has(k)) : null;
      return keyToOutput.get(translated || key);
    };
    const target = lookup(resolvedKey)
      || fallbackResolvedKeys.map(lookup).find(Boolean)
      || lookup(absoluteLikeKey);
    if (!target) return full;

    const rewritten = buildRelativeMarkdownHref(currentOutputPath, target, hash);
    return `[${label}](${rewritten})`;
  });
}

function appendBackToHubSlide(markdown, currentOutputPath) {
  const body = String(markdown || '').trimEnd();
  const hubHref = buildRelativeMarkdownHref(currentOutputPath, 'presentation.md');
  return [
    body,
    '',
    '---',
    '',
    '<h2 data-translate>Documentation Hub</h2>',
    '',
    `<a data-translate href="${hubHref}">Back to Documentation Hub</a>`,
    ''
  ].join('\n');
}

// `pluginsDir` is the folder pluginDirector resolved (user-installed plugins live there); it defaults to the bundled one.
function generateDocumentationPresentations({ presentationsDir, revelationDir, wrapperRoot, pluginsDir, appVersion = '' }) {
  const { readmePresDir, readmeYamlPath } = ensureDocsPresentationScaffold({
    presentationsDir,
    revelationDir
  });

  if (!fs.existsSync(readmeYamlPath)) {
    throw new Error(`Missing README header template at ${readmeYamlPath}`);
  }

  const headerTemplate = fs.readFileSync(readmeYamlPath, 'utf-8');
  const sourceCandidates = getDefaultDocSources({ wrapperRoot, revelationDir, pluginsDir });
  const sources = sourceCandidates.filter((entry) => typeof entry.content === 'string' || fs.existsSync(entry.absPath));
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
  for (const [canonicalKey, alternatives] of canonicalToAlternatives.entries()) {
    const canonicalOutput = keyToOutput.get(canonicalKey);
    if (!canonicalOutput) continue;
    if (!Object.prototype.hasOwnProperty.call(alternatives, canonicalOutput)) {
      alternatives[canonicalOutput] = 'en';
    }
  }

  const generatedEntries = [];
  for (const entry of sources) {
    const original = typeof entry.content === 'string' ? entry.content : fs.readFileSync(entry.absPath, 'utf-8');
    const outputFile = keyToOutput.get(entry.key);
    const rewritten = rewriteMarkdownLinks(original, entry.key, outputFile, keyToOutput);
    const isHub = outputFile === 'presentation.md';
    const finalBody = isHub ? rewritten : appendBackToHubSlide(rewritten, outputFile);
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
    try {
      fs.mkdirSync(path.dirname(absOutPath), { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    fs.writeFileSync(absOutPath, finalText, 'utf-8');
    generatedEntries.push({ key: entry.key, outputFile, title });
  }

  const cleanVersion = String(appVersion || '').trim();
  const manifestPath = cleanVersion
    ? writeDocsManifest({
      presentationsDir,
      appVersion: cleanVersion,
      generatedCount: generatedEntries.length
    })
    : '';

  copyAgentDocsToPresDir(presentationsDir, revelationDir);

  return {
    readmePresDir,
    generatedCount: generatedEntries.length,
    landingFile: path.join(readmePresDir, 'presentation.md'),
    manifestPath,
    generatedEntries
  };
}

// Startup entry point: regenerates the 'readme' presentation unless its manifest already matches the app
// version. Never throws; failures are logged so startup continues.
function ensureDocumentationPresentation(AppContext, { appVersion, wrapperRoot, pluginsDir }) {
  try {
    const docsCurrent = isDocumentationPresentationCurrent({
      presentationsDir: AppContext.config.presentationsDir,
      appVersion
    });
    if (docsCurrent) {
      const manifestPath = getDocsManifestPath(AppContext.config.presentationsDir);
      AppContext.log(`📝 Documentation presentation up to date for app version ${appVersion} (${manifestPath})`);
    } else {
      // Ensure presentations directory is writable before generating docs (handles OneDrive sync delays)
      try {
        fs.mkdirSync(AppContext.config.presentationsDir, { recursive: true });
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
      }

      const docsResult = generateDocumentationPresentations({
        presentationsDir: AppContext.config.presentationsDir,
        revelationDir: AppContext.config.revelationDir,
        wrapperRoot,
        pluginsDir,
        appVersion
      });
      AppContext.log(`📝 Documentation presentation ready: ${docsResult.generatedCount} files (${docsResult.readmePresDir})`);
    }
  } catch (err) {
    AppContext.error(`Failed to prepare documentation presentation: ${err.message}`);
  }
}

module.exports = {
  ensureDocumentationPresentation,
  ensureDocsPresentationScaffold,
  generateDocumentationPresentations,
  isDocumentationPresentationCurrent,
  getDocsManifestPath,
  copyAgentDocsToPresDir,
  loadPluginManifests,
  generatePluginsIndexMarkdown
};
