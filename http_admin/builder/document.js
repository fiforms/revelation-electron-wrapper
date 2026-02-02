/*
 * Document assembly helpers (front matter + slide stacks).
 *
 * Sections:
 * - Markdown assembly
 */
import { state } from './context.js';
import { joinSlides } from './markdown.js';

// --- Markdown assembly ---
function getBodyMarkdown() {
  return joinSlides(state.stacks);
}

function getFullMarkdown() {
  return `${state.frontmatter}${getBodyMarkdown()}`;
}

export { getBodyMarkdown, getFullMarkdown };
