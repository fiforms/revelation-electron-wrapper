# Instalación desde código fuente

---

<a id="install-overview"></a>

## Resumen

Usa esta guía si estás desarrollando localmente o instalando manualmente desde código fuente.

---

## Requisitos previos

- **Node.js 22.12 o superior** y npm (requerido por Electron 44)
- **Git**, con soporte para submódulos (el framework `revelation/` es un submódulo)

<a id="install-clone"></a>

## Clonar, instalar y ejecutar

```bash
git clone --recursive https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper
npm install
npm start
```

`npm install` compila el submódulo `revelation/` (preinstall) y luego descarga binarios grandes y CSS heredado
(postinstall). Para omitir esas descargas, por ejemplo con una conexión lenta o en CI, establece `SKIP_BLOBS=1`:

---

```bash
SKIP_BLOBS=1 npm install
npm run fetch-blobs   # más tarde, para obtener lo que se omitió
```

Para producir instaladores y paquetes, consulta [BUILDING.md](BUILDING.md). En macOS, consulta
[../MACOS_INSTALL.md](../MACOS_INSTALL.md).
