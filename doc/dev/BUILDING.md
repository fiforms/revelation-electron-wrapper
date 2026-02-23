---

# Notes on packaging

---

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

---

### Building the Application

```shell
git clone --recursive https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper

npm install

# Testing the app
npm start

npm run dist-mac
```

---

### Building on OSx (intel, cross compiling from arm64)

* Install Rosetta
* Set the Terminal app to open using Rosetta
* Follow build instrucitons above in a fresh directory


---

## Building on Windows

First install [Git](https://gitforwindows.org/) and [Node](https://nodejs.org/en/download)

Open a PowerShell window

```shell
git clone --recursive https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper
npm install

# Testing the app
npm start

# Building Package
npm run dist-win
```

---

## Building on Linux

setup envorinment (Ubuntu)
```shell
sudo apt install git npm libnspr4 libnss3 ffmpeg
sudo npm install -g node@latest
sudo npm install -g npm@latest
```

Build

```shell
git clone --recursive https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper
npm install
npm start
npm run dist-linux

```
