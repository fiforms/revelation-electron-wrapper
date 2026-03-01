# Plugin de Control de Diapositivas

Agrega una superposición de navegación en la parte inferior de la vista de presentación, y opcionalmente permite la navegación desde cualquier par conectado.

En sesiones compartidas/de pares, los clientes seguidores pueden solicitar cambios de navegación mediante el socket de plugins del presentador. La sesión maestra ejecuta esos comandos localmente, y luego RevealRemote sincroniza el estado de las diapositivas con los clientes conectados.

## Controles

- `<<` Columna izquierda
- `^` Diapositiva anterior
- `v` Siguiente diapositiva
- `>>` Columna derecha
- `OV` Alternar vista general
- `BL` Pantalla en negro

## Tiempo real

- Ruta del socket: `/presenter-plugins-socket`
- Alcance del plugin: `slidecontrol`
- Evento: `slideshow-control-command`

Solo las sesiones que no son de seguidor ejecutan comandos remotos entrantes.

## Configuración

- `allowControlFromAnyClient` (booleano, predeterminado `true`)
- `true`: comportamiento compartido actual (clientes pares pueden reenviar comandos por socket al maestro).
- `false`: no se realiza ninguna conexión de socket; el plugin funciona solo en local y actúa como controles directos del deck.
- Cuando es `false`, los pares seguidores en modo solo lectura (sesiones con `remoteMultiplexId`) quedan completamente deshabilitados (sin UI, sin controles).
