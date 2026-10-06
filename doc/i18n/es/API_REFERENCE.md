# Referencia de la API de REVELation

El servidor de API opcional proporciona endpoints HTTP para controlar presentaciones, administrar medios y acceder a los recursos de las presentaciones de forma programática. Esto permite la integración con sistemas de control externos, scripts personalizados y herramientas de automatización.

---

## Resumen

El servidor de API está **habilitado por defecto** (clave de configuración `apiServerEnabled`; establécela en `false` para desactivarlo) y se ejecuta como un segundo servidor HTTP, separado del servidor Vite. Escucha en `127.0.0.1:<port>` (solo localhost). Este documento cubre las APIs de **Control de presentaciones**. Hay APIs adicionales basadas en plugins (texto bíblico, biblioteca de medios, etc.) disponibles en [TEMPLATE.AGENTS.md](../revelation/doc/TEMPLATE.AGENTS.md).

---

## Primeros pasos

### 1. Habilitar el servidor de API

Edita tu archivo de configuración (`~/.config/revelation-electron/config.json`):

```json
{
  "apiServerEnabled": true,
  "apiServerPort": 8900,
  "key": "your-secret-api-key"
}
```

---

Reinicia la aplicación. La API estará disponible en `http://127.0.0.1:8900/api`.

> **Nota sobre el puerto.** El valor predeterminado era `8001` en versiones anteriores, que caía dentro
> del rango que el servidor Vite explora cuando su propio puerto (8000) está ocupado, así que un
> puerto 8000 ocupado podía empujar a Vite hacia el servidor de API. Las configuraciones existentes conservan
> el puerto que ya tienen y siguen funcionando; solo cambió el valor predeterminado para
> instalaciones nuevas. Verifica el puerto real en Settings → API Server Port, o
> en el registro de inicio (`[apiServer] Listening on …`).

---

### 2. Obtener tu clave de API

El valor `key` de tu configuración es tu clave de API. Mantenla en secreto: otorga control total sobre las presentaciones.

---

### 3. Hacer solicitudes

Todos los endpoints requieren autenticación:

```bash
curl -H "x-api-key: your-secret-api-key" http://127.0.0.1:8900/api/...
# or
curl http://127.0.0.1:8900/api/...?key=your-secret-api-key
```

---

## Autenticación

Todos los endpoints requieren autenticación mediante uno de estos métodos:

```bash
# Using header
curl -H "x-api-key: your-secret-api-key" http://127.0.0.1:8900/api/...

# Using query parameter
curl http://127.0.0.1:8900/api/...?key=your-secret-api-key
```

---

**Clave ausente o incorrecta:**
```
401 Unauthorized
{ "error": "Unauthorized" }
```

---

## API de control de presentaciones

Controla la navegación de diapositivas, la sincronización entre pares y los modos de visualización de la presentación mediante inyección de entrada de teclado. Las acciones corresponden a los atajos existentes de Reveal.js y a las funciones de sincronización peer de REVELation.

**URL base:** `http://127.0.0.1:<port>/api/presentation`

### GET /api/presentation/status

Consulta el estado actual de la ventana de presentación.

**Parámetros:** Ninguno (autenticado mediante el encabezado o parámetro de consulta de la clave de API)

**Respuesta (200 OK):**

---

Cuando no hay ninguna presentación abierta:
```json
{
  "isOpen": false
}
```

---

Cuando hay una presentación abierta:
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

---

**Campos:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `isOpen` | boolean | Si hay una ventana de presentación abierta actualmente |
| `slug` | string | Nombre de la carpeta de la presentación (solo cuando isOpen=true) |
| `mdFile` | string | Archivo Markdown que se está mostrando (solo cuando isOpen=true) |
| `slideNumber.h` | number | Número de diapositiva horizontal actual (base 1, posición de columna) |
| `slideNumber.v` | number | Número de diapositiva vertical actual (base 1, posición dentro de la columna) |
| `isBlank` | boolean | Si la presentación está en modo en blanco/pausa |
| `isOverview` | boolean | Si la presentación está en modo de vista general |

