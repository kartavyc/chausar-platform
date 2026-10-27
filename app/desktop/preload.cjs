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
  // The network import (4D1): the owner picks one of their own files; a desktop worker reads it and only what Chausar keeps comes back. Null when cancelled.
  pickNetworkFile: async (kind, options = {}) => {
    const request = { kind: String(kind) };
    if (Array.isArray(options?.ownerAddresses)) request.ownerAddresses = options.ownerAddresses.map(String);
    if (typeof options?.ownerProfile === 'string') request.ownerProfile = options.ownerProfile;
    if (typeof options?.timeZone === 'string') request.timeZone = options.timeZone;
    const reply = await ipcRenderer.invoke('chausar:network:pickFile', request);
    if (reply?.ok === true) return reply.result;
    throw Object.assign(new Error(reply?.error?.message || 'The file could not be read.'), { code: reply?.error?.code || 'REQUEST_FAILED' });
  },
  // Export for your CA (4J4): saves one month's CSV where the owner picks; the system dialog asks before replacing a file. Null when cancelled.
  saveMoneyExport: async month => {
    const reply = await ipcRenderer.invoke('chausar:money:saveExport', { month: String(month) });
    if (reply?.ok === true) return reply.result;
    throw Object.assign(new Error(reply?.error?.message || 'The file could not be saved.'), { code: reply?.error?.code || 'REQUEST_FAILED' });
  },
  // A client report (5A5): the desktop makes the files and saves them in a new folder where the owner picks. Null when cancelled.
  saveReport: async runId => {
    const reply = await ipcRenderer.invoke('chausar:report:save', { runId: String(runId) });
    if (reply?.ok === true) return reply.result;
    throw Object.assign(new Error(reply?.error?.message || 'The report could not be saved.'), { code: reply?.error?.code || 'REQUEST_FAILED' });
  },
  onEngineStatus: callback => {
    if (typeof callback !== 'function') throw new TypeError('Use a function for engine status updates.');
    const states = ['starting', 'ready', 'failed', 'stopping', 'stopped'];
    const listener = (_event, value) => callback(Object.freeze({ healthy: value?.healthy === true, state: states.includes(value?.state) ? value.state : 'failed' }));
    ipcRenderer.on('chausar:engine-status', listener);
    return () => ipcRenderer.removeListener('chausar:engine-status', listener);
  },
  // Run events (VENTURE_RUN_EVENT_TYPES): plain fields only, frozen. seq is the event's place in the business's log, for
  // replay after a gap; count rides on notify.new alone (Ink v2 wave 4, 4G1). The same rules as main's validateVentureEvent.
  onEvent: callback => {
    if (typeof callback !== 'function') throw new TypeError('Use a function for run events.');
    const types = ['run.started', 'run.step', 'run.waiting', 'run.done', 'run.failed', 'queue.changed',
      'agent.message', 'chief.message', 'proposal.created', 'notify.new', 'pipeline.changed', 'run.stopped', 'run.call', 'keeper.ran',
      'chain.changed', 'desk.changed', 'idea.changed'];
    const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
    const whole = value => Number.isSafeInteger(value) && value >= 0;
    const listener = (_event, value) => {
      if (!value || typeof value !== 'object' || !types.includes(value.type) || !id(value.businessId) || (value.runId !== undefined && !id(value.runId))) return;
      if (typeof value.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/.test(value.at)) return;
      if ((value.seq !== undefined && !whole(value.seq)) || (value.count !== undefined && (value.type !== 'notify.new' || !whole(value.count)))) return;
      callback(Object.freeze({
        type: value.type, businessId: value.businessId, ...(value.runId !== undefined ? { runId: value.runId } : {}), at: value.at,
        ...(value.seq !== undefined ? { seq: value.seq } : {}), ...(value.count !== undefined ? { count: value.count } : {}),
      }));
    };
    ipcRenderer.on('chausar:venture-event', listener);
    return () => ipcRenderer.removeListener('chausar:venture-event', listener);
  },
}));
