// preload_profile_dialog.js — IPC bridge for the Save-as-Profile dialog window
// Handlers: lib/profileWindow.js (profile-dialog:confirm / profile-dialog:cancel).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('profileDialogAPI', {
  confirm: (name, duplicate) => ipcRenderer.invoke('profile-dialog:confirm', name, duplicate),
  cancel:  ()     => ipcRenderer.invoke('profile-dialog:cancel')
});