**Ejemplos:**

---

```bash
# Get current presentation status
curl -H "x-api-key: your-key" http://127.0.0.1:8900/api/presentation/status

# Pretty-print the response
curl -s -H "x-api-key: your-key" http://127.0.0.1:8900/api/presentation/status | jq .
```

**Casos de uso:**

- Comprobar si hay una presentación abierta antes de enviar comandos de control
- Mostrar el número de diapositiva actual en una interfaz de control remoto
- Monitorear los cambios de estado de la presentación
- Implementar un panel que muestre el estado de la presentación

---

### POST /api/presentation/control

Inyecta una acción de teclado en la ventana de presentación abierta actualmente. Las acciones se asignan a los atajos de navegación de Reveal.js y a las funciones de sincronización peer de REVELation.

**Solicitud:**
```json
{
  "action": "<action>"
}
```

---

**Acciones compatibles:**

| Acción | Tecla | Efecto |
|--------|-------|--------|
| `next` | Space | Avanzar a la siguiente diapositiva |
| `prev` | P | Ir a la diapositiva anterior |
| `up` | ArrowUp | Navegación vertical (anterior en la columna) |
| `down` | ArrowDown | Navegación vertical (siguiente en la columna) |
| `left` | ArrowLeft | Mover a la izquierda (columna anterior) |
| `right` | ArrowRight | Mover a la derecha (columna siguiente) |
| `blank` | B | Alternar en blanco/pausa en la diapositiva actual |
| `overview` | O | Alternar el modo de vista general |
| `push` | Z | Enviar la presentación actual a las ventanas de los pares |
| `close` | Q | Cerrar las presentaciones en los pares (o mostrar la predeterminada) |

---

**Respuesta (200 OK):**
```json
{
  "success": true,
  "data": {
    "action": "next"
  }
}
```

---

**Respuestas de error:**

- `400 Bad Request` — acción desconocida:
  ```json
  { "error": "Unknown action: foo" }
  ```

- `409 Conflict` — no hay ninguna presentación abierta actualmente:
  ```json
  { "error": "No active presentation" }
  ```

---

**Ejemplos:**

```bash
# Next slide
curl -X POST http://127.0.0.1:8900/api/presentation/control \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"action":"next"}'
```


---

```bash
# Toggle overview
curl -X POST http://127.0.0.1:8900/api/presentation/control \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"action":"overview"}'
```


---


```bash
# Send presentation to peers
curl -X POST http://127.0.0.1:8900/api/presentation/control \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"action":"push"}'
```

---

### POST /api/presentation/goto

Salta a una diapositiva específica por número de columna y fila.

**Solicitud:**
```json
{
  "h": 3,
  "v": 2
}
```

**Parámetros:**

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `h` | number | Sí | Número de diapositiva horizontal (columna, base 1) |
| `v` | number | Sí | Número de diapositiva vertical (fila dentro de la columna, base 1) |

---

**Respuesta (200 OK):**
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

---

**Respuestas de error:**

- `400 Bad Request` — parámetros faltantes o inválidos:
  ```json
  { "error": "Missing or invalid parameters: h and v must be numbers" }
  ```
  o
  ```json
  { "error": "Invalid slide number: h and v must be >= 1" }
  ```

- `409 Conflict` — no hay ninguna presentación abierta:
  ```json
  { "error": "No active presentation" }
  ```

**Ejemplos:**

---

```bash
# Jump to slide 3, column 2
curl -X POST http://127.0.0.1:8900/api/presentation/goto \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"h":3,"v":2}'

# Jump to first slide
curl -X POST http://127.0.0.1:8900/api/presentation/goto \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"h":1,"v":1}'
```

---

## Abrir una presentación

