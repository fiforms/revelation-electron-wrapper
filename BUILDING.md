# Notes on packaging

## Building on OSx (arm64)

```shell
git clone --recursive https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper
rm package-lock.json
npm install
npm install --include=optional sharp
npm install dmg-license
# cp -a http_admin revelation/admin # Not Needed
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
# cp -a http_admin revelation/admin  #Not Needed
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
## Building on Windows

```shell
git clone --recursive https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper
rm package-lock.json
npm install -D emnapi
npm install @emnapi/runtime
npm install -D sharp
cd revelation
rm package-lock.json
npm install
npm run build
npm run dev
cd ..

# Testing the app
npm start

# Resetting
Remove-Item -Recurse -Force revelation\presentations_*

npm run dist-win
```

## Building on Linux

*Note: Package broken because presentations directory is in a read-only filesystem*

```shell
sudo apt install flatpak flatpak-builder
flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install flathub org.freedesktop.Sdk//24.08
flatpak install flathub org.freedesktop.Platform//24.08
git clone --recursive https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper
npm install
cd revelation
npm install
npm run build
npm run dev
cd ..
npm start
rm -r revelation/presentations_*
npm run dist-linux

```