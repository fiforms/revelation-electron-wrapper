# Plugin Compactor

Agrega una acción al menú contextual de la lista de presentaciones:

- `Compact Presentation...`

## Qué hace

1. Solicita ajustes de compactación al iniciarse.
2. Copia la carpeta de la presentación seleccionada a una nueva carpeta `<slug>_compacted` (o `<slug>_compacted_2`, etc. si es necesario).
3. Compacta recursivamente recursos de imagen en la carpeta copiada con un ancho/alto máximos fijos y calidad configurable.
4. Opcionalmente convierte archivos PNG a `webp` o `avif`.
5. Opcionalmente compacta recursos de video con la misma lógica de dimensiones máximas y calidad configurable.
6. Reescribe referencias relativas de medios en los archivos `.md` copiados cuando cambian nombres/extensiones por conversión.
7. Muestra estado en vivo en la página de lista de presentaciones, incluyendo progreso como:
   - `Compacting 3 of 29 assets...`

## Notas de implementación

- La compactación se realiza con `ffmpeg` tanto para imágenes como para videos.

## Valores predeterminados

- Dimensiones máximas: `1920x1080`
- Calidad de imagen: `85%`
- Compactar video: desactivado por defecto
- Calidad de video (si está activado): `85%`
- Conversión de PNG: `none` (sin conversión)
