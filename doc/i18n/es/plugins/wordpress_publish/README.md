# WordPress Publish

`wordpress_publish` conecta la aplicación de escritorio REVELation con el plugin de WordPress `revelation-presentations` para que pueda:

- vincular una instancia de escritorio con un sitio de WordPress
- publicar una presentación directamente desde la lista de presentaciones
- volver a publicar cambios de forma incremental en lugar de volver a subir todo
- reflejar la biblioteca compartida `_media` del escritorio en WordPress para alias `media:` alojados

Este README cubre el flujo completo, desde la configuración inicial hasta la publicación, la sincronización de medios y el comportamiento del lado del servidor. La referencia técnica está al final.

## Qué Hace Esta Función

Después de vincular, una presentación puede publicarse desde REVELation Desktop hacia un sitio de WordPress que tenga instalado el plugin correspondiente `revelation-presentations`.

Después, el plugin de WordPress:

- almacena la presentación dentro de las subidas de WordPress
- la sirve desde rutas alojadas limpias
- mantiene un registro de confianza de vinculación por sitio
- acepta actualizaciones incrementales de presentación desde el escritorio vinculado
- opcionalmente usa una biblioteca compartida de medios reflejada para referencias `media:` alojadas

Esto está pensado como un flujo unidireccional de escritorio a WordPress. WordPress es el destino alojado, no la fuente principal de edición.

## Requisitos

Necesita todo lo siguiente:

1. REVELation Desktop con el plugin `wordpress_publish` disponible y habilitado.
2. Un sitio de WordPress con el plugin `revelation-presentations` instalado y activado.
3. Acceso de administrador de WordPress para poder aprobar solicitudes de vinculación.
4. Una presentación en su carpeta local de presentaciones de REVELation.

Recomendado:

- Use `https://` para el sitio de WordPress.
- Evite certificados TLS autofirmados o con nombre no coincidente, a menos que intencionalmente planee usar HTTP plano.

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

### Lado de WordPress: `revelation-presentations`

Este es el plugin de WordPress que:

- aloja presentaciones REVELation importadas y publicadas
- proporciona la API de vinculación y publicación
- permite a un administrador aprobar o rechazar solicitudes pendientes de vinculación del escritorio
- almacena instancias confiables vinculadas
- sirve presentaciones desde `/_revelation/{slug}`
- opcionalmente sirve alias `media:` alojados desde una biblioteca compartida reflejada

## Configuración Inicial

### 1. Instale y active el plugin de WordPress

Instale `revelation-presentations` en su sitio de WordPress y actívelo.

Luego abra:

- `WordPress Admin -> REVELation -> Settings`

### 2. Revise la configuración de WordPress

Como mínimo, revise estos ajustes:

- `Reveal Remote URL`
- `Max Publish Upload Request (MB)`
- `Use Shared Media Library`
- `Hosted Runtime Plugins`

Notas:

- `Use Shared Media Library` solo importa si planea sincronizar `_media` compartido.
- `Hosted Runtime Plugins` se cargan para cada presentación servida por el plugin de WordPress.
- La página de ajustes también muestra la URL de vinculación de escritorio y las tablas de aprobación de vinculación.

### 3. Habilite el plugin de escritorio

En REVELation Desktop:

1. Abra `Settings`.
2. Asegúrese de que el plugin `wordpress_publish` esté habilitado.
3. Guarde la configuración si hace falta.

### 4. Abra la ventana de publicación

En la lista de presentaciones:

1. Haga clic derecho sobre una tarjeta de presentación.
2. Haga clic en `WordPress Publish...`.

Eso abre la ventana de vinculación/publicación para la presentación seleccionada.

## Vincular un Sitio de WordPress

### Lado de WordPress

En `WordPress Admin -> REVELation -> Settings`, copie el valor mostrado en:

- `Desktop Pairing URL`

Puede pegar cualquiera de estas opciones:

- la URL completa de vinculación, como `https://example.org/wp-json/revelation/v1/pair`
- o la URL base del sitio, como `https://example.org`

El plugin de escritorio normaliza cualquiera de las dos formas.

### Lado de escritorio

1. Abra la ventana `WordPress Publish...` desde una tarjeta de presentación.
2. Pegue la URL de vinculación o la URL base del sitio en `Pairing URL`.
3. Haga clic en `Pair Site`.
4. Si el sitio usa HTTP plano, confirme la advertencia si desea continuar.
5. Espere a que la ventana muestre un mensaje de aprobación pendiente y un código de un solo uso.

### Aprobar en WordPress

En `WordPress Admin -> REVELation -> Settings`, mire en `Pending Pairing Requests`.

Verá:

- hora de la solicitud
- IP de la solicitud
- nombre de host declarado
- nombre declarado del escritorio
- ID de instancia del escritorio
- código de un solo uso

Confirme que la solicitud coincida con el escritorio en el que desea confiar, luego haga clic en:

