# Notes on packaging

## Building on OSx (arm64)

```shell
git clone --recursive https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper
npm install
cd revelation
npm install
npm run build
npm run dev
cd ..

# Testing the app
npm start

# Resetting
rm -r revelation/presentations_*

npm run dist-mac
```

## Building on OSx (intel, cross compiling from arm64)

```shell
mkdir intel
git clone --recursive https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper
npm install --arch=x64 --platform=darwin
cd revelation
npm install --arch=x64 --platform=darwin
npm run build
npm run dev
cd ..

# Testing the app
npm start

# Resetting
rm -r revelation/presentations_*

npm run dist-mac
```
