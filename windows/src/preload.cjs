const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('prIndicator', {
    getState: () => ipcRenderer.invoke('get-state'),
    onState: callback => ipcRenderer.on('state', (_e, state) => callback(state)),
    refresh: () => ipcRenderer.send('refresh'),
    openUrl: url => ipcRenderer.send('open-url', url),
    toggleSection: id => ipcRenderer.send('toggle-section', id),
    commitSectionOrder: ids => ipcRenderer.send('commit-section-order', ids),
    setTheme: name => ipcRenderer.send('set-theme', name),
    setBadgeSection: id => ipcRenderer.send('set-badge-section', id),
    submitToken: value => ipcRenderer.invoke('submit-token', value),
    resize: height => ipcRenderer.send('resize', height),
    hide: () => ipcRenderer.send('hide'),
});
