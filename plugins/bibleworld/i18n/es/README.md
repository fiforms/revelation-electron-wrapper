# Plugin BibleWorld.ai

Explora [bibleworld.ai](https://bibleworld.ai) dentro de una ventana de navegador integrada e
importa los medios descargados directamente a la biblioteca de medios compartida (`_media`), con
los metadatos completados automáticamente. Todo el contenido del sitio tiene licencia **CC0**.

## Cómo funciona

1. Aparece un botón **📖 BibleWorld.ai** en la barra lateral (bajo *Plugins*). Haz clic
   en él para abrir el navegador integrado en `https://bibleworld.ai/explore`. El botón
   usa el hook de acción `pluginButtons` del núcleo, `{ title, action: 'open-explorer' }`,
   que llama directamente al método `open-explorer` de la api del plugin (sin navegación de página).
2. El navegador usa una partición de sesión persistente (`persist:bibleworld`), por lo que
   conservas tu sesión iniciada entre sesiones de uso. La autenticación mediante **Auth0** y los
   proveedores OAuth de **Google / Microsoft / Facebook** se ejecuta dentro del navegador
   integrado (incluidas las ventanas emergentes). Cualquier otro enlace externo al sitio se abre en tu
   navegador del sistema.
3. Cuando inicias una descarga en el sitio, el archivo se captura automáticamente y se
   importa a la biblioteca de medios. Una notificación confirma la importación.

---

## Extracción de metadatos

Para una descarga como:

```
https://cdn.bibleworld.ai/bible-world/generations/<uuid>.png?dl=The%20Compassionate%20Mercy%20of%20the%20Savior.png&format=png
```

el plugin registra:

| Campo        | Fuente                                                        |
|--------------|---------------------------------------------------------------|
| Title        | Parámetro de consulta `dl` (nombre de archivo sin extensión)  |
| Attribution  | Extraída de la página del elemento de origen (enlace/identificador del creador)  |
| License      | `CC0` (fija: todos los recursos del sitio son CC0)            |
| Description   | Extraída de la página (`og:description` / `meta[name=description]`) |
| url_direct    | La URL de descarga del CDN                                    |
| url_origin    | La URL de la página del elemento en bibleworld.ai             |

---

La detección del título y de la descripción es confiable; la atribución usa heurísticas. Si
el marcado del sitio cambia, puedes fijar selectores CSS exactos en **Configuración → BibleWorld.ai**:

- `titleSelector`
- `descriptionSelector`
- `attributionSelector`

Déjalos en blanco para usar la detección automática.

## Habilitación

Habilita **BibleWorld.ai** en **Configuración → Plugins** y luego reinicia la aplicación.
