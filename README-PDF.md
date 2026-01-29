# PDF Import Setup (Poppler)

This guide explains how to install Poppler and configure the Add Media plugin so PDF pages can be imported as slides.

## Where to set the paths in the app
1) Open the app Settings window.
2) Go to the Plugins section.
3) Find the Add Media plugin.
4) Fill in these fields:
   - `pdftoppmPath`
   - `pdfinfoPath`
5) Save settings and restart the app.

Tip: Use full paths to the binaries.

## Windows
1) Download Poppler for Windows from this page: https://github.com/oschwartz10612/poppler-windows/releases

2) Unzip the file to a folder you control, for example:
```
C:\Tools\poppler
```
3) Open the folder and locate the binaries. The typical path looks like:
```
<unzipped>\poppler-<version>\Library\bin\pdftoppm.exe
<unzipped>\poppler-<version>\Library\bin\pdfinfo.exe
```
4) Copy those full paths into the Add Media plugin settings.

Example:
```
pdftoppmPath = C:\Tools\poppler\poppler-24.08.0\Library\bin\pdftoppm.exe
pdfinfoPath  = C:\Tools\poppler\poppler-24.08.0\Library\bin\pdfinfo.exe
```

## macOS
Install Poppler with Homebrew:
```
brew install poppler
```
Find the binary paths:
```
which pdftoppm
which pdfinfo
```
Use those results in the Add Media plugin settings. On Apple Silicon, the path is often:
```
/opt/homebrew/bin/pdftoppm
/opt/homebrew/bin/pdfinfo
```

## Linux
Install Poppler using your package manager:
```
sudo apt install poppler-utils
sudo dnf install poppler-utils
sudo pacman -S poppler
```
Find the binary paths:
```
which pdftoppm
which pdfinfo
```
Use those results in the Add Media plugin settings. The path is often:
```
/usr/bin/pdftoppm
/usr/bin/pdfinfo
```

## Troubleshooting
- If the PDF import dialog says it cannot run Poppler, double-check the paths and restart the app.
- Make sure both `pdftoppm` and `pdfinfo` are installed and executable.
