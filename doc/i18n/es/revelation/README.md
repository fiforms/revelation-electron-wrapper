# REVELation

**Framework Snapshot Presenter**

Un sistema modular para construir, diseñar y presentar 
diaporamas [Reveal.js](https://revealjs.com/) basados en 
Markdown. Diseñe temas, amplíe y comparta presentaciones 
hermosas con facilidad: ideal para oradores, docentes y creadores 
de contenido.

---

REVELation Snapshot Presenter es la forma más sencilla de crear 
y presentar exposiciones elegantes y ricas en medios con Reveal.js 
— sin necesidad de conocimientos de desarrollo web. 

---

Le permite empezar inmediatamente sin configuración, con soporte 
extendido de Markdown y un sistema simple basado en archivos. Ya sea docente,
orador o creador de contenido, REVELation le ayuda a enfocarse en su mensaje —
no en el marcado — con funciones como videos de fondo, macros reutilizables
y generación de presentaciones con un solo comando.

---

Úselo directamente (para incorporarlo en su proyecto de desarrollo web)
o descargue nuestra app [GUI complementaria](https://github.com/fiforms/revelation-electron-wrapper)
para una experiencia de autoría fluida.

---

## 🔧 Inicio rápido

---

### 1. Instalar y ejecutar

Clone e instale el framework:

```bash
git clone https://github.com/fiforms/revelation.git
cd revelation
npm install
```

---

Inicie el servidor local:

```bash
npm run dev         # solo localhost
# O
npm run serve       # listo para LAN con funciones de control remoto
```

El enlace para acceder a su hub de presentaciones aparecerá en la terminal.

---

### 2. Crear una presentación

```bash
npm run make
```

Esto generará una nueva carpeta de presentación en `presentations_<key>/`.

Edite el archivo `presentation.md` en la nueva carpeta para empezar a crear contenido.

---

## 🎁 Funcionalidades

* 🧩 **Markdown extendido** — Use front matter YAML, macros de diapositiva y etiquetas de atribución
* 🎥 **Gestión de medios** — Manejo de medios simplificado frente a Reveal.js nativo
* 🧰 **Macros** — Reutilice contenido y atributos de diapositiva con llamadas `{{macroname}}`
* 📲 **Control remoto** — Mantenga múltiples pantallas sincronizadas con remoto integrado

***

---

## 📘 Referencia

La documentación completa de funciones Markdown, esquema YAML,
macros y convenciones de layout está disponible en:

* [doc/REFERENCE.md](doc/REFERENCE.md) - índice de referencia principal
* [doc/AUTHORING_REFERENCE.md](doc/AUTHORING_REFERENCE.md) - extensiones de sintaxis de autoría markdown
* [doc/METADATA_REFERENCE.md](doc/METADATA_REFERENCE.md) - front matter YAML, macros y alias de medios
* [doc/ARCHITECTURE.md](doc/ARCHITECTURE.md) - arquitectura del framework y modelo de extensión

---

## 💻 Aplicación GUI (Recomendada)

Para una autoría y gestión de medios más simple, instale la aplicación de escritorio complementaria:

👉 **[REVELation Snapshot Builder](https://github.com/fiforms/revelation-electron-wrapper)**
*(GUI Electron multiplataforma con gestor de presentaciones, editor y exportación offline)

---


Esto ofrece:

* 📁 **Portal de presentaciones** — Explore y abra todas las presentaciones desde una interfaz central
* 📦 **Exportación** — Exporte handouts, HTML offline o ZIP para compartir

***

---

## 📜 Licencia

Licencia MIT — Libre para usar, modificar y distribuir. Consulte LICENSE.md para más detalles.
