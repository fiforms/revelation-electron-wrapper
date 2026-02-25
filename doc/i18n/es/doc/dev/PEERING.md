# Peering y descubrimiento

Peering es un mecanismo potente que permite que una instancia "maestra" envíe una presentación 
simultáneamente a múltiples instancias "seguidoras". Las otras instancias pueden reflejar la 
pantalla principal del presentador, mostrar notas o versiones lower-third,
permitir relaciones de aspecto distintas para streaming, o mostrar la presentación en diferentes idiomas. 

Peering primero debe habilitarse en "Settings" tanto en instancias maestras como seguidoras, y
el modo "network" debe habilitarse al menos en la instancia maestra.

La pantalla de peering muestra instancias disponibles en la red local. Para que peering funcione,
todas las instancias deben estar conectadas a la misma red local. Probablemente no funcione en
WiFi pública u otras configuraciones que "aíslan clientes".

El emparejamiento siempre se inicia desde el "seguidor" hacia el "maestro". Debe conocer el
Pairing Pin del maestro (disponible en el diálogo de información de la pantalla principal). 

Abajo hay una referencia más técnica de cómo funciona el protocolo.

---

## Tabla de contenidos
* [Resumen en lenguaje simple](#dev-peering-overview)
* [Roles y transporte](#dev-peering-roles)
* [Descubrimiento (mDNS)](#dev-peering-discovery)
* [Protocolo de emparejamiento](#dev-peering-pairing)
* [Canal de comandos peer](#dev-peering-commands)
* [Persistencia y modelo de datos](#dev-peering-persistence)
* [Checklist de compatibilidad](#dev-peering-compatibility)
* [Modelo de seguridad y supuestos](#dev-peering-security)
* [Recomendaciones de hardening](#dev-peering-hardening)
* [Solución de problemas](#dev-peering-troubleshooting)

---

<a id="dev-peering-overview"></a>

## Resumen

Peering permite que una instancia del wrapper REVELation (el "maestro") abra/cierre remotamente una presentación en otra instancia (el "seguidor").

En runtime, el sistema usa:
- mDNS (`bonjour-service`) para descubrimiento LAN.
- HTTP plano (no HTTPS) en el puerto Vite del wrapper para endpoints de emparejamiento y bootstrap de comandos.
- Socket.IO para comandos peer en curso.
- Firmas RSA-2048 (SHA-256) para verificaciones de identidad challenge-response y firma de payloads de auth de socket de corta duración.
- Un PIN de emparejamiento compartido para autorización.

---

Resumen de dirección del protocolo:
- Los nodos maestros anuncian por mDNS y exponen puntos de peering por HTTP.
- El emparejamiento se inicia desde el "seguidor" al "maestro". El "seguidor" actúa como cliente y llama endpoints HTTP del peer candidato (servidor vite) (en `viteServerPort`, típicamente 8000).
- Dirección de comandos: seguidores mantienen conexiones Socket.IO salientes a cada maestro emparejado y reciben eventos peer-command vía endpoint Socket.IO del servidor Vite (/peer-commands, también `viteServerPort`).

---

> **Nota específica de implementación:** En este wrapper Electron, anuncio y disponibilidad de endpoints están condicionados por configuración local (`mdnsPublish`) y modo de inicio (`network`).

---

Puertos:
- El anuncio de descubrimiento incluye `pairingPort`, actualmente igual a `viteServerPort`.
- Los endpoints de emparejamiento (`/peer/*`) se sirven por HTTP.

---

> **Nota específica de implementación:** En este wrapper Electron, `/peer/*` se aloja en el servidor Vite (`viteServerPort`, típicamente 8000), se deshabilita totalmente salvo que `mdnsPublish === true`, y es separado de Reveal Remote (`revealRemoteServerPort`, a menudo 1947).

---

Almacenamiento de claves y secretos:
- Los "maestros" mantienen un par de claves RSA usado para probar identidad ante conexiones repetidas de "seguidores".
- `rsaPublicKey`, `rsaPrivateKey`, `mdnsPairingPin` y `pairedMasters` se persisten en config Electron y se gestionan automáticamente.
- Las claves privadas son de larga duración y se reutilizan entre ejecuciones salvo que se reemplace la config. Seguidores emparejados se tratan como no verificados y la conexión de comando falla si el maestro no puede autenticarse ante seguidores con su clave privada.

---

<a id="dev-peering-roles"></a>

## Roles y transporte

Terminología usada por la implementación:
- `master`: nodo emparejado al que un seguidor escucha para comandos peer.
- `follower`: nodo local que ejecuta comandos de maestros emparejados.
- `instanceId`: identificador hex aleatorio estable por instalación (16 caracteres hex; 8 bytes aleatorios).

---

Resumen de transporte:
- Tipo de servicio mDNS: `revelation`
- Endpoints de emparejamiento/auth: HTTP JSON
- Canal de comandos en tiempo real: Socket.IO en ruta `/peer-commands`

---

<a id="dev-peering-discovery"></a>

## Descubrimiento (mDNS)

Comportamiento de protocolo:
- Los peers se descubren por tipo de servicio mDNS `revelation`.
- Las instancias pueden anunciar metadatos usando campos mDNS TXT listados abajo.

---

> **Nota específica de implementación:** En este wrapper Electron, browse/publish están controlados por `mdnsBrowse`/`mdnsPublish`, el navegador se actualiza cada 15 segundos y autoanuncios se ignoran por `instanceId`.

---

Detalles de publicación de servicio:
- Tipo de servicio: `revelation`
- Nombre de servicio: `mdnsInstanceName` (predeterminado `${username}@${hostname}`)
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
- `pubKeyFingerprint` (`sha256(publicKeyPem)` hex)

---

> **Nota específica de implementación:** La selección de host prefiere la primera dirección IPv4 detectada y cae en `service.host`. Los instance IDs emparejados previamente se reverifican al evento mDNS `up` vía `/peer/challenge` antes de aceptarlos como online.

---

<a id="dev-peering-pairing"></a>

## Protocolo de emparejamiento

El emparejamiento es HTTP JSON sobre `http://<peerHost>:<pairingPort>`.

> **Nota específica de implementación:** En este wrapper Electron, los endpoints de emparejamiento solo están disponibles cuando el peer objetivo `mdnsPublish === true`.

---

### 1) Obtener identidad

`GET /peer/public-key`

Respuesta:
```json
{
  "instanceId": "<string>",
  "instanceName": "<string>",
  "hostname": "<string>",
  "publicKey": "-----BEGIN PUBLIC KEY-----...",
  "publicKeyFingerprint": "<sha256 hex>"
}
```

---

Reglas de validación:
- Verificar que los campos de respuesta necesarios para selección de confianza estén presentes y sean consistentes.

> **Nota específica de implementación:** Este wrapper impone coincidencia de hostname TXT descubierto (cuando está presente), luego elige ID maestro por prioridad: respuesta `instanceId`, `peer.instanceId` descubierto, luego `peer.txt.instanceId` descubierto.

---

### 2) Challenge-response con PIN

El cliente genera challenge como base64 de 32 bytes aleatorios.

`POST /peer/challenge`

Solicitud:
```json
{
  "challenge": "<base64 random>",
  "pin": "<pairing pin>"
}
```

Respuesta:
```json
{
  "signature": "<base64 RSA-SHA256 signature of challenge>"
}
```

---

Regla de PIN en servidor:
- Si `mdnsPairingPin` está establecido/no vacío, `pin` provisto debe coincidir exactamente o servidor devuelve `403`.
- Si no hay PIN configurado, no se aplica PIN.

---

Regla de verificación en cliente:
- Verificar firma sobre `challenge` con RSA-SHA256.
- La clave pública usada para verificar es:
1. `pairedMasters[n].publicKey` almacenada existente para mismo `instanceId`, o
2. respuesta `publicKey` de `/peer/public-key`.

---

### 3) Persistir maestro emparejado

> **Nota específica de implementación:** Este wrapper persiste maestros emparejados en config local (`pairedMasters`) con campos como `instanceId`, `publicKey`, `name`, `pairedAt`, `hostHint`, `pairingPortHint` y `pairingPin`. También mantiene una caché runtime (`pairedPeerCache`) y elimina ambas entradas al desemparejar.

---

<a id="dev-peering-commands"></a>

## Canal de comandos peer

Seguidores conectan saliente a maestros emparejados y reciben eventos `peer-command`.

> **Nota específica de implementación:** Este wrapper refresca conexiones de seguidores cada 10 segundos y exige `mdnsPublish === true` en destino para endpoints bootstrap/fan-out.

---

### Bootstrap: info de socket firmada

El seguidor solicita:

`GET /peer/socket-info?instanceId=<followerInstanceId>&pin=<pairingPin>`

---

> **Nota específica de implementación:** Este wrapper valida PIN exactamente como `/peer/challenge` y actualmente no autoriza según query `instanceId`.

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
- `"${token}:${expiresAt}:${socketPath}"`

El seguidor verifica `signature` con clave pública maestra almacenada antes de conectar.

---

### Conexión Socket.IO

El seguidor se conecta a `socketUrl` con ruta `/peer-commands` y payload auth:
```json
{
  "token": "...",
  "expiresAt": 1700000000000,
  "signature": "...",
  "instanceId": "<followerInstanceId>"
}
```

---

Validación de handshake en servidor:
- Requiere `token`, `expiresAt`, `signature`.
- Requiere `expiresAt >= Date.now()`.
- Verifica firma sobre `"${token}:${expiresAt}:/peer-commands"` usando clave pública local configurada.

---

### Fan-out de comandos

Nota específica de implementación (no protocolo core): este endpoint loopback `POST /peer/command` es una conveniencia del wrapper Electron para fan-out local UI-a-socket. Una implementación compatible puede usar un mecanismo local de dispatch distinto.

La UI del lado maestro local publica comandos solo a loopback:

`POST /peer/command` a `http://127.0.0.1:<vitePort>/peer/command`

---

Solicitud:
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

Reglas de servidor:
- Rechaza llamadores no-loopback con `403`.
- Emite evento `peer-command` a todos los sockets peer conectados.

> **Nota específica de implementación:** Este wrapper maneja `open-presentation` abriendo la URL en ventanas de presentación (incluyendo pantallas adicionales), maneja `close-presentation` cerrándolas, y registra/ignora tipos de comando desconocidos.

---

<a id="dev-peering-persistence"></a>

## Persistencia y modelo de datos

> **Sección específica de implementación:** Las siguientes claves y esquemas describen el modelo de almacenamiento local de este wrapper Electron, no campos on-wire requeridos por protocolo.

---

Claves de config relevantes para peering:
- `mode`: `network` habilita enlace de servidor LAN; `localhost` no publica.
- `mdnsBrowse`: controla si este nodo explora peers y si se permite comportamiento follower de emparejamiento/comandos peer.
- `mdnsPublish`: controla si este nodo se anuncia en modo `network` y si endpoints locales `/peer/*` están habilitados.
- `mdnsInstanceName`: nombre anunciado.
- `mdnsInstanceId`: id único estable del nodo.
- `mdnsPairingPin`: secreto compartido validado por `/peer/challenge` y `/peer/socket-info`.
- `rsaPublicKey` / `rsaPrivateKey`: par de claves PEM RSA-2048.
- `pairedMasters`: registros de confianza persistidos.

---

Esquema persistido `pairedMasters[]`:
- `instanceId: string` (requerido)
- `name: string`
- `publicKey: string` (PEM)
- `pairedAt: string` (datetime ISO)
- `hostHint: string`
- `pairingPortHint: number`
- `pairingPin: string`

---

Entradas de caché solo-runtime (`pairedPeerCache`):
- `host`, `port`, `addresses[]`, `hostname`, `lastSeen`

---

<a id="dev-peering-compatibility"></a>

## Checklist de compatibilidad

Una implementación paralela es compatible a nivel wire si hace todo lo siguiente:
- Publica y explora tipo de servicio mDNS `revelation` con campos TXT coincidentes.
- Usa los mismos endpoints HTTP y payloads JSON:
  - `GET /peer/public-key`
  - `POST /peer/challenge`
  - `GET /peer/socket-info`

---

- Usa firmas RSA-SHA256 con firmas base64 y claves PEM.
- Usa formato challenge como bytes aleatorios base64.
- Usa formato payload firmado de socket exactamente: `token:expiresAt:socketPath`.
- Usa ruta Socket.IO `/peer-commands` y nombre de evento `peer-command`.
- Persiste peers de confianza por `instanceId` + `publicKey` fijada.
- Re-verifica peers conocidos cuando se redescubren por mDNS antes de aceptarlos como online.

---

> **Nota específica de implementación:** Este wrapper también expone loopback `POST /peer/command` para fan-out de UI local, pero ese endpoint no es requerido por el protocolo wire core peer.

---

<a id="dev-peering-security"></a>

## Modelo de seguridad y supuestos

Modelo de confianza actual:
- La identidad es criptográfica (par de claves RSA).
- La autorización es mayormente basada en PIN para emparejamiento y bootstrap de socket.
- El transporte es HTTP en texto plano sobre LAN.

---

Supuestos requeridos para operación segura:
- La LAN es semi-confiable y no está bajo MITM activo.
- El PIN de emparejamiento se mantiene privado y razonablemente fuerte.
- La obtención inicial de clave durante el primer emparejamiento no está manipulada.
- Compromiso de dispositivo implica compromiso de confianza peer (clave privada + PIN almacenado).

---

Limitaciones conocidas:
- Sin TLS; metadatos, tokens y comandos son observables en LAN.
- Sin enlace de identidad mutuo en handshake de socket más allá de la tupla bootstrap firmada.
- `/peer/socket-info` actualmente no impone autorización de `instanceId` del llamador.

> **Nota específica de implementación:** En este wrapper, `mdnsAuthToken` existe en config pero no se usa por el protocolo actual, y el throttling de PIN es en memoria por IP origen (3 fallos -> bloqueo de 60s), por lo que contadores se reinician al reiniciar app y no se comparten entre instancias múltiples.

---

<a id="dev-peering-hardening"></a>

## Recomendaciones de hardening

Mejoras de alto impacto:
1. Agregar HTTPS para todos los endpoints `/peer/*` y transporte Socket.IO (TLS), con pinning de certificado o pinning TOFU.
2. Reemplazar PIN estático/compartido por secretos de enrolamiento por dispositivo o códigos de emparejamiento de corta duración.
3. Enlazar emisión de `/peer/socket-info` a `instanceId` autorizado y requerir protección anti-replay basada en nonce.
4. Firmar y verificar claims más ricos (issuer, subject instanceId, issued-at, expiry, audience) en lugar de tuplas string crudas.
5. Cifrar valores sensibles en reposo (`rsaPrivateKey`, secretos de emparejamiento almacenados) con integración keychain/secure enclave del SO.

---

Mejoras de impacto medio:
1. Agregar rotación de claves y flujos explícitos de reset de confianza.
2. Extender protecciones de abuso PIN con lockout persistente/distribuido y telemetría.
3. Restringir destinatarios de comandos Socket.IO por mapeo explícito de emparejamiento en lugar de broadcast-a-todos los peers conectados.
4. Validar fingerprint mDNS (`pubKeyFingerprint`) contra clave persistida antes de cualquier solicitud challenge activa.
5. Agregar logging de auditoría para pair/unpair, emisión socket-info e identidad del emisor de comando.

---

<a id="dev-peering-troubleshooting"></a>

## Solución de problemas

Para pasos operativos de troubleshooting (incluido emparejamiento manual cuando el descubrimiento mDNS está bloqueado), consulte:
- [doc/TROUBLESHOOTING.md](../TROUBLESHOOTING.md)
