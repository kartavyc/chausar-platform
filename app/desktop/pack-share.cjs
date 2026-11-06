'use strict';
// Chausar desktop (C5 task 16): Send to my CA in one step. The window names only the month and how; main asks the engine
// for that month's CA file and the remembered contact, keeps the file in Chausar's own share folder, and opens a mail
// draft to the CA with the file attached, or WhatsApp to the CA's number with the words filled in (a WhatsApp link cannot
// carry a file, so the file waits in the folder for "Show in folder"). Chausar sends nothing: the owner presses send.
const fsp = require('node:fs/promises');
const { join } = require('node:path');
const { validateExternalUrl } = require('./ipc-contract.cjs');
const { buildEml } = require('./mail-draft.cjs');
const { keepFile, prune, whatsappAppUrl } = require('./invoice-share.cjs');

const failure = (code, message) => Object.assign(new Error(message), { code });
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$/;
const WHATSAPP = /^\d{6,15}$/;
const FILE = /^[a-z0-9-]{1,80}\.csv$/;

function packRequest(input) {
  if (!isRecord(input) || Object.keys(input).some(key => key !== 'month' && key !== 'how') || typeof input.month !== 'string' || !MONTH.test(input.month)
    || (input.how !== 'email' && input.how !== 'whatsapp')) throw failure('INVALID_REQUEST', 'Choose a month, and email or WhatsApp.');
  return { month: input.month, how: input.how };
}

/** The pack:share handler: { ok: true, result: { how, opened, file, to } } or { ok: false, error } in plain words. */
async function sharePack(event, input, deps) {
  try {
    deps.assertTrustedSender(event, deps.window?.webContents);
    const { month, how } = packRequest(input);
    const contact = await deps.engine.request('venture.accountant.get', {});
    const address = isRecord(contact) ? contact[how === 'email' ? 'email' : 'whatsapp'] : null;
    if (typeof address !== 'string' || address === '') throw failure('CA_CONTACT_MISSING', how === 'email' ? "Add your CA's email first." : "Add your CA's WhatsApp number first.");
    if (how === 'email' ? !EMAIL.test(address) : !WHATSAPP.test(address)) throw failure('CA_CONTACT_BAD', how === 'email' ? "Check your CA's email address." : "Check your CA's WhatsApp number.");
    const file = await deps.engine.request('venture.money.export', { month });
    if (!isRecord(file) || typeof file.csv !== 'string' || typeof file.fileName !== 'string' || !FILE.test(file.fileName)) throw failure('REQUEST_FAILED', 'The file could not be made.');
    const bytes = Buffer.from(file.csv, 'utf8');
    const subject = `Books for ${month}`;
    const body = `Here are the books for ${month}, made by Chausar, for you to check and import.`;
    const fs = deps.fs ?? fsp;
    await fs.mkdir(deps.folder, { recursive: true });
    await prune(fs, deps.folder, (deps.now ?? Date.now)());
    const kept = await keepFile(fs, deps.folder, file.fileName, bytes);
    if (how === 'email') {
      const eml = buildEml({ to: address, subject, body, attachment: { name: file.fileName, mimeType: 'text/csv', bytes } });
      const draft = await keepFile(fs, deps.folder, file.fileName.replace(/\.csv$/, '.eml'), Buffer.from(eml, 'utf8'));
      const known = typeof deps.emlApp === 'function' ? await Promise.resolve().then(deps.emlApp).then(value => value === true, () => false) : true;
      const problem = known ? await Promise.resolve(deps.shell.openPath(join(deps.folder, draft))).catch(error => String(error?.message ?? error) || 'failed') : 'no app for email files';
      return { ok: true, result: { how, opened: problem === '' ? 'draft' : 'none', file: kept, to: address } };
    }
    const web = validateExternalUrl(`https://wa.me/${address}?text=${encodeURIComponent(body)}`);
    let opened = 'web';
    if (deps.whatsappApp()) {
      const appLink = whatsappAppUrl(web);
      if (appLink) { try { await deps.shell.openExternal(appLink); opened = 'app'; } catch { opened = 'web'; } }
    }
    if (opened === 'web') await deps.shell.openExternal(web);
    return { ok: true, result: { how, opened, file: kept, to: address } };
  } catch (error) {
    return { ok: false, error: deps.publicError(error) };
  }
}

module.exports = Object.freeze({ sharePack });
