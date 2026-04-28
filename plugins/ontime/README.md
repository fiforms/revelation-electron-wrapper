# OnTime Integration Plugin

Pulls live data from an [OnTime](https://www.getontime.no/) running-order server to drive countdown timers and dynamic lower-third overlays in slides.

## Setup

In the plugin settings, set **Poll URL** to the OnTime API endpoint:

| Setting    | Example                          | Description                        |
|------------|----------------------------------|------------------------------------|
| `pollUrl`  | `http://192.168.1.10:4001/data`  | OnTime `/data` REST endpoint       |

The plugin polls this URL every 5 seconds.

---

## Countdown timer

Displays a live countdown sourced from the OnTime timer, updating every second.

```yaml
:ontime:
  type: countdown
  timer: current
```

### Fields

| Field    | Required | Default   | Description                                              |
|----------|----------|-----------|----------------------------------------------------------|
| `type`   | yes      | —         | Must be `countdown`                                      |
| `timer`  | no       | `current` | Timer key from the OnTime payload (`current`, `clock`, etc.) |
| `actions`| no       | —         | Trigger actions at specific moments (see below)          |

The countdown renders as an `<h2>` element styled with the `countdown` class. It shows `--:--` while OnTime is stopped.

### Timer display

- Counts down smoothly: ticks locally every second, syncs to the server every 5 s.
- Snaps to the server value if local drift exceeds 3 seconds.
- Shows a leading `-` sign when the timer runs past zero (overtime).
- Hours are included only when the remaining time is ≥ 1 hour.

### Actions

Use `actions` to trigger slide behaviour at key moments:

```yaml
:ontime:
  type: countdown
  timer: current
  actions:
    zero: advance
```

| Action key | Value     | Effect                                    |
|------------|-----------|-------------------------------------------|
| `zero`     | `advance` | Advances to the next slide when the timer reaches zero |

---

## Dynamic lower thirds

Populates a lower-third overlay (provided by the **Lower Thirds** plugin) with live text from the OnTime event data, updating automatically as the running order progresses.

```yaml
:ontime:
  type: lowerthird
  name: eventNow.custom.Presenter
  title: eventNow.custom.PresenterTitle
```

The `name` and `title` values are **dotted paths** into the OnTime `/data` payload (starting from `payload`). For example, `eventNow.custom.Presenter` resolves to `payload.eventNow.custom.Presenter` in the API response.

### Fields

| Field   | Required | Default    | Description                                                  |
|---------|----------|------------|--------------------------------------------------------------|
| `type`  | yes      | —          | Must be `lowerthird`                                         |
| `name`  | no       | —          | Dotted path to the name value in the OnTime payload          |
| `title` | no       | —          | Dotted path to the title/role value in the OnTime payload    |
| `style` | no       | `colorful` | Lower-thirds theme name (see Lower Thirds plugin docs)       |

Fields that resolve to `null`, `undefined`, or a missing path are blanked automatically when the event changes.

### Semi-colon separated values and `index`

OnTime custom fields can hold multiple values separated by ` ; ` (e.g. `"John Doe; Jane Smith"`). Use the `index` field to select one entry, then repeat the block on another slide with a different index to create separate lower thirds for each person.

```yaml
:ontime:
  type: lowerthird
  name: eventNow.custom.Presenter
  title: eventNow.custom.PresenterTitle
  index: 0
```

```yaml
:ontime:
  type: lowerthird
  name: eventNow.custom.Presenter
  title: eventNow.custom.PresenterTitle
  index: 1
```

Given `Presenter = "John Doe; Jane Smith"` and `PresenterTitle = "Director; Associate Director"`:

| `index` | Name rendered      | Title rendered        |
|---------|--------------------|-----------------------|
| `0`     | John Doe           | Director              |
| `1`     | Jane Smith         | Associate Director    |

Omit `index` to use the full field value without splitting.

### Requirements

- The **Lower Thirds** plugin must be enabled.
- Set **Slide View Distance** in presentation settings to a value greater than the total number of slides so Reveal.js pre-loads all slides and the overlays render before they are shown.
- The first poll fires within 5 seconds of the presentation loading; there is a brief window where the overlay fields are blank.
