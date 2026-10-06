# Instalar REVELation Snapshot Presenter en macOS

REVELation aún no está firmado con un Apple Developer ID, por lo que Gatekeeper de macOS bloquea el primer inicio.
La app es segura de abrir. Sigue los pasos para tu versión de macOS.

## 1. Instalar

1. Abre el `.dmg` descargado.
2. Arrastra **REVELation Snapshot Presenter** a **Applications**.
3. Expulsa el DMG.

---

## 2. Primer inicio
### macOS 15 Sequoia y posteriores

1. Abre **Applications** y haz doble clic en la app. macOS muestra una advertencia. Haz clic en **Done** (no hagas clic en Move to Trash).
2. Abre **System Settings → Privacy & Security** y desplázate hasta **Security**.
3. Junto a "REVELation Snapshot Presenter was blocked", haz clic en **Open Anyway** e ingresa tu contraseña.
4. Haz clic en **Open** en el aviso final.

Solo necesitas hacer esto una vez.

### macOS 14 Sonoma y anteriores

Haz clic derecho (o Control-clic) en la app en **Applications**, elige **Open** y luego haz clic en **Open** en el cuadro de diálogo.

---

## 3. Si macOS dice que la app está "dañada y no se puede abrir"

Esto ocurre cuando la descarga está marcada como en cuarentena y la app no tiene una firma válida. Abre **Terminal** y ejecuta:

```
xattr -cr "/Applications/REVELation Snapshot Presenter.app"
```

Luego abre la app de nuevo (repite el paso 2 si se te solicita). Esto solo quita la marca de
"descargado de internet" de esta única app.

## Notas

- Descargar con un navegador distinto de Safari no cambia nada; cualquier navegador agrega la marca de cuarentena.
- Elige el DMG **Apple Silicon (arm64)** para Macs M1/M2/M3/M4 y el DMG **Intel (x64)** para Macs más antiguos.
