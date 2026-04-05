// Registers HTTP API routes for the adventisthymns plugin.
// Called by apiServer._loadPluginRoutes() at startup.
//
// Handler signature: async (searchParams, res) → result object
// Throw { status, message } for HTTP errors, plain Error for 500s.

module.exports = {
  register(routes, callPlugin /*, AppContext */) {

    // GET /api/adventisthymns/hymn?number=123
    // Returns hymn slides as text/plain markdown.
    routes['GET /api/adventisthymns/hymn'] = async (sp, res) => {
      const number = sp.get('number');
      if (!number) throw { status: 400, message: 'Missing number parameter' };
      const result = await callPlugin('fetchHymnPreview', { number });
      if (!result?.markdown) throw { status: 404, message: 'No hymn content found' };
      const body = Buffer.from(result.markdown, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length });
      res.end(body);
      // return undefined so apiServer skips JSON wrapping
    };

    // GET /api/adventisthymns/index
    // Returns the full hymn index as JSON.
    routes['GET /api/adventisthymns/index'] = async (_sp) => {
      const result = await callPlugin('getHymnIndex', {});
      return result.hymnIndex;
    };

    // GET /api/adventisthymns/search?query=amazing+grace
    // Filters hymn index entries by title or hymn number (case-insensitive substring).
    routes['GET /api/adventisthymns/search'] = async (sp) => {
      const query = sp.get('query');
      if (!query) throw { status: 400, message: 'Missing query parameter' };
      const result = await callPlugin('getHymnIndex', {});
      const index = result.hymnIndex;
      const lower = query.toLowerCase();
      const matches = index.filter((entry) => {
        const title = String(entry?.hymn_title || '').toLowerCase();
        const num = String(entry?.hymn_no || '');
        return title.includes(lower) || num === query.trim();
      });
      return matches;
    };

  }
};
