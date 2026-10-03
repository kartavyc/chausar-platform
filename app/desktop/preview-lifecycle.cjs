'use strict';
// Optional packaged-preview observation. It supplies evidence to the owning
// launcher; it does not change Engine readiness, dispatch or shutdown limits.
const { lstatSync, realpathSync, writeFileSync, linkSync, unlinkSync } = require('node:fs');
const { join, resolve } = require('node:path');

function createPreviewLifecycle({ metadata, profile, environment = process.env, pid = process.pid }) {
  if (metadata.chausarPreview !== true || environment.CHAUSAR_PREVIEW_OBSERVER_NONCE === undefined) return undefined;
  const nonce = environment.CHAUSAR_PREVIEW_OBSERVER_NONCE;
  if (!/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{40}$/.test(metadata.chausarSourceCommit ?? '') || !/^[a-f0-9]{40}$/.test(metadata.chausarSourceTree ?? '') || !Number.isSafeInteger(pid) || pid <= 0) throw new Error('Pinned preview observer identity required.');
  if (!profile || !Object.isFrozen(profile) || profile.userData !== join(profile.root, 'userData') || profile.sessionData !== join(profile.root, 'sessionData') || profile.vaults !== join(profile.root, 'userData', 'vaults')) throw new Error('The observer requires the bound fresh demo profile.');
  const base = Object.freeze({ schemaVersion: 1, nonce, pid, sourceCommit: metadata.chausarSourceCommit, sourceTree: metadata.chausarSourceTree,
    profileRoot: profile.root, userData: profile.userData, sessionData: profile.sessionData, vaults: profile.vaults });
  let readyWritten = false; let stoppedWritten = false;
  function write(name, record) {
    for (const path of [profile.root, profile.userData, profile.sessionData]) {
      const item = lstatSync(path);
      if (!item.isDirectory() || item.isSymbolicLink() || resolve(realpathSync(path)) !== path) throw new Error('The observer profile changed.');
    }
    const temporary = join(profile.root, `.${name}-${nonce}-${pid}.tmp`);
    writeFileSync(temporary, JSON.stringify({ ...base, ...record }) + '\n', { flag: 'wx', mode: 0o600 });
    // A complete owned file becomes visible under the fixed receipt name in one
    // exclusive operation. linkSync refuses an occupied destination with EEXIST.
    try { linkSync(temporary, join(profile.root, name)); } finally { unlinkSync(temporary); }
  }
  return Object.freeze({
    ready({ engineState, windowVisible }) {
      if (readyWritten) return;
      if (stoppedWritten || engineState !== 'ready' || windowVisible !== true) throw new Error('An engine ready and shown window observation is required once.');
      write('preview-ready.json', { state: 'ready', engineState, windowVisible, observedAt: new Date().toISOString() });
      readyWritten = true;
    },
    stopped({ engineResult, errors = [] }) {
      if (stoppedWritten || !Array.isArray(errors) || !errors.every(code => typeof code === 'string' && /^[A-Z_]{1,80}$/.test(code))) throw new Error('A single bounded shutdown observation is required.');
      const validResult = !!engineResult && typeof engineResult.graceful === 'boolean' && typeof engineResult.forced === 'boolean';
      const graceful = validResult && engineResult.graceful === true && engineResult.forced === false && engineResult.exitCode === 0 && errors.length === 0;
      const forced = validResult ? engineResult.forced : false;
      write('preview-stopped.json', { state: 'stopped', readyObserved: readyWritten, graceful, forced, engineExitCode: validResult && Number.isInteger(engineResult.exitCode) ? engineResult.exitCode : null,
        errors, observedAt: new Date().toISOString() });
      stoppedWritten = true;
    },
  });
}
module.exports = { createPreviewLifecycle };
