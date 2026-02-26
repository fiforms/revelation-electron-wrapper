# Guía de Configuración

Esta guía explica la pantalla de Configuración en lenguaje sencillo:

- qué cambia cada opción en el uso real
- cuándo te conviene cambiarla
- qué esperar después de pulsar **Guardar configuración**

Para una vista general de la app, consulta [doc/GUI_REFERENCE.md](GUI_REFERENCE.md).

## Antes de cambiar la configuración

- Los cambios se aplican cuando pulsas **Guardar configuración** al final de la ventana de *Configuración*.

## Recomendaciones rápidas para la mayoría

- Deja **Red** en `localhost` salvo que necesites conectar otros dispositivos.
- Configura primero **Pantalla preferida** si usas dos monitores.
- Deja los puertos con sus valores por defecto, salvo que haya conflicto.
- Solo define rutas personalizadas de `FFMPEG`/`FFPROBE` si fallan funciones de medios.

## General

### Pantalla preferida

- Elige en qué monitor se abre la presentación.

### Idioma

- Cambia el idioma de la interfaz de la app.
- Al guardar este ajuste, la app se reinicia para aplicar el idioma en todas partes.

### Idioma preferido de presentación

- Define el idioma predeterminado de las presentaciones.
- Normalmente solo necesitas cambiarlo si prefieres presentar en un idioma distinto al de la interfaz de la app (por ejemplo, esta instancia o un peer muestra una variante traducida).
- También puedes dejarlo en blanco y configurar idiomas alternativos por pantalla en *Virtual Peers*.

En la práctica:
- Déjalo en blanco para seguir el idioma de la app.
- Define un valor (por ejemplo `en` o `es`) para forzar ese idioma por defecto.

### Número de licencia CCLI

Qué hace:
- Pone tu número CCLI a disposición de las diapositivas que usan la macro de CCLI.

Por qué cambiarlo:
- Necesitas que tu número de licencia aparezca al presentar contenido que lo requiere.

En la práctica:
- Si no usas contenido relacionado con CCLI, puedes dejarlo vacío.

### Variante de tipo de pantalla

Qué hace:
- Define una variante visual predeterminada, como lower thirds o notas.

Por qué cambiarlo:
- Sueles trabajar con un estilo de salida concreto y quieres dejarlo por defecto.

En la práctica:
- Si no estás seguro, deja `Normal`.

## Pantallas adicionales (Virtual Peers)

Usa esta sección cuando quieres más de una salida al mismo tiempo, por ejemplo:
- una salida a un proyector
- una salida con enlace en navegador
- una salida con otro idioma o diseño

Cada fila es una salida extra.

### Pantalla

Qué hace:
- Elige dónde va esa salida extra:
- `Window only`: ventana local adicional
- `URL Publish`: salida por enlace web
- una pantalla física específica: salida directa a ese monitor

Por qué cambiarlo:
- Quieres enviar salida a una pantalla de sala, una transmisión o un visor remoto en navegador.

### Idioma

Qué hace:
- Sobrescribe el idioma solo para esa salida extra.

Por qué cambiarlo:
- Necesitas salida bilingüe (por ejemplo pantalla principal en inglés y secundaria en español).

### Variante

Qué hace:
- Sobrescribe el estilo visual solo para esa salida extra.

Por qué cambiarlo:
- Quieres notas en una pantalla y diapositivas normales en otra.

### Pantalla por defecto

Qué hace:
- Controla qué muestra esa salida extra cuando no hay presentación activa.

Opciones:
- `Use Main Default`: usa el mismo comportamiento por defecto de la pantalla principal
- `Solid Black`: pantalla negra
- `Solid Green`: pantalla verde
- `Default Presentation`: muestra una presentación elegida por defecto

Por qué cambiarlo:
- Quieres un estado de espera limpio antes y después de un evento.

### Ruta de presentación por defecto

Qué hace:
- Define qué presentación se abre cuando **Pantalla por defecto** está en `Default Presentation`.

Por qué cambiarlo:
- Quieres un bucle de bienvenida, anuncios o una diapositiva de espera.

### Enlace URL Publish

Qué hace:
- Muestra el enlace web que otras personas pueden abrir para seguir la presentación.

Por qué cambiarlo:
- Quieres que TVs, tablets o móviles sigan la presentación por URL.

En la práctica:
- Este enlace solo aparece si al menos una fila usa `URL Publish`.

### Modo de pantalla de presentación

Qué hace:
- Controla cuándo se abren las pantallas extra configuradas.

Opciones:
- `Always Open`: las abre automáticamente al iniciar la app
- `Group Control`: las abres manualmente con **Open Screens**
- `On Demand`: solo se abren mientras presentas

Por qué cambiarlo:
- Elige el modo que mejor encaja con tu flujo de trabajo.

### Predeterminado de pantalla principal

Qué hace:
- Define el contenido de espera por defecto de la salida principal.

Por qué cambiarlo:
- Quieres una apariencia consistente antes de iniciar diapositivas.

### Ruta predeterminada de presentación principal

Qué hace:
- Elige qué presentación usar cuando **Predeterminado de pantalla principal** está en `Default Presentation`.

Por qué cambiarlo:
- Quieres abrir siempre una presentación concreta por defecto.

### Buscar actualizaciones automáticamente

- Permite que la app busque nuevas versiones automáticamente.
- Desactívalo si tu entorno bloquea las comprobaciones o prefieres revisar manualmente.

## Red

Esta sección controla si la app trabaja solo en local o también con otros dispositivos en la misma red.

### Red (`localhost` o `network`)

Qué hace:
- `localhost`: la app funciona solo en este equipo.
- `network`: permite conexiones desde otros dispositivos de tu red. Úsalo para peering en modo maestro o para Publish URL.

