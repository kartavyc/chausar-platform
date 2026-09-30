const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('chausar', Object.freeze({
  request: (method, payload = {}) => ipcRenderer.invoke('chausar:request', { method, payload }),
  onEngineStatus: callback => { const listener = (_event, value) => callback(Object.freeze({ healthy: value.healthy === true })); ipcRenderer.on('chausar:engine-status', listener); return () => ipcRenderer.removeListener('chausar:engine-status', listener); },
}));