- `Approve`

Si no confía en ella, haga clic en:

- `Reject`

### Qué ocurre después

El plugin de escritorio consulta WordPress para conocer el estado de la aprobación. Cuando llega la aprobación:

- el sitio aparece en la lista `Destinations` del escritorio
- el escritorio almacena localmente las credenciales de vinculación devueltas
- las acciones futuras de publicación y sincronización de medios pueden usar esa vinculación

## Publicar una Presentación

Una vez que un sitio esté vinculado:

1. Abra `WordPress Publish...` desde la presentación que desea publicar.
2. En `Destinations`, busque el sitio vinculado.
3. Haga clic en `Publish`.

El plugin de escritorio:

1. reconstruirá el manifiesto local de la presentación
2. preguntará a WordPress qué archivos faltan o cambiaron
3. subirá solo esos archivos
4. confirmará la publicación en el servidor

Cuando termine, el mensaje de estado incluye la URL final alojada cuando está disponible.

## Volver a Publicar una Presentación Actualizada

El botón normal de publicar también es el botón de actualización.

Si cambia una presentación localmente y vuelve a publicarla:

- los archivos sin cambios se omiten
- los archivos modificados o faltantes se suben
- la asignación del slug remoto se reutiliza para esa vinculación y ese slug local

Esto es publicación incremental, no una reimportación completa del ZIP cada vez.

## Sincronizar la Biblioteca de Medios Compartidos

Use esto cuando sus presentaciones alojadas dependan de contenido compartido `_media` y quiera que WordPress sirva los mismos archivos compartidos.

Desde la ventana de vinculación del escritorio:

1. Busque un destino vinculado.
2. Haga clic en `...`
3. Haga clic en `Sync Media Library`

El plugin de escritorio:

1. regenerará el archivo local compartido `_media/index.json`
2. construirá un manifiesto de la biblioteca compartida `_media`
3. preguntará a WordPress qué archivos faltan o cambiaron
4. subirá solo esos archivos
5. confirmará la sincronización y eliminará del servidor los archivos obsoletos

Esto es un espejo unidireccional de escritorio hacia WordPress.

## Habilitar Medios Compartidos Alojados en WordPress

Si quiere que los alias `media:` alojados se resuelvan desde la biblioteca compartida reflejada:

1. Vincule el sitio.
2. Ejecute `Sync Media Library` desde el plugin de escritorio.
3. En WordPress, abra `REVELation -> Settings`.
4. Habilite `Use Shared Media Library`.
5. Guarde los ajustes.

Cuando está habilitado, los alias `media:` alojados se resuelven desde:

- `wp-content/uploads/revelation-presentations/_shared_media`

en lugar de la carpeta local `_resources/_media` de cada presentación.

## Desvincular un Sitio

La desvinculación tiene dos lados.

### Quitarla de la aplicación de escritorio

En la ventana de vinculación del escritorio:

1. Busque el destino vinculado.
2. Haga clic en `...`
3. Haga clic en `Unpair`

Esto elimina el registro de vinculación local almacenado en la configuración del escritorio.

### Quitar la confianza en el servidor WordPress

En `WordPress Admin -> REVELation -> Settings`, en `Paired Instances`:

1. Busque la instancia de escritorio vinculada.
2. Haga clic en `Delete`

Esto elimina el registro de vinculación confiable del lado del servidor.

Para un reinicio completo, elimine la vinculación en ambos lados.

## Botón de Ayuda

La ventana de vinculación del escritorio incluye un botón `❔` en la esquina superior derecha. Abre este README en el visor de handout de REVELation.

## Solución de Problemas

### La vinculación queda pendiente y nunca se completa

Revise `REVELation -> Settings` en WordPress y confirme:

- que la solicitud aparece en `Pending Pairing Requests`
- que hizo clic en `Approve`
- que el código de un solo uso coincide con la ventana del escritorio

Si hace falta:

- rechace la solicitud anterior
- inicie la vinculación otra vez

### La vinculación desaparece después de cambiar ajustes

Las vinculaciones de escritorio se almacenan en la configuración del plugin. Si antes se encontró con el error antiguo de serialización de ajustes, vuelva a vincular una vez en una versión actual y la vinculación debería persistir correctamente.

### La vinculación por HTTPS falla

El cliente de escritorio valida los certificados TLS. La vinculación y la publicación pueden fallar si el certificado está:

- vencido
- autofirmado
- emitido para un nombre de host incorrecto
- sin una cadena válida

Corrija el certificado o use HTTP plano solo si acepta el riesgo de seguridad.

### La publicación falla con solicitud demasiado grande / HTTP 413

Esto normalmente significa que el servidor rechazó una solicitud de subida por límites de tamaño.

Revise:

- el ajuste de WordPress `Max Publish Upload Request (MB)`
- nginx `client_max_body_size`
- PHP `post_max_size`
- PHP `upload_max_filesize`

