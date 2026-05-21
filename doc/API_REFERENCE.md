# REVELation API Reference

The optional API server provides HTTP endpoints for controlling presentations, managing media, and accessing presentation resources programmatically. This enables integration with external control systems, custom scripts, and automation tools.

---

## Overview

The API server is disabled by default. When enabled, it listens on `127.0.0.1:<port>` (localhost only). This document covers the **Presentation Control** APIs. Additional plugin-based APIs (Bible text, media library, etc.) are available in [TEMPLATE.AGENTS.md](../revelation/doc/TEMPLATE.AGENTS.md).

---

## Getting Started

### 1. Enable the API Server

Edit your config file (`~/.config/revelation-electron/config.json`):

```json
{
  "apiServerEnabled": true,
  "apiServerPort": 8001,
  "key": "your-secret-api-key"
}
```

Restart the app. The API will be available at `http://127.0.0.1:8001/api`.

---

### 2. Obtain Your API Key

The `key` value in your config is your API key. Keep it secret — it grants full control over presentations.

---

### 3. Make Requests

All endpoints require authentication:

```bash
curl -H "x-api-key: your-secret-api-key" http://127.0.0.1:8001/api/...
# or
curl http://127.0.0.1:8001/api/...?key=your-secret-api-key
```

---

## Authentication

All endpoints require authentication via one of these methods:

```bash
# Using header
curl -H "x-api-key: your-secret-api-key" http://127.0.0.1:8001/api/...

# Using query parameter
curl http://127.0.0.1:8001/api/...?key=your-secret-api-key
```

---

**Missing or incorrect key:**
```
401 Unauthorized
{ "error": "Unauthorized" }
```

---

## Presentation Control API

Control slide navigation, peer sync, and presentation display modes via keyboard input injection. Actions map to existing Reveal.js key bindings and REVELation peer-sync features.

**Base URL:** `http://127.0.0.1:<port>/api/presentation`

### GET /api/presentation/status

Query the current state of the presentation window.

**Parameters:** None (authenticated via API key header/query param)

**Response (200 OK):**

When no presentation is open:
```json
{
  "isOpen": false
}
```

When presentation is open:
```json
{
  "isOpen": true,
  "slug": "sunday-morning",
  "mdFile": "presentation.md",
  "slideNumber": {
    "h": 3,
    "v": 2
  },
  "isBlank": false,
  "isOverview": false
}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `isOpen` | boolean | Whether a presentation window is currently open |
| `slug` | string | Presentation folder name (only when isOpen=true) |
| `mdFile` | string | Markdown file being displayed (only when isOpen=true) |
| `slideNumber.h` | number | Current horizontal slide number (1-based, column position) |
| `slideNumber.v` | number | Current vertical slide number (1-based, position within column) |
| `isBlank` | boolean | Whether presentation is in blank/pause mode |
| `isOverview` | boolean | Whether presentation is in overview mode |

**Examples:**

```bash
# Get current presentation status
curl -H "x-api-key: your-key" http://127.0.0.1:8001/api/presentation/status

# Pretty-print the response
curl -s -H "x-api-key: your-key" http://127.0.0.1:8001/api/presentation/status | jq .
```

**Use Cases:**

- Check if a presentation is currently open before sending control commands
- Display current slide number in a remote control UI
- Monitor presentation state changes
- Implement a dashboard showing presentation status

---

### POST /api/presentation/control

Inject a keyboard action into the currently-open presentation window. Actions are mapped to Reveal.js navigation bindings and REVELation peer-sync features.

**Request:**
```json
{
  "action": "<action>"
}
```

---

**Supported Actions:**

| Action | Key | Effect |
|--------|-----|--------|
| `next` | Space | Advance to next slide |
| `prev` | P | Go to previous slide |
| `up` | ArrowUp | Vertical navigation (previous in column) |
| `down` | ArrowDown | Vertical navigation (next in column) |
| `left` | ArrowLeft | Move left (previous column) |
| `right` | ArrowRight | Move right (next column) |
| `blank` | B | Toggle blank/pause on current slide |
| `overview` | O | Toggle overview mode |
| `push` | Z | Send current presentation to peer windows |
| `close` | Q | Close presentations on peers (or show default) |

---

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "action": "next"
  }
}
```

---

**Error Responses:**

- `400 Bad Request` — unknown action:
  ```json
  { "error": "Unknown action: foo" }
  ```

- `409 Conflict` — no presentation currently open:
  ```json
  { "error": "No active presentation" }
  ```

---

**Examples:**

