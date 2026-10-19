You can copy in any bible translations (XMLBIBLE) format into this folder.
The plugin will automatically convert the .xml format into .json for
quicker processing.

Bibles can be downloaded from https://sourceforge.net/projects/zefania-sharp/files/Bibles/
Open Translation Bible (CC BY-SA 4.0) JSON can be converted with `node ../import-otb.js <open-bible checkout> [--lang fr-FR]` (one-off tool, see its header).
Berean Standard Bible (public domain) from its plain-text download: `node ../import-bsb.js bsb.txt`.
unfoldingWord ULT/UST (CC BY-SA 4.0) from the en_ult / en_ust USFM: `node ../import-ult.js <unzipped repo>`.
The NET Bible is not converted by hand: the app downloads and converts it for the user (`bibleDownloader.js`).
All converters share `../usfm.js` (USFM parsing and the XML writer). A release build bundles only the KJV
(`scripts/prepackage.js` BUNDLED_BIBLES); users download the rest from the app into their user-data folder.
