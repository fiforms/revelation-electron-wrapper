#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const mediafxDir = path.resolve(__dirname, '..');
const outPath = path.join(mediafxDir, 'locales', 'effectgenerator.translations.json');

function readJsonSafe(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function resolveBinaryPath() {
  const envBin = process.env.EFFECTGENERATOR_BIN && process.env.EFFECTGENERATOR_BIN.trim();
  if (envBin) return envBin;

  // Repo-root command used at runtime/dev: bin/effectgenerator
  const repoRootBin = path.resolve(mediafxDir, '..', '..', 'bin', 'effectgenerator');
  if (fs.existsSync(repoRootBin)) return repoRootBin;

  // Plugin-local fallback if bundled there
  const pluginBin = path.join(mediafxDir, 'bin', 'effectgenerator');
  if (fs.existsSync(pluginBin)) return pluginBin;

  return 'effectgenerator';
}

function loadEffectGeneratorDoc() {
  const binary = resolveBinaryPath();
  try {
    const raw = execFileSync(binary, ['--list-effects', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return JSON.parse(raw);
  } catch (err) {
    const reason = err && err.message ? err.message : String(err);
    throw new Error(
      `Failed to run effectgenerator (${binary} --list-effects --json): ${reason}\n` +
      'Tip: set EFFECTGENERATOR_BIN to the executable path if needed.'
    );
  }
}

function collectDescriptions(doc) {
  const keys = new Set();
  const effects = Array.isArray(doc?.effects) ? doc.effects : [];
  for (const effect of effects) {
    if (typeof effect?.description === 'string' && effect.description.trim()) {
      keys.add(effect.description.trim());
    }
    const options = Array.isArray(effect?.options) ? effect.options : [];
    for (const opt of options) {
      if (typeof opt?.description === 'string' && opt.description.trim()) {
        keys.add(opt.description.trim());
      }
    }
  }
  return [...keys].sort((a, b) => a.localeCompare(b));
}

const doc = loadEffectGeneratorDoc();
const existing = readJsonSafe(outPath, { es: {} });
const existingEs = existing && typeof existing.es === 'object' ? existing.es : {};

const descriptions = collectDescriptions(doc);
const nextEs = {};
for (const key of descriptions) {
  if (!Object.prototype.hasOwnProperty.call(existingEs, key)) {
    nextEs[key] = '';
    continue;
  }
  const existingValue = existingEs[key];
  // Migrate old auto-seeded placeholders (value === key) to empty
  nextEs[key] = existingValue === key ? '' : existingValue;
}

const output = { es: nextEs };
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

console.log(`Wrote ${descriptions.length} effectgenerator translation keys to ${outPath}`);