```bash
# Next slide
curl -X POST http://127.0.0.1:8001/api/presentation/control \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"action":"next"}'
```


---

```bash
# Toggle overview
curl -X POST http://127.0.0.1:8001/api/presentation/control \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"action":"overview"}'
```


---


```bash
# Send presentation to peers
curl -X POST http://127.0.0.1:8001/api/presentation/control \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"action":"push"}'
```

---

### POST /api/presentation/goto

Jump to a specific slide by column and row number.

**Request:**
```json
{
  "h": 3,
  "v": 2
}
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `h` | number | Yes | Horizontal slide number (column, 1-based) |
| `v` | number | Yes | Vertical slide number (row within column, 1-based) |

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "h": 3,
    "v": 2,
    "indexh": 2,
    "indexv": 1
  }
}
```

**Error Responses:**

- `400 Bad Request` — missing or invalid parameters:
  ```json
  { "error": "Missing or invalid parameters: h and v must be numbers" }
  ```
  or
  ```json
  { "error": "Invalid slide number: h and v must be >= 1" }
  ```

- `409 Conflict` — no presentation open:
  ```json
  { "error": "No active presentation" }
  ```

**Examples:**

```bash
# Jump to slide 3, column 2
curl -X POST http://127.0.0.1:8001/api/presentation/goto \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"h":3,"v":2}'

# Jump to first slide
curl -X POST http://127.0.0.1:8001/api/presentation/goto \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"h":1,"v":1}'
```

---

## Open Presentation

### POST /api/presentation/open

Open a presentation by slug and markdown file, or load an external presentation URL.

**Request:**
```json
{
  "slug": "my-presentation",
  "mdFile": "slides.md",
  "fullscreen": true,
  "overrides": {}
}
```


---

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `slug` | string | Yes | — | Presentation name/slug |
| `mdFile` | string | Yes | — | Path to markdown file (relative to presentation directory) |
| `fullscreen` | boolean | No | `true` | Open in fullscreen. Set to `false` for windowed mode (respects app's `mainWindowMode` config). |
| `overrides` | object | No | `{}` | Additional options passed to the presentation window, e.g. `{ "forcePresentationPreload": true }`. |



---

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "slug": "my-presentation",
    "mdFile": "slides.md",
    "fullscreen": true
  }
}
```


---

**Error Responses:**

- `400 Bad Request` — missing required parameters, or invalid path:
  ```json
  { "error": "Missing required parameter: slug" }
  ```
  or
  ```json
  { "error": "Missing required parameter: mdFile (external URLs not allowed)" }
  ```
  or
  ```json
  { "error": "Invalid slug: cannot contain path separators" }
  ```
  or
  ```json
  { "error": "Invalid mdFile: cannot contain parent directory references" }
  ```


---


- `404 Not Found` — presentation directory or markdown file not found:
  ```json
  { "error": "Presentation not found: my-pres" }
  ```
  or
  ```json
  { "error": "Markdown file not found: my-pres/slides.md" }
  ```

- `500 Internal Server Error` — presentations directory not configured:
  ```json
  { "error": "Presentations directory not configured" }
  ```



---

**Examples:**

```bash
# Open local presentation file
curl -X POST http://127.0.0.1:8001/api/presentation/open \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "my-presentation",
    "mdFile": "slides.md"
  }'



---

# Open in windowed mode
curl -X POST http://127.0.0.1:8001/api/presentation/open \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "my-presentation",
    "mdFile": "slides.md",
    "fullscreen": false
  }'



---

# With custom overrides
curl -X POST http://127.0.0.1:8001/api/presentation/open \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "my-presentation",
    "mdFile": "slides.md",
    "overrides": { "forcePresentationPreload": true }
  }'
```

---

## Typical Workflows

### Quick Navigation with StreamDeck

Use the `/api/presentation/control` endpoint to send navigation commands from your StreamDeck device:

1. Create a StreamDeck button that runs:
   ```bash
   curl -s -X POST http://127.0.0.1:8001/api/presentation/control \
     -H "x-api-key: YOUR_KEY" \
     -H "Content-Type: application/json" \
     -d '{"action":"next"}'
   ```


---

2. Each button maps to a different action: `next`, `prev`, `up`, `down`, `left`, `right`, `blank`, `overview`, `push`, `close`

3. Test with `curl` first to ensure your API key and port are correct


---

### Opening Presentations Programmatically

Use the `/api/presentation/open` endpoint to load presentations from a script or automation tool:

```bash
# Open a specific presentation
curl -X POST http://127.0.0.1:8001/api/presentation/open \
  -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "sunday-morning",
    "mdFile": "presentation.md"
  }'
