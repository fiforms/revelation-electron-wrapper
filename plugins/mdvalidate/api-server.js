// Registers HTTP API routes for the mdvalidate plugin.
// Called by apiServer._loadPluginRoutes() at startup.
//
// GET /api/mdvalidate/report?slug=presentation-slug&mdFile=presentation.md

module.exports = {
  register(routes, callPlugin, AppContext) {

    // GET /api/mdvalidate/report?slug=presentation-slug&mdFile=presentation.md
    // Returns a human-readable text report of validation results.
    routes['GET /api/mdvalidate/report'] = async (sp, res) => {
      const slug = sp.get('slug');
      if (!slug) throw { status: 400, message: 'Missing slug parameter' };

      const mdFile = sp.get('mdFile') || 'presentation.md';
      const result = await callPlugin('validate', { slug, mdFile });

      if (result.error) throw { status: 400, message: result.error };

      const report = formatValidationReport(result);
      const body = Buffer.from(report, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length });
      res.end(body);
      // return undefined so apiServer skips JSON wrapping
    };
  }
};

function formatValidationReport(result) {
  const lines = [];
  const { slug, mdFile, checks, summary } = result;

  // Header
  lines.push(`Validation Report: ${slug}/${mdFile}`);
  lines.push('='.repeat(60));
  lines.push('');

  // Summary
  lines.push(`Total Checks: ${summary.total} | Passed: ${summary.passed} | Warnings: ${summary.warned} | Failed: ${summary.failed}`);
  if (summary.errorCount > 0 || summary.warnCount > 0) {
    const details = [];
    if (summary.errorCount > 0) details.push(`${summary.errorCount} error${summary.errorCount !== 1 ? 's' : ''}`);
    if (summary.warnCount > 0) details.push(`${summary.warnCount} warning${summary.warnCount !== 1 ? 's' : ''}`);
    lines.push(`Issues: ${details.join(', ')}`);
  }
  lines.push('');

  // Results by check
  for (const check of checks) {
    const statusEmoji = check.level === 'pass' ? '✓' : check.level === 'warn' ? '⚠' : '✗';
    const statusLabel = check.level.toUpperCase();
    lines.push(`[${statusLabel}] ${statusEmoji} ${check.label}`);

    if (check.errors.length > 0) {
      for (const error of check.errors) {
        lines.push(`    • ${error}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
