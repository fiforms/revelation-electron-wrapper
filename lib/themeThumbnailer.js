// themeThumbnailer.js -- developer tool that renders sample thumbnails (512x288) per theme CSS in
// <revelationDir>/dist/css into dist/css/theme-thumbnails/: <theme>.jpg (title slide, also the card image) plus
// <theme>.2.jpg .. <theme>.N.jpg (the other SAMPLE_SLIDES) which the Theme tab shows as a 2x2 grid in its top bar.
// For each theme it writes a throw-away presentation (slug __theme_thumb_*) into the presentations folder, captures
// its slides with exportWindow.captureSlidesToImageFolder and deletes it again.
// Reached via Help -> Debug -> "Generate Theme Thumbnails..." (callback menu:generate-theme-thumbnails in
// otherEventHandlers.js; only visible with --enable-debug). Exports { generateThemeThumbnails }.
// NOTE: EXCLUDED_THEMES duplicates the exclusion list in otherEventHandlers' getAvailableThemes handler.

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { captureSlidesToImageFolder, makeCaptureDir, removeCaptureDir } = require('./exportWindow');

const EXCLUDED_THEMES = new Set(['handout.css', 'presentations.css', 'medialibrary.css', 'lowerthirds.css', 'confidencemonitor.css', 'notes-teleprompter.css']);

// Slide bodies captured per theme, one image each (a title, a heading pair, a verse, an info layout).
// Each is separated by a --- line; no fragments, so one capture step = one slide.
const SAMPLE_SLIDES = (themeLabel) => [
  `# ${themeLabel}`,
  '## Second Level Heading\n\n### with Normal Text Subtitle',
  '_Refrain_  \nAmazing grace! how sweet the sound,  \nthat saved a wretch like me!  \nI once was lost, but now am found;  \nwas blind, but now I see.',
  ":info:\n\n### Informational Layout\n\nPresent Financial Position\n\n- Quarterly Gains\n- Year-to-Date Summary\n- Next Year's Projection"
];

const toTitleCase = (name) => name
  .split(/[-_]+/g)
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

async function generateThemeThumbnails(AppContext) {
  const themeDir = path.join(AppContext.config.revelationDir, 'dist', 'css');
  const outputDir = path.join(themeDir, 'theme-thumbnails');

  if (!fs.existsSync(themeDir)) {
    throw new Error(`Theme directory not found: ${themeDir}`);
  }

  const themes = fs.readdirSync(themeDir)
    .filter((file) => file.endsWith('.css') && !EXCLUDED_THEMES.has(file))
    .filter((file) => fs.statSync(path.join(themeDir, file)).isFile());

  if (!themes.length) {
    return { success: true, total: 0, outputDir, failures: [] };
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const templateDir = path.join(AppContext.config.revelationDir, 'templates', 'default');
  const templateStyle = path.join(templateDir, 'style.css');
  const templateThumb = path.join(templateDir, 'thumbnail.jpg');

  const results = {
    success: true,
    total: themes.length,
    outputDir,
    failures: []
  };

  for (const themeFile of themes) {
    const themeBase = path.basename(themeFile, '.css');
    const themeLabel = toTitleCase(themeBase);
    const slug = `__theme_thumb_${themeBase}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const presDir = path.join(AppContext.config.presentationsDir, slug);
    const mdFile = 'presentation.md';
    const author = 'REVELation';

    try {
      fs.mkdirSync(presDir, { recursive: true });

      if (fs.existsSync(templateStyle)) {
        fs.copyFileSync(templateStyle, path.join(presDir, 'style.css'));
      }
      if (fs.existsSync(templateThumb)) {
        fs.copyFileSync(templateThumb, path.join(presDir, 'thumbnail.jpg'));
      }

      const metadata = {
        title: `${themeLabel} Theme`,
        author,
        version: app.getVersion(),
        theme: themeFile,
        thumbnail: 'thumbnail.jpg',
        // Headings must not start new slides, or the sample slides split and capture 4 stops before the info slide
        newSlideOnHeading: false,
        config: {
          width: 960,
          height: 540,
          slideNumber: false,
          progress: false,
          controls: false
        },
        created: new Date().toISOString().split('T')[0]
      };

      const slides = SAMPLE_SLIDES(themeLabel);
      const markdown = `---\n${yaml.dump(metadata)}---\n\n${slides.join('\n\n---\n\n')}\n`;
      fs.writeFileSync(path.join(presDir, mdFile), markdown, 'utf-8');

      const captureDir = makeCaptureDir('theme-thumbs');
      try {
        const capture = await captureSlidesToImageFolder(AppContext, slug, mdFile, 512, 288, 1, captureDir, slides.length);
        const images = capture?.imagePaths || [];
        if (!images.length) {
          throw new Error('No slides captured for theme thumbnails.');
        }
        images.forEach((imagePath, i) => {
          const destPath = path.join(outputDir, i === 0 ? `${themeBase}.jpg` : `${themeBase}.${i + 1}.jpg`);
          fs.copyFileSync(imagePath, destPath);
          AppContext.log(`🎨 Theme thumbnail saved: ${destPath}`);
        });
      } finally {
        removeCaptureDir(AppContext, captureDir);
      }
    } catch (err) {
      results.success = false;
      results.failures.push({ theme: themeFile, error: err.message });
      AppContext.error(`Failed to generate thumbnail for ${themeFile}: ${err.message}`);
    } finally {
      fs.rmSync(presDir, { recursive: true, force: true });
    }
  }

  return results;
}

module.exports = {
  generateThemeThumbnails,
  SAMPLE_SLIDES
};