```

Combine with navigation commands to create automated presentation workflows.

---

## Plugin APIs

The REVELation app provides additional plugin-based APIs for Bible text, media management, hymns, and presentation validation. All plugin APIs require authentication via API key (header or query parameter).

---

### Bible Verse API

Base URL: `http://127.0.0.1:<port>/api/bibletext`

All requests require `?key=<access-key>` or the `X-Api-Key: <access-key>` header.

Use this API to retrieve Bible passages and translations. On first use, prompt the user for their preferred translation and whether to include attribution tags in presentations.

| Endpoint | Parameters | Description |
|---|---|---|
| `GET /api/bibletext/passage` | `ref` (required), `translation` (default: `KJV.local`), `attribution` (`true`/`false`), `lang` | Returns Bible passage as `text/plain` markdown for the given reference (e.g. `ref=John+3:16`) |
| `GET /api/bibletext/translations` | — | Returns a YAML list of available local translations |
| `GET /api/bibletext/books` | `translation` (required) | Returns the book list for the given translation |
| `GET /api/bibletext/chapter` | `translation`, `book`, `chapter` (all required) | Returns all verses for a given chapter |
| `GET /api/bibletext/search` | `translation`, `query` (required), `maxResults` (default: `20`) | Full-text search of verses in the given translation |

**Example:**

```bash
curl -H "x-api-key: your-key" "http://127.0.0.1:8001/api/bibletext/passage?ref=John+3:16&translation=KJV.local"
```

---

### Media Library API

Base URL: `http://127.0.0.1:<port>/api/addmedia`

All requests require `?key=<access-key>` or the `X-Api-Key: <access-key>` header.

Use the search endpoint to find relevant media by keyword, then use the item endpoint to get a YAML snippet ready to paste into presentation front matter.

| Endpoint | Parameters | Description |
|---|---|---|
| `GET /api/addmedia/search` | `query` (required) | Search media by keyword against title, description, keywords, and original filename. Returns a YAML list of matches with `filename`, `title`, `mediatype`, `keywords`, and a short `description`. |
| `GET /api/addmedia/item` | `filename` (required) | Returns a `text/yaml` snippet for the given media file, ready to paste directly under `media:` in front matter. The tag is deterministically generated. |

**Typical workflow:**

1. `GET /api/addmedia/search?query=background` — find candidates
2. `GET /api/addmedia/item?filename=<filename from search>` — get the YAML entry
3. Paste the returned YAML block under `media:` in the presentation front matter
4. Reference it in slide content as `media:<tag>` (the tag is the key returned in step 2)

**Example:**

```bash
# Search for background media
curl -H "x-api-key: your-key" "http://127.0.0.1:8001/api/addmedia/search?query=waterfall"

# Get YAML snippet for a media file
curl -H "x-api-key: your-key" "http://127.0.0.1:8001/api/addmedia/item?filename=0787c7d91d5bc289d61e9d985931fd16.mp4"
```

---

### Virtual Bible Snapshots Media API

Base URL: `http://127.0.0.1:<port>/api/virtualbiblesnapshots`

All requests require `?key=<access-key>` or the `X-Api-Key: <access-key>` header.

Searches the online VRBM (Virtual Resource & Background Media) catalogue and imports selected items into the local `_media` library.

| Endpoint | Method | Parameters / Body | Description |
|---|---|---|---|
| `/api/virtualbiblesnapshots/search` | GET | `query` (required), `collection` (optional: `thumbs`, `videos`, `music`, `illustrations`), `maxResults` (default: 30) | Search the remote catalogue by keyword. Returns a YAML list of matching items. Each item includes all fields needed to identify it and to pass directly to the import endpoint. Results are cached for 1 hour. |
| `/api/virtualbiblesnapshots/import?key=<access-key>` | POST | Form body `md5=<md5 from search results>` | Downloads the asset into the local `_media` library and returns a `text/yaml` snippet ready to paste directly under `media:` in front matter (same format as `GET /api/addmedia/item`). |

**Typical workflow:**

1. `GET /api/virtualbiblesnapshots/search?query=waterfall` — find candidates
2. Pick an item from the results
3. `POST /api/virtualbiblesnapshots/import?key=<access-key>` with body `md5=<md5>` — download and store it
4. Paste the returned YAML block under `media:` in the presentation front matter
5. Reference it in slide content as `media:<tag>` (the tag is the key in the returned YAML)

