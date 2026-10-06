# Plugin Live Bible Text

## Tabla de Contenido
* [Resumen](#bibletext-live-overview)
* [Requiere el Plugin Bible Text](#bibletext-live-requires)
* [Configurar la Diapositiva Dinámica](#bibletext-live-setup)
* [Presentar Versículos](#bibletext-live-presenting)
* [Cómo Funciona la Entrega](#bibletext-live-delivery)

---

<a id="bibletext-live-overview"></a>
## Resumen

Live Bible Text te permite poner un versículo en pantalla en el instante en que se menciona durante un
servicio, sin abrir el constructor, guardar ni recargar la presentación.

Este es un plugin de **colaboración de espectadores**: cualquiera que tenga el enlace de la presentación puede cambiar
el versículo mostrado en cada diapositiva de versículo en vivo. Está separado del plugin
[Bible Text](../../../bibletext/i18n/es/README.md) para que la colaboración sea opcional; las funciones normales de
búsqueda e inserción de pasajes funcionan sin él.

---

<a id="bibletext-live-requires"></a>
## Requiere el Plugin Bible Text

Este plugin solo proporciona el mecanismo de entrega de la diapositiva en vivo. Reutiliza la búsqueda de versículos
local/en línea del plugin Bible Text, por lo que **Bible Text también debe estar habilitado** para que los versículos
en vivo funcionen. Si no lo está, al enviar un versículo se devuelve un error que te pide habilitarlo.

---

<a id="bibletext-live-setup"></a>
## Configurar la Diapositiva Dinámica

1. En el constructor, abre el menú **Add Content** y elige **📖 Add Live Bible Slide**.
2. Esto inserta una diapositiva dinámica en blanco que contiene un único marcador `:bibleverse:`. Si quieres, añade un
   fondo; hasta que se envíe un versículo solo muestra el fondo.

---

<a id="bibletext-live-presenting"></a>
## Presentar Versículos

1. Abre la barra lateral **Bible Text** (el botón del plugin "Bible Text").
2. Navega a un capítulo, o escribe una referencia como `John 3:16` y presiona **Enter**.
3. Envía un versículo a todas las diapositivas dinámicas con cualquiera de estas opciones:
   - Haz clic en el botón **▶ present** junto a un versículo.
   - Presiona **Alt+Enter** para presentar el versículo resaltado actualmente.
   - Presiona **↑ / ↓** para pasar al versículo anterior/siguiente y presentarlo (cruzando los límites de
     capítulo), de modo que puedas seguir a un lector a lo largo de un pasaje.
   - Presiona **Esc** para despejar la pantalla (igual que el botón **Clear Screen**).

Después de cada pulsación de tecla, el cuadro de referencia conserva el foco con su texto seleccionado, listo para la
siguiente referencia. El versículo aparece en **todas** las diapositivas dinámicas, en cada presentación abierta,
y tanto en el proyector local como en cualquier espectador de LAN/navegador.

---

<a id="bibletext-live-delivery"></a>
## Cómo Funciona la Entrega

El proceso principal es la única fuente de verdad y transmite el versículo ya renderizado y con HTML escapado
mediante Socket.IO a una sala asociada a un identificador por sesión generado al iniciar el servidor
(`bibletext-live:<presenterLiveRoomId>`). Cada conjunto de diapositivas, tanto el proyector local como los
navegadores remotos, se une a esa sala y renderiza lo que recibe.

> **Nota:** La entrega es solo por Socket.IO. De forma predeterminada, el proceso principal se conecta al propio
> servidor de este equipo (`/presenter-plugins-socket` en el puerto de Vite); cuando
> `useRemotePublicServer` está activado usa en su lugar la URL absoluta de `presenterPluginsPublicServer`.
> No hay un mecanismo alternativo sin conexión.

Consulta `revelation/doc/SECURITY.md` para el modelo de colaboración abierta que sigue esta sala.
