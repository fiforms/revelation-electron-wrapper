# Notas sobre empaquetado

---

## Compilación en OSx

Antes de compilar, asegúrese de tener Homebrew, Node.js y Git instalados. Desde una terminal:

```shell
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Verificar disponibilidad
brew --version

# Instalar Node:
brew install node

# Verificar:
node -v
npm -v

# Instalar Git
brew install git

# Verificar
git --version
```

---

### Compilar la aplicación

```shell
git clone --recursive https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper

npm install

# Probar la app
npm start

npm run dist-mac
```

---

### Compilación en OSx (intel, compilación cruzada desde arm64)

* Instale Rosetta
* Configure la app Terminal para abrir usando Rosetta
* Siga las instrucciones de compilación anteriores en un directorio nuevo


---

## Compilación en Windows

Primero instale [Git](https://gitforwindows.org/) y [Node](https://nodejs.org/en/download)

Abra una ventana de PowerShell

```shell
git clone --recursive https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper
npm install

# Probar la app
npm start

# Compilar plugin Poppler
npm run build-popplerpdf-win
npm run dist-popplerpdf-win

# Compilar paquete
npm run dist-win
```

---

## Compilación en Linux

Configurar entorno (Ubuntu)
```shell
sudo apt install git npm libnspr4 libnss3 ffmpeg
sudo npm install -g node@latest
sudo npm install -g npm@latest
```

Compilar

```shell
git clone --recursive https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper
npm install
npm start
npm run dist-linux

```
