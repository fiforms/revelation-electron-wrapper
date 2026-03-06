function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function leadingSpaces(value) {
  const match = String(value || '').match(/^ */);
  return match ? match[0].length : 0;
}

function formatCreditsBlock(rawCredits = {}) {
  const credits = rawCredits && typeof rawCredits === 'object' ? rawCredits : {};
  const words = String(credits.words || '').trim();
  const music = String(credits.music || '').trim();
  const title = String(credits.title || '').trim();
  const year = String(credits.year || '').trim();
  const copyrightHolder = String(credits.copyright || '').trim();
  const ccliSong = String(credits.cclisong || '').trim();
  const license = String(credits.license || '').trim().toLowerCase();
  const source = String(credits.source || '').trim();
  const sourceUrl = String(credits.sourceurl || '').trim();

  const lines = [];
  const sameAuthor = words && music && words.toLowerCase() === music.toLowerCase();

  if (sameAuthor) {
    if (title) {
      lines.push(`&quot;${escapeHTML(title)}&quot; words and music by ${escapeHTML(words)}`);
    } else {
      lines.push(`Words and music by ${escapeHTML(words)}`);
    }
  } else {
    if (words) {
      const yearSuffix = year && license === 'public' ? ` (${escapeHTML(year)})` : '';
      lines.push(`Words by ${escapeHTML(words)}${yearSuffix}`);
    }
    if (music) {
      lines.push(`Music by ${escapeHTML(music)}`);
    }
  }

  const hasCopyrightLine = !!(year || copyrightHolder);
  if (license === 'ccli' && hasCopyrightLine) {
    const yearPart = year ? ` ${escapeHTML(year)}` : '';
    const holderPart = copyrightHolder ? ` by ${escapeHTML(copyrightHolder)}` : '';
    lines.push(`&copy;${yearPart}${holderPart}`.trim());
  }

  if (license === 'public') {
    lines.push('Public Domain');
  } else if (license === 'ccli') {
    if (ccliSong) {
      lines.push(`CCLI Song # ${escapeHTML(ccliSong)}`);
    }
    lines.push('CCLI License No: :ccli:');
  }

  if (source) {
    const safeSource = escapeHTML(source);
    const safeHref = escapeHTML(sourceUrl);
    if (/^https?:\/\//i.test(sourceUrl)) {
      lines.push(`<a href="${safeHref}" target="_blank" rel="noopener noreferrer">Source: ${safeSource}</a>`);
    } else {
      lines.push(`Source: ${safeSource}`);
    }
  }

  let stickyAttrib = '';
  if (license === 'ccli') {
    const copyrightParts = [];
    if (year) copyrightParts.push(escapeHTML(year));
    if (copyrightHolder) {
      if (year) {
        copyrightParts.push(`by ${escapeHTML(copyrightHolder)}`);
      } else {
        copyrightParts.push(escapeHTML(copyrightHolder));
      }
    }
    if (copyrightParts.length) {
      stickyAttrib = `© ${copyrightParts.join(' ')}, CCLI License # :ccli:`;
    } else {
      stickyAttrib = 'CCLI License # :ccli:';
    }
  }

  if (!lines.length) {
    return { cite: '', stickyAttrib };
  }

  return {
    cite: `<cite class="attrib">\n${lines.join('<br />\n')}\n</cite>`,
    stickyAttrib
  };
}

function parseYamlBlock(lines, startIndex, markerName, parseYAML) {
  const markerLine = lines[startIndex];
  const markerMatch = markerLine.match(new RegExp(`^(\\s*):${markerName}:\\s*$`));
  if (!markerMatch) return null;

  const baseIndent = leadingSpaces(markerMatch[1]);
  let i = startIndex + 1;
  const blockLines = [];

  while (i < lines.length) {
    const current = lines[i];
    if (current.trim() === '') {
      blockLines.push(current);
      i += 1;
      continue;
    }
    if (leadingSpaces(current) <= baseIndent) break;
    blockLines.push(current);
    i += 1;
  }

  const nonEmpty = blockLines.filter((line) => line.trim() !== '');
  if (!nonEmpty.length) {
    return { parsed: null, nextIndex: i, blockLines };
  }

  const dedent = Math.min(...nonEmpty.map((line) => leadingSpaces(line)));
  const yamlText = blockLines
    .map((line) => (line.trim() === '' ? '' : line.slice(dedent)))
    .join('\n');

  try {
    return { parsed: parseYAML(yamlText), nextIndex: i, blockLines };
  } catch (err) {
    console.warn(`[credit_ccli] Failed to parse :${markerName}: YAML block:`, err);
    return { parsed: undefined, nextIndex: i, blockLines };
  }
}

function getConfiguredCcliNumber(pluginContext, appConfig) {
  const fromPluginConfig = String(pluginContext?.config?.licenseNumber || '').trim();
  if (fromPluginConfig) return fromPluginConfig;

  const fromAppPluginConfig = String(appConfig?.pluginConfigs?.credit_ccli?.licenseNumber || '').trim();
  if (fromAppPluginConfig) return fromAppPluginConfig;

  const fromLegacyConfig = String(appConfig?.ccliLicenseNumber || '').trim();
  if (fromLegacyConfig) return fromLegacyConfig;

  return '{Please set in settings}';
}

export function preprocessMarkdown(markdown, context = {}) {
  const parseYAML = typeof context.parseYAML === 'function' ? context.parseYAML : null;
  const source = String(markdown || '');

  const ccliLicenseNumber = getConfiguredCcliNumber(this?.context, context?.appConfig);
  let transformed = source.replace(/:ccli:/gi, ccliLicenseNumber);

  if (!parseYAML) {
    return transformed;
  }

  const lines = transformed.split('\n');
  const out = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!/^\s*:credits:\s*$/.test(line)) {
      out.push(line);
      i += 1;
      continue;
    }

    const creditsBlock = parseYamlBlock(lines, i, 'credits', parseYAML);
    if (!creditsBlock) {
      out.push(line);
      i += 1;
      continue;
    }

    if (creditsBlock.parsed === undefined || creditsBlock.parsed === null) {
      out.push(line);
      for (const blockLine of creditsBlock.blockLines || []) {
        out.push(blockLine);
      }
      i = creditsBlock.nextIndex;
      continue;
    }

    const rendered = formatCreditsBlock(creditsBlock.parsed);
    if (rendered.cite) {
      out.push(rendered.cite);
    }
    if (rendered.stickyAttrib) {
      out.push(`{{ATTRIB:${rendered.stickyAttrib}}}`);
    }
    i = creditsBlock.nextIndex;
  }

  // Run replacement again so plugin-generated markup (for example :credits: output)
  // also resolves :ccli: tokens.
  return out.join('\n').replace(/:ccli:/gi, ccliLicenseNumber);
}