Por qué cambiarlo:
- Usa `network` para configuraciones con varios dispositivos.
- Deja `localhost` para uso simple en un único equipo.

### Activar peering como seguidor

Qué hace:
- Permite que esta app encuentre y siga a otro presentador en la red.

Por qué cambiarlo:
- Quieres que este equipo replique o siga comandos desde otro equipo.

### Activar modo maestro

Qué hace:
- Permite que esta app actúe como presentador principal al que otros equipos pueden emparejarse.

Por qué cambiarlo:
- Quieres controlar otros equipos seguidores desde este equipo.

En la práctica:
- Solo funciona cuando **Red** está en `network`.

### PIN de emparejamiento

- Añade un PIN obligatorio para emparejar seguidores con este equipo maestro.
- Si el modo maestro está activo y no existe PIN, se crea uno automáticamente.

### Nombre de instancia

Qué hace:
- Define el nombre que ven otros dispositivos durante el descubrimiento.

Por qué cambiarlo:
- Te ayuda a identificar fácilmente este equipo (por ejemplo `PC Escenario Frontal`).

Para más detalle de red y emparejamiento, consulta [doc/dev/PEERING.md](dev/PEERING.md).

## Servidor y carpetas

### Puerto del servidor Vite

Qué hace:
- Define el puerto web local que usa la app.

Por qué cambiarlo:
- Solo si otra app ya está usando ese puerto.

En la práctica:
- El valor por defecto `8000` suele funcionar bien.

### Puerto de Reveal Remote

Qué hace:
- Define el puerto para funciones de control remoto.

Por qué cambiarlo:
- Solo si tienes conflicto de puertos.

En la práctica:
- El valor por defecto `1947` suele funcionar bien.

### Servidor público de Reveal Remote

Qué hace:
- Define la URL del servicio remoto para soporte de reveal remote.

Por qué cambiarlo:
- Solo si tu equipo usa otro endpoint remoto.

### Carpeta de presentaciones

Qué hace:
- Elige dónde se guardan presentaciones y medios compartidos.

Por qué cambiarlo:
- Quieres el contenido en otro disco, en una ruta compartida o en una carpeta con respaldo.

En la práctica:
- Haz este cambio con cuidado y confirma que los archivos existentes estén en la nueva ruta.
- Guardar esta carpeta en nube (Google Drive, Nextcloud, OneDrive) puede ayudar a sincronizar presentaciones entre equipos.
- Esta ruta también incluye la biblioteca de medios, que puede crecer bastante.

### Preferir medios de alto bitrate

Qué hace:
- Indica a la app que priorice medios de mayor calidad cuando exista más de una versión.

Por qué cambiarlo:
- Quieres la mejor calidad visual y tu equipo/red lo soporta.

### Auto-convertir medios AV1 para hardware y software antiguos

Qué hace:
- Ayuda a que equipos antiguos reproduzcan mejor contenido AV1 convirtiéndolo.

Por qué cambiarlo:
- Ves problemas de reproducción en sistemas más antiguos.

En la práctica:
- Déjalo desactivado salvo que necesites compatibilidad extra.

## Picture-in-picture (PIP)

### Activar modo PIP

Qué hace:
- Abre presentaciones en un diseño pensado para PIP.

Por qué cambiarlo:
- Envías salida a herramientas de producción de video con chroma key.

### Lado del PIP

Qué hace:
- Elige en qué lado se coloca el área PIP.

Por qué cambiarlo:
- Para adaptarlo a tu diseño de captura/producción.

### Color de chroma key

Qué hace:
- Define el color de key usado en PIP.

Por qué cambiarlo:
- Para ajustarlo a tu configuración de key y evitar artefactos.

## Atajos globales

Los atajos globales permiten controlar diapositivas con teclas mientras una ventana de presentación está abierta.

Acciones disponibles:
- `pipToggle` (envía `X`)
- `previous` (envía `P`)
- `next` (envía `Space`)
- `blank` (envía `B`)
- `up`, `down`, `left`, `right`

Cómo usarlos:
- Haz clic en **Record** junto a una acción.
- Pulsa tu combinación de teclas.
- Haz clic en **Clear** para quitarla.

Notas prácticas:
- No se permiten atajos duplicados.
- Pulsa `Esc` durante la grabación para cancelar.
- Mantén atajos simples para una operación confiable.

## Rutas de herramientas de medios

### Ruta a FFMPEG

Qué hace:
- Indica a la app dónde encontrar `ffmpeg` para tareas de medios.

Por qué cambiarlo:
- Configúralo solo si fallan funciones de medios porque la app no encuentra ffmpeg.

### Ruta a FFPROBE

Qué hace:
- Indica a la app dónde encontrar `ffprobe` para leer datos del medio.

Por qué cambiarlo:
- Configúralo solo si fallan funciones de metadatos/inspección de medios.

Para configurar importación PDF (plugin Add Media), consulta [doc/dev/README-PDF.md](dev/README-PDF.md).

## Gestor de plugins

Esta sección controla qué plugins están activos y permite editar opciones específicas de cada plugin.

Qué hace:
- Activar o desactivar plugins.
- Editar su configuración.

Por qué cambiarlo:
- Activa solo los plugins que usa tu equipo.
- Ajusta el comportamiento de plugins a tu flujo de trabajo.

Notas prácticas:
- Desactivar un plugin quita sus funciones de la interfaz.
- Algunas opciones de plugin pueden requerir reiniciar la app o reabrir pantallas relacionadas.
- Para el significado exacto de cada opción, revisa el `README.md` de ese plugin (por ejemplo [plugins/addmedia/README.md](plugins/addmedia/README.md)).

Para detalles técnicos de arquitectura de plugins, consulta [doc/dev/PLUGINS.md](dev/PLUGINS.md).
