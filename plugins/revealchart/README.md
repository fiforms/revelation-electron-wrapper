# RevealChart Plugin Reference

---

## Table of Contents
* [Overview](#revealchart-overview)
* [Chart Blocks](#revealchart-chart-blocks)
* [Chart Size Controls](#revealchart-chart-size)
* [CSV Datasource](#revealchart-csv-datasource)
* [Datasource Object Form](#revealchart-datasource-object)
* [Editing Charts and Tables in the Rich Builder](#revealchart-rich-builder)
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

Chart blocks consist of a :chart: command followed by indented YAML. This YAML mirrors the object accepted by Chart.js, see https://www.chartjs.org/docs/latest/ for detailed documentation. Any object in JSON in these online docs should be accepted here, only in YAML syntax.

---

Example Chart

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

---

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

- `height` and `width` size the chart's container `<div>`; the canvas fills it. No HTML wrapper is needed.
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

---

Supported object keys:
- `file`
- `series`: `column-series` (default) or `row-series`
- `labelColumn`
- `dataColumns`
- `headerRow`
- `labelRow`
- `dataRows`

Row-series example:

---

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

<a id="revealchart-rich-builder"></a>

## Editing Charts and Tables in the Rich Builder

In the Rich Builder, choose **Animation → Chart…** to insert a chart, or click an existing `:chart:` card to edit it. The dialog has two tabs that edit the same chart:

* **Guided**: chart type, width and height, a data grid (labels down the side, one column per dataset; you can paste cells copied from a spreadsheet) and a few common options (title, legend, stacked, value axis from zero, horizontal bars).
* **YAML**: the whole chart as YAML, where you can type any Chart.js option. The **Add option snippet…** menu merges ready-made settings (log scale, no gridlines, thicker lines and so on) into it, and a link opens the Chart.js options reference.

Anything the Guided tab does not know about, including all of `options`, is kept exactly as written. A live preview shows the chart as you edit. Charts that read a CSV `datasource` have no preview or grid; edit them on the YAML tab. If a block cannot be read as YAML, the card opens in the plain-text editor instead.

**Animation → Table…** (or clicking a `:table:` card) opens the same kind of dialog for tables. The Guided tab has the CSV file path, the common table options (style, height, overflow, columns and rows to show, header row, default alignment and format, currency, ID) and a column rule list that sets alignment, format and sum/average per column. Everything else stays untouched and can be edited on the YAML tab.

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

---

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

---

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
