// plugins/widgets/validate.js
//
// Parameter validation for overlay widgets, shared by the browser (client.js
// loads it with a <script> tag) and the main process (endpoint-server.js
// require()s it). Implements the rules in overlaywidgets/README.md#parameters.
//
// Errors carry a `.reason` string ('invalid_params', 'invalid_args',
// 'blocked_url') so callers can pass it straight on.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OverlayWidgetsValidate = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  function fail(reason) {
    const err = new Error(`Widget data unavailable: ${reason}`);
    err.reason = reason;
    throw err;
  }

  function isEmpty(v) {
    return v === undefined || v === null || v === '';
  }

  function emptyValue(type) {
    if (type === 'boolean') return false;
    if (type === 'number') return null;
    return '';
  }

  // Returns the cleaned value for one parameter/arg declaration, or throws.
  function validateValue(def, raw, invalidReason) {
    const bad = () => fail(invalidReason);
    let value = raw;
    if (isEmpty(value) && def.default !== undefined) value = def.default;
    if (isEmpty(value)) {
      if (def.required) bad();
      return emptyValue(def.type);
    }

    switch (def.type) {
      case 'string':
      case 'text': {
        if (typeof value !== 'string') value = String(value);
        const max = def.maxLength || (def.type === 'text' ? 5000 : 500);
        if (value.length > max) bad();
        if (def.pattern && !new RegExp(`^(?:${def.pattern})$`).test(value)) bad();
        return value;
      }
      case 'url': {
        if (typeof value !== 'string') bad();
        value = value.trim().replace(/^webcal:\/\//i, 'https://');
        let u;
        try { u = new URL(value); } catch { bad(); }
        if (u.protocol !== 'https:') bad();
        if (Array.isArray(def.allow) && def.allow.length
          && !def.allow.some(prefix => value.startsWith(prefix))) fail('blocked_url');
        return value;
      }
      case 'enum': {
        const match = (def.options || []).find(o => String(o) === String(value));
        if (match === undefined) bad();
        return match;
      }
      case 'color': {
        const c = String(value).toLowerCase();
        if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(c)) bad();
        return c;
      }
      case 'number': {
        const n = Number(value);
        if (!Number.isFinite(n)) bad();
        if (typeof def.min === 'number' && n < def.min) bad();
        if (typeof def.max === 'number' && n > def.max) bad();
        return n;
      }
      case 'boolean':
        if (value === true || value === 'true') return true;
        if (value === false || value === 'false') return false;
        return bad();
      default:
        return bad();
    }
  }

  // Validates every parameter a manifest declares; unknown keys are dropped.
  function validateParams(manifest, raw) {
    const out = {};
    const input = raw && typeof raw === 'object' ? raw : {};
    for (const [name, def] of Object.entries(manifest.parameters || {})) {
      out[name] = validateValue(def, input[name], 'invalid_params');
    }
    return out;
  }

  return { validateValue, validateParams };
}));
