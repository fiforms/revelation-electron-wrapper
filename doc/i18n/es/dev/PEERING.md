# Emparejamiento y descubrimiento

El emparejamiento (peering) es un mecanismo potente que permite que una instancia "maestra" envíe una presentación
simultáneamente a múltiples instancias "seguidoras". Las otras instancias pueden reflejar la
pantalla principal del presentador, mostrar notas o versiones de tercio inferior (lower-thirds),
permitir distintas relaciones de aspecto para streaming, o mostrar la presentación en diferentes idiomas.

El emparejamiento primero debe habilitarse en "Settings" (Configuración) tanto en las instancias maestras como en las seguidoras, y
el modo "network" debe habilitarse al menos en la instancia maestra.

La pantalla de emparejamiento muestra las instancias disponibles en la red local. Para que el emparejamiento funcione,
todas las instancias deben estar conectadas a la misma red local. Probablemente no funcione en
WiFi pública u otras configuraciones que "aíslan a los clientes".

---

El emparejamiento siempre se inicia desde el "seguidor" hacia el "maestro". Debes conocer el
PIN de emparejamiento del maestro (disponible en el diálogo de información de la pantalla principal). El PIN solo se necesita
para emparejar: después, el seguidor se identifica con su propia clave, así que cambiar el PIN
en el maestro no desconecta a los seguidores que ya están emparejados. Para revocar a un seguidor,
usa **Forget** (Olvidar) en la lista **Settings → Peer Pairing → Paired Followers** del maestro.

A continuación hay una referencia más técnica de cómo funciona el protocolo.

---

