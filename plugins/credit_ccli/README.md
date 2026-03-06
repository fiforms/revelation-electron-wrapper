# Credit CCLI Plugin

Adds presentation credit helpers:

- Replaces `:ccli:` tokens with the configured CCLI license number.
- Converts `:credits:` YAML blocks into `<cite class="attrib">...</cite>` markup.

## Settings

In Settings -> Plugin Manager -> `credit_ccli`:

- `CCLI License Number`

## Credits Block

Example:

```yaml
:credits:
  words: Ron Hamilton
  music: Ron Hamilton
  year: 1981
  copyright: Majesty Music
  cclisong: 72439
  license: ccli
```
