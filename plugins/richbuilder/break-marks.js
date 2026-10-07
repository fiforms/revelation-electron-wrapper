/**
 * break-marks.js — Editor-only ↵ markers for hard line breaks
 *
 * Chromium won't render ::before/::after content on <br>, so the markers are
 * absolutely positioned elements in an overlay inside the stage, placed from
 * each <br>'s client rect.  The overlay lives outside the editor, so it never
 * reaches the serializer or the caret.  A <br> that is the only child of its
 * block is the placeholder that gives an empty line height, not a real break,
 * and gets no marker.
 *
 * Caller: builder.js (installBreakMarks, once, after the editor is mounted).
 */

export function installBreakMarks(stage, editor) {
  const overlay = document.createElement('div');
  overlay.className = 'richbuilder-break-marks';
  overlay.setAttribute('aria-hidden', 'true');
  stage.appendChild(overlay);

  let frame = 0;
  function draw() {
    frame = 0;
    const stageRect = stage.getBoundingClientRect();
    const marks = [];
    editor.querySelectorAll('br').forEach((br) => {
      if (br.parentElement.childNodes.length === 1) return;
      const rect = br.getBoundingClientRect();
      if (!rect.height) return;
      const mark = document.createElement('span');
      mark.textContent = '↵';
      mark.style.left = `${rect.left - stageRect.left + stage.scrollLeft + 4}px`;
      mark.style.top = `${rect.top - stageRect.top + stage.scrollTop}px`;
      mark.style.height = `${rect.height}px`;
      marks.push(mark);
    });
    overlay.replaceChildren(...marks);
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  new MutationObserver(schedule).observe(editor, { childList: true, subtree: true, characterData: true, attributes: true });
  new ResizeObserver(schedule).observe(editor);
  editor.addEventListener('input', schedule);
  window.addEventListener('resize', schedule);
  schedule();
  return schedule;
}
