// plugins/widgets/widget-block.js  (browser ES module; pure, no DOM)
// Read and write a `:widget:` YAML block as a plain object. Used by builder.js (the widget
// dialog) for both the Rich Builder card edit and the Animation menu's "Overlay Widget…" entry.
// `yaml` is a js-yaml instance (the builder page provides window.jsyaml).
// Gotcha: saving re-dumps the YAML, so key order is normalised and comments are lost;
// unknown top-level keys are kept (`extras`) after the known ones.

const round = (n) => Math.round(n * 10000) / 10000;
const finite = (v) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const isMap = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Parse a raw `:widget:` block. Returns { name, x, y, w, h, location, parameters, extras, indent }
// (x/y/w/h are slide-width/height ratios or null when absent); null if the text isn't a
// `:widget:` block or its YAML is malformed or not a mapping.
export function parseWidgetBlock(raw, yaml) {
  const lines = String(raw || '').split(/\r?\n/);
  if (!/^[ \t]*:widget:[ \t]*$/.test(lines[0])) return null;
  const body = lines.slice(1);
  const indents = body.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  let parsed;
  try {
    parsed = yaml.load(body.map((l) => l.slice(min)).join('\n')) ?? {};
  } catch {
    return null;
  }
  if (!isMap(parsed)) return null;
  const { name, position, size, location, parameters, ...extras } = parsed;
  return {
    name: String(name ?? '').trim(),
    x: finite(position?.x),
    y: finite(position?.y),
    w: finite(size?.w),
    h: finite(size?.h),
    location: isMap(location) ? location : null,
    parameters: isMap(parameters) ? parameters : {},
    extras,
    indent: lines[0].match(/^[ \t]*/)[0]
  };
}

// Build block text from dialog values. Empty position/size/location/parameters are left out.
// `parameters` is written as given: the caller drops defaults and blanks.
export function buildWidgetBlock(values, yaml, { extras = {}, indent = '' } = {}) {
  const out = { name: String(values.name || '').trim() };
  const x = finite(values.x);
  const y = finite(values.y);
  if (x !== null || y !== null) out.position = { x: round(x ?? 0), y: round(y ?? 0) };
  const w = finite(values.w);
  const h = finite(values.h);
  if (w !== null || h !== null) {
    out.size = {};
    if (w !== null) out.size.w = round(w);
    if (h !== null) out.size.h = round(h);
  }
  const loc = values.location;
  if (isMap(loc) && finite(loc.latitude) !== null && finite(loc.longitude) !== null) {
    out.location = {};
    if (String(loc.name || '').trim()) out.location.name = String(loc.name).trim();
    out.location.latitude = Number(loc.latitude);
    out.location.longitude = Number(loc.longitude);
  }
  if (isMap(values.parameters) && Object.keys(values.parameters).length) out.parameters = values.parameters;
  Object.assign(out, extras);
  const body = yaml.dump(out, { lineWidth: -1 }).trimEnd().split('\n').map((line) => `${indent}  ${line}`);
  return [`${indent}:widget:`, ...body].join('\n');
}