El plugin de escritorio también tiene una protección local previa a la subida y se detendrá antes si estima que un fragmento excede el tamaño de solicitud permitido.

### Los medios compartidos no aparecen en el sitio alojado

Revise todo lo siguiente:

- que `Sync Media Library` haya finalizado correctamente
- que `Use Shared Media Library` esté habilitado en los ajustes de WordPress
- que la presentación alojada realmente use alias `media:` que deban resolverse desde medios compartidos

### Aprobé el escritorio incorrecto

En WordPress:

1. Vaya a `REVELation -> Settings`
2. Elimine la instancia vinculada desde `Paired Instances`

Luego quite la vinculación local en la aplicación de escritorio y vuelva a vincular con la máquina correcta.

## Referencia Técnica

## Puntos de Entrada para el Usuario

### Interfaz de escritorio

- menú contextual de la lista de presentaciones: `WordPress Publish...`
- ventana de vinculación/publicación:
  - listar destinos vinculados
  - vincular un sitio nuevo
  - publicar la presentación actual
  - sincronizar medios compartidos
  - desvincular destino

### Interfaz de WordPress

- `WP Admin -> REVELation -> Settings`
  - ayuda para copiar la URL de vinculación de escritorio
  - aprobación/rechazo de solicitudes pendientes de vinculación
  - eliminación de clientes vinculados
  - ajustes de subida, medios y runtime

## Rutas Alojadas

El plugin de WordPress sirve presentaciones desde:

- `/_revelation/{slug}`
- `/_revelation/{slug}/embed`

El archivo Markdown puede elegirse con:

- `?p=relative/path/to/file.md`

El shortcode de WordPress es:

- `[revelation slug="my-slug" md="presentation.md" embed="1"]`

## Endpoints REST

- `POST /wp-json/revelation/v1/pair/challenge`
- `POST /wp-json/revelation/v1/pair`
- `POST /wp-json/revelation/v1/pair/status`
- `POST /wp-json/revelation/v1/publish/check`
- `POST /wp-json/revelation/v1/publish/file`
- `POST /wp-json/revelation/v1/publish/commit`
- `POST /wp-json/revelation/v1/media-sync/check`
- `POST /wp-json/revelation/v1/media-sync/file`
- `POST /wp-json/revelation/v1/media-sync/commit`

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

## Flujo de Publicación

1. El escritorio regenera `manifest.json` local.
2. El escritorio llama a `/publish/check` con el manifiesto local y las credenciales de vinculación.
3. WordPress resuelve el slug remoto para esa vinculación y slug local.
4. WordPress devuelve solo los archivos cambiados o faltantes.
5. El escritorio sube los archivos necesarios mediante `/publish/file`.
6. El escritorio llama a `/publish/commit`.
7. WordPress actualiza el manifiesto/índice de la presentación alojada y devuelve la URL alojada.

## Flujo de Sincronización de Medios Compartidos

1. El escritorio regenera `_media/index.json` local.
2. El escritorio construye un manifiesto de medios compartidos.
3. El escritorio llama a `/media-sync/check`.
4. WordPress devuelve solo los archivos de medios compartidos cambiados o faltantes.
5. El escritorio sube los archivos necesarios mediante `/media-sync/file`.
6. El escritorio llama a `/media-sync/commit`.
7. WordPress actualiza el espejo de medios compartidos y elimina los archivos obsoletos.

## Reglas de Asignación de Slug Remoto

- WordPress puede renombrar el slug remoto para evitar conflictos.
- La asignación se conserva por vinculación y slug local.
- El mismo escritorio vinculado que vuelve a publicar el mismo slug local reutiliza el mismo slug remoto.
- Distintos escritorios vinculados pueden publicar el mismo slug local sin sobrescribirse entre sí.

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

## Ajustes de WordPress Relevantes

- `reveal_remote_url`
- `max_zip_mb`
- `max_publish_request_mb`
- `allow_embed`
- `show_splash_screen`
- `use_db_index`
- `use_shared_media_library`
- `allowed_extensions`
- `enabled_runtime_plugins`

## Plugins de Runtime Alojado en WordPress

El catálogo integrado actual de plugins de runtime alojado incluye:

- `highlight`
- `markerboard`
- `slidecontrol`
- `revealchart`
- `credit_ccli`

Estos se habilitan globalmente para todas las presentaciones alojadas que renderiza el plugin de WordPress.

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
- WordPress aplica comprobaciones de marca de tiempo y nonce para reducir ataques de repetición.
- HTTPS usa validación TLS normal en el cliente de escritorio.
- Se permiten sitios solo HTTP, pero no existe seguridad de transporte.

## Limitaciones Actuales

- No hay una interfaz de resolución de conflictos en el escritorio más allá del comportamiento actual basado en manifiestos.
- La sincronización de medios compartidos es unidireccional, de escritorio a WordPress.
- La configuración de plugins de runtime alojado es global en WordPress, no por presentación.