### POST /api/presentation/open

Abre una presentación de tu directorio de presentaciones por slug y archivo Markdown. Las URL externas se rechazan.

**Solicitud:**
```json
{
  "slug": "my-presentation",
  "mdFile": "slides.md",
  "fullscreen": true,
  "overrides": {}
}
```


---

**Parámetros:**

| Parámetro | Tipo | Requerido | Predeterminado | Descripción |
|-----------|------|-----------|----------------|-------------|
| `slug` | string | Sí | — | Nombre/slug de la presentación |
| `mdFile` | string | Sí | — | Ruta al archivo Markdown (relativa al directorio de la presentación) |
| `fullscreen` | boolean | No | `true` | Abrir en pantalla completa. Establécelo en `false` para modo ventana (respeta la configuración `mainWindowMode` de la aplicación). |
| `overrides` | object | No | `{}` | Opciones adicionales pasadas a la ventana de presentación, p. ej. `{ "forcePresentationPreload": true }`. |



---

**Respuesta (200 OK):**
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

**Respuestas de error:**

- `400 Bad Request` — faltan parámetros requeridos, o ruta inválida:
  ```json
  { "error": "Missing required parameter: slug" }
  ```
  o
  ```json
  { "error": "Missing required parameter: mdFile (external URLs not allowed)" }
  ```
  o
  ```json
  { "error": "Invalid slug: cannot contain path separators" }
  ```
  o
  ```json
  { "error": "Invalid mdFile: cannot contain parent directory references" }
  ```


---


- `404 Not Found` — no se encontró el directorio de la presentación o el archivo Markdown:
  ```json
  { "error": "Presentation not found: my-pres" }
  ```
  o
  ```json
  { "error": "Markdown file not found: my-pres/slides.md" }
  ```

- `500 Internal Server Error` — el directorio de presentaciones no está configurado:
  ```json
  { "error": "Presentations directory not configured" }
  ```



---

**Ejemplos:**

```bash
# Open local presentation file
curl -X POST http://127.0.0.1:8900/api/presentation/open \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "my-presentation",
    "mdFile": "slides.md"
  }'



---

# Open in windowed mode
curl -X POST http://127.0.0.1:8900/api/presentation/open \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "my-presentation",
    "mdFile": "slides.md",
    "fullscreen": false
  }'



---

# With custom overrides
curl -X POST http://127.0.0.1:8900/api/presentation/open \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "my-presentation",
    "mdFile": "slides.md",
    "overrides": { "forcePresentationPreload": true }
  }'
```

---

## Flujos de trabajo típicos

### Navegación rápida con StreamDeck

Usa el endpoint `/api/presentation/control` para enviar comandos de navegación desde tu dispositivo StreamDeck:

1. Crea un botón de StreamDeck que ejecute:
   ```bash
   curl -s -X POST http://127.0.0.1:8900/api/presentation/control \
     -H "x-api-key: YOUR_KEY" \
     -H "Content-Type: application/json" \
     -d '{"action":"next"}'
   ```


---

2. Cada botón se asigna a una acción distinta: `next`, `prev`, `up`, `down`, `left`, `right`, `blank`, `overview`, `push`, `close`

3. Prueba primero con `curl` para asegurarte de que tu clave de API y el puerto son correctos


---

### Abrir presentaciones de forma programática

Usa el endpoint `/api/presentation/open` para cargar presentaciones desde un script o herramienta de automatización:

```bash
# Open a specific presentation
curl -X POST http://127.0.0.1:8900/api/presentation/open \
  -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "sunday-morning",
    "mdFile": "presentation.md"
  }'
```

Combínalo con comandos de navegación para crear flujos de trabajo de presentación automatizados.

---

## APIs de plugins

La aplicación REVELation proporciona APIs adicionales basadas en plugins para texto bíblico, administración de medios, himnos y validación de presentaciones. Todas las APIs de plugins requieren autenticación mediante clave de API (encabezado o parámetro de consulta).

