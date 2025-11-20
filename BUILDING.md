# Notes on packaging

## Building on OSx

Before building, make sure you have Homebrew, Node.js and Git installed. From a terminal:

```shell
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Make sure it's available
brew --version

# Install Node:
brew install node

# Verify:
node -v
npm -v

# Install Git
brew install git

# Verify
git --version
```

### Building on OSx (arm64 Specific)

```shell
git clone --recursive https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper
rm package-lock.json
cd revelation
rm package-lock.json
npm install
npm run build
npm run dev
#  Ctrl+C to Exit

cd ..
npm install

# Testing the app
npm start

# Resetting
rm -r revelation/presentations_*
rm plugins/bibletext/bibles/*.json

npm run dist-mac
```

### Building on OSx (intel, cross compiling from arm64)

```shell
mkdir intel
git clone --recursive https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper/revelation
rm package-lock.json
npm install --arch=x64 --platform=darwin
npm install --include=optional --os=darwin --cpu=x64 rollup
npm install --include=optional --os=darwin --cpu=x64 esbuild
npm run build
npm run dev
#  Ctrl+C to Exit

cd ..
rm package-lock.json
npm install --arch=x64 --platform=darwin

# Testing the app
npm start

# Resetting
rm -r revelation/presentations_*
rm plugins/bibletext/bibles/*.json

npm run dist-mac-intel
```
## Building on Windows

First install [Git](https://gitforwindows.org/) and [Node](https://nodejs.org/en/download)

Open a PowerShell window

```shell
git clone --recursive https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper/revelation
rm package-lock.json
npm install
npm run build
npm run dev
#  Ctrl+C to Exit

cd ..
rm package-lock.json
npm install

# Testing the app
npm start

# Resetting
Remove-Item -Recurse -Force revelation\presentations_*
Remove-Item  plugins\bibletext\bibles/*.json

npm run dist-win
```

## Building on Linux

setup envorinment (Ubuntu)
```shell
sudo apt install git npm rpm fakeroot curl build-essential
```

Build

```shell
git clone --recursive https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper/revelation
npm install
npm run build
npm run dev
#  Ctrl+C to Exit

cd ..
npm install
npm start
rm -r revelation/presentations_*
rm plugins/bibletext/bibles/*.json
npm run dist-linux

```