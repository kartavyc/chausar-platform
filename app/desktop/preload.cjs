const { contextBridge, ipcRenderer } = require('electron');
// Sandbox preloads cannot import project modules; main owns the shared validator.
contextBridge.exposeInMainWorld('chausar', Object.freeze({
  request: async (method, payload = {}) => {
    const reply = await ipcRenderer.invoke('chausar:request', { method, payload });
    if (reply?.ok === true) return reply.result;
    const error = reply?.error;
    throw Object.assign(new Error(typeof error?.message === 'string' ? error.message : 'The desktop request failed.'), { code: typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED' }, error?.owner === true ? { owner: true } : {});
  },
  openExternal: async url => { const reply = await ipcRenderer.invoke('chausar:open-external', String(url)); if (reply?.ok !== true) throw Object.assign(new Error(reply?.error?.message || 'The link could not be opened.'), { code: reply?.error?.code || 'REQUEST_FAILED' }, reply?.error?.owner === true ? { owner: true } : {}); },
  // The network import (4D1): the owner picks one of their own files; a desktop worker reads it and only what Chausar keeps comes back. Null when cancelled.
  pickNetworkFile: async (kind, options = {}) => {
    const request = { kind: String(kind) };
    if (Array.isArray(options?.ownerAddresses)) request.ownerAddresses = options.ownerAddresses.map(String);
    if (typeof options?.ownerProfile === 'string') request.ownerProfile = options.ownerProfile;
    if (typeof options?.timeZone === 'string') request.timeZone = options.timeZone;
    const reply = await ipcRenderer.invoke('chausar:network:pickFile', request);
    if (reply?.ok === true) return reply.result;
    throw Object.assign(new Error(reply?.error?.message || 'The file could not be read.'), { code: reply?.error?.code || 'REQUEST_FAILED' }, reply?.error?.owner === true ? { owner: true } : {});
  },
  // Export for your CA (4J4): saves one month's CSV where the owner picks; the system dialog asks before replacing a file. Null when cancelled.
  saveMoneyExport: async month => {
    const reply = await ipcRenderer.invoke('chausar:money:saveExport', { month: String(month) });
    if (reply?.ok === true) return reply.result;
    throw Object.assign(new Error(reply?.error?.message || 'The file could not be saved.'), { code: reply?.error?.code || 'REQUEST_FAILED' }, reply?.error?.owner === true ? { owner: true } : {});
  },
  // A client report (5A5): the desktop makes the files and saves them in a new folder where the owner picks. Null when cancelled.
  saveReport: async runId => {
    const reply = await ipcRenderer.invoke('chausar:report:save', { runId: String(runId) });
    if (reply?.ok === true) return reply.result;
    throw Object.assign(new Error(reply?.error?.message || 'The report could not be saved.'), { code: reply?.error?.code || 'REQUEST_FAILED' }, reply?.error?.owner === true ? { owner: true } : {});
  },
  saveYoutubeProject: async (editId, digest) => {
    const reply = await ipcRenderer.invoke('chausar:youtube:saveProject', { editId: String(editId), digest: String(digest) });
    if (reply?.ok === true) return reply.result;
    throw Object.assign(new Error(reply?.error?.message || 'The project could not be saved.'), { code: reply?.error?.code || 'EXPORT_NOT_SAVED' }, reply?.error?.owner === true ? { owner: true } : {});
  },
  pickAppTestApk: async (orderId, fromClient, digest) => {
    const reply = await ipcRenderer.invoke('chausar:apptest:pickApk', { orderId, fromClient, ...(digest === undefined ? {} : { digest }) });
    if (reply?.ok === true) return reply.result;
    throw Object.assign(new Error(reply?.error?.message || 'The client APK could not be read.'), { code: reply?.error?.code || 'CLIENT_APK_REQUIRED' }, reply?.error?.owner === true ? { owner: true } : {});
  },
  openYoutubeProject: async savedId => {
    const reply = await ipcRenderer.invoke('chausar:youtube:openProject', { savedId: String(savedId) });
    if (reply?.ok === true) return reply.result;
    throw Object.assign(new Error(reply?.error?.message || 'The saved folder could not be opened.'), { code: reply?.error?.code || 'EXPORT_NOT_SAVED' }, reply?.error?.owner === true ? { owner: true } : {});
  },
  saveSocialProject: async (orderId, digest) => {
    const reply = await ipcRenderer.invoke('chausar:social:saveProject', { orderId: String(orderId), digest: String(digest) });
    if (reply?.ok === true) return reply.result;
    throw Object.assign(new Error(reply?.error?.message || 'The approved posts could not be saved.'), { code: reply?.error?.code || 'EXPORT_NOT_SAVED' }, reply?.error?.owner === true ? { owner: true } : {});
  },
  openSocialProject: async savedId => {
    const reply = await ipcRenderer.invoke('chausar:social:openProject', { savedId: String(savedId) });
    if (reply?.ok === true) return reply.result;
    throw Object.assign(new Error(reply?.error?.message || 'The saved folder could not be opened.'), { code: reply?.error?.code || 'EXPORT_NOT_SAVED' }, reply?.error?.owner === true ? { owner: true } : {});
  },
  // After Delete (review of A1, row 1): show one kept export in the file manager, by its file name only.
  showExport: async name => {
    const reply = await ipcRenderer.invoke('chausar:exports:show', { name: String(name) });
    if (reply?.ok === true) return;
    throw Object.assign(new Error(reply?.error?.message || 'The copy could not be shown.'), { code: reply?.error?.code || 'REQUEST_FAILED' }, reply?.error?.owner === true ? { owner: true } : {});
  },
  // One-shot C4 task 36: save a copy of the whole business where the owner picks in the save dialog; null when cancelled.
  saveBusinessExport: async plaintext => {
    const reply = await ipcRenderer.invoke('chausar:export:saveAs', { plaintext: plaintext === true });
    if (reply?.ok === true) return reply.result;
    throw Object.assign(new Error(reply?.error?.message || 'The copy could not be saved.'), { code: reply?.error?.code || 'REQUEST_FAILED' }, reply?.error?.owner === true ? { owner: true } : {});
  },
  // C4 task 36: show a copy saved above in the file manager, by its id only.
  showSavedExport: async id => {
    const reply = await ipcRenderer.invoke('chausar:export:showSaved', { id: String(id) });
    if (reply?.ok === true) return;
    throw Object.assign(new Error(reply?.error?.message || 'The copy could not be shown.'), { code: reply?.error?.code || 'REQUEST_FAILED' }, reply?.error?.owner === true ? { owner: true } : {});
  },
  // One-shot A6: Email it or Share on WhatsApp on an issued invoice; only the invoice and how go to main, which makes the file.
  shareInvoice: async (invoiceId, how) => {
    const reply = await ipcRenderer.invoke('chausar:invoice:share', { invoiceId: String(invoiceId), how: String(how) });
    if (reply?.ok === true) return reply.result;
    throw Object.assign(new Error(reply?.error?.message || 'The invoice could not be shared.'), { code: reply?.error?.code || 'REQUEST_FAILED' }, reply?.error?.owner === true ? { owner: true } : {});
  },
  // A6: show the invoice file Chausar kept for sharing in the file manager, by its file name only.
  showShared: async name => {
    const reply = await ipcRenderer.invoke('chausar:share:show', { name: String(name) });
    if (reply?.ok === true) return;
    throw Object.assign(new Error(reply?.error?.message || 'The file could not be shown.'), { code: reply?.error?.code || 'REQUEST_FAILED' }, reply?.error?.owner === true ? { owner: true } : {});
  },
  // One-shot A5: start at login and keep running, read back from this computer; a change sends only the two ticks.
  getBackground: async () => {
    const reply = await ipcRenderer.invoke('chausar:background:get');
    if (reply?.ok === true) return reply.result;
    throw Object.assign(new Error(reply?.error?.message || 'Chausar could not read this setting.'), { code: reply?.error?.code || 'REQUEST_FAILED' }, reply?.error?.owner === true ? { owner: true } : {});
  },
  // A5 fix round 3: the day the owner put Today's start-at-login question aside; only the day goes to main.
  getAskLater: async () => {
    const reply = await ipcRenderer.invoke('chausar:background:later:get');
    if (reply?.ok === true) return typeof reply.result?.day === 'string' ? reply.result.day : null;
    throw Object.assign(new Error(reply?.error?.message || 'Chausar could not read this setting.'), { code: reply?.error?.code || 'REQUEST_FAILED' }, reply?.error?.owner === true ? { owner: true } : {});
  },
  setAskLater: async day => {
    const reply = await ipcRenderer.invoke('chausar:background:later:set', { day: String(day) });
    if (reply?.ok === true) return;
    throw Object.assign(new Error(reply?.error?.message || 'Chausar could not save this setting.'), { code: reply?.error?.code || 'REQUEST_FAILED' }, reply?.error?.owner === true ? { owner: true } : {});
  },
  setBackground: async update => {
    const request = {};
    if (typeof update?.startAtLogin === 'boolean') request.startAtLogin = update.startAtLogin;
    if (typeof update?.keepRunning === 'boolean') request.keepRunning = update.keepRunning;
    const reply = await ipcRenderer.invoke('chausar:background:set', request);
    if (reply?.ok === true) return reply.result;
    throw Object.assign(new Error(reply?.error?.message || 'Chausar could not change this setting.'), { code: reply?.error?.code || 'REQUEST_FAILED' }, reply?.error?.owner === true ? { owner: true } : {});
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
      'chain.changed', 'desk.changed', 'idea.changed', 'privacy.forgotten'];
    const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
    const whole = value => Number.isSafeInteger(value) && value >= 0;
    const listener = (_event, value) => {
      if (!value || typeof value !== 'object' || !types.includes(value.type) || !id(value.businessId) || (value.type !== 'privacy.forgotten' && value.runId !== undefined && !id(value.runId))) return;
      if (typeof value.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/.test(value.at)) return;
      if ((value.seq !== undefined && !whole(value.seq)) || (value.count !== undefined && (value.type !== 'notify.new' || !whole(value.count)))) return;
      callback(Object.freeze({
        type: value.type, businessId: value.businessId, ...(value.type !== 'privacy.forgotten' && value.runId !== undefined ? { runId: value.runId } : {}), at: value.at,
        ...(value.seq !== undefined ? { seq: value.seq } : {}), ...(value.count !== undefined ? { count: value.count } : {}),
      }));
    };
    ipcRenderer.on('chausar:venture-event', listener);
    return () => ipcRenderer.removeListener('chausar:venture-event', listener);
  },
}));
