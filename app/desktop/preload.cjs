const { contextBridge, ipcRenderer } = require('electron');
// Sandbox preloads cannot import project modules; main owns the shared validator.
contextBridge.exposeInMainWorld('chausar', Object.freeze({
  request: async (method, payload = {}) => {
    const reply = await ipcRenderer.invoke('chausar:request', { method, payload });
    if (reply?.ok === true) return reply.result;
    const error = reply?.error;
    throw Object.assign(new Error(typeof error?.message === 'string' ? error.message : 'The desktop request failed.'), { code: typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED' });
  },
  onEngineStatus: callback => {
    if (typeof callback !== 'function') throw new TypeError('Use a function for engine status updates.');
    const states = ['starting', 'ready', 'failed', 'stopping', 'stopped'];
    const listener = (_event, value) => callback(Object.freeze({ healthy: value?.healthy === true, state: states.includes(value?.state) ? value.state : 'failed' }));
    ipcRenderer.on('chausar:engine-status', listener);
    return () => ipcRenderer.removeListener('chausar:engine-status', listener);
  },
}));
