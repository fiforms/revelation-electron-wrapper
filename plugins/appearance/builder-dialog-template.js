// HTML used by builder.js to render the animation dialog UI. buildDialogHtml(t) takes the
// translate function; every visible string is a literal t() call with an English key (see locales/translations.json).
// Kept in a dedicated module so dialog markup is isolated from runtime logic.
export function buildDialogHtml(t) {
  return `
  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 12px;">
    <h3 style="margin:0;">${t('Animation')}</h3>
    <button type="button" data-action="help" title="${t('Help')}" aria-label="${t('Help')}">❔</button>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
    <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">${t('Trigger')}
      <select name="trigger">
        <option value="==">${t('Auto (on slide entry)')}</option>
        <option value="++">${t('Fragment (click to reveal)')}</option>
      </select>
    </label>
    <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">${t('Animation')}
      <select name="preset">
        <optgroup label="${t('Fade')}">
          <option value="drop">drop — ${t('fade in from above')}</option>
          <option value="dropBig">dropBig — ${t('fade in from above (big)')}</option>
          <option value="dropLeft">dropLeft — ${t('fade in from top-left')}</option>
          <option value="dropRight">dropRight — ${t('fade in from top-right')}</option>
          <option value="rise">rise — ${t('fade in from below')}</option>
          <option value="riseBig">riseBig — ${t('fade in from below (big)')}</option>
          <option value="riseLeft">riseLeft — ${t('fade in from bottom-left')}</option>
          <option value="riseRight">riseRight — ${t('fade in from bottom-right')}</option>
          <option value="fly">fly — ${t('fade in from left')}</option>
          <option value="flyBig">flyBig — ${t('fade in from left (big)')}</option>
          <option value="flyRight">flyRight — ${t('fade in from right')}</option>
          <option value="flyRightBig">flyRightBig — ${t('fade in from right (big)')}</option>
          <option value="fade">fade — ${t('simple fade in')}</option>
        </optgroup>
        <optgroup label="${t('Bounce')}">
          <option value="bounce">bounce — ${t('bounce in')}</option>
          <option value="bounceDown">bounceDown — ${t('bounce from above')}</option>
          <option value="bounceUp">bounceUp — ${t('bounce from below')}</option>
          <option value="bounceLeft">bounceLeft — ${t('bounce from left')}</option>
          <option value="bounceRight">bounceRight — ${t('bounce from right')}</option>
        </optgroup>
        <optgroup label="${t('Slide')}">
          <option value="slide">slide — ${t('slide from left')}</option>
          <option value="slideRight">slideRight — ${t('slide from right')}</option>
          <option value="slideDown">slideDown — ${t('slide from above')}</option>
          <option value="slideUp">slideUp — ${t('slide from below')}</option>
        </optgroup>
        <optgroup label="${t('Zoom')}">
          <option value="zoom">zoom — ${t('zoom in')}</option>
          <option value="zoomDown">zoomDown — ${t('zoom from above')}</option>
          <option value="zoomUp">zoomUp — ${t('zoom from below')}</option>
          <option value="zoomLeft">zoomLeft — ${t('zoom from left')}</option>
          <option value="zoomRight">zoomRight — ${t('zoom from right')}</option>
        </optgroup>
        <optgroup label="${t('Back')}">
          <option value="backDown">backDown — ${t('back in from above')}</option>
          <option value="backUp">backUp — ${t('back in from below')}</option>
          <option value="backLeft">backLeft — ${t('back in from left')}</option>
          <option value="backRight">backRight — ${t('back in from right')}</option>
        </optgroup>
        <optgroup label="${t('Rotate')}">
          <option value="rotate">rotate — ${t('rotate in')}</option>
          <option value="rotateDownLeft">rotateDownLeft — ${t('rotate in down-left')}</option>
          <option value="rotateDownRight">rotateDownRight — ${t('rotate in down-right')}</option>
          <option value="rotateUpLeft">rotateUpLeft — ${t('rotate in up-left')}</option>
          <option value="rotateUpRight">rotateUpRight — ${t('rotate in up-right')}</option>
        </optgroup>
        <optgroup label="${t('Flip / Roll')}">
          <option value="flipX">flipX — ${t('flip on X axis')}</option>
          <option value="flipY">flipY — ${t('flip on Y axis')}</option>
          <option value="flipFull">flipFull — ${t('full 3D flip')}</option>
          <option value="roll">roll — ${t('roll in')}</option>
          <option value="jack">jack — ${t('jack in the box')}</option>
        </optgroup>
        <optgroup label="${t('Light Speed')}">
          <option value="lightLeft">lightLeft — ${t('light speed from left')}</option>
          <option value="lightRight">lightRight — ${t('light speed from right')}</option>
        </optgroup>
        <optgroup label="${t('Specials')}" data-keepable>
          <option value="hinge">hinge — ${t('hinge and fall')}</option>
        </optgroup>
        <optgroup label="${t('Attention Seekers')}" data-keepable>
          <option value="hop">hop — ${t('bounce in place')}</option>
          <option value="headShake">headShake — ${t('shake side to side')}</option>
          <option value="heartbeat">heartbeat — ${t('heartbeat pulse')}</option>
          <option value="pulse">pulse — ${t('gentle pulse')}</option>
          <option value="tada">tada — ${t('tada!')}</option>
          <option value="wobble">wobble — ${t('wobble')}</option>
          <option value="jello">jello — ${t('jello wobble')}</option>
          <option value="rubber">rubber — ${t('rubber band')}</option>
          <option value="shakeX">shakeX — ${t('shake horizontally')}</option>
          <option value="shakeY">shakeY — ${t('shake vertically')}</option>
          <option value="flash">flash — ${t('flash')}</option>
          <option value="swing">swing — ${t('swing')}</option>
        </optgroup>
        <optgroup label="${t('Appearance Custom')}">
          <option value="shrink">shrink — ${t('shrink in')}</option>
          <option value="shrinkBig">shrinkBig — ${t('shrink in (big)')}</option>
          <option value="shrinkBlur">shrinkBlur — ${t('shrink in with blur')}</option>
          <option value="skidLeft">skidLeft — ${t('skid from left')}</option>
          <option value="skidLeftBig">skidLeftBig — ${t('skid from left (big)')}</option>
          <option value="skidRight">skidRight — ${t('skid from right')}</option>
          <option value="skidRightBig">skidRightBig — ${t('skid from right (big)')}</option>
        </optgroup>
      </select>
    </label>
    <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">${t('Split')}
      <select name="split">
        <option value="">${t('None — animate whole element')}</option>
        <option value="let">${t('Letters — animate letter by letter')}</option>
        <option value="word">${t('Words — animate word by word')}</option>
      </select>
    </label>
    <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">${t('Speed')}
      <select name="speed">
        <option value="">${t('Normal')}</option>
        <option value="slow">${t('Slow')}</option>
        <option value="fast">${t('Fast')}</option>
      </select>
    </label>
    <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">${t('Delay (ms)')}
      <input name="delay" type="number" min="0" step="50" placeholder="${t('default 300')}">
    </label>
    <label id="appearance-keep-row" style="display:none;flex-direction:column;gap:4px;color:#c4ccda;" title="${t('Keep the text visible and animate it when clicked (emphasis)')}">${t('Show always')}
      <span style="display:flex;align-items:center;gap:8px;height:29px;"><input name="keep" type="checkbox"> ${t('Emphasis on click')}</span>
    </label>
  </div>

  <div style="margin:0 0 10px;display:flex;align-items:center;gap:10px;">
    <div id="appearance-sample" style="flex:1;height:120px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#0b0f17;border:1px solid #303545;border-radius:8px;font:600 28px 'Source Sans Pro',sans-serif;color:#f2f5fb;">${t('Sample text')}</div>
    <button type="button" data-action="replay" title="${t('Replay the animation')}">▶ ${t('Replay')}</button>
  </div>

  <div style="margin:0 0 12px;padding:8px 10px;border:1px solid #1e3a2a;background:#0f2018;color:#a8d5b5;border-radius:8px;font-size:12px;line-height:1.4;">
    <strong>${t('Added to the end of the current line:')}</strong> <code id="appearance-preview" style="font-family:monospace;"></code>
  </div>

  <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px;">
    <button type="button" data-action="cancel">${t('Cancel')}</button>
    <button type="button" data-action="insert" style="font-weight:600;">${t('Insert')}</button>
  </div>
`;
}
