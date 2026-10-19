You can copy in any bible translations (XMLBIBLE) format into this folder.
The plugin will automatically convert the .xml format into .json for
quicker processing.

Bibles can be downloaded from https://sourceforge.net/projects/zefania-sharp/files/Bibles/
Open Translation Bible (CC BY-SA 4.0) JSON can be converted with `node ../import-otb.js <open-bible checkout> [--lang fr-FR]` (one-off tool, see its header).
Berean Standard Bible (public domain) from its plain-text download: `node ../import-bsb.js bsb.txt`.
unfoldingWord ULT/UST (CC BY-SA 4.0) from the en_ult / en_ust USFM: `node ../import-ult.js <unzipped repo>`.
Septuagint, Greek (Swete's edition, CC BY-SA 4.0, Open Greek and Latin): `node ../import-swete.js <First1KGreek>/data/tlg0527`.
Septuagint, English (Brenton, LXX2012, public domain): `node ../import-lxx2012.js <unzipped eng-lxx2012_usfm.zip>`.
Both scripts' headers say where to download their sources and which rules they apply (Ecclesiastes is not in the Greek source).
The NET Bible is not converted by hand: the app downloads and converts it for the user (`bibleDownloader.js`).
`make-manifest.js` (run it in the folder you upload to the CDN) writes `manifest.json` with each file's title, size and
language group; see its header for the optional `groups.json` override. The app's download checkboxes come from those groups.
All converters share `../usfm.js` (USFM parsing and the XML writer). A release build bundles only the KJV
(`scripts/prepackage.js` BUNDLED_BIBLES); users download the rest from the app into their user-data folder.
