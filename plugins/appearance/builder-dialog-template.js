// Static HTML used by builder.js to render the Add Content dialog UI.
// Kept in a dedicated module so dialog markup is isolated from runtime logic.
export const APPEARANCE_BUILDER_DIALOG_HTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 12px;">
    <h3 style="margin:0;">Insert Animated Line</h3>
    <button type="button" data-action="help" title="Help" aria-label="Help">❔</button>
  </div>

  <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:10px;color:#c4ccda;">Text Content
    <input name="content" placeholder="Enter the text you want to animate" style="width:100%;box-sizing:border-box;">
  </label>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
    <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Trigger
      <select name="trigger">
        <option value="==">Auto (on slide entry)</option>
        <option value="++">Fragment (click to reveal)</option>
      </select>
    </label>
    <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Animation
      <select name="preset">
        <optgroup label="Fade">
          <option value="drop">drop — fade in from above</option>
          <option value="dropBig">dropBig — fade in from above (big)</option>
          <option value="dropLeft">dropLeft — fade in from top-left</option>
          <option value="dropRight">dropRight — fade in from top-right</option>
          <option value="rise">rise — fade in from below</option>
          <option value="riseBig">riseBig — fade in from below (big)</option>
          <option value="riseLeft">riseLeft — fade in from bottom-left</option>
          <option value="riseRight">riseRight — fade in from bottom-right</option>
          <option value="fly">fly — fade in from left</option>
          <option value="flyBig">flyBig — fade in from left (big)</option>
          <option value="flyRight">flyRight — fade in from right</option>
          <option value="flyRightBig">flyRightBig — fade in from right (big)</option>
          <option value="fade">fade — simple fade in</option>
        </optgroup>
        <optgroup label="Bounce">
          <option value="bounce">bounce — bounce in</option>
          <option value="bounceDown">bounceDown — bounce from above</option>
          <option value="bounceUp">bounceUp — bounce from below</option>
          <option value="bounceLeft">bounceLeft — bounce from left</option>
          <option value="bounceRight">bounceRight — bounce from right</option>
        </optgroup>
        <optgroup label="Slide">
          <option value="slide">slide — slide from left</option>
          <option value="slideRight">slideRight — slide from right</option>
          <option value="slideDown">slideDown — slide from above</option>
          <option value="slideUp">slideUp — slide from below</option>
        </optgroup>
        <optgroup label="Zoom">
          <option value="zoom">zoom — zoom in</option>
          <option value="zoomDown">zoomDown — zoom from above</option>
          <option value="zoomUp">zoomUp — zoom from below</option>
          <option value="zoomLeft">zoomLeft — zoom from left</option>
          <option value="zoomRight">zoomRight — zoom from right</option>
        </optgroup>
        <optgroup label="Back">
          <option value="backDown">backDown — back in from above</option>
          <option value="backUp">backUp — back in from below</option>
          <option value="backLeft">backLeft — back in from left</option>
          <option value="backRight">backRight — back in from right</option>
        </optgroup>
        <optgroup label="Rotate">
          <option value="rotate">rotate — rotate in</option>
          <option value="rotateDownLeft">rotateDownLeft — rotate in down-left</option>
          <option value="rotateDownRight">rotateDownRight — rotate in down-right</option>
          <option value="rotateUpLeft">rotateUpLeft — rotate in up-left</option>
          <option value="rotateUpRight">rotateUpRight — rotate in up-right</option>
        </optgroup>
        <optgroup label="Flip / Roll">
          <option value="flipX">flipX — flip on X axis</option>
          <option value="flipY">flipY — flip on Y axis</option>
          <option value="flipFull">flipFull — full 3D flip</option>
          <option value="roll">roll — roll in</option>
          <option value="jack">jack — jack in the box</option>
        </optgroup>
        <optgroup label="Light Speed">
          <option value="lightLeft">lightLeft — light speed from left</option>
          <option value="lightRight">lightRight — light speed from right</option>
        </optgroup>
        <optgroup label="Specials">
          <option value="hinge">hinge — hinge and fall</option>
        </optgroup>
        <optgroup label="Attention Seekers">
          <option value="hop">hop — bounce in place</option>
          <option value="headShake">headShake — shake side to side</option>
          <option value="heartbeat">heartbeat — heartbeat pulse</option>
          <option value="pulse">pulse — gentle pulse</option>
          <option value="tada">tada — tada!</option>
          <option value="wobble">wobble — wobble</option>
          <option value="jello">jello — jello wobble</option>
          <option value="rubber">rubber — rubber band</option>
          <option value="shakeX">shakeX — shake horizontally</option>
          <option value="shakeY">shakeY — shake vertically</option>
          <option value="flash">flash — flash</option>
          <option value="swing">swing — swing</option>
        </optgroup>
        <optgroup label="Appearance Custom">
          <option value="shrink">shrink — shrink in</option>
          <option value="shrinkBig">shrinkBig — shrink in (big)</option>
          <option value="shrinkBlur">shrinkBlur — shrink in with blur</option>
          <option value="skidLeft">skidLeft — skid from left</option>
          <option value="skidLeftBig">skidLeftBig — skid from left (big)</option>
          <option value="skidRight">skidRight — skid from right</option>
          <option value="skidRightBig">skidRightBig — skid from right (big)</option>
        </optgroup>
      </select>
    </label>
    <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Split
      <select name="split">
        <option value="">None — animate whole element</option>
        <option value="let">Letters — animate letter by letter</option>
        <option value="word">Words — animate word by word</option>
      </select>
    </label>
    <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Speed
      <select name="speed">
        <option value="">Normal</option>
        <option value="slow">Slow</option>
        <option value="fast">Fast</option>
      </select>
    </label>
    <label style="display:flex;flex-direction:column;gap:4px;color:#c4ccda;">Delay (ms)
      <input name="delay" type="number" min="0" step="50" placeholder="e.g. 500">
    </label>
  </div>

  <div style="margin:0 0 12px;padding:8px 10px;border:1px solid #1e3a2a;background:#0f2018;color:#a8d5b5;border-radius:8px;font-size:12px;line-height:1.4;">
    <strong>Preview shortcode:</strong> <code id="appearance-preview" style="font-family:monospace;"></code>
  </div>

  <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px;">
    <button type="button" data-action="cancel">Cancel</button>
    <button type="button" data-action="insert" style="font-weight:600;">Insert</button>
  </div>
`;
