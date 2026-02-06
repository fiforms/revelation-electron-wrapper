/*
 * Static label/tooltip updates after translations load.
 *
 * Sections:
 * - Tooltip/title assignments
 * - aria-label translation pass
 */
import {
  addTopTintBtn,
  addTopFormatBtn,
  addTopMediaBtn,
  addTopAudioBtn,
  addTopImageBtn,
  slideToolsBtn,
  addSlideFormatBtn,
  addSlideMediaBtn,
  addSlideImageBtn,
  previewFrame,
  columnMoveLeftMenuItem,
  columnMoveRightMenuItem
} from './context.js';

// --- Tooltip/title assignments ---
function applyStaticLabels() {
  if (addTopTintBtn) addTopTintBtn.title = tr('Insert background tint macro');
  if (addTopFormatBtn) addTopFormatBtn.title = tr('Insert top matter formatting macro');
  if (addTopMediaBtn) addTopMediaBtn.title = tr('Insert linked media into top matter');
  if (addTopAudioBtn) addTopAudioBtn.title = tr('Insert audio macro');
  if (addTopImageBtn) addTopImageBtn.title = tr('Insert image into top matter');
  if (slideToolsBtn) slideToolsBtn.title = tr('Slide markdown tools');
  if (addSlideFormatBtn) addSlideFormatBtn.title = tr('Insert slide formatting macro');
  if (addSlideMediaBtn) addSlideMediaBtn.title = tr('Insert linked media into slide markdown');
  if (addSlideImageBtn) addSlideImageBtn.title = tr('Insert image into slide markdown');
  if (columnMoveLeftMenuItem) columnMoveLeftMenuItem.title = tr('Move column left');
  if (columnMoveRightMenuItem) columnMoveRightMenuItem.title = tr('Move column right');
  if (previewFrame) previewFrame.title = tr('Presentation preview');
  // --- aria-label translation pass ---
  document.querySelectorAll('[aria-label]').forEach((el) => {
    const label = el.getAttribute('aria-label');
    if (!label) return;
    const translated = tr(label);
    if (translated) {
      el.setAttribute('aria-label', translated);
    }
  });
}

export { applyStaticLabels };
