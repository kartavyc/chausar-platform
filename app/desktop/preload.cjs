const { contextBridge, ipcRenderer } = require('electron');
// Sandbox preloads cannot import project modules; main owns the shared validator.
contextBridge.exposeInMainWorld('chausar', Object.freeze({
  request: async (method, payload = {}) => {
    const reply = await ipcRenderer.invoke('chausar:request', { method, payload });
    if (reply?.ok === true) return reply.result;
    const error = reply?.error;
    throw Object.assign(new Error(typeof error?.message === 'string' ? error.message : 'The desktop request failed.'), { code: typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED' });
  },
  openExternal: async url => { const reply = await ipcRenderer.invoke('chausar:open-external', String(url)); if (reply?.ok !== true) throw Object.assign(new Error(reply?.error?.message || 'The link could not be opened.'), { code: reply?.error?.code || 'REQUEST_FAILED' }); },
  onEngineStatus: callback => {
    if (typeof callback !== 'function') throw new TypeError('Use a function for engine status updates.');
    const states = ['starting', 'ready', 'failed', 'stopping', 'stopped'];
    const listener = (_event, value) => callback(Object.freeze({ healthy: value?.healthy === true, state: states.includes(value?.state) ? value.state : 'failed' }));
    ipcRenderer.on('chausar:engine-status', listener);
    return () => ipcRenderer.removeListener('chausar:engine-status', listener);
  },
  // Run events (run.started, run.step, run.waiting, run.done, run.failed, queue.changed): four plain fields, frozen.
  onEvent: callback => {
    if (typeof callback !== 'function') throw new TypeError('Use a function for run events.');
    const types = ['run.started', 'run.step', 'run.waiting', 'run.done', 'run.failed', 'queue.changed'];
    const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
    const listener = (_event, value) => {
      if (!value || typeof value !== 'object' || !types.includes(value.type) || !id(value.businessId) || (value.runId !== undefined && !id(value.runId))) return;
      if (typeof value.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/.test(value.at)) return;
      callback(Object.freeze({ type: value.type, businessId: value.businessId, ...(value.runId !== undefined ? { runId: value.runId } : {}), at: value.at }));
    };
    ipcRenderer.on('chausar:venture-event', listener);
    return () => ipcRenderer.removeListener('chausar:venture-event', listener);
  },
}));