---

### API de versículos bíblicos

URL base: `http://127.0.0.1:<port>/api/bibletext`

Todas las solicitudes requieren `?key=<access-key>` o el encabezado `X-Api-Key: <access-key>`.

Usa esta API para obtener pasajes bíblicos y traducciones. En el primer uso, pregunta al usuario cuál es su traducción preferida y si desea incluir etiquetas de atribución en las presentaciones.

| Endpoint | Parámetros | Descripción |
|---|---|---|
| `GET /api/bibletext/passage` | `ref` (requerido), `translation` (predeterminado: `KJV.local`), `attribution` (`true`/`false`), `lang` | Devuelve el pasaje bíblico como markdown `text/plain` para la referencia dada (p. ej. `ref=John+3:16`) |
| `GET /api/bibletext/translations` | — | Devuelve una lista YAML de las traducciones locales disponibles |
| `GET /api/bibletext/books` | `translation` (requerido) | Devuelve la lista de libros de la traducción dada |
| `GET /api/bibletext/chapter` | `translation`, `book`, `chapter` (todos requeridos) | Devuelve todos los versículos de un capítulo dado |
| `GET /api/bibletext/search` | `translation`, `query` (requeridos), `maxResults` (predeterminado: `20`) | Búsqueda de texto completo de versículos en la traducción dada |

---

**Ejemplo:**

```bash
curl -H "x-api-key: your-key" "http://127.0.0.1:8900/api/bibletext/passage?ref=John+3:16&translation=KJV.local"
```

---

### API de la biblioteca de medios

URL base: `http://127.0.0.1:<port>/api/addmedia`

Todas las solicitudes requieren `?key=<access-key>` o el encabezado `X-Api-Key: <access-key>`.

Usa el endpoint de búsqueda para encontrar medios relevantes por palabra clave, y luego usa el endpoint de elemento para obtener un fragmento YAML listo para pegar en el front matter de la presentación.

| Endpoint | Parámetros | Descripción |
|---|---|---|
| `GET /api/addmedia/search` | `query` (requerido) | Busca medios por palabra clave en el título, la descripción, las palabras clave y el nombre de archivo original. Devuelve una lista YAML de coincidencias con `filename`, `title`, `mediatype`, `keywords` y una `description` corta. |
| `GET /api/addmedia/item` | `filename` (requerido) | Devuelve un fragmento `text/yaml` para el archivo de medios dado, listo para pegar directamente bajo `media:` en el front matter. La etiqueta se genera de forma determinista. |

---

**Flujo de trabajo típico:**

1. `GET /api/addmedia/search?query=background` — encontrar candidatos
2. `GET /api/addmedia/item?filename=<filename from search>` — obtener la entrada YAML
3. Pega el bloque YAML devuelto bajo `media:` en el front matter de la presentación
4. Haz referencia a él en el contenido de la diapositiva como `media:<tag>` (la etiqueta es la clave devuelta en el paso 2)

**Ejemplo:**

```bash
# Search for background media
curl -H "x-api-key: your-key" "http://127.0.0.1:8900/api/addmedia/search?query=waterfall"

# Get YAML snippet for a media file
curl -H "x-api-key: your-key" "http://127.0.0.1:8900/api/addmedia/item?filename=0787c7d91d5bc289d61e9d985931fd16.mp4"
```

---

### API de medios de Virtual Bible Snapshots

URL base: `http://127.0.0.1:<port>/api/virtualbiblesnapshots`

Todas las solicitudes requieren `?key=<access-key>` o el encabezado `X-Api-Key: <access-key>`.

Busca en el catálogo en línea VRBM (Virtual Resource & Background Media) e importa los elementos seleccionados a la biblioteca local `_media`.

