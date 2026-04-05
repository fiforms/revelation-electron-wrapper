// Registers HTTP API routes for the bibletext plugin.
// Called by apiServer._loadPluginRoutes() at startup.
//
// Handler signature: async (searchParams) → result object
// Throw { status, message } for HTTP errors, plain Error for 500s.

function humanRefToOsis(ref) {
  // "John 3:16-18" → "John.3.16-18"
  // fetch-passage expects OSIS format with dots as separators
  return String(ref || '').trim()
    .replace(/^(.+?)\s+(\d)/, '$1.$2')  // first space before chapter number → dot
    .replace(/:/, '.');                  // colon between chapter and verse → dot
}

module.exports = {
  register(routes, callPlugin /*, AppContext */) {

    // GET /api/bibletext/passage?ref=John+3:16&translation=KJV.local
    // Returns raw markdown as text/plain rather than JSON.
    routes['GET /api/bibletext/passage'] = async (sp, res) => {
      const ref = sp.get('ref');
      if (!ref) throw { status: 400, message: 'Missing ref parameter' };
      const result = await callPlugin('fetch-passage', {
        osis: humanRefToOsis(ref),
        translation: sp.get('translation') || 'KJV.local',
        includeAttribution: sp.get('attribution') !== 'false',
        referenceSlidePosition: sp.get('refPosition') || 'end',
        translationLanguageCode: sp.get('lang') || ''
      });
      if (!result.success) throw { status: 400, message: result.error };
      const body = Buffer.from(result.markdown, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length });
      res.end(body);
      // return undefined so apiServer skips JSON wrapping
    };

    // GET /api/bibletext/translations
    routes['GET /api/bibletext/translations'] = async (_sp) => {
      return callPlugin('get-translations', {});
    };

    // GET /api/bibletext/books?translation=KJV.local
    routes['GET /api/bibletext/books'] = async (sp) => {
      const translation = sp.get('translation');
      if (!translation) throw { status: 400, message: 'Missing translation parameter' };
      return callPlugin('get-local-books', { translation });
    };

    // GET /api/bibletext/chapter?translation=KJV.local&book=John&chapter=3
    routes['GET /api/bibletext/chapter'] = async (sp) => {
      const translation = sp.get('translation');
      const book = sp.get('book');
      const chapter = parseInt(sp.get('chapter'), 10);
      if (!translation || !book || !chapter) throw { status: 400, message: 'Missing translation, book, or chapter parameter' };
      return callPlugin('read-local-chapter', { translation, book, chapter });
    };

    // GET /api/bibletext/search?translation=KJV.local&query=love+world
    routes['GET /api/bibletext/search'] = async (sp) => {
      const translation = sp.get('translation');
      const query = sp.get('query');
      if (!translation || !query) throw { status: 400, message: 'Missing translation or query parameter' };
      return callPlugin('search-local-verses', {
        translation,
        query,
        maxResults: parseInt(sp.get('maxResults') || '20', 10)
      });
    };
  }
};
