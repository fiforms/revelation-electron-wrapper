const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { exportSlidesAsImages } = require('./exportWindow');

const EXCLUDED_THEMES = new Set(['handout.css', 'presentations.css', 'medialibrary.css']);

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
        theme: themeFile,
        thumbnail: 'thumbnail.jpg',
        config: {
          slideNumber: false,
          progress: false,
          controls: false
        },
        created: new Date().toISOString().split('T')[0]
      };

      const markdown = `---\n${yaml.dump(metadata)}---\n\n# ${themeLabel}\n\n### ${author}\n\n${themeFile}\n`;
      fs.writeFileSync(path.join(presDir, mdFile), markdown, 'utf-8');

      const exportResult = await exportSlidesAsImages(AppContext, slug, mdFile, 512, 288, 1, true);
      if (!exportResult?.success) {
        throw new Error(exportResult?.error || 'Thumbnail export failed.');
      }

      const destPath = path.join(outputDir, `${themeBase}.jpg`);
      fs.copyFileSync(path.join(presDir, 'thumbnail.jpg'), destPath);
      AppContext.log(`🎨 Theme thumbnail saved: ${destPath}`);
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
  generateThemeThumbnails
};
