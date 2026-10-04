# Installing REVELation Snapshot Presenter on macOS

REVELation is not yet signed with an Apple Developer ID, so macOS Gatekeeper blocks the first launch.
The app is safe to open. Follow the steps for your macOS version.

## 1. Install

1. Open the downloaded `.dmg`.
2. Drag **REVELation Snapshot Presenter** into **Applications**.
3. Eject the DMG.

## 2. First launch

### macOS 15 Sequoia and later

1. Open **Applications** and double-click the app. macOS shows a warning. Click **Done** (do not click Move to Trash).
2. Open **System Settings → Privacy & Security** and scroll to **Security**.
3. Next to "REVELation Snapshot Presenter was blocked", click **Open Anyway** and enter your password.
4. Click **Open** in the final prompt.

You only need to do this once.

### macOS 14 Sonoma and earlier

Right-click (or Control-click) the app in **Applications**, choose **Open**, then click **Open** in the dialog.

## 3. If macOS says the app is "damaged and can't be opened"

This happens when the download is flagged as quarantined and the app has no valid signature. Open **Terminal** and run:

```
xattr -cr "/Applications/REVELation Snapshot Presenter.app"
```

Then open the app again (repeat step 2 if prompted). This only removes the "downloaded from the internet"
flag from this one app.

## Notes

- Downloading with a browser other than Safari makes no difference; any browser adds the quarantine flag.
- Choose the **Apple Silicon (arm64)** DMG for M1/M2/M3/M4 Macs and the **Intel (x64)** DMG for older Macs.
