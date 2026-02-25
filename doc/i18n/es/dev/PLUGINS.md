# Desarrollo de plugins del wrapper

---

## Tabla de contenidos
* [Resumen](#dev-plugins-overview)
* [Hooks de menú del Builder](#dev-plugins-builder-hooks)
* [Hooks de exportación offline](#dev-plugins-offline-hooks)
* [Localización de UI de plugins](#dev-plugins-i18n)
* [Referencias específicas de plugins](#dev-plugins-specific)

---

<a id="dev-plugins-overview"></a>

## Resumen

Este archivo documenta los hooks de plugins usados por el pipeline de builder/exportación del wrapper Electron.

---

<a id="dev-plugins-builder-hooks"></a>

## Hooks de menú del Builder

Hooks de plugins en navegador:
- `getContentCreators(context)` (legacy)
- `getBuilderTemplates(context)` (recomendado)

Los elementos de plantilla pueden proporcionar:
- `label` o `title`
- `template` / `markdown` / `content`
- `slides` / `stacks`
- `onSelect(ctx)` o `build(ctx)`

---

Los campos de contexto incluyen:
- `slug`, `mdFile`, `dir`, `origin`, `insertAt`
- helper `insertContent(payload)`

Si un callback llama a `insertContent(...)`, la inserción del builder se considera completa.

---

<a id="dev-plugins-offline-hooks"></a>

## Hooks de exportación offline

Un plugin puede incluir `offline.js` con hooks opcionales:
- `build(context)`
- `export(context)`

`export(context)` puede devolver:
- `pluginListEntry`
- `headTags`
- `bodyTags`
- entradas `copy` en formato `{ from, to }`

---

Ejemplo:

```js
module.exports = {
  async export(ctx) {
    return {
      pluginListEntry: {
        baseURL: './_resources/plugins/example',
        clientHookJS: 'client.js',
        priority: 100,
        config: {}
      },
      copy: [
        { from: 'client.js', to: 'plugins/example/client.js' },
        { from: 'dist', to: 'plugins/example/dist' }
      ]
    };
  }
};
```

---

<a id="dev-plugins-i18n"></a>

## Localización de UI de plugins

El texto de la UI de un plugin debe permanecer dentro de cada plugin, no en el `translations.json` global de la app.

Convención:
- Agregar archivos de locale del plugin en `plugins/<pluginName>/locales/translations.json`
- En páginas del plugin (`*.html`), añadir ese archivo a `window.translationsources` antes de cargar `/js/translate.js`
- Usar `data-translate` para texto estático del DOM y `tr('...')` para strings en JS de tiempo de ejecución
- Para hooks de builder/runtime (por ejemplo etiquetas en `client.js`), el plugin puede añadir su propio archivo de locale desde `ctx.baseURL` y llamar a `loadTranslations()`

Esto mantiene las traducciones de plugins autocontenidas y evita inflar el archivo central de traducciones.

---

<a id="dev-plugins-specific"></a>

## Referencias específicas de plugins

Las sintaxis markdown específicas de plugins se documentan en carpetas de plugins:
- [plugins/revealchart/README.md](../../plugins/revealchart/README.md)