| Endpoint | Método | Parámetros / Cuerpo | Descripción |
|---|---|---|---|
| `/api/virtualbiblesnapshots/search` | GET | `query` (requerido), `collection` (opcional: `thumbs`, `videos`, `music`, `illustrations`), `maxResults` (predeterminado: 30) | Busca en el catálogo remoto por palabra clave. Devuelve una lista YAML de elementos coincidentes. Cada elemento incluye todos los campos necesarios para identificarlo y para pasarlo directamente al endpoint de importación. Los resultados se almacenan en caché durante 1 hora. |
| `/api/virtualbiblesnapshots/import?key=<access-key>` | POST | Cuerpo de formulario `md5=<md5 from search results>` | Descarga el recurso a la biblioteca local `_media` y devuelve un fragmento `text/yaml` listo para pegar directamente bajo `media:` en el front matter (mismo formato que `GET /api/addmedia/item`). |

---

**Flujo de trabajo típico:**

1. `GET /api/virtualbiblesnapshots/search?query=waterfall` — encontrar candidatos
2. Elige un elemento de los resultados
3. `POST /api/virtualbiblesnapshots/import?key=<access-key>` con el cuerpo `md5=<md5>` — descargarlo y almacenarlo
4. Pega el bloque YAML devuelto bajo `media:` en el front matter de la presentación
5. Haz referencia a él en el contenido de la diapositiva como `media:<tag>` (la etiqueta es la clave del YAML devuelto)

---

### API del himnario adventista (Adventist Hymns)

URL base: `http://127.0.0.1:<port>/api/adventisthymns`

Todas las solicitudes requieren `?key=<access-key>` o el encabezado `X-Api-Key: <access-key>`.

Usa la API de búsqueda si el usuario da el nombre de un himno pero no el número; confirma con el usuario si hay varias opciones disponibles.

| Endpoint | Parámetros | Descripción |
|---|---|---|
| `GET /api/adventisthymns/hymn` | `number` (requerido) | Devuelve las diapositivas del himno como markdown `text/plain` (obtenidas en vivo de adventisthymns.com) |
| `GET /api/adventisthymns/search` | `query` (requerido) | Filtra el índice de himnos por subcadena del título o número exacto del himno; devuelve las entradas coincidentes como JSON |

**Ejemplo:**

```bash
# Get hymn by number
curl -H "x-api-key: your-key" "http://127.0.0.1:8900/api/adventisthymns/hymn?number=299"

# Search by title
curl -H "x-api-key: your-key" "http://127.0.0.1:8900/api/adventisthymns/search?query=amazing+grace"
```

---

### API del validador de presentaciones

URL base: `http://127.0.0.1:<port>/api/mdvalidate`

Todas las solicitudes requieren `?key=<access-key>` o el encabezado `X-Api-Key: <access-key>`.

Usa esta API para validar archivos Markdown de presentaciones y recibir un informe legible de los problemas encontrados.

| Endpoint | Parámetros | Descripción |
|---|---|---|
| `GET /api/mdvalidate/report` | `slug` (requerido), `mdFile` (opcional, predeterminado: `presentation.md`) | Devuelve un informe de validación `text/plain` de la presentación indicada, comprobando la validez del encabezado YAML, los separadores de diapositivas, los bloques de código, los archivos de medios y los alias de medios. |

**Secciones del informe:**

---

El informe de validación incluye comprobaciones de:
- **Validez del encabezado YAML** — sintaxis YAML válida y campos requeridos (`title`, `theme`)
- **Delimitadores YAML** — delimitadores `---` correctos y con el formato adecuado
- **Separadores de diapositivas** — líneas en blanco antes/después de los separadores `---` y `***`
- **Bloques de código** — bloques de código delimitados correctamente cerrados
- **Archivos de medios** — los archivos de medios enlazados existen y las rutas son válidas
- **Alias de medios** — las referencias `media:alias` coinciden con las entradas YAML
- **Archivos de la biblioteca de medios** — los alias de medios en YAML apuntan a archivos en `_media/`
- **Alias sin usar** — identifica los alias de medios definidos que nunca se referencian (solo advertencias)