---

### Seventh-day Adventist Hymnal (Adventist Hymns) API

Base URL: `http://127.0.0.1:<port>/api/adventisthymns`

All requests require `?key=<access-key>` or the `X-Api-Key: <access-key>` header.

Use the search API if the user gives a hymn name but not a number; confirm with the user if multiple options are available.

| Endpoint | Parameters | Description |
|---|---|---|
| `GET /api/adventisthymns/hymn` | `number` (required) | Returns the hymn slides as `text/plain` markdown (fetched live from adventisthymns.com) |
| `GET /api/adventisthymns/search` | `query` (required) | Filters the hymn index by title substring or exact hymn number; returns matching entries as JSON |

**Example:**

```bash
# Get hymn by number
curl -H "x-api-key: your-key" "http://127.0.0.1:8001/api/adventisthymns/hymn?number=299"

# Search by title
curl -H "x-api-key: your-key" "http://127.0.0.1:8001/api/adventisthymns/search?query=amazing+grace"
```

---

### Presentation Validator API

Base URL: `http://127.0.0.1:<port>/api/mdvalidate`

All requests require `?key=<access-key>` or the `X-Api-Key: <access-key>` header.

Use this API to validate presentation markdown files and receive a human-readable report of any issues found.

| Endpoint | Parameters | Description |
|---|---|---|
| `GET /api/mdvalidate/report` | `slug` (required), `mdFile` (optional, default: `presentation.md`) | Returns a `text/plain` validation report for the specified presentation, checking YAML header validity, slide separators, code blocks, media files, and media aliases. |

**Report Sections:**

The validation report includes checks for:
- **YAML header validity** — valid YAML syntax and required fields (`title`, `theme`)
- **YAML delimiters** — proper `---` delimiters with correct formatting
- **Slide separators** — blank lines before/after `---` and `***` separators
- **Code blocks** — properly closed fenced code blocks
- **Media files** — linked media files exist and paths are valid
- **Media aliases** — `media:alias` references match YAML entries
- **Media library files** — YAML media aliases point to files in `_media/`
- **Unused aliases** — identifies defined media aliases that are never referenced (warnings only)

**Example:**

```bash
# Validate a presentation
curl -H "x-api-key: your-key" "http://127.0.0.1:8001/api/mdvalidate/report?slug=sunday-morning"

# Validate a non-default markdown file
curl -H "x-api-key: your-key" "http://127.0.0.1:8001/api/mdvalidate/report?slug=advent-week-3&mdFile=presentation_es.md"
```

---

## Additional Resources

For comprehensive presentation format documentation and advanced features, see the [REVELation Snapshot Presenter Documentation Hub](https://snapshots.vrbm.org/revelation-snapshot-presenter-doc/).

For additional context on using these APIs with AI agents, see [TEMPLATE.AGENTS.md](../revelation/doc/TEMPLATE.AGENTS.md) in your presentations folder.

---

## Content Types

All endpoints expect and return JSON:

```
Content-Type: application/json
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Human-readable error message"
}
```


---

Common HTTP status codes:

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad Request — missing or invalid parameters |
| `401` | Unauthorized — missing or wrong API key |
| `404` | Not Found — endpoint does not exist |
| `405` | Method Not Allowed — wrong HTTP method |
| `409` | Conflict — e.g., no presentation open when action requires one |
| `500` | Internal Server Error |

---

## StreamDeck Integration

To control REVELation from a StreamDeck:

1. Enable the API server in REVELation's config and note the port and API key
2. In StreamDeck, add a **"System" → "Execute Command"** action (or use a shell/HTTP plugin)
3. Paste a `curl` command like:

```bash
curl -s -X POST http://127.0.0.1:8001/api/presentation/control \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"action":"next"}'
```

Each StreamDeck button can map to a different action. Alternatively, use a custom HTTP plugin if available in the StreamDeck app.

---

## Security Notes

- The API server only accepts connections from `127.0.0.1` (localhost). It is not accessible over the network by default.
- The `POST /api/presentation/open` endpoint only opens local presentations from your presentations directory. External/arbitrary URLs are not allowed.
- Path traversal protection: `slug` cannot contain `/`, and `mdFile` cannot contain `..` to prevent accessing files outside your presentations directory.
- Protect your API key as you would a password — anyone with the key can control your presentation.


---

## Notes

- Actions like `push` and `close` operate on peer-connected presentation windows (see REVELation documentation for peer mode).
- The API is optional and can be disabled by setting `apiServerEnabled: false` in the config.
