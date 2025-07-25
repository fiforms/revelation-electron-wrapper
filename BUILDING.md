# Notes on packaging

## Building on OSx (arm64)

```shell
git clone --recursive https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper
rm package-lock.json
npm install
npm install --include=optional sharp
npm install dmg-license
cp -a http_admin revelation/admin
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
rm package-lock.json
npm install --arch=x64 --platform=darwin
npm install --include=optional --os=darwin --cpu=x64 sharp
cp -a http_admin revelation/admin
cd revelation
rm package-lock.json
npm install --arch=x64 --platform=darwin
npm install --include=optional --os=darwin --cpu=x64 rollup
npm install --include=optional --os=darwin --cpu=x64 esbuild
npm run build
npm run dev
cd ..

# Testing the app
npm start

# Resetting
rm -r revelation/presentations_*

npm run dist-mac-intel
```
