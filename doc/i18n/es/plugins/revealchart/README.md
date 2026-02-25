# Referencia del plugin RevealChart

---

## Tabla de contenidos
* [Resumen](#revealchart-overview)
* [Bloques de gráfico](#revealchart-chart-blocks)
* [Controles de tamaño de gráfico](#revealchart-chart-size)
* [Fuente de datos CSV](#revealchart-csv-datasource)
* [Forma de objeto datasource](#revealchart-datasource-object)
* [Bloques de tabla](#revealchart-table-blocks)
* [Formato de tablas](#revealchart-table-formatting)

---

<a id="revealchart-overview"></a>

## Resumen

Cuando el plugin `revealchart` está habilitado, markdown soporta bloques YAML `:chart:` y `:table:`.

En Presentation Builder, use:
- Add Content -> Insert Chart Block
- Add Content -> Insert Table Block

---

<a id="revealchart-chart-blocks"></a>

## Bloques de gráfico

Los bloques de gráfico consisten en un comando :chart: seguido de YAML indentado. Este YAML refleja el objeto aceptado por Chart.js; consulte https://www.chartjs.org/docs/latest/ para documentación detallada. Cualquier objeto en JSON de esa documentación debería aceptarse aquí, pero en sintaxis YAML.

---

Ejemplo de gráfico

```yaml
:chart:
  items:
    - type: line
      data:
        labels: ["Jan", "Feb", "Mar"]
        datasets:
          - label: Attendance
            data: [12, 19, 9]
      options:
        responsive: true
```

Nota de renderizado:

Si los gráficos aparecen en blanco en diapositivas posteriores, aumente la distancia de vista de Reveal:

```yaml
---
config:
  viewDistance: 120
  mobileViewDistance: 120
---
```

---

<a id="revealchart-chart-size"></a>

## Controles de tamaño de gráfico

Cada elemento de gráfico puede incluir `height` y `width`.

```yaml
:chart:
  items:
    - type: line
      height: 520px
      width: 80%
```

- `height` predeterminado: `400px`
- `width` predeterminado: `100%`
- Unidades soportadas: número (px), `px`, `vh`, `vw`, `%`, `rem`, `em`

---

<a id="revealchart-csv-datasource"></a>

## Fuente de datos CSV

Use `datasource` en lugar de `data` inline:

```yaml
:chart:
  items:
    - type: bar
      datasource: attendance.csv
      options:
        responsive: true
```

Forma esperada del CSV:

```csv
,"Adult","Children","Pets"
"Jan",5,3,7
"Feb",4,8,9
"Mar",1,7,2
```

---

<a id="revealchart-datasource-object"></a>

## Forma de objeto datasource

```yaml
:chart:
  items:
    - type: line
      datasource:
        file: attendance.csv
        series: column-series
        labelColumn: C
        dataColumns: E,F
        headerRow: 1
        dataRows: 2:4
```

Claves soportadas del objeto:
- `file`
- `series`: `column-series` (predeterminado) o `row-series`
- `labelColumn`
- `dataColumns`
- `headerRow`
- `labelRow`
- `dataRows`

Ejemplo row-series:

```yaml
:chart:
  items:
    - type: radar
      datasource:
        file: attendance.csv
        series: row-series
        labelRow: 1
        labelColumn: A
        dataColumns: B:D
        dataRows: 2:4
```

---

<a id="revealchart-table-blocks"></a>

## Bloques de tabla

```yaml
:table:
  datasource: attendance.csv
  dataId: attendance-window
  class: lighttable
  overflow: scroll
  height: 320px
  dataColumns: A,C,D,E,F
```

Claves soportadas:
- `datasource` (string o forma de objeto)
- `id`
- `dataId`
- `class`
- `style`
- `overflow`
- `height`
- `dataColumns`
- `dataRows`
---

- `headerRow`
- `align`
- `alignColumns`
- `format`
- `formatColumns`
- `currency`
- `summarizeColumns`

Estilos incluidos:
- `datatable` (base)
- `lighttable`
- `darktable`

---

<a id="revealchart-table-formatting"></a>

## Formato de tablas

```yaml
:table:
  datasource: attendance.csv
  class: darktable
  dataColumns: A,C,D,E,F
  align: left
  alignColumns:
    C: right
    D: right
    E: right
    F: right
  formatColumns:
    C: currency
    D: percentage
  summarizeColumns:
    C: sum
    D: average
  currency: USD
```
