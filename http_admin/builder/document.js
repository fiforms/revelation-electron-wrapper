/*
 * Document assembly helpers (front matter + slide stacks).
 *
 * Sections:
 * - Markdown assembly
 */
import { state } from './context.js';
import { joinSlides, parseFrontMatterText, stringifyFrontMatter, getYaml } from './markdown.js';

// --- Markdown assembly ---
function getBodyMarkdown() {
  return joinSlides(state.stacks);
}

function getFullMarkdown() {
  // Use edited frontmatter, but preserve imports and remove flattened entries
  if (!state.importsData || (!state.importsData.media && !state.importsData.macros)) {
    return `${state.frontmatter}${getBodyMarkdown()}`;
  }

  // Parse current frontmatter to get user edits
  const currentMeta = parseFrontMatterText(state.frontmatter);
  const originalMeta = parseFrontMatterText(state.originalFrontmatter);

  // Remove only entries that match imported values (preserve user overrides)
  if (currentMeta.media && state.importsData.media) {
    for (const [key, importedValue] of Object.entries(state.importsData.media)) {
      if (currentMeta.media[key] && JSON.stringify(currentMeta.media[key]) === JSON.stringify(importedValue)) {
        delete currentMeta.media[key];
      }
    }
  }
  if (currentMeta.macros && state.importsData.macros) {
    for (const [key, importedValue] of Object.entries(state.importsData.macros)) {
      if (currentMeta.macros[key] && JSON.stringify(currentMeta.macros[key]) === JSON.stringify(importedValue)) {
        delete currentMeta.macros[key];
      }
    }
  }

  // Restore imports field and re-serialize
  if (originalMeta.imports) {
    currentMeta.imports = originalMeta.imports;
  }

  return `${stringifyFrontMatter(currentMeta)}${getBodyMarkdown()}`;
}

export { getBodyMarkdown, getFullMarkdown };
