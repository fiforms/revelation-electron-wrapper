/*
 * Slug helpers shared by the Create / Edit Metadata form (create/metadata-form-core.js, which
 * re-exports them) and the Import Presentation window (import-presentation.js).
 *
 * Pure browser ESM with no import-time side effects. Mirrors lib/pathSafety.js `slugify` on the
 * Node side; keep the two rules identical (the renderer can't require a CommonJS module).
 */

// Lowercase and collapse non-alphanumerics to single hyphens, trimming hyphens at the ends.
export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Random four-digit string (1000-9999), used as the auto-slug suffix.
export function randomFourDigits() {
  return String(1000 + Math.floor(Math.random() * 9000));
}
