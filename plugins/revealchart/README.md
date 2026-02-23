---

# RevealChart Plugin Reference

---

## Table of Contents
* [Overview](#revealchart-overview)
* [Chart Blocks](#revealchart-chart-blocks)
* [Chart Size Controls](#revealchart-chart-size)
* [CSV Datasource](#revealchart-csv-datasource)
* [Datasource Object Form](#revealchart-datasource-object)
* [Table Blocks](#revealchart-table-blocks)
* [Table Formatting](#revealchart-table-formatting)

---

<a id="revealchart-overview"></a>

## Overview

When the `revealchart` plugin is enabled, markdown supports `:chart:` and `:table:` YAML blocks.

In the Presentation Builder, use:
- Add Content -> Insert Chart Block
- Add Content -> Insert Table Block

---

<a id="revealchart-chart-blocks"></a>

## Chart Blocks

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

Rendering note:

If charts are blank on later slides, increase Reveal view distance:

```yaml
---
config:
  viewDistance: 120
  mobileViewDistance: 120
---
```

---

<a id="revealchart-chart-size"></a>

## Chart Size Controls

Each chart item can include `height` and `width`.

```yaml
:chart:
  items:
    - type: line
      height: 520px
      width: 80%
```

- Default `height`: `400px`
- Default `width`: `100%`
- Supported units: number (px), `px`, `vh`, `vw`, `%`, `rem`, `em`

---

<a id="revealchart-csv-datasource"></a>

## CSV Datasource

Use `datasource` instead of inline `data`:

```yaml
:chart:
  items:
    - type: bar
      datasource: attendance.csv
      options:
        responsive: true
```

Expected CSV shape:

```csv
,"Adult","Children","Pets"
"Jan",5,3,7
"Feb",4,8,9
"Mar",1,7,2
```

---

<a id="revealchart-datasource-object"></a>

## Datasource Object Form

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

Supported object keys:
- `file`
- `series`: `column-series` (default) or `row-series`
- `labelColumn`
- `dataColumns`
- `headerRow`
- `labelRow`
- `dataRows`

Row-series example:

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

## Table Blocks

```yaml
:table:
  datasource: attendance.csv
  dataId: attendance-window
  class: lighttable
  overflow: scroll
  height: 320px
  dataColumns: A,C,D,E,F
```

Supported keys:
- `datasource` (string or object form)
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

Built-in styles:
- `datatable` (base)
- `lighttable`
- `darktable`

---

<a id="revealchart-table-formatting"></a>

## Table Formatting

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
