# Plugin Live Captions

Este plugin lanza un comando local de voz a texto, muestra la transcripción como una superposición de subtítulos en la diapositiva y replica el texto de los subtítulos a otros clientes de la presentación a través del socket de plugins del presentador existente.

## Configuración

- `command` (predeterminado vacío): Comando completo usado para iniciar los subtítulos, por ejemplo `/home/user/programs/whisper.cpp/build/bin/whisper-stream`
- `modelPath` (predeterminado vacío): Ruta absoluta opcional del modelo; si se define, el plugin añade `-m <path>`
- `inputDevice` (predeterminado vacío): Número opcional del dispositivo de captura; si se define, el plugin añade `-c <number>`
- `autoStart` (predeterminado activado): Inicia automáticamente cuando se abre una ventana de presentación de Electron
- `captionHoldMs` (predeterminado `5000`): Milisegundos antes de que los subtítulos se borren tras el silencio
- `maxLines` (predeterminado `2`): Número de líneas de subtítulos que se mantienen visibles

---

## Notas

- La ventana principal de presentación de Electron es la fuente de los subtítulos. Los clientes seguidores/de navegador reciben el texto de los subtítulos a través del socket de plugins del presentador.
- `whisper-stream` escribe caracteres de control de terminal mientras actualiza la línea actual. El plugin elimina esas secuencias antes de renderizar los subtítulos.
- Si no hay disponible ningún `remoteMultiplexId` ni `multiplexId` almacenado, los subtítulos igualmente aparecen de forma local, pero no se replican a los pares.
