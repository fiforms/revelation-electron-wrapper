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
    { key: 'revelation/doc/MARKDOWN_REFERENCE.md', absPath: path.join(revelationDir, 'doc', 'MARKDOWN_REFERENCE.md') },
    { key: 'revelation/doc/METADATA_REFERENCE.md', absPath: path.join(revelationDir, 'doc', 'METADATA_REFERENCE.md') },
    { key: 'revelation/doc/ARCHITECTURE.md', absPath: path.join(revelationDir, 'doc', 'ARCHITECTURE.md') }
  ];
}

function buildHeaderFromTemplate(templateText, { title, description, hidden = false }) {
  const match = String(templateText || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    throw new Error('Invalid docs header template: missing YAML front matter block');
  }
  const parsed = yaml.load(match[1]) || {};
  if (title) parsed.title = title;
  if (description) parsed.description = description;
  if (hidden) {
    parsed.alternatives = 'hidden';
  } else if (parsed.alternatives === 'hidden') {
    delete parsed.alternatives;
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
    if (!resolvedKey) return full;

    const target = keyToOutput.get(resolvedKey);
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
    '## Documentation Hub',
    '',
    '[Back to Documentation Hub](index.html?p=presentation.md)',
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
  for (const entry of sources) {
    if (entry.key === 'QUICKSTART.md') {
      keyToOutput.set(entry.key, 'presentation.md');
      usedNames.add('presentation.md');
      continue;
    }
    keyToOutput.set(entry.key, keyToFilename(entry.key, usedNames));
  }

  const generatedEntries = [];
  for (const entry of sources) {
    const original = fs.readFileSync(entry.absPath, 'utf-8');
    const rewritten = rewriteMarkdownLinks(original, entry.key, keyToOutput);
    const outputFile = keyToOutput.get(entry.key);
    const isHub = outputFile === 'presentation.md';
    const finalBody = isHub ? rewritten : appendBackToHubSlide(rewritten);
    const title = extractTitleFromMarkdown(finalBody, path.basename(entry.key));
    const header = buildHeaderFromTemplate(headerTemplate, {
      title,
      description: entry.key,
      hidden: !isHub
    });
    const finalText = `${header}\n\n${finalBody.trim()}\n`;
    fs.writeFileSync(path.join(readmePresDir, outputFile), finalText, 'utf-8');
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
