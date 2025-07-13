const fs = require('fs');
const path = require('path');

const presentationsDir = path.resolve(__dirname, '../revelation/presentations');
const templateDir = path.resolve(__dirname, '../revelation/templates/default');

const touch = (filePath) => {
  const time = new Date();
  fs.utimesSync(filePath, time, time);
};

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
}

function createPresentation({ title, description, author }) {
  const slug = slugify(title);
  const presDir = path.join(presentationsDir, slug);

  if (fs.existsSync(presDir)) {
    throw new Error(`Presentation folder '${slug}' already exists.`);
  }

  fs.mkdirSync(presDir, { recursive: true });

  // Copy default files
  fs.copyFileSync(path.join(templateDir, 'style.css'), path.join(presDir, 'style.css'));
  fs.copyFileSync(path.join(templateDir, 'thumbnail.webp'), path.join(presDir, 'thumbnail.webp'));

  // Write Markdown with YAML
  const date = new Date().toISOString().split('T')[0];
  const content = `---\n` +
    `title: ${title}\n` +
    `description: ${description}\n` +
    `author: ${author}\n` +
    `theme: softblood.css\n` +
    `thumbnail: thumbnail.webp\n` +
    `created: ${date}\n` +
    `---\n\n` +
    `# ${title}\n\n${description}\n`;

  fs.writeFileSync(path.join(presDir, 'presentation.md'), content, 'utf-8');

  const dummy = path.join(presentationsDir, 'index.json');
  if (fs.existsSync(dummy)) touch(dummy); // triggers vite.plugins.js update


  return {
    success: true,
    message: `Presentation '${title}' created in presentations/${slug}`,
    slug
  };
}

module.exports = { createPresentation };

