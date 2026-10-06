# WordPress Publish

`wordpress_publish` conecta la aplicación de escritorio REVELation con el plugin de WordPress `revelation-presentations` para que puedas:

- vincular una instancia de escritorio con un sitio de WordPress
- publicar una presentación directamente desde la lista de presentaciones
- volver a publicar cambios de forma incremental en lugar de volver a subir todo
- reflejar la biblioteca compartida `_media` del escritorio en WordPress para alias `media:` alojados

Este README cubre el flujo completo, desde la configuración inicial hasta la publicación, la sincronización de medios y el comportamiento del lado del servidor. La referencia técnica está al final.

---

## Qué Hace Esta Función

Después de vincular, una presentación puede publicarse desde REVELation Desktop hacia un sitio de WordPress que tenga instalado el plugin correspondiente `revelation-presentations`.

Después, el plugin de WordPress:

- almacena la presentación dentro de las subidas de WordPress
- la sirve desde rutas alojadas limpias
- mantiene un registro de confianza de vinculación por sitio
- acepta actualizaciones incrementales de presentación desde el escritorio vinculado
- opcionalmente usa una biblioteca compartida de medios reflejada para referencias `media:` alojadas

La publicación comenzó como un envío unidireccional de escritorio a WordPress. Con un plugin de WordPress que admita `syncProtocol >= 1`, publicar ahora es una **sincronización bidireccional** de tres vías (consulta [Flujo de Sincronización Bidireccional](#flujo-de-sincronización-bidireccional)): los archivos modificados solo en el servidor se descargan, y los archivos modificados en ambos lados muestran una opción de conflicto. Solo la sincronización de la biblioteca de medios compartidos sigue siendo estrictamente unidireccional.

---

## Requisitos

Necesitas todo lo siguiente:

1. REVELation Desktop con el plugin `wordpress_publish` disponible y habilitado.
2. Un sitio de WordPress con el plugin `revelation-presentations` instalado y activado.
3. Acceso de administrador de WordPress para poder aprobar solicitudes de vinculación.
4. Una presentación en tu carpeta local de presentaciones de REVELation.

Recomendado:

- Usa `https://` para el sitio de WordPress.
- Evita certificados TLS autofirmados o con nombre no coincidente, a menos que intencionalmente planees usar HTTP plano.

---

Importante:

- HTTPS se valida normalmente en la aplicación de escritorio.
- Certificados inválidos, autofirmados o con nombre no coincidente harán fallar la vinculación y la publicación.
- Se permiten sitios `http://` planos, pero la interfaz del escritorio muestra una advertencia porque el tráfico de vinculación y publicación no queda protegido por transporte.

## Las Dos Partes

Esta función tiene dos partes:

### Lado de escritorio: `wordpress_publish`

Este es el plugin de REVELation Desktop que:

- abre la ventana de publicación de WordPress desde una tarjeta de presentación
- almacena registros de sitios vinculados en la configuración del escritorio
- firma solicitudes de vinculación y publicación con la clave RSA del escritorio
- sube únicamente los archivos de presentación modificados
- sincroniza archivos de medios compartidos solo cuando es necesario

---

### Lado de WordPress: `revelation-presentations`

Este es el plugin de WordPress que:

- aloja presentaciones REVELation importadas y publicadas
- proporciona la API de vinculación y publicación
- permite a un administrador aprobar o rechazar solicitudes pendientes de vinculación del escritorio
- almacena instancias confiables vinculadas
- sirve presentaciones desde `/_revelation/{slug}`
- opcionalmente sirve alias `media:` alojados desde una biblioteca compartida reflejada

## Configuración Inicial

### 1. Instala y activa el plugin de WordPress

Instala `revelation-presentations` en tu sitio de WordPress y actívalo.

Luego abre:

- `WordPress Admin -> REVELation -> Settings`

---

### 2. Revisa la configuración de WordPress

Como mínimo, revisa estos ajustes:

- `Reveal Remote URL`
- `Max Publish Upload Request (MB)`
- `Use Shared Media Library`
- `Hosted Runtime Plugins`

Notas:

- `Use Shared Media Library` solo importa si planeas sincronizar `_media` compartido.
- `Hosted Runtime Plugins` se cargan para cada presentación servida por el plugin de WordPress.
- La página de configuración también muestra la URL de vinculación de escritorio y las tablas de aprobación de vinculación.

---

### 3. Habilita el plugin de escritorio

En REVELation Desktop:

1. Abre `Settings`.
2. Asegúrate de que el plugin `wordpress_publish` esté habilitado.
3. Guarda la configuración si hace falta.

### 4. Abre la ventana de publicación

En la lista de presentaciones:

1. Haz clic derecho sobre una tarjeta de presentación.
2. Haz clic en `WordPress Publish...`.

Eso abre la ventana de vinculación/publicación para la presentación seleccionada.

---

## Vincular un Sitio de WordPress
### Lado de WordPress

En `WordPress Admin -> REVELation -> Settings`, copia el valor mostrado en:

- `Desktop Pairing URL`

Puedes pegar cualquiera de estas opciones:

- la URL completa de vinculación, como `https://example.org/wp-json/revelation/v1/pair`
- o la URL base del sitio, como `https://example.org`

El plugin de escritorio normaliza cualquiera de las dos formas.

### Lado de escritorio

1. Abre la ventana `WordPress Publish...` desde una tarjeta de presentación.
2. Pega la URL de vinculación o la URL base del sitio en `Pairing URL`.
3. Haz clic en `Pair Site`.
4. Si el sitio usa HTTP plano, confirma la advertencia si deseas continuar.
5. Espera a que la ventana muestre un mensaje de aprobación pendiente y un código de un solo uso.

---

### Aprobar en WordPress

En `WordPress Admin -> REVELation -> Settings`, mira en `Pending Pairing Requests`.

Verás:

- hora de la solicitud
- IP de la solicitud
- nombre de host declarado
- nombre declarado del escritorio
- ID de instancia del escritorio

El código de un solo uso no se muestra en WordPress. Escribe el código que aparece en la ventana de vinculación del escritorio en el campo de código de la solicitud y luego haz clic en:

- `Approve`

La aprobación falla si el código no coincide. Cualquiera puede enviar una solicitud de vinculación con cualquier nombre o nombre de host, así que el código es lo que demuestra que la solicitud vino de tu escritorio. Las solicitudes pendientes caducan después de 24 horas.

---

Si no confías en ella, haz clic en:

- `Reject`

### Qué ocurre después

El plugin de escritorio consulta WordPress para conocer el estado de la aprobación. Cuando llega la aprobación:

- el sitio aparece en la lista `Destinations` del escritorio
- el escritorio almacena localmente las credenciales de vinculación devueltas
- las acciones futuras de publicación y sincronización de medios pueden usar esa vinculación

---

## Publicar una Presentación

Una vez que un sitio esté vinculado:

1. Abre `WordPress Publish...` desde la presentación que deseas publicar.
2. En `Destinations`, busca el sitio vinculado.
3. Haz clic en `Publish`.

El plugin de escritorio:

1. reconstruirá el manifiesto local de la presentación
2. preguntará a WordPress qué archivos faltan o cambiaron
3. subirá solo esos archivos
4. confirmará la publicación en el servidor

Cuando termine, el mensaje de estado incluye la URL final alojada cuando está disponible.

---

## Volver a Publicar una Presentación Actualizada

El botón normal de publicar también es el botón de actualización.

Si cambias una presentación localmente y vuelves a publicarla:

- los archivos sin cambios se omiten
- los archivos modificados o faltantes se suben
- la asignación del slug remoto se reutiliza para esa vinculación y ese slug local

Esto es publicación incremental, no una reimportación completa del ZIP cada vez.

---

## Explorar y Sincronizar Presentaciones Alojadas

Abre `Presentation -> WordPress Sync...` desde el menú principal para ver todas las presentaciones alojadas en un sitio vinculado.

1. Elige el sitio en la lista de la parte superior. `Manage Sites...` abre la ventana de vinculación.
2. Cada presentación alojada tiene un punto de estado:
   - verde: **Synced locally**. Hay una presentación local vinculada a ella, ya sea porque la publicaste o la importaste, o porque exactamente una presentación local tiene el mismo ID de presentación.
   - azul: **Server only**. No tienes copia local.
3. Haz clic en `Sync` en una fila verde para ejecutar una sincronización bidireccional de esa presentación. Haz clic en `Import` en una fila azul para descargarla a una nueva presentación local, con el nombre del slug alojado cuando ese nombre esté libre.
4. El menú `...` abre la presentación alojada (una entrada por cada archivo Markdown) o copia su enlace.

Usa el cuadro de filtro para acotar la lista por título o slug.

---

## Sincronizar la Biblioteca de Medios Compartidos

Usa esto cuando tus presentaciones alojadas dependan de contenido compartido `_media` y quieras que WordPress sirva los mismos archivos compartidos.

Desde la ventana de vinculación del escritorio:

1. Busca un destino vinculado.
2. Haz clic en `...`
3. Haz clic en `Sync Media Library`

El plugin de escritorio:

1. regenerará el archivo local compartido `_media/index.json`
2. construirá un manifiesto de la biblioteca compartida `_media`
3. preguntará a WordPress qué archivos faltan o cambiaron
4. subirá solo esos archivos
5. confirmará la sincronización y eliminará del servidor los archivos obsoletos

Esto es un espejo unidireccional de escritorio hacia WordPress.

---

## Habilitar Medios Compartidos Alojados en WordPress

Si quieres que los alias `media:` alojados se resuelvan desde la biblioteca compartida reflejada:

1. Vincula el sitio.
2. Ejecuta `Sync Media Library` desde el plugin de escritorio.
3. En WordPress, abre `REVELation -> Settings`.
4. Habilita `Use Shared Media Library`.
5. Guarda la configuración.

Cuando está habilitado, los alias `media:` alojados se resuelven desde:

- `wp-content/uploads/revelation-presentations/_shared_media`

en lugar de la carpeta local `_resources/_media` de cada presentación.

## Desvincular un Sitio

La desvinculación tiene dos lados.

---

### Quitarla de la aplicación de escritorio

En la ventana de vinculación del escritorio:

1. Busca el destino vinculado.
2. Haz clic en `...`
3. Haz clic en `Unpair`

Esto elimina el registro de vinculación local almacenado en la configuración del escritorio.

### Quitar la confianza en el servidor WordPress

En `WordPress Admin -> REVELation -> Settings`, en `Paired Instances`:

1. Busca la instancia de escritorio vinculada.
2. Haz clic en `Delete`

Esto elimina el registro de vinculación confiable del lado del servidor.

Para un reinicio completo, elimina la vinculación en ambos lados.

## Botón de Ayuda

La ventana de vinculación del escritorio incluye un botón `❔` en la esquina superior derecha. Abre este README en el visor de handout de REVELation.

---

## Solución de Problemas

### La vinculación queda pendiente y nunca se completa

Revisa `REVELation -> Settings` en WordPress y confirma:

- que la solicitud aparece en `Pending Pairing Requests`
- que escribiste el código de un solo uso de la ventana del escritorio y hiciste clic en `Approve`

Si hace falta:

- rechaza la solicitud anterior
- inicia la vinculación otra vez

### La vinculación desaparece después de cambiar la configuración

Las vinculaciones de escritorio se almacenan en la configuración del plugin. Si antes te encontraste con el error antiguo de serialización de la configuración, vuelve a vincular una vez en una versión actual y la vinculación debería persistir correctamente.

---

### La vinculación por HTTPS falla

El cliente de escritorio valida los certificados TLS. La vinculación y la publicación pueden fallar si el certificado está:

- vencido
- autofirmado
- emitido para un nombre de host incorrecto
- sin una cadena válida

Corrige el certificado o usa HTTP plano solo si aceptas el riesgo de seguridad.

---

### La publicación falla con solicitud demasiado grande / HTTP 413

Esto normalmente significa que el servidor rechazó una solicitud de subida por límites de tamaño.

Revisa:

- el ajuste de WordPress `Max Publish Upload Request (MB)`
- nginx `client_max_body_size`
- PHP `post_max_size`
- PHP `upload_max_filesize`

El plugin de escritorio también tiene una protección local previa a la subida y se detendrá antes si estima que un fragmento excede el tamaño de solicitud permitido.

### Los medios compartidos no aparecen en el sitio alojado

Revisa todo lo siguiente:

- que `Sync Media Library` haya finalizado correctamente
- que `Use Shared Media Library` esté habilitado en la configuración de WordPress
- que la presentación alojada realmente use alias `media:` que deban resolverse desde medios compartidos

---

### Aprobé el escritorio incorrecto

En WordPress:

1. Ve a `REVELation -> Settings`
2. Elimina la instancia vinculada desde `Paired Instances`

Luego quita la vinculación local en la aplicación de escritorio y vuelve a vincular con la máquina correcta.

## Referencia Técnica

---

## Puntos de Entrada para el Usuario
### Interfaz de escritorio

- Menú contextual de la lista de presentaciones: `WordPress Publish...`
- Menú principal: `Presentation -> WordPress Sync...`
- Ventana de sincronización:
  - listar las presentaciones alojadas en un sitio vinculado, con su estado de sincronización local
  - sincronizar presentaciones vinculadas, importar las que solo existen en el servidor
  - abrir o copiar enlaces a presentaciones alojadas
- Ventana de vinculación/publicación:
  - listar destinos vinculados
  - vincular un sitio nuevo
  - publicar la presentación actual
  - sincronizar medios compartidos
  - desvincular destino

---

### Interfaz de WordPress

- `WP Admin -> REVELation -> Settings`
  - ayuda para copiar la URL de vinculación de escritorio
  - aprobación/rechazo de solicitudes pendientes de vinculación
  - eliminación de clientes vinculados
  - configuración de subida, medios y runtime

## Rutas Alojadas

El plugin de WordPress sirve presentaciones desde:

- `/_revelation/{slug}`
- `/_revelation/{slug}/embed`

El archivo Markdown puede elegirse con:

- `?p=relative/path/to/file.md`

El shortcode de WordPress es:

- `[revelation slug="my-slug" md="presentation.md" embed="1"]`

---

## Endpoints REST

- `POST /wp-json/revelation/v1/pair/challenge`
- `POST /wp-json/revelation/v1/pair`
- `POST /wp-json/revelation/v1/pair/status`
- `POST /wp-json/revelation/v1/publish/check`
- `POST /wp-json/revelation/v1/publish/file`
- `POST /wp-json/revelation/v1/publish/commit`
- `POST /wp-json/revelation/v1/publish/pull`
- `POST /wp-json/revelation/v1/publish/list`
- `POST /wp-json/revelation/v1/media-sync/check`
- `POST /wp-json/revelation/v1/media-sync/file`
- `POST /wp-json/revelation/v1/media-sync/commit`

---

## Flujo de Vinculación

1. El escritorio solicita un desafío desde `/pair/challenge`.
2. WordPress devuelve un desafío de corta duración y metadatos del sitio.
3. El escritorio firma el desafío con su clave privada RSA local.
4. El escritorio envía la solicitud de vinculación firmada a `/pair`.
5. WordPress verifica la firma y crea una solicitud pendiente con un código de un solo uso.
6. Un administrador de WordPress aprueba o rechaza la solicitud.
7. El escritorio consulta `/pair/status`.
8. Tras la aprobación, WordPress devuelve credenciales de vinculación y el escritorio las almacena localmente.

Modo de autenticación actual:

- solo desafío-respuesta RSA

---

## Flujo de Publicación

1. El escritorio regenera `manifest.json` local.
2. El escritorio llama a `/publish/check` con el manifiesto local y las credenciales de vinculación.
3. WordPress resuelve el slug remoto para esa vinculación y slug local.
4. WordPress devuelve solo los archivos cambiados o faltantes.
5. El escritorio sube los archivos necesarios mediante `/publish/file`.
6. El escritorio llama a `/publish/commit`.
7. WordPress actualiza el manifiesto/índice de la presentación alojada y devuelve la URL alojada.

---

## Flujo de Sincronización de Medios Compartidos

1. El escritorio regenera `_media/index.json` local.
2. El escritorio construye un manifiesto de medios compartidos.
3. El escritorio llama a `/media-sync/check`.
4. WordPress devuelve solo los archivos de medios compartidos cambiados o faltantes.
5. El escritorio sube los archivos necesarios mediante `/media-sync/file`.
6. El escritorio llama a `/media-sync/commit`.
7. WordPress actualiza el espejo de medios compartidos y elimina los archivos obsoletos.

---

## Reglas de Asignación de Slug Remoto

- WordPress puede renombrar el slug remoto para evitar conflictos.
- La asignación se conserva por vinculación y slug local.
- El mismo escritorio vinculado que vuelve a publicar el mismo slug local reutiliza el mismo slug remoto.
- El manifiesto de cada presentación lleva un `presentationId` persistente (UUID). Se crea una sola vez, se conserva entre reescrituras del manifiesto y viaja con la carpeta (sincronización en la nube, ZIP, Import from URL).
- Un escritorio que aún no tiene asignación se vincula a una copia alojada existente cuando coinciden tanto el `presentationId` como el nombre de la carpeta local. Así es como la misma carpeta sincronizada en la nube, publicada desde varios escritorios, comparte una sola copia alojada. Una carpeta duplicada (mismo ID, distinto nombre) recibe su propia copia alojada, por lo que nunca puede sobrescribir la original.
- Un escritorio que conoce una copia alojada por su registro de sincronización (por ejemplo, después de Import from URL) solicita ese slug de forma explícita con `targetRemoteSlug`, de modo que la publicación llega allí con cualquier slug local. Un destino cuyo `presentationId` sea distinto se rechaza, no se sobrescribe.
- Vincularse a una copia creada por otra vinculación requiere el ajuste de WordPress **Allow Shared Presentation Updates** (desactivado por defecto). Cuando está desactivado, cada escritorio solo puede actualizar las presentaciones que él mismo publicó.
- Los manifiestos alojados registran `siteUrl`, `remoteSlug` y `presentationId`. Un cambio de nombre hecho por un administrador de WP actualiza `remoteSlug` y las asignaciones de publicación.

---

## Registro de Vinculación Almacenado en el Escritorio

El escritorio almacena las vinculaciones en:

- `config.pluginConfigs.wordpress_publish.pairings[]`

Cada registro incluye:

- `siteBaseUrl`
- `siteName`
- `siteUrl`
- `pairingId`
- `publishEndpoint`
- `publishToken`
- `authMode`
- `insecureTransport`
- `pairedAt`
- `localPublicKeyFingerprint`

---

## Pares de Sincronización de Presentaciones

El escritorio mantiene un registro por máquina de dónde se publicó o desde dónde se importó cada presentación, en `sync-peers.json` dentro de la carpeta de datos de usuario de la app (junto a `config.json`). Las entradas se identifican por la ruta resuelta de la carpeta de la presentación.

- Una publicación exitosa registra un par `wordpress` (`siteBaseUrl`, `siteName`, `remoteSlug`, `pairingId`, `presentationUrl`) y, en sitios con soporte de sincronización, una instantánea `base` (`revision` más el `sha1` y el `size` de cada archivo en la última sincronización).
- Import from URL registra un par `url` (`sourceUrl`, `baseUrl`, `manifestUrl`). Cuando la fuente es una presentación alojada por el plugin de WordPress, también registra un par `wordpress` (sitio y slug remoto, con una instantánea base tomada del manifiesto alojado), de modo que publicar en una copia vinculada de ese sitio sincroniza de vuelta con la misma presentación alojada.
- Los pares se identifican por sitio + slug remoto (o URL base), por lo que volver a publicar actualiza la entrada existente.

---

El registro vive deliberadamente fuera de la carpeta de la presentación. Las carpetas de presentaciones suelen sincronizarse en la nube, y una instantánea base que llegue a otra máquina antes que los archivos que describe haría que esa máquina enviara contenido obsoleto. Mover o renombrar la carpeta de una presentación deja huérfana su entrada; la siguiente publicación se comporta entonces como una primera sincronización, lo cual es seguro.

---

## Flujo de Sincronización Bidireccional
Cuando el plugin de WordPress informa `syncProtocol >= 1` desde `/publish/check`, publicar se convierte en una sincronización:

1. El escritorio envía `syncProtocol` con `/publish/check`. WordPress devuelve el `revision` remoto, `remoteFiles` (`sha1`/`size` calculados por el servidor) y `acceptedFiles`.
2. El escritorio compara, para cada archivo, el estado local, el remoto y el `base` del par:
   - modificado solo localmente: subir
   - modificado solo remotamente: descargar
   - modificado en ambos lados: conflicto
3. Los conflictos muestran un único diálogo: **Keep my versions**, **Keep server versions** o **Cancel**. La versión perdedora de cada archivo se guarda en `.sync-conflicts/<timestamp>/` dentro de la carpeta de la presentación, que se excluye de la publicación y de la exportación ZIP. Esto también se aplica cuando no hay una base de sincronización registrada (por ejemplo, se perdió `sync-peers.json`) y decide "gana el más reciente por fecha de modificación": el lado sobrescrito se respalda allí primero. Para los archivos `.html` y `_resources/*` distintos de `_media`, que nunca se escriben localmente, **Keep server versions** deja intacto tu archivo local y no lo sube, por lo que ambos permanecen distintos hasta que actúes.
4. Las descargas pasan por `/publish/pull`, autenticado y por fragmentos. Cada archivo se verifica contra el tamaño y el sha1 del servidor y luego se mueve a su lugar con la fecha de modificación remota.
5. Las subidas y `/publish/commit` llevan `baseRevision`. WordPress responde `409 revision_mismatch` si otra publicación se confirmó mientras tanto.
6. La confirmación se ejecuta bajo un bloqueo por presentación, recalcula los hashes desde el disco, incrementa `revision` y devuelve la lista de archivos confirmados, que pasa a ser el nuevo `base`.

---

Comportamiento sin base (primera sincronización con un sitio): gana el `modified` más reciente, y los archivos que existen solo en el servidor se omiten del manifiesto en lugar de descargarse, igual que en el comportamiento anterior de publicación.

La fase 2 nunca elimina archivos. Una eliminación local quita el archivo del manifiesto alojado (el archivo permanece en el disco del servidor), a menos que el servidor haya modificado ese archivo desde la base, en cuyo caso se descarga de nuevo. Un archivo que falta en el servidor se vuelve a subir.

Los archivos que el sitio rechaza (por ejemplo, una extensión que falta en **Allowed File Extensions**) se enumeran en una advertencia después de publicar.

Los plugins de WordPress más antiguos sin `syncProtocol` reciben la publicación anterior, solo de envío.

---

## Claves de Configuración del Plugin de Escritorio

- `config.pluginConfigs.wordpress_publish.pairings`
- `config.pluginConfigs.wordpress_publish.maxUploadRequestBytes`
- `config.pluginConfigs.wordpress_publish.uploadChunkSizeBytes`

Valores predeterminados:

- `maxUploadRequestBytes = 921600`
- `uploadChunkSizeBytes = 8388608`

Notas:

- `maxUploadRequestBytes = 0` desactiva la protección local previa a la subida.
- el escritorio también puede usar el límite anunciado por el servidor desde `/publish/check`

---

## Ajustes de WordPress Relevantes

- `reveal_remote_url`
- `max_zip_mb`
- `max_publish_request_mb`
- `allow_embed`
- `allow_shared_presentation_updates`
- `show_splash_screen`
- `use_db_index`
- `use_shared_media_library`
- `allowed_extensions`
- `enabled_runtime_plugins`

---

## Plugins de Runtime Alojado en WordPress

El catálogo integrado actual de plugins de runtime alojado incluye:

- `highlight`
- `markerboard`
- `slidecontrol`
- `revealchart`
- `credit_ccli`

Estos se habilitan globalmente para todas las presentaciones alojadas que renderiza el plugin de WordPress.

---

## Notas de Seguridad

- La vinculación requiere aprobación explícita de un administrador de WordPress.
- La clave privada RSA del escritorio nunca sale de la aplicación de escritorio.
- Las solicitudes de vinculación y publicación se firman.
- Las solicitudes de publicación requieren:
  - `pairingId`
  - `publishToken`
  - firma RSA de la solicitud
  - marca de tiempo
  - nonce
  - hash del payload
- WordPress aplica comprobaciones de marca de tiempo y nonce para reducir el riesgo de ataques de repetición.
- HTTPS usa validación TLS normal en el cliente de escritorio.
- Se permiten sitios solo HTTP, pero no existe seguridad de transporte.

---

## Limitaciones Actuales

- Los conflictos de sincronización se resuelven de forma global (conservar todas las versiones locales o todas las del servidor), no archivo por archivo.
- La sincronización nunca elimina archivos; las eliminaciones solo los quitan del manifiesto alojado.
- Renombrar o duplicar la carpeta de una presentación local inicia una nueva copia alojada (el nombre de la carpeta forma parte de cómo se empareja una copia).
- La sincronización de medios compartidos es unidireccional, de escritorio a WordPress.
- La configuración de plugins de runtime alojado es global en WordPress, no por presentación.