**Ejemplo:**

---

```bash
# Validate a presentation
curl -H "x-api-key: your-key" "http://127.0.0.1:8900/api/mdvalidate/report?slug=sunday-morning"

# Validate a non-default markdown file
curl -H "x-api-key: your-key" "http://127.0.0.1:8900/api/mdvalidate/report?slug=advent-week-3&mdFile=presentation_es.md"
```

---

## Recursos adicionales

Para la documentación completa del formato de las presentaciones y las funciones avanzadas, consulta el [REVELation Snapshot Presenter Documentation Hub](https://snapshots.vrbm.org/revelation-snapshot-presenter-doc/).

Para más contexto sobre el uso de estas APIs con agentes de IA, consulta [TEMPLATE.AGENTS.md](../revelation/doc/TEMPLATE.AGENTS.md) en tu carpeta de presentaciones.

---

## Tipos de contenido

Los cuerpos de las solicitudes son JSON (`Content-Type: application/json`). **Las respuestas son YAML por defecto** (`text/yaml`); agrega `?format=json` a cualquier solicitud para obtener JSON. Los ejemplos JSON de abajo muestran la forma `?format=json`.

---

## Respuestas de error

Todos los errores siguen este formato:

```json
{
  "error": "Human-readable error message"
}
```


---

Códigos de estado HTTP comunes:

| Estado | Significado |
|--------|-------------|
| `200` | Éxito |
| `400` | Bad Request — parámetros faltantes o inválidos |
| `401` | Unauthorized — clave de API ausente o incorrecta |
| `404` | Not Found — el endpoint no existe |
| `405` | Method Not Allowed — solo para métodos distintos de GET/POST; un método incorrecto en una ruta válida devuelve `404` |
| `409` | Conflict — p. ej., no hay ninguna presentación abierta cuando la acción requiere una |
| `500` | Internal Server Error |

---

## Integración con StreamDeck

Para controlar REVELation desde un StreamDeck:

1. Habilita el servidor de API en la configuración de REVELation y anota el puerto y la clave de API
2. En StreamDeck, agrega una acción **"System" → "Execute Command"** (o usa un plugin de shell/HTTP)
3. Pega un comando `curl` como:

```bash
curl -s -X POST http://127.0.0.1:8900/api/presentation/control \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"action":"next"}'
```

Cada botón de StreamDeck puede asignarse a una acción distinta. Como alternativa, usa un plugin HTTP personalizado si está disponible en la aplicación StreamDeck.

---

## Notas de seguridad

- El servidor de API solo acepta conexiones desde `127.0.0.1` (localhost). No es accesible por la red de forma predeterminada.
- El endpoint `POST /api/presentation/open` solo abre presentaciones locales de tu directorio de presentaciones. No se permiten URL externas/arbitrarias.
- Protección contra path traversal: `slug` no puede contener `/`, y `mdFile` no puede contener `..`. (Brecha conocida: un `slug` exactamente igual a `..` no se rechaza — consulta [KNOWN_ISSUES.md](dev/KNOWN_ISSUES.md).)
- Los cuerpos de las solicitudes están limitados a 1 MiB; los más grandes reciben `413`. La clave se compara en tiempo constante. Puede enviarse como `?key=` o en el encabezado `x-api-key`; la forma por consulta se admite porque las APIs de plugins y las integraciones existentes la usan, pero un encabezado mantiene la clave fuera de los registros y del historial.
- Protege tu clave de API como protegerías una contraseña: cualquiera que tenga la clave puede controlar tu presentación.


---

## Notas

- Acciones como `push` y `close` operan sobre las ventanas de presentación conectadas por peer (consulta la documentación de REVELation sobre el modo peer).
- La API es opcional y puede desactivarse estableciendo `apiServerEnabled: false` en la configuración.
