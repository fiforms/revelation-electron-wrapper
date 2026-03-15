const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const TEST_PRESENTATION_SLUG = 'markdown-conversion-tests';
const TEST_MANIFEST_FILENAME = 'manifest.json';

function getFixturesDir(revelationDir) {
  return path.join(revelationDir, 'tests', 'fixtures');
}

function copyFileSync(srcPath, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
}

function clearDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    fs.rmSync(path.join(dirPath, entry.name), { recursive: true, force: true });
  }
}

function humanizeFixtureName(name) {
  return String(name || '')
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildHubMarkdown(fixtures, appVersion) {
  const metadata = {
    title: 'Markdown Conversion Visual Tests',
    description: 'Generated from revelation/tests fixtures for visual inspection.',
    theme: 'revelation_dark.css',
    newSlideOnHeading: false,
    version: String(appVersion || '').trim() || '0.0.0'
  };
  const frontMatter = `---\n${yaml.dump(metadata, { lineWidth: -1, noRefs: true, sortKeys: false })}---\n`;
  const slides = [
    [
      '# Markdown Conversion Visual Tests',
      '',
      'This presentation is generated from the markdown fixture suite.',
      '',
      'Open each fixture below to inspect slideshow and handout rendering.'
    ].join('\n')
  ];

  const fixturesPerSlide = 6;
  for (let i = 0; i < fixtures.length; i += fixturesPerSlide) {
    const lines = ['## Fixture Index', '','---',''];
    for (const fixture of fixtures.slice(i, i + fixturesPerSlide)) {
      const label = humanizeFixtureName(fixture.name);
      lines.push(`### ${label}`);
      lines.push('');
      lines.push(`[View Test](${fixture.mdFile})`);
      lines.push('');
      lines.push('---');
      lines.push('');
    }
    slides.push(lines.join('\n'));
  }

  return `${frontMatter}\n${slides.join('\n\n***\n\n')}\n`;
}

function installMarkdownTestPresentation({ presentationsDir, revelationDir, appVersion }) {
  const fixturesDir = getFixturesDir(revelationDir);
  if (!fs.existsSync(fixturesDir)) {
    throw new Error(`Markdown test fixtures not found: ${fixturesDir}`);
  }

  const fixtures = fs.readdirSync(fixturesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const sourcePath = path.join(fixturesDir, entry.name, 'presentation.md');
      if (!fs.existsSync(sourcePath)) return null;
      return {
        name: entry.name,
        sourcePath,
        mdFile: `${entry.name}.md`
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!fixtures.length) {
    throw new Error(`No markdown fixture presentations found in ${fixturesDir}`);
  }

  const targetDir = path.join(presentationsDir, TEST_PRESENTATION_SLUG);
  fs.mkdirSync(targetDir, { recursive: true });
  clearDirectory(targetDir);

  const templateDir = path.join(revelationDir, 'templates', 'default');
  const stylePath = path.join(templateDir, 'style.css');
  const thumbnailPath = path.join(templateDir, 'thumbnail.jpg');
  if (fs.existsSync(stylePath)) {
    copyFileSync(stylePath, path.join(targetDir, 'style.css'));
  }
  if (fs.existsSync(thumbnailPath)) {
    copyFileSync(thumbnailPath, path.join(targetDir, 'thumbnail.jpg'));
  }

  for (const fixture of fixtures) {
    copyFileSync(fixture.sourcePath, path.join(targetDir, fixture.mdFile));
  }

  fs.writeFileSync(path.join(targetDir, 'presentation.md'), buildHubMarkdown(fixtures, appVersion), 'utf-8');
  fs.writeFileSync(
    path.join(targetDir, TEST_MANIFEST_FILENAME),
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      appVersion: String(appVersion || '').trim(),
      fixtureCount: fixtures.length,
      fixtureFiles: fixtures.map((fixture) => fixture.mdFile)
    }, null, 2)}\n`,
    'utf-8'
  );

  return {
    slug: TEST_PRESENTATION_SLUG,
    mdFile: 'presentation.md',
    presentationDir: targetDir,
    fixtureCount: fixtures.length
  };
}

module.exports = {
  installMarkdownTestPresentation
};
