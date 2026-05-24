# OnTime Integration Plugin

Pulls live data from an [OnTime](https://www.getontime.no/) running-order server to drive countdown timers and dynamic lower-third overlays in slides.

## Setup

In the plugin settings, set **Poll URL** to the OnTime API endpoint:

| Setting    | Example                              | Description                        |
|------------|--------------------------------------|------------------------------------|
| `pollUrl`  | `http://192.168.1.10:4001/api/poll`  | OnTime `/api/poll` REST endpoint   |

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
| `type`         | yes  | —         | Must be `countdown`                                      |
| `timer`        | no   | `current` | Timer key from the OnTime payload (`current`, `clock`, etc.) |
| `displayOffset`| no   | `0`       | Seconds added to the displayed text only; triggers ignore it (may be negative) |
| `actions`      | no   | —         | Trigger actions at specific moments (see below)          |

The countdown renders as an `<h2>` element styled with the `countdown` class. It shows `--:--` while OnTime is stopped.

### Timer display

- Counts down smoothly: ticks locally every second, syncs to the server every 5 s.
- Snaps to the server value if local drift exceeds 3 seconds.
- Shows a leading `-` sign when the timer runs past zero (overtime).
- Hours are included only when the remaining time is ≥ 1 hour.

### Display offset

`displayOffset` adds a fixed number of seconds to the reported timer before it
is shown. Use it when a column should count down to a moment other than the one
OnTime is tracking. For example, OnTime counts down to a 5-minute prelude, but a
pre-meeting column should count down to the meeting start (5 minutes = 300 s
later):

```yaml
:ontime:
  type: countdown
  timer: current
  displayOffset: 300
```

The offset is **cosmetic only** — it changes the displayed text but not the
timer the triggers act on. `actions` thresholds (`zero`, `atTime`) always fire
against OnTime's real reported value, regardless of `displayOffset`. So a column
showing `display +5:00` still triggers `zero` when OnTime's actual timer reaches
zero (when the screen reads `5:00`).

### Actions

Use `actions` to trigger slide navigation at key moments. Each action key is a
**trigger** (when to fire); its value names an **effect** (what to do).

```yaml
:ontime:
  type: countdown
  timer: current
  actions:
    zero: advance
```

#### Triggers

| Trigger      | Value                       | Fires when…                                                        |
|--------------|-----------------------------|--------------------------------------------------------------------|
| `zero`       | effect name                 | the timer counts down past zero                                    |
| `atTime`     | `{ time, action }`          | the timer reaches `time`, the value shown on the countdown (positive = remaining, negative = overtime) |
| `atInterval` | `{ interval, action }`      | every `interval` running seconds while the timer plays             |

`atTime` may also be a list of `{ time, action }` entries to fire several at
different moments. Each trigger fires once per crossing and re-arms if the timer
climbs back above its threshold (e.g. a restart). `atInterval` counts only while
the timer is playing, so pausing OnTime pauses the cycle.

#### Effects

| Effect          | Behaviour                                                                              |
|-----------------|----------------------------------------------------------------------------------------|
| `advance`       | Move to the next slide (same as pressing the down/forward arrow).                      |
| `advanceColumn` | Move to the next column (the slide to the right).                                      |
| `advanceLoop`   | Like `advance`, but on the last slide of a column it loops back to that column's first slide instead of moving to the next column. |

#### Example: looping announcement reel with a timed hand-off

Place this block on **every** slide of the announcements column. The slides cycle
every 10 seconds; at 30 seconds remaining, control jumps to the next column (e.g.
an intro video that plays out the final 30 seconds):

```yaml
:ontime:
  type: countdown
  timer: current
  actions:
    atInterval:
      interval: 10
      action: advanceLoop
    atTime:
      time: 30
      action: advanceColumn
```

---

## Dynamic lower thirds

Populates a lower-third overlay (provided by the **Lower Thirds** plugin) with live text from the OnTime event data, updating automatically as the running order progresses.

```yaml
:ontime:
  type: lowerthird
  name: $eventNow.custom.Presenter
  title: $eventNow.custom.PresenterTitle
  caption: $eventNow.title
```

Field values can be either **resolved paths** (prefixed with `$`) or **literal strings** (plain text).

- **Resolved paths** (e.g. `$eventNow.custom.Presenter`) are resolved to `payload.eventNow.custom.Presenter` in the API response.
- **Literal strings** (e.g. `Q&A Session`) are used as-is without any payload lookup.

### Fields

| Field   | Required | Default    | Description                                                  |
|---------|----------|------------|--------------------------------------------------------------|
| `type`  | yes      | —          | Must be `lowerthird`                                         |
| `name`  | no       | —          | `$path.to.field` to resolve, or plain text for a static string |
| `title` | no       | —          | `$path.to.field` to resolve, or plain text for a static string |
| `style` | no       | `colorful` | Lower-thirds theme name (see Lower Thirds plugin docs)       |

Fields with `$` prefix are resolved from the OnTime payload. Fields without `$` are treated as literal text. Resolved fields that result in `null`, `undefined`, or a missing path are blanked automatically when the event changes.

### Example: mixing resolved and literal values

```yaml
:ontime:
  type: lowerthird
  name: $eventNow.custom.Presenter
  title: $eventNow.custom.PresenterTitle
  caption: Q&A Session
```

In this example:
- `name` and `title` are resolved from OnTime data and update as the running order changes
- `caption` is always `Q&A Session` regardless of the event data

### Semi-colon separated values and `index`

OnTime custom fields can hold multiple values separated by ` ; ` (e.g. `"John Doe; Jane Smith"`). Use the `index` field to select one entry, then repeat the block on another slide with a different index to create separate lower thirds for each person.

```yaml
:ontime:
  type: lowerthird
  name: $eventNow.custom.Presenter
  title: $eventNow.custom.PresenterTitle
  index: 0
```

```yaml
:ontime:
  type: lowerthird
  name: $eventNow.custom.Presenter
  title: $eventNow.custom.PresenterTitle
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
