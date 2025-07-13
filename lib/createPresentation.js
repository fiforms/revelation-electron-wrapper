const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml'); // 🔹 Add to package.json if not already installed

const presentationsDir = path.resolve(__dirname, '../revelation/presentations');
const templateDir = path.resolve(__dirname, '../revelation/templates/default');

const touch = (filePath) => {
  const time = new Date();
  fs.utimesSync(filePath, time, time);
};

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
}

function createPresentation(data) {
  const title = data.title || 'Untitled';
  const slug = slugify(title);
  const presDir = path.join(presentationsDir, slug);

  if (fs.existsSync(presDir)) {
    throw new Error(`Presentation folder '${slug}' already exists.`);
  }

  fs.mkdirSync(presDir, { recursive: true });

  // Copy template assets
  fs.copyFileSync(path.join(templateDir, 'style.css'), path.join(presDir, 'style.css'));
  fs.copyFileSync(path.join(templateDir, 'thumbnail.webp'), path.join(presDir, 'thumbnail.webp'));

  // Compose full YAML
  const date = new Date().toISOString().split('T')[0];
  const metadata = {
    ...data,
    created: date,
    theme: data.theme || 'softblood.css',
    thumbnail: data.thumbnail || 'thumbnail.webp'
  };

  // Format YAML frontmatter safely
  const frontmatter = `---\n${yaml.dump(metadata)}---\n`;

  // Basic slide content
  const mdBody = `\n# ${title}\n\n${data.description || ''}\n`;

  fs.writeFileSync(path.join(presDir, 'presentation.md'), frontmatter + mdBody, 'utf-8');

  // Trigger Vite refresh if applicable
  const dummy = path.join(presentationsDir, 'index.json');
  if (fs.existsSync(dummy)) touch(dummy);

  return {
    success: true,
    message: `✅ Presentation '${title}' created in presentations/${slug}`,
    slug
  };
}

module.exports = { createPresentation };