## Tabla de contenidos
* [Cambios desde el protocolo 1.0 (guía de migración)](#dev-peering-migration)
* [Resumen en lenguaje simple](#dev-peering-overview)
* [Roles y transporte](#dev-peering-roles)
* [Descubrimiento (mDNS)](#dev-peering-discovery)
* [Protocolo de emparejamiento](#dev-peering-pairing)
* [Solicitudes autenticadas del seguidor](#dev-peering-follower-auth)
* [Canal de comandos peer](#dev-peering-commands)
* [Construcción de firmas](#dev-peering-signatures)
* [Persistencia y modelo de datos](#dev-peering-persistence)
* [Lista de verificación de compatibilidad](#dev-peering-compatibility)
* [Modelo de seguridad y supuestos](#dev-peering-security)
* [Recomendaciones de endurecimiento](#dev-peering-hardening)
* [Solución de problemas](#dev-peering-troubleshooting)

Relacionado: [Ejecutar un relay público](PUBLIC_RELAY.md) — alojar el relay de sockets en un servidor público.

---

<a id="dev-peering-migration"></a>

## Cambios desde el protocolo 1.0 (guía de migración)

"Protocolo 1.0" significa el protocolo sin versión publicado hasta la versión 1.0.10 de la aplicación. La versión 1.0.12 introduce el **protocolo v2**. (Existió un "v1" intermedio solo durante el desarrollo de 1.0.11 y nunca se publicó, así que puedes ignorarlo.) Las dos versiones no son interoperables, y **todo emparejamiento existente debe rehacerse una vez**.

---

**Lado del maestro (servidor):**

| Cambio | Qué hacer | Detalles |
|---|---|---|
| Se anuncia la versión | Agrega `"peerProtocol": 2` a `GET /peer/public-key`. | [Obtener identidad](#dev-peering-pairing) |
| Par de claves peer separado | Firma con un par de claves usado solo para el emparejamiento. `publicKey` en `/peer/public-key` y `pubKeyFingerprint` en el TXT de mDNS deben ser esa clave. No reutilices la clave de WordPress. | [Resumen](#dev-peering-overview) |
| Firmas con separación de dominio | Deja de firmar desafíos y payloads de socket en crudo. Firma `prefix + hex(sha256(...))` en su lugar. | [Construcción de firmas](#dev-peering-signatures) |
| Nuevo: `POST /peer/pair` | Este es ahora el único endpoint que verifica el PIN (con el bloqueo). Guarda `followerInstanceId` y `followerPublicKey` del seguidor. | [Inscribirse con el PIN](#dev-peering-pairing) |
| Nuevo: `GET /peer/auth-nonce` | Emite nonces de un solo uso que expiran en 60 segundos. | [Solicitudes autenticadas del seguidor](#dev-peering-follower-auth) |
| `POST /peer/challenge` cambió | Sin PIN. Exige una firma del seguidor (`purpose` `challenge`). | [Verificación de identidad](#dev-peering-follower-auth) |
| `/peer/socket-info` cambió | `GET ?pin=` pasa a `POST` con una firma del seguidor (`purpose` `socket-info`). Registra a qué seguidor se emitió cada token. | [Bootstrap](#dev-peering-commands) |
| Handshake del socket | Acepta solo tokens que tú emitiste. Toma la identidad del seguidor del token, no de `auth.instanceId`. Rechaza a los seguidores que ya no están emparejados. | [Conexión Socket.IO](#dev-peering-commands) |
| Códigos de error | Devuelve `{ error, code }` usando los códigos de la tabla. | [Protocolo de emparejamiento](#dev-peering-pairing) |
| Revocación | Ofrece una forma de olvidar a un seguidor y desconecta sus sockets cuando lo hagas. Cambiar el PIN no debe afectar a los seguidores emparejados. | [Modelo de seguridad](#dev-peering-security) |

---

**Lado del seguidor (cliente):**

| Cambio | Qué hacer | Detalles |
|---|---|---|
| Verificación de versión | Rechaza emparejar a menos que `peerProtocol` sea `2`. | [Obtener identidad](#dev-peering-pairing) |
| Par de claves propio | Ten un `instanceId` estable y un par de claves RSA (de al menos 2048 bits) para el emparejamiento. | [Inscribirse con el PIN](#dev-peering-pairing) |
| Emparejar con `POST /peer/pair` | Reemplaza el emparejamiento mediante `/peer/challenge` con un PIN. Envía tu clave pública y verifica la firma del maestro bajo el dominio de desafío. | [Inscribirse con el PIN](#dev-peering-pairing) |
| No guardes el PIN | Olvídalo cuando el emparejamiento tenga éxito. | [Persistencia](#dev-peering-persistence) |
| Firma cada solicitud posterior | Obtén un nonce y luego firma `purpose`, `masterId`, `followerId`, `nonce` y `extra` bajo el dominio follower-auth. | [Solicitudes autenticadas del seguidor](#dev-peering-follower-auth) |
| Verifica bajo los nuevos dominios | Las firmas del maestro en desafíos y en la información de socket tienen separación de dominio. | [Construcción de firmas](#dev-peering-signatures) |
| Deja de reintentar al ser rechazado | Con `not-paired`, `invalid-signature`, `invalid-pin` o `pin-lockout`, detente y pide al usuario que empareje de nuevo. En 1.0 un PIN obsoleto se reintentaba cada 10 segundos y seguía bloqueando la IP del seguidor. | [Protocolo de emparejamiento](#dev-peering-pairing) |
| Re-emparejar los emparejamientos existentes | El `publicKey` de un maestro cambió junto con su par de claves, así que una clave fijada bajo 1.0 ya no se verifica. | [Persistencia](#dev-peering-persistence) |

---

**Eliminados:** `GET /peer/socket-info`, el campo `pin` en `/peer/challenge` y `POST /peer/command`. Este último era solo el despacho local de este wrapper, nunca parte del protocolo wire, así que otras implementaciones no necesitan reemplazarlo.

**Sin cambios:**
- el tipo de servicio mDNS y los campos TXT;
- la ruta de Socket.IO `/peer-commands`;
- el evento `peer-command` y sus payloads;
- la tupla `token:expiresAt:socketPath` (aunque ahora se firma bajo el dominio socket);
- el formato del desafío (base64 de 32 bytes aleatorios).

---

<a id="dev-peering-overview"></a>

## Resumen

El emparejamiento permite que una instancia del wrapper REVELation (el "maestro") abra/cierre remotamente una presentación en otra instancia (el "seguidor").

En tiempo de ejecución, el sistema usa:
- mDNS (`bonjour-service`) para el descubrimiento en la LAN.
- HTTP en el puerto Vite del wrapper para los endpoints de emparejamiento y de bootstrap de comandos (HTTPS cuando `httpsEnabled` está activado).
- Socket.IO para los comandos peer continuos.
- Firmas RSA-2048 (SHA-256) para las verificaciones de identidad desafío-respuesta y la firma de payloads de autenticación de socket de corta duración.
- Un PIN de emparejamiento compartido, usado una vez por seguidor para autorizar la inscripción.
- Claves del seguidor: tras la inscripción el maestro conoce la clave pública de cada seguidor, y el seguidor firma cada solicitud con ella.

Versión actual del protocolo peer: **2** (anunciada como `peerProtocol` por `/peer/public-key`).

---

Resumen de la dirección del protocolo:
- Los nodos maestros anuncian por mDNS y exponen puntos de emparejamiento mediante un protocolo HTTP.
- El emparejamiento se inicia desde el "seguidor" hacia el "maestro". El "seguidor" actúa como cliente y llama a los endpoints HTTP (servidor vite) del peer candidato (ejecutándose en el puerto `viteServerPort`, típicamente 8000).
- Dirección de los comandos: los seguidores mantienen conexiones Socket.IO salientes hacia cada maestro emparejado y reciben eventos peer-command mediante el endpoint Socket.IO del servidor Vite (/peer-commands, también en `viteServerPort`).

---

> **Nota específica de la implementación:** En este wrapper Electron, el anuncio y la disponibilidad de los endpoints dependen de la configuración local (`mdnsPublish`) y del modo de inicio (`network`).

---

Puertos:
- El anuncio de descubrimiento incluye `pairingPort`, actualmente igual a `viteServerPort`.
- Los endpoints de emparejamiento (`/peer/*`) se sirven por HTTP.

---

> **Nota específica de la implementación:** En este wrapper Electron, `/peer/*` se aloja en el servidor Vite (`viteServerPort`, típicamente 8000), y está totalmente deshabilitado a menos que `mdnsPublish === true`. Reveal Remote se ejecuta en el mismo servidor Vite (sin puerto separado).

---

Almacenamiento de claves y secretos:
- Cada instancia tiene un par de claves RSA peer (`peerRsaPublicKey` / `peerRsaPrivateKey`), separado del par de claves de WordPress (`rsaPublicKey` / `rsaPrivateKey`). Como maestro prueba su identidad ante los seguidores con él; como seguidor prueba su identidad ante los maestros con él.
- Los maestros guardan el PIN (`mdnsPairingPin`) en la configuración de Electron y los seguidores inscritos en `peer-followers.json`. Los seguidores guardan sus maestros emparejados (`pairedMasters`) en la configuración de Electron. Los seguidores **no** guardan el PIN.
- Las claves privadas son de larga duración y se reutilizan entre ejecuciones a menos que se reemplace la configuración. El seguidor se niega a conectar si el maestro no puede firmar con la clave fijada al emparejar. El maestro rechaza a un seguidor cuya clave no está en su lista.

---

<a id="dev-peering-roles"></a>

## Roles y transporte

Terminología usada por la implementación:
- `master`: un nodo emparejado al que un seguidor escucha para recibir comandos peer.
- `follower`: nodo local que ejecuta comandos de los maestros emparejados.
- `instanceId`: identificador hexadecimal aleatorio estable por instalación (16 caracteres hex; 8 bytes aleatorios).

---

Resumen del transporte:
- Tipo de servicio mDNS: `revelation`
- Endpoints de emparejamiento/autenticación: HTTP JSON
- Canal de comandos en tiempo real: Socket.IO en la ruta `/peer-commands`

---

<a id="dev-peering-discovery"></a>

## Descubrimiento (mDNS)

Comportamiento del protocolo:
- Los peers se descubren mediante el tipo de servicio mDNS `revelation`.
- Las instancias pueden anunciar metadatos usando los campos TXT de mDNS listados abajo.

---

> **Nota específica de la implementación:** En este wrapper Electron, browse/publish se controlan con `mdnsBrowse`/`mdnsPublish`, el explorador se actualiza cada 15 segundos y los autoanuncios se ignoran por `instanceId`.

---

Detalles de la publicación del servicio:
- Tipo de servicio: `revelation`
- Nombre del servicio: `mdnsInstanceName` (predeterminado `${username}@${hostname}`)
- Host: `${os.hostname()}.local` (a menos que ya termine en `.local`)
- Puerto: `viteServerPort`
- `disableIPv6: true`

---

Payload TXT publicado:
- `instanceId`
- `mode`
- `version`
- `hostname`
- `pairingPort`
- `pubKeyFingerprint` (`sha256(publicKeyPem)` en hex, de la clave pública peer)
- `httpsEnabled` (`"true"` / `"false"`)

---

> **Nota específica de la implementación:** La selección del host prefiere la primera dirección IPv4 descubierta y recurre a `service.host`. Los IDs de instancia emparejados previamente se reverifican en el evento mDNS `up` mediante `/peer/challenge` (autenticado por el seguidor, ver abajo) antes de aceptarlos como en línea.

---

<a id="dev-peering-pairing"></a>

## Protocolo de emparejamiento

El emparejamiento es HTTP JSON sobre `http://<peerHost>:<pairingPort>` (o `https://` cuando el maestro anuncia `httpsEnabled=true`).

> **Nota específica de la implementación:** En este wrapper Electron, los endpoints de emparejamiento solo están disponibles cuando el peer destino tiene `mdnsPublish === true`.

---

Las respuestas de error son JSON `{ "error": "<message>", "code": "<code>" }`. Los valores de `code` que un seguidor debe manejar:

| HTTP | `code` | Significado | El seguidor debe |
|---|---|---|---|
| 403 | `invalid-pin` | PIN incorrecto en la inscripción. Incluye `remainingAttempts`. | Preguntar de nuevo al usuario. |
| 429 | `pin-lockout` | Demasiados PIN incorrectos desde esta IP. Incluye `retryAfterSec`. | Esperar y luego preguntar de nuevo al usuario. |
| 503 | `pairing-unavailable` | El maestro no tiene un PIN configurado. | Informar al usuario. |
| 403 | `not-paired` | El maestro no tiene registro de este seguidor (olvidado, o nunca emparejado). | **Dejar de reintentar.** Marcar el emparejamiento como que necesita re-emparejarse. |
| 403 | `invalid-signature` | La firma del seguidor no coincide con la clave que el maestro tiene para él. | **Dejar de reintentar.** Marcar el emparejamiento como que necesita re-emparejarse. |
| 401 | `invalid-nonce` | Nonce expirado, reutilizado o falsificado. | Obtener un nonce nuevo y reintentar. |
| 403 | `master-disabled` | El modo maestro está desactivado en esa máquina. | Reintentar más tarde. |

---

Los seguidores no deben reintentar automáticamente ante `invalid-pin`, `pin-lockout`, `not-paired` o `invalid-signature`. Reintentar no puede tener éxito, y reintentar un PIN bloquea la IP.

---

### 1) Obtener identidad

`GET /peer/public-key`

Respuesta:
```json
{
  "instanceId": "<string>",
  "instanceName": "<string>",
  "hostname": "<string>",
  "peerProtocol": 2,
  "publicKey": "-----BEGIN PUBLIC KEY-----...",
  "publicKeyFingerprint": "<sha256 hex>"
}
```

---

Reglas de validación:
- Verifica que los campos de la respuesta necesarios para la selección de confianza estén presentes y sean consistentes.
- Rechaza emparejar a menos que `peerProtocol` sea `2`.

> **Nota específica de la implementación:** Este wrapper exige que el hostname TXT descubierto coincida (cuando está presente) y luego elige el ID del maestro por prioridad: `instanceId` de la respuesta, `peer.instanceId` descubierto y después `peer.txt.instanceId` descubierto.

---

### 2) Inscribirse con el PIN

Esta es la única solicitud que lleva el PIN. El seguidor envía su propia clave pública peer y el maestro la guarda. El seguidor también envía un desafío para confirmar que el maestro posee la clave privada correspondiente al `publicKey` del paso 1.

El cliente genera el desafío como base64 de 32 bytes aleatorios.

`POST /peer/pair`

---

Solicitud:
```json
{
  "pin": "<pairing pin>",
  "challenge": "<base64 random>",
  "followerInstanceId": "<follower instanceId>",
  "followerName": "<display name>",
  "followerPublicKey": "-----BEGIN PUBLIC KEY-----..."
}
```

---

Respuesta:
```json
{
  "signature": "<base64 RSA-SHA256 signature, challenge domain>",
  "peerProtocol": 2,
  "instanceId": "<master instanceId>",
  "instanceName": "<master name>"
}
```

---

Reglas del lado del servidor:
- Si no hay PIN configurado, rechaza con `503 pairing-unavailable`. La verificación falla de forma cerrada.
- `pin` debe coincidir exactamente. Un PIN incorrecto devuelve `403 invalid-pin`. Tres fallos desde una IP bloquean esa IP por 60 segundos (`429 pin-lockout`).
- `followerInstanceId` debe coincidir con `^[A-Za-z0-9_-]{1,128}$`.
- `followerPublicKey` debe ser una clave pública RSA (SPKI PEM) de al menos 2048 bits.
- El seguidor se guarda por `followerInstanceId`. Emparejar de nuevo reemplaza la clave guardada y desconecta las sesiones hechas con la anterior.

---

Regla de verificación en el cliente:
- Verifica `signature` sobre `challenge` usando el dominio de desafío (ver [Construcción de firmas](#dev-peering-signatures)).
- La clave pública usada para la verificación es:
1. el `pairedMasters[n].peerPublicKey` almacenado existente para el mismo `instanceId`, o si no,
2. el `publicKey` de la respuesta de `/peer/public-key`.
- No guardes el PIN.

---

### 3) Persistir el maestro emparejado

> **Nota específica de la implementación:** Este wrapper persiste los maestros emparejados en la configuración local (`pairedMasters`) con campos como `instanceId`, `peerPublicKey`, `peerProtocol`, `name`, `pairedAt`, `hostHint`, `pairingPortHint`, `httpsEnabled` y `natCompatibility`. También mantiene una caché de tiempo de ejecución (`pairedPeerCache`) y elimina ambas entradas al desemparejar.

---

<a id="dev-peering-follower-auth"></a>

## Solicitudes autenticadas del seguidor

Después de la inscripción, cada solicitud del seguidor se firma con la clave privada peer del seguidor sobre un nonce emitido por el maestro. No se envía ningún PIN.

### Obtener un nonce

`GET /peer/auth-nonce` (sin autenticación)

Respuesta:
```json
{ "nonce": "<opaque string>", "expiresAt": 1700000000000 }
```

Trata `nonce` como opaco. Es válido por 60 segundos, medidos con el reloj del maestro, y puede usarse una sola vez. Solo importa el reloj del maestro, así que el desfase del reloj del seguidor no causa fallos.

---

### Firmar la solicitud

El seguidor firma estos campos con su clave privada peer:
- `purpose`: `socket-info` o `challenge`
- `masterId`: el `instanceId` del maestro, de modo que una firma hecha para un maestro es inútil en otro
- `followerId`: el `instanceId` del seguidor
- `nonce`: obtenido de `/peer/auth-nonce`
- `extra`: el desafío para `challenge`, cadena vacía para `socket-info`

La construcción exacta de bytes está en [Construcción de firmas](#dev-peering-signatures). El cuerpo de la solicitud entonces lleva:
```json
{
  "followerInstanceId": "<follower instanceId>",
  "nonce": "<nonce>",
  "signature": "<base64>"
}
```
más los campos específicos de cada endpoint.

---

Reglas del lado del servidor, verificadas en este orden:
1. `followerInstanceId` es un seguidor conocido, si no `403 not-paired`.
2. `nonce` es auténtico, no ha expirado y no se ha usado, si no `401 invalid-nonce`.
3. `signature` se verifica con la clave guardada del seguidor, si no `403 invalid-signature`.
4. El nonce se marca como usado.

Estos fallos no cuentan para el bloqueo por PIN, porque no se está adivinando nada.

---

### Verificación de identidad: `POST /peer/challenge`

Lo usan los seguidores para reverificar a un maestro emparejado cuando mDNS lo redescubre.

Solicitud (autenticada por el seguidor, `purpose` `challenge`, `extra` = `challenge`):
```json
{
  "challenge": "<base64 random>",
  "followerInstanceId": "...",
  "nonce": "...",
  "signature": "..."
}
```

Respuesta:
```json
{ "signature": "<base64 RSA-SHA256 signature, challenge domain>", "peerProtocol": 2 }
```

El seguidor verifica `signature` con el `peerPublicKey` fijado.

---

<a id="dev-peering-commands"></a>

## Canal de comandos peer

Los seguidores se conectan de forma saliente a los maestros emparejados y reciben eventos `peer-command`.

> **Nota específica de la implementación:** Este wrapper actualiza las conexiones de los seguidores cada 10 segundos y exige `mdnsPublish === true` en el destino para los endpoints de bootstrap/fan-out. Los emparejamientos marcados como que necesitan re-emparejarse se omiten por completo: no se hacen solicitudes a ese maestro hasta que el usuario empareje de nuevo.

---

### Bootstrap: información de socket firmada

El seguidor solicita (autenticado por el seguidor, `purpose` `socket-info`, `extra` vacío):

`POST /peer/socket-info`

```json
{
  "followerInstanceId": "...",
  "nonce": "...",
  "signature": "..."
}
```

---

Respuesta:
```json
{
  "socketUrl": "http://<host>:<port>",
  "socketPath": "/peer-commands",
  "token": "<hex 16 random bytes>",
  "expiresAt": 1700000000000,
  "signature": "<base64 RSA-SHA256 signature>"
}
```

---

Formato del payload firmado:
- `"${token}:${expiresAt}:${socketPath}"`, firmado bajo el dominio socket

El seguidor verifica `signature` con la clave pública almacenada del maestro antes de conectar.

El maestro registra a qué seguidor se emitió cada token. Un token puede reutilizarse hasta que expire (60 segundos), de modo que la reconexión automática de Socket.IO funciona ante caídas breves de red.

---

### Conexión Socket.IO

El seguidor se conecta a `socketUrl` con la ruta `/peer-commands` y este payload de autenticación:
```json
{
  "token": "...",
  "expiresAt": 1700000000000,
  "signature": "...",
  "instanceId": "<followerInstanceId>",
  "instanceName": "<display name>",
  "hostname": "<display label>"
}
```

---

Validación del handshake en el servidor:
- Requiere `token`, `expiresAt`, `signature`.
- `token` debe haber sido emitido por `/peer/socket-info`, con el mismo `expiresAt`, y no debe haber expirado.
- Verifica la firma sobre `"${token}:${expiresAt}:/peer-commands"` usando la clave pública configurada localmente.
- El seguidor al que se emitió el token debe seguir emparejado.
- La identidad del seguidor viene del token, no de `instanceId` en el payload de autenticación. `instanceName` y `hostname` son solo etiquetas de visualización.

Los errores de handshake llevan `err.data.code`, con los mismos códigos que los endpoints HTTP más `expired` y `missing-auth`. Ante `not-paired`, detente y marca el emparejamiento como que necesita re-emparejarse.

Cuando un seguidor es olvidado en el maestro, el maestro desconecta sus sockets. La siguiente solicitud `socket-info` del seguidor recibe `not-paired`.

---

### Fan-out de comandos

El maestro emite un evento `peer-command` a cada socket de seguidor conectado. Solo los seguidores inscritos pueden conectarse, así que eso significa todos los seguidores emparejados. Cómo la propia interfaz de un maestro entrega un comando a su servidor de sockets depende de cada implementación y no forma parte del protocolo wire.

> **Nota específica de la implementación:** En este wrapper, el proceso principal de Electron envía `{ type: "peer-command", command }` al proceso utilitario de Vite mediante `parentPort` (`sendPeerCommand()` en `lib/peerCommandClient.js`), y la respuesta lleva cualquier error. Deliberadamente **no hay endpoint HTTP** para esto. Antes de 1.0.11 era `POST /peer/command`, restringido a llamadores loopback. Pero una verificación de loopback no puede impedir que una página web abierta en un navegador de la misma máquina haga POST a `127.0.0.1`, así que cualquier sitio podría enviar presentaciones a todos los seguidores. Una implementación compatible que conserve un endpoint HTTP para esto debería exigir un secreto que el navegador no pueda conocer, no solo una dirección loopback.

---

Payloads de comando:
```json
{
  "command": {
    "type": "open-presentation",
    "payload": {
      "url": "<share URL>"
    }
  }
}
```

---

o

```json
{
  "command": {
    "type": "close-presentation",
    "payload": {}
  }
}
```

---

Reglas:
- Se rechaza a menos que el modo maestro esté activado (`mdnsPublish === true`).
- `command.type` debe ser una cadena no vacía.
- Emite el evento `peer-command` a todos los sockets peer conectados.

> **Nota específica de la implementación:** Este wrapper maneja `open-presentation` abriendo la URL en ventanas de presentación (incluidas pantallas adicionales), maneja `close-presentation` cerrándolas y `navigate-slide` controlando la diapositiva, y entrega cualquier otro tipo de comando a `AppContext.pluginPeerCommandHandlers` (punto de extensión para plugins) antes de ignorarlo.

---

<a id="dev-peering-signatures"></a>

## Construcción de firmas

Todas las firmas son RSA-SHA256 (PKCS#1 v1.5), codificadas en base64. Lo que se firma nunca son los bytes del llamador: es una cadena ASCII formada por un prefijo de dominio y un digest SHA-256 en hex. Así, una firma hecha para un propósito no tiene significado para ningún otro propósito o protocolo.

| Uso | Firmante | Mensaje firmado |
|---|---|---|
| Desafío (`/peer/pair`, `/peer/challenge`) | maestro | `"revelation-peer-challenge:v1:" + hex(sha256(utf8(challenge)))` |
| Bootstrap de socket (`/peer/socket-info`) | maestro | `"revelation-peer-socket:v1:" + hex(sha256(utf8(token + ":" + expiresAt + ":" + socketPath)))` |
| Autenticación del seguidor | seguidor | `"revelation-peer-follower-auth:v2:" + hex(sha256(utf8(purpose + "\n" + masterId + "\n" + followerId + "\n" + nonce + "\n" + extra)))` |

---

El dominio follower-auth importa porque una instancia puede ser a la vez maestro y seguidor con un único par de claves peer. Sin él, sus firmas de desafío podrían hacerse pasar por autenticación de seguidor.

Estas construcciones se implementan una sola vez, en `revelation/server/peer-protocol.js` (solo el `crypto` de Node). El maestro (`revelation/server/peer-server.js`) lo requiere directamente; el `lib/peerAuth.js` del wrapper lo reexporta, cargado mediante `lib/revelationModules.js` desde la carpeta `revelation/` incluida. No hay una segunda copia que mantener sincronizada. Las pruebas de respuesta conocida en `revelation/tests/unit/peer-protocol.test.cjs` fijan las cadenas exactas, de modo que un cambio en el formato wire no pase desapercibido.

---

<a id="dev-peering-persistence"></a>

## Persistencia y modelo de datos

> **Sección específica de la implementación:** Las siguientes claves y esquemas describen el modelo de almacenamiento local de este wrapper Electron, no campos on-wire requeridos por el protocolo.

---

Claves de configuración relevantes para el emparejamiento:
- `mode`: `network` habilita el enlace del servidor a la LAN; `localhost` no publica.
- `mdnsBrowse`: controla si este nodo explora peers y si se permite el emparejamiento del lado seguidor y el comportamiento de comandos peer.
- `mdnsPublish`: controla si este nodo se anuncia en modo `network` y si los endpoints locales `/peer/*` están habilitados.
- `mdnsInstanceName`: nombre anunciado.
- `mdnsInstanceId`: id de nodo único y estable.
- `mdnsPairingPin`: secreto compartido verificado solo por `/peer/pair`.
- `peerRsaPublicKey` / `peerRsaPrivateKey`: par de claves PEM RSA-2048 para el emparejamiento (ambos roles).
- `rsaPublicKey` / `rsaPrivateKey`: par de claves PEM RSA-2048 para publicar en WordPress, nunca usado para el emparejamiento.
- `pairedMasters`: registros de confianza persistidos (lado seguidor).

---

Esquema persistido de `pairedMasters[]`:
- `instanceId: string` (requerido)
- `name: string`
- `publicKey: string` (PEM)
- `pairedAt: string` (fecha y hora ISO)
- `hostHint: string`
- `pairingPortHint: number`
- `peerPublicKey: string` (PEM, la clave peer del maestro, fijada en el primer emparejamiento)
- `peerProtocol: number` (`2`; cualquier otro valor se trata como que necesita re-emparejarse)
- `httpsEnabled: boolean`
- `natCompatibility: boolean`
- `needsRepair: boolean` (opcional; se establece cuando el maestro rechaza este dispositivo o el emparejamiento está desactualizado)
- `needsRepairReason: "revoked" | "outdated"` (opcional)

`pairingPin` se guardaba antes del protocolo v2 y ahora se descarta al guardar.

---

Lado del maestro: `peer-followers.json` en el directorio `userData` de Electron. Solo el proceso del servidor Vite lo escribe. El proceso principal de Electron lo lee para Settings y pide al proceso de Vite que olvide seguidores.
```json
{
  "version": 1,
  "followers": [
    {
      "instanceId": "<follower instanceId>",
      "name": "<display name given at pairing>",
      "publicKey": "-----BEGIN PUBLIC KEY-----...",
      "pairedAt": "<ISO datetime>",
      "lastSeenAt": "<ISO datetime of last socket connection>",
      "lastAddress": "<IP>"
    }
  ]
}
```

---

Entradas de la caché solo de tiempo de ejecución (`pairedPeerCache`):
- `host`, `port`, `addresses[]`, `hostname`, `lastSeen`

---

<a id="dev-peering-compatibility"></a>

## Lista de verificación de compatibilidad

Una implementación paralela es compatible a nivel wire si hace todo lo siguiente:
- Publica y explora el tipo de servicio mDNS `revelation` con campos TXT coincidentes.
- Usa los mismos endpoints HTTP y payloads JSON:
  - `GET /peer/public-key`
  - `POST /peer/pair`
  - `GET /peer/auth-nonce`
  - `POST /peer/challenge`
  - `POST /peer/socket-info`

---

- Usa firmas RSA-SHA256 con firmas en base64 y claves PEM, con las [construcciones de firma](#dev-peering-signatures) exactas.
- Usa el formato de desafío de bytes aleatorios en base64.
- Usa exactamente el formato de payload firmado del socket: `token:expiresAt:socketPath`.
- Envía el PIN solo a `/peer/pair` y no lo guarda.
- Deja de reintentar ante `not-paired` / `invalid-signature` / `invalid-pin` / `pin-lockout` en lugar de entrar en bucle.
- Usa la ruta Socket.IO `/peer-commands` y el nombre de evento `peer-command`.
- Persiste los peers de confianza por `instanceId` + `publicKey` fijada.
- Reverifica los peers conocidos cuando mDNS los redescubre antes de aceptarlos como en línea.

---

> **Nota específica de la implementación:** El despacho local de comandos de este wrapper no usa HTTP (ver [Fan-out de comandos](#dev-peering-commands)), así que una implementación compatible no necesita ningún endpoint local.

---

<a id="dev-peering-security"></a>

## Modelo de seguridad y supuestos

Modelo de confianza actual:
- La identidad es criptográfica en ambas direcciones. Los seguidores fijan la clave peer del maestro al emparejar, y los maestros guardan la clave peer de cada seguidor al inscribirlo.
- El PIN autoriza solo la inscripción. El acceso se revoca por seguidor en el maestro, no cambiando el PIN.
- El transporte es HTTP en texto plano en la LAN, a menos que HTTPS esté habilitado.

---

Supuestos requeridos para una operación segura:
- La LAN es semiconfiable y no sufre MITM activo.
- El PIN de emparejamiento se mantiene privado y razonablemente fuerte.
- La obtención inicial de la clave durante el primer emparejamiento no es manipulada.
- El compromiso de un dispositivo implica el compromiso de la confianza peer (la clave privada peer de ese dispositivo).

---

Limitaciones conocidas:
- Sin TLS por defecto; los metadatos, tokens y comandos son observables en la LAN. El PIN es observable solo durante la inscripción.
- Las respuestas de error no están firmadas. Un atacante activo en la LAN podría falsificar `not-paired` y forzar un re-emparejamiento, pero ese mismo atacante ya puede bloquear la conexión.
- Los comandos se transmiten a todos los seguidores conectados. Como solo los seguidores emparejados pueden conectarse, son todos los que el maestro ha emparejado.

> **Nota específica de la implementación:** En este wrapper, la limitación de PIN es en memoria por IP de origen (3 fallos -> bloqueo de 60 s), así que los contadores se reinician al reiniciar la aplicación y no se comparten entre múltiples instancias. Los nonces se autentican con HMAC usando un secreto por proceso, así que todos los nonces pendientes se invalidan cuando el servidor se reinicia, y los seguidores simplemente obtienen nuevos.

---

<a id="dev-peering-hardening"></a>

## Recomendaciones de endurecimiento

Hecho en el protocolo v2:
- El PIN estático se usa solo para la inscripción. Después, cada seguidor se autentica con su propia clave.
- `/peer/socket-info` se emite solo a un seguidor inscrito, con protección contra repetición basada en nonce y un vínculo de audiencia (`masterId`).
- Revocación por seguidor, sin necesidad de cambiar el PIN.

Mejoras de alto impacto:
1. Agregar HTTPS para todos los endpoints `/peer/*` y el transporte Socket.IO (TLS), con fijación de certificado o fijación TOFU.
2. Reemplazar el PIN estático por códigos de emparejamiento de corta duración mostrados en el maestro cuando un seguidor pide emparejarse.
3. Firmar y verificar claims más ricos (emisor, instanceId del sujeto, momento de emisión, expiración, audiencia) en lugar de cadenas de tupla en crudo.
4. Cifrar en reposo los valores sensibles (`peerRsaPrivateKey`, `rsaPrivateKey`) con integración con el llavero del SO/enclave seguro.

---

Mejoras de impacto medio:
1. Agregar rotación de claves y flujos explícitos de restablecimiento de confianza.
2. Extender las protecciones contra abuso del PIN con bloqueo persistente/distribuido y telemetría.
3. Permitir que los maestros dirijan comandos a seguidores particulares en lugar de transmitirlos a todos.
4. Validar la huella mDNS (`pubKeyFingerprint`) contra la clave persistida antes de cualquier solicitud de desafío activa.
5. Agregar registro de auditoría persistente para emparejar/olvidar, emisión de socket-info e identidad del emisor de comandos. Hoy solo están en el registro de eventos en memoria.

---

<a id="dev-peering-troubleshooting"></a>

## Solución de problemas

Para pasos de solución de problemas orientados al operador (incluido el emparejamiento manual cuando el descubrimiento mDNS está bloqueado), consulta:
- [doc/TROUBLESHOOTING.md](../TROUBLESHOOTING.md)
