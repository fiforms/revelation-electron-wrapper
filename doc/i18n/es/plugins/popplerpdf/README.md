# Plugin Poppler PDF

Este plugin incluye una carga útil local de Poppler y configura rutas de herramientas PDF para Add Media cuando está habilitado.

## Comportamiento

- Al registrarse, escanea esta carpeta para encontrar cargas `poppler-*`.
- Selecciona la carga más nueva que contenga `Library/bin/pdfimages.exe`.
- Escribe estos ajustes de Add Media en la configuración de la app:
  - `pluginConfigs.addmedia.pdftoppmPath`
  - `pluginConfigs.addmedia.pdfinfoPath`

Ejemplo de estructura esperada de la carga:

```text
plugins/popplerpdf/poppler-25.12.0/Library/bin/pdfimages.exe
plugins/popplerpdf/poppler-25.12.0/Library/bin/pdftoppm.exe
plugins/popplerpdf/poppler-25.12.0/Library/bin/pdfinfo.exe
```

## Flujo de empaquetado

`scripts/prepackage.js` crea `dist/popplerpdf.zip` desde esta carpeta de plugin y luego elimina `plugins/popplerpdf` antes de compilar el paquete principal de Electron.
