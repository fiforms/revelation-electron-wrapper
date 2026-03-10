# Plugin wordpress_publish

`wordpress_publish` es el plugin de escritorio de REVELation para vincularse con un sitio de WordPress y publicar presentaciones más tarde.

Alcance actual: vinculación y publicación incremental.

## Guía de vinculación para usuarios (paso a paso)

1. Instale y active el plugin de WordPress `revelation-presentations` en su sitio de WordPress.
2. En el panel de administración de WordPress, abra `REVELation -> Settings`.
3. Copie la URL de vinculación de escritorio que aparece allí (por ejemplo: `https://your-site.com/wp-json/revelation/v1/pair`) o anote la URL base del sitio.
4. En REVELation Desktop, abra su lista de presentaciones.
5. Haga clic derecho sobre cualquier tarjeta de presentación.
6. Haga clic en `WordPress Publish: Pair Site…`.
7. En la ventana de vinculación, pegue la URL de WordPress.
8. Haga clic en `Pair Site`.
9. REVELation muestra un código de un solo uso y entra en estado pendiente.
10. En WordPress Admin `REVELation -> Settings`, revise los detalles de la solicitud pendiente:
   - IP de la solicitud
   - nombre de host declarado
   - nombre de la app / ID de instancia declarados
   - código de un solo uso
11. Haga clic en `Approve` para confiar en esa instancia (o en `Reject` para denegarla).
12. REVELation completa la vinculación después de la aprobación y el sitio aparece en `Paired Sites`.
13. Haga clic en `Publish` junto a un destino vinculado para enviar la presentación seleccionada actualmente.

Para desvincular:
- En REVELation: abra `...` y haga clic en `Unpair` en la ventana de vinculación del plugin (eliminación local).
- En WordPress: elimine la instancia vinculada de la tabla `Paired Instances` (eliminación de confianza del lado del servidor).

## Resumen del protocolo

La vinculación usa únicamente desafío-respuesta con RSA.

### Endpoints

- `POST /wp-json/revelation/v1/pair/challenge`
- `POST /wp-json/revelation/v1/pair`
- `POST /wp-json/revelation/v1/pair/status`
- `POST /wp-json/revelation/v1/publish/check`
- `POST /wp-json/revelation/v1/publish/file`
- `POST /wp-json/revelation/v1/publish/commit`

### Flujo

1. El escritorio solicita un desafío de un solo uso a WordPress (`/pair/challenge`).
2. WordPress devuelve:
   - `challenge`
   - `expiresInSeconds`
   - `siteName`
   - `siteUrl`
3. El escritorio firma `challenge` con su clave privada RSA local existente (`config.rsaPrivateKey`).
4. El escritorio envía el payload de `/pair`:
   - `auth.method = "rsa"`
   - `auth.challenge`
   - `auth.signature` (base64)
   - `auth.publicKey` (clave pública RSA PEM del escritorio)
   - metadatos de identidad `client` (`appName`, `appInstanceId`, `appVersion`, `appPublicKey`)
5. WordPress verifica la firma usando OpenSSL y la clave pública proporcionada.
6. Si es válida, WordPress crea una solicitud de vinculación **pendiente** con un código de un solo uso.
7. Un administrador de WordPress aprueba o rechaza la solicitud en la interfaz de ajustes.
8. El escritorio consulta `/pair/status` periódicamente (firmado con la clave RSA) hasta que sea aprobada o rechazada.
9. Cuando se aprueba, WordPress devuelve:
   - `pairingId`
   - `publishToken`
   - `publishEndpoint` (marcador de posición para una futura implementación de publicación)
   - `siteName`, `siteUrl`

### Datos locales almacenados por el escritorio

El escritorio almacena las vinculaciones en la configuración del plugin en:

- `config.pluginConfigs.wordpress_publish.pairings[]`

Cada registro de vinculación incluye:

- `siteBaseUrl`
- `siteName`
- `siteUrl`
- `pairingId`
- `publishEndpoint`
- `publishToken`
- `authMode` (`rsa`)
- `pairedAt`
- `localPublicKeyFingerprint`

### Notas de seguridad

- No hay modo de clave precompartida habilitado.
- Los desafíos son de un solo uso y de corta duración (transient de WordPress).
- La vinculación requiere aprobación explícita de un administrador de WordPress antes de otorgar confianza.
- La clave privada nunca sale del escritorio.
- La verificación de firmas ocurre en el servidor de WordPress.
- Las solicitudes de publicación ahora requieren tanto el token de publicación de larga duración como una firma RSA de la clave del escritorio vinculado, junto con comprobaciones de marca de tiempo y nonce para reducir el riesgo de repetición.
- Las solicitudes HTTPS del escritorio dependen de la validación del certificado TLS; certificados inválidos, autofirmados o con nombre no coincidente hacen fallar la vinculación/publicación, a menos que el sitio use HTTP plano.
- Se permiten sitios de WordPress solo con HTTP, pero la interfaz del escritorio muestra una advertencia antes de vincular o publicar porque no existe seguridad de transporte.

## Flujo de publicación

1. El escritorio regenera `manifest.json` local antes de publicar.
2. El escritorio llama a `/publish/check` con:
   - `pairingId`
   - `publishToken`
   - `localSlug`
   - el manifiesto local completo
3. WordPress resuelve la asignación de slug por par (`pairing + localSlug -> remoteSlug`) y devuelve solo los archivos cambiados o faltantes.
4. El escritorio sube únicamente los archivos necesarios mediante `/publish/file`.
5. El escritorio llama a `/publish/commit` para finalizar las actualizaciones del manifiesto/índice.

### Reglas de asignación de slug

- WordPress puede renombrar silenciosamente el slug remoto para evitar conflictos.
- La asignación se conserva por vinculación y slug local.
- El mismo par + el mismo slug local publica en el mismo slug remoto.
- Diferentes pares pueden publicar slugs locales idénticos sin sobrescribirse entre sí.

## Aún no implementado

- UX de conflicto/fusión en la interfaz de escritorio (actualmente automático solo según marcas de tiempo del manifiesto).

## Protección de tamaño de subida

- El escritorio comprueba cada archivo antes de subirlo usando un tamaño estimado de solicitud JSON.
- El escritorio usa primero el límite anunciado por el servidor desde `/publish/check` (`serverMaxUploadRequestBytes`) cuando está disponible.
- Si el servidor no proporciona un límite, el escritorio usa el valor predeterminado de `921600` bytes (aproximadamente `900 KB`) por solicitud `/publish/file`.
- Clave de configuración: `config.pluginConfigs.wordpress_publish.maxUploadRequestBytes`
- Configure `maxUploadRequestBytes` en `0` para desactivar la protección previa a la subida.
- Si un archivo supera el límite, el escritorio muestra un error claro antes de subirlo y sugiere aumentar:
  - nginx `client_max_body_size`
  - PHP `post_max_size`
  - PHP `upload_max_filesize`
