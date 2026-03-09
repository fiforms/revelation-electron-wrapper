# Credit CCLI Plugin

Adds presentation credit helpers:

- Replaces `:ccli:` tokens with the configured CCLI license number.
- Converts `:credits:` YAML blocks into `<cite class="attrib">...</cite>` markup.
- Adds :ATTRIB: Macros for CCLI Number and copyright info.

## Settings

In Settings -> Plugin Manager -> `credit_ccli`:

Be sure to set your `CCLI License Number` to your church's actual CCLI license number.
This plugin is provided for convenience, it does not automatically give you permission
to use copyright songs!

## Importing from SongSelect

REVELation does not automatically integrate with SongSelect; however, it extends the
"Smart Paste" feature in the presentation builder to build slides from copied lyrics.

In SongSelect, copy the song lyrics using the "copy" link next to the song title.

In the builder, use the "Smart Paste" option from the tools menu to paste lyrics as
slides.

## Credits Block

Use YAML to add song metadata on your title slide. This metadata will be fomratted
as a credit block in your slide presentation, including your CCLI license number if
applicable:

```yaml
:credits:
  words: Ron Hamilton
  music: Ron Hamilton
  year: 1981
  copyright: Majesty Music
  cclisong: 72439
  license: ccli
```

## Automatic Macros

Credits block will automatically set macros to display attribution for your CCLI
License number and the song copyright holder. Keep that in mind, as it could
reset macros set on previous slides, and also create macros that need to be 
reset manually at the song end.