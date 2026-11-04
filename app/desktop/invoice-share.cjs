'use strict';
// Chausar desktop (one-shot A6, the founder's answers 6 and 7): Email it and Share on WhatsApp on an issued invoice.
// The window names only the invoice and how ({ invoiceId, how: 'email' | 'whatsapp' }); main asks the engine for the
// file and its share words itself (venture.invoice.pdf) and keeps the file in Chausar's own share folder (main passes
// <userData>/share, never a vault folder), written whole through a temporary file. Files of ours older than a day are
// taken out of that folder each time. Chausar sends nothing: the owner presses send in their own app.
// - email: an .eml draft with the file attached (mail-draft.cjs) beside it, opened with the computer's mail app. With
//   no app for email files, the checked mail link opens instead (no file then), and the answer says which.
// - whatsapp: the WhatsApp desktop app when this computer has one for whatsapp:// links, else the wa.me web page, with
//   the words filled in. A WhatsApp link cannot carry a file, so the file waits in the share folder for the owner to drag
//   in ("Show the PDF in its folder", showShared). Every link opened is built here from a checked engine link.
const fsp = require('node:fs/promises');
const { randomBytes } = require('node:crypto');
const { execFile } = require('node:child_process');
const { basename, dirname, join, relative } = require('node:path');
const { constants: fsConstants } = require('node:fs');
const { mailtoParts, validateExternalUrl } = require('./ipc-contract.cjs');
const { buildEml, cleanSubject, FILE_NAME, TYPES } = require('./mail-draft.cjs');

const DAY_MS = 24 * 60 * 60_000;
const MAX_LINK = 30_000;
const INVOICE_ID = /^[A-Za-z0-9_.:-]{1,200}$/;
const OURS = /^[A-Za-z0-9-]{1,80}\.(?:pdf|html|eml)$/;
const STAGED = /^\.[A-Za-z0-9-]{1,80}\.(?:pdf|html|eml)\.[0-9a-f]{12}\.tmp$/;
const failure = (code, message) => Object.assign(new Error(message), { code });
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const notMade = () => failure('REQUEST_FAILED', 'The invoice file could not be made. Try again.');

/** { invoiceId, how } and nothing else: never a path, a link or words from the window. */
function shareRequest(input) {
  if (!isRecord(input) || Object.keys(input).some(key => key !== 'invoiceId' && key !== 'how') || typeof input.invoiceId !== 'string' || !INVOICE_ID.test(input.invoiceId)
    || (input.how !== 'email' && input.how !== 'whatsapp')) throw failure('INVALID_REQUEST', 'Choose an invoice, and Email it or Share on WhatsApp.');
  return { invoiceId: input.invoiceId, how: input.how };
}

/** The engine's file, checked: a name Chausar made, the type that goes with it, and real base64 bytes. */
function engineFile(file) {
  if (!isRecord(file) || typeof file.fileName !== 'string' || typeof file.contentBase64 !== 'string' || !isRecord(file.share)) throw notMade();
  const match = FILE_NAME.exec(file.fileName);
  if (!match || file.mimeType !== TYPES[match[1]]) throw notMade();
  const text = file.contentBase64;
  if (text.length === 0 || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw notMade();
  const bytes = Buffer.from(text, 'base64');
  if (bytes.toString('base64') !== text) throw notMade();
  const note = typeof file.note === 'string' ? file.note.slice(0, 300) : null;
  return { name: file.fileName, mimeType: file.mimeType, bytes, note, share: file.share };
}

/**
 * The WhatsApp desktop app's link for a checked wa.me link (https://wa.me/ or https://wa.me/<6 to 15 digits>, with one
 * text and nothing else), or null.
 */
function whatsappAppUrl(input) {
  if (typeof input !== 'string' || input.length > MAX_LINK || input.includes('#')) return null;
  let url;
  try { url = new URL(input); } catch { return null; }
  if (url.protocol !== 'https:' || url.host !== 'wa.me' || url.username !== '' || url.password !== '') return null;
  const path = /^\/(\d{6,15})?$/.exec(url.pathname);
  const query = url.search.startsWith('?') ? url.search.slice(1) : '';
  if (!path || query === '' || query.includes('&')) return null;
  const equals = query.indexOf('=');
  if (equals < 0 || query.slice(0, equals) !== 'text') return null;
  let text;
  try { text = decodeURIComponent(query.slice(equals + 1).replace(/\+/g, ' ')); } catch { return null; }
  const link = `whatsapp://send?${path[1] ? `phone=${path[1]}&` : ''}text=${encodeURIComponent(text)}`;
  return link.length <= MAX_LINK ? link : null;
}

/** A file system failure in plain words, never with a path on this computer. */
function plain(error) {
  if (error?.code === 'ENOSPC' || error?.code === 'EDQUOT') return failure('SHARE_NOT_SAVED', 'There is not enough space on this computer to keep the file. Free some space and try again.');
  return failure('SHARE_NOT_SAVED', 'Chausar could not keep the file on this computer. Try again.');
}

/** Writes bytes whole: a temporary file beside it, flushed, then renamed over the name. A failure leaves nothing. */
async function writeWhole(fs, target, bytes) {
  const temp = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

// A6 rounds 1 and 2: on Windows a file another app holds open (the PDF in a viewer after "Show the PDF in its folder",
// the .eml in the mail app) cannot be replaced: the rename fails with EBUSY, or with EPERM or EACCES over a file that is
// there and writable. EPERM or EACCES with no such file is a plain refusal to write, said as that.
const DENIED = new Set(['EPERM', 'EACCES']);
const notAllowed = () => failure('SHARE_NOT_ALLOWED', "Chausar isn't allowed to write in its share folder. Check that folder's permissions, then try again.");
async function heldOpen(fs, path, error) {
  if (error?.code === 'EBUSY') return true;
  if (!DENIED.has(error?.code)) return false;
  const found = await fs.lstat(path).catch(() => null);
  if (!found || !found.isFile()) return false;
  return fs.access(path, fsConstants.W_OK).then(() => true, () => false);
}
// Shares of the same name run one after another, so two at once never race for one file.
const writing = new Map();
function oneAtATime(key, work) {
  const next = (writing.get(key) ?? Promise.resolve()).then(work, work);
  const settled = next.then(() => {}, () => {});
  writing.set(key, settled);
  void settled.then(() => { if (writing.get(key) === settled) writing.delete(key); });
  return next;
}

/**
 * Keeps bytes in the share folder under the name, and answers the name used: a file already there with the same bytes
 * is used as it is; one another app holds open is left alone and the next free name is used (INV-0001-2.pdf up to -9).
 * When every name is held, the owner is asked to close the file in the other app.
 */
function keepFile(fs, folder, name, bytes) {
  return oneAtATime(join(folder, name), async () => {
    const dot = name.lastIndexOf('.');
    for (let n = 1; n <= 9; n++) {
      const candidate = n === 1 ? name : `${name.slice(0, dot)}-${n}${name.slice(dot)}`;
      if (!OURS.test(candidate)) break;
      const path = join(folder, candidate);
      const found = await fs.lstat(path).catch(() => null);
      if (found && found.isFile() && found.size === bytes.length) {
        const there = await fs.readFile(path).catch(() => null);
        if (there && there.equals(bytes)) {
          // A6 round 2: a fresh time, so the next prune never takes a file the sheet still offers.
          const now = new Date();
          await fs.utimes(path, now, now).catch(() => {});
          return candidate;
        }
      }
      try { await writeWhole(fs, path, bytes); return candidate; } catch (error) {
        if (await heldOpen(fs, path, error)) continue;
        throw DENIED.has(error?.code) ? notAllowed() : plain(error);
      }
    }
    throw failure('SHARE_FILE_IN_USE', `${name} is open in another app. Close it there and try again.`);
  });
}

/** Takes our files older than a day out of the share folder. Anything else there is left alone. */
async function prune(fs, folder, now) {
  const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !(OURS.test(entry.name) || STAGED.test(entry.name))) continue;
    const path = join(folder, entry.name);
    const found = await fs.lstat(path).catch(() => null);
    if (found && now - found.mtimeMs > DAY_MS) await fs.rm(path, { force: true }).catch(() => {});
  }
}

/** Runs a read-only system command with no window, within the time given: { code, stdout }. */
function quietRun(command, args, { timeoutMs = 5000 } = {}) {
  return new Promise(done => {
    execFile(command, args, { windowsHide: true, timeout: Math.max(1, timeoutMs), encoding: 'utf8', maxBuffer: 64 * 1024 }, (error, stdout) => {
      done({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: typeof stdout === 'string' ? stdout : '' });
    });
  });
}

const PROG_ID = /^[A-Za-z0-9._-]{1,200}$/;
/** A registry value a `reg query` printed: the named one, or with no name the first text value (the default value's
 * name is localised, "(Default)" or "(Standard)"); null when there is none. */
function regValue(stdout, name = null) {
  for (const line of String(stdout).split(/\r?\n/)) {
    const match = /^\s+(\S.*?)\s+REG_(?:SZ|EXPAND_SZ)\s+(.*)$/.exec(line);
    if (match && (name === null || match[1].toLowerCase() === name.toLowerCase())) return match[2].trim() || null;
  }
  return null;
}

const EML_KEYS = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.eml`;
/**
 * A6 rounds 1 and 2: whether this computer names an app for email files, read quietly (no window, nothing changed),
 * within one time limit for the whole check. Windows (reg.exe by its full path): the owner's own choice, first where
 * Windows 11 24H2 keeps it (UserChoiceLatest), then UserChoice, else the .eml class; that program's shell verbs must be
 * there. Linux: xdg-mime's default for message/rfc822. macOS: Mail opens email files on every Mac. Any failure is no.
 */
async function emlHandler({ platform = process.platform, run = quietRun, limitMs = 5000, reg = join(process.env.SystemRoot || String.raw`C:\Windows`, 'System32', 'reg.exe') } = {}) {
  const end = Date.now() + limitMs;
  // A7 (A6 leftover): once the time is spent, the answer is no and nothing more starts (a check still racing the
  // limit would otherwise go on running reg.exe after the share had moved on).
  const ask = (command, args) => {
    const left = end - Date.now();
    return left <= 0 ? Promise.resolve({ code: 1, stdout: '' }) : run(command, args, { timeoutMs: left });
  };
  const check = async () => {
    if (platform === 'darwin') return true;
    if (platform === 'linux') {
      const reply = await ask('xdg-mime', ['query', 'default', 'message/rfc822']);
      return reply.code === 0 && /^[A-Za-z0-9._-]+\.desktop$/.test(String(reply.stdout).trim());
    }
    if (platform !== 'win32') return false;
    let progId = null;
    for (const key of [`${EML_KEYS}\\UserChoiceLatest\\ProgId`, `${EML_KEYS}\\UserChoice`]) {
      const reply = await ask(reg, ['query', key, '/v', 'ProgId']);
      progId = reply.code === 0 ? regValue(reply.stdout, 'ProgId') : null;
      if (progId) break;
    }
    if (!progId) {
      const fallback = await ask(reg, ['query', String.raw`HKCR\.eml`, '/ve']);
      progId = fallback.code === 0 ? regValue(fallback.stdout) : null;
    }
    if (!progId || !PROG_ID.test(progId) || progId.includes('..')) return false;
    return (await ask(reg, ['query', `HKCR\\${progId}\\shell`])).code === 0;
  };
  let timer;
  try {
    return await Promise.race([check(), new Promise(done => { timer = setTimeout(() => done(false), limitMs); })]);
  } catch {
    return false;
  } finally { clearTimeout(timer); }
}

/** The invoice:share handler: { ok: true, result } or { ok: false, error } in plain words. */
async function shareInvoice(event, input, deps) {
  try {
    deps.assertTrustedSender(event, deps.window?.webContents);
    const { invoiceId, how } = shareRequest(input);
    const file = engineFile(await deps.engine.request('venture.invoice.pdf', { invoiceId }));
    const fs = deps.fs ?? fsp;
    // Everything is checked before anything is written or opened.
    let eml = null, mail = null, appLink = null, webLink = null;
    if (how === 'email') {
      // A6 round 1: an address the engine keeps but a mail link cannot carry (o'brien@, a&b@, a name with accents) is
      // left out: the draft and the link go with no To line, and the owner adds the address. The subject and body are
      // checked the same either way.
      let link = typeof file.share.mailtoUrl === 'string' ? file.share.mailtoUrl : '';
      let parts = mailtoParts(link);
      if (!parts) {
        const bare = link.replace(/^mailto:[^?#]*/i, 'mailto:');
        parts = bare !== link ? mailtoParts(bare) : null;
        link = bare;
      }
      if (!parts) throw notMade();
      try { eml = buildEml({ to: parts.address, subject: parts.subject, body: parts.body, attachment: { name: file.name, mimeType: file.mimeType, bytes: file.bytes } }); } catch { throw notMade(); }
      // A7 (A6 leftover): the fallback link carries the subject as the draft does, hidden marks out (but the joiners).
      const subject = cleanSubject(parts.subject);
      const query = [...(subject ? [`subject=${encodeURIComponent(subject)}`] : []), ...(parts.body ? [`body=${encodeURIComponent(parts.body)}`] : [])].join('&');
      mail = { to: parts.address !== '', link: `mailto:${encodeURIComponent(parts.address).replace(/%40/g, '@')}${query ? `?${query}` : ''}` };
    } else {
      appLink = whatsappAppUrl(file.share.whatsappUrl);
      if (!appLink) throw notMade();
      try { webLink = validateExternalUrl(file.share.whatsappUrl); } catch { throw notMade(); }
    }
    try { await fs.mkdir(deps.folder, { recursive: true }); } catch (error) { throw plain(error); }
    await prune(fs, deps.folder, (deps.now ?? Date.now)());
    const kept = await keepFile(fs, deps.folder, file.name, file.bytes);
    if (how === 'email') {
      const draftPath = join(deps.folder, await keepFile(fs, deps.folder, file.name.replace(/\.(?:pdf|html)$/, '.eml'), Buffer.from(eml, 'utf8')));
      let opened = 'draft';
      // A6 round 1: a file no app takes may bring up Windows' "How do you want to open this file?" box while openPath
      // still answers '', so the draft is opened only when this computer names an app for email files.
      const known = typeof deps.emlApp === 'function' ? await Promise.resolve().then(deps.emlApp).then(value => value === true, () => false) : true;
      const problem = known ? await Promise.resolve(deps.shell.openPath(draftPath)).catch(error => String(error?.message ?? error) || 'failed') : 'no app for email files';
      if (problem !== '') {
        // The mail link only when the gate opens it (a long message is too long for one link): then nothing opened.
        try { await deps.shell.openExternal(validateExternalUrl(mail.link)); opened = 'link'; } catch { opened = 'none'; }
      }
      // A6 round 2: the draft attaches the file under the engine's name; kept is the file on disk, for Show the PDF in its folder.
      return { ok: true, result: { how, opened, file: kept, attached: file.name, to: mail.to, note: file.note } };
    }
    let opened = 'web';
    if (deps.whatsappApp()) {
      try { await deps.shell.openExternal(appLink); opened = 'app'; } catch { opened = 'web'; }
    }
    if (opened === 'web') await deps.shell.openExternal(webLink);
    return { ok: true, result: { how, opened, file: kept, note: file.note } };
  } catch (error) {
    return { ok: false, error: deps.publicError(error) };
  }
}

/** The share:show handler: shows one invoice file of the share folder in the file manager, by its name only. */
async function showShared(event, input, deps) {
  try {
    deps.assertTrustedSender(event, deps.window?.webContents);
    const name = isRecord(input) && Object.keys(input).length === 1 ? input.name : undefined;
    if (typeof name !== 'string' || !FILE_NAME.test(name)) throw failure('INVALID_REQUEST', 'Choose the invoice file Chausar kept.');
    const path = join(deps.folder, name);
    if (relative(deps.folder, path) !== name) throw failure('INVALID_REQUEST', 'Choose the invoice file Chausar kept.');
    const found = await (deps.fs ?? fsp).lstat(path).catch(() => null);
    if (!found || !found.isFile()) throw failure('SHARE_FILE_GONE', 'That file is not there any more. Press the button again to make it.');
    deps.shell.showItemInFolder(path);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: deps.publicError(error) };
  }
}

module.exports = Object.freeze({ shareInvoice, showShared, whatsappAppUrl, emlHandler });
