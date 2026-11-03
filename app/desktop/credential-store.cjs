'use strict';
const { createHash, randomUUID } = require('node:crypto');
const { mkdir, lstat, open, rename, unlink } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { constants } = require('node:fs');
const { validate, failure } = require('../../platform/runtime/venture/models/credential-contract.cjs');

/**
 * Only the trusted main process owns this directory and Electron safeStorage. No plaintext files. A2 second review:
 * CREDENTIAL_NO_STORE only when safeStorage (or a Linux keyring) is really missing; any other failure is
 * CREDENTIAL_UNAVAILABLE, so a broken folder never reads as "no store here".
 */
function createCredentialStore({ directory, safeStorage, platform = process.platform }) {
  const root = resolve(directory), pending = new Map();
  function protectedStorage() {
    if (!safeStorage?.isEncryptionAvailable?.() || (platform === 'linux' && !['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(safeStorage.getSelectedStorageBackend?.()))) throw failure('CREDENTIAL_NO_STORE');
  }
  async function folder() {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const stat = await lstat(root); if (stat.isSymbolicLink() || !stat.isDirectory()) throw failure('CREDENTIAL_INVALID');
  }
  async function regular(path) {
    try { const stat = await lstat(path); if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 65536) throw failure('CREDENTIAL_INVALID'); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  function run(op, workspaceId, name, value) {
    try { validate(workspaceId, name, value, op === 'set'); } catch (error) { return Promise.reject(error); }
    const file = join(root, createHash('sha256').update(JSON.stringify([workspaceId, name])).digest('hex') + '.enc');
    const previous = pending.get(file) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      if (op !== 'delete') protectedStorage();
      await folder();
      const exists = await regular(file);
      if (op === 'delete') { if (exists) await unlink(file); return; }
      if (op === 'get') {
        if (!exists) return null;
        const handle = await open(file, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW ?? 0));
        let bytes;
        try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > 65536) throw failure('CREDENTIAL_INVALID'); bytes = await handle.readFile(); } finally { await handle.close(); }
        let saved; try { saved = JSON.parse(safeStorage.decryptString(bytes)); } catch { throw failure('CREDENTIAL_INVALID'); }
        if (!saved || saved.version !== 1 || saved.workspaceId !== workspaceId || saved.name !== name) throw failure('CREDENTIAL_INVALID');
        validate(saved.workspaceId, saved.name, saved.value, true); return saved.value;
      }
      const encrypted = safeStorage.encryptString(JSON.stringify({ version: 1, workspaceId, name, value }));
      if (!Buffer.isBuffer(encrypted) || encrypted.length > 65536) throw failure('CREDENTIAL_INVALID');
      const temporary = join(root, randomUUID() + '.tmp');
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(encrypted); await handle.sync(); } finally { await handle.close(); }
        await regular(file); await rename(temporary, file);
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    }).catch(error => { throw failure(error?.code === 'CREDENTIAL_INVALID' || error?.code === 'CREDENTIAL_NO_STORE' ? error.code : 'CREDENTIAL_UNAVAILABLE'); });
    pending.set(file, task); void task.finally(() => { if (pending.get(file) === task) pending.delete(file); }).catch(() => {}); return task;
  }
  return Object.freeze({ get: (workspaceId, name) => run('get', workspaceId, name), set: (workspaceId, name, value) => run('set', workspaceId, name, value), delete: (workspaceId, name) => run('delete', workspaceId, name) });
}
module.exports = { createCredentialStore };
