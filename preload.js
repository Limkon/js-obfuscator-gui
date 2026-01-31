const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectFile: () => ipcRenderer.invoke('dialog:openFile'),
    obfuscate: (data) => ipcRenderer.invoke('perform-obfuscate', data),
    showContextMenu: () => ipcRenderer.send('show-context-menu')
});
