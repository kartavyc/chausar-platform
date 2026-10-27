'use strict';
// Chausar desktop (Ink v2 wave 5, package 5A5, P11): the print port for a client report's PDF. The engine worker asks
// over its own channel (engine-harness.cjs 'print'); main.cjs passes Electron in. The report's HTML is loaded in a
// hidden window that runs no script, in its own in-memory session that loads nothing but the page itself (every other
// request is cancelled), and Electron's printToPDF makes the PDF; the window is destroyed after. When the report has
// Hindi and this computer has no font that draws Devanagari, nothing is printed and the answer says 'font-missing', so
// the engine keeps the HTML with the reason instead of a PDF of empty boxes. Any failure answers 'failed'. Nothing is
// written to disk and nothing leaves this computer. Written for Chausar from Electron's documented API.
const { existsSync } = require('node:fs');
const { join } = require('node:path');

/** The session the print window uses: in memory (no persist: prefix), shared by every print. */
const PRINT_PARTITION = 'chausar-report-print';
/** The largest HTML printed: a data address this size still loads in Chromium. */
const MAX_HTML_BYTES = 1_500_000;
const PDF_OPTIONS = Object.freeze({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' }, preferCSSPageSize: false });

/**
 * Font files that draw Devanagari, where each system keeps them: Windows (Nirmala UI since 8.1, Mangal before),
 * macOS (Kohinoor Devanagari, Devanagari Sangam MN, Devanagari MT) and common Linux packages (Noto, Lohit, FreeFont).
 */
function devanagariFontPaths(platform, env) {
  if (platform === 'win32') {
    const fonts = join(env.WINDIR || env.SystemRoot || 'C:\\Windows', 'Fonts');
    return ['Nirmala.ttc', 'Nirmala.ttf', 'NirmalaS.ttf', 'mangal.ttf', 'Mangal.ttf'].map(name => join(fonts, name));
  }
  if (platform === 'darwin') {
    return ['/System/Library/Fonts/Kohinoor.ttc', '/System/Library/Fonts/Supplemental/Devanagari Sangam MN.ttc', '/System/Library/Fonts/Supplemental/DevanagariMT.ttc',
      '/Library/Fonts/Kohinoor.ttc'];
  }
  return ['/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf', '/usr/share/fonts/noto/NotoSansDevanagari-Regular.ttf',
    '/usr/share/fonts/google-noto/NotoSansDevanagari-Regular.ttf', '/usr/share/fonts/opentype/noto/NotoSansDevanagari-Regular.ttf',
    '/usr/share/fonts/truetype/lohit-devanagari/Lohit-Devanagari.ttf', '/usr/share/fonts/truetype/freefont/FreeSans.ttf'];
}

/** Whether this computer has a font that draws Devanagari. */
function hasDevanagariFont(deps = {}) {
  const exists = deps.exists ?? existsSync;
  return devanagariFontPaths(deps.platform ?? process.platform, deps.env ?? process.env).some(path => { try { return exists(path); } catch { return false; } });
}

/** The request as the harness passed it: an HTML string within bounds and the scripts it uses. Null otherwise. */
function printRequest(input) {
  if (!input || typeof input !== 'object' || typeof input.html !== 'string' || !Array.isArray(input.scripts)) return null;
  if (!input.html.startsWith('<!doctype html>') || Buffer.byteLength(input.html, 'utf8') > MAX_HTML_BYTES) return null;
  if (!input.scripts.every(script => script === 'latin' || script === 'devanagari')) return null;
  return { html: input.html, scripts: [...new Set(input.scripts)] };
}

/** The print session, set up once: nothing but the page's own data address loads, and no permission is granted. */
const prepared = new WeakSet();
function printSession(session) {
  const chosen = session.fromPartition(PRINT_PARTITION);
  if (!prepared.has(chosen)) {
    chosen.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !String(details.url).startsWith('data:text/html;') }));
    chosen.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    chosen.setPermissionCheckHandler(() => false);
    prepared.add(chosen);
  }
  return chosen;
}

/**
 * Prints a report's HTML to PDF: { ok: true, pdfBase64 } or { ok: false, reason: 'font-missing' | 'failed' }. deps:
 * Electron's BrowserWindow and session; exists, platform and env for the font check (tests pass stand-ins).
 */
async function printReport(input, deps) {
  const request = printRequest(input);
  if (!request) return { ok: false, reason: 'failed' };
  if (request.scripts.includes('devanagari') && !hasDevanagariFont(deps)) return { ok: false, reason: 'font-missing' };
  let window = null;
  try {
    window = new deps.BrowserWindow({
      show: false, width: 794, height: 1123, paintWhenInitiallyHidden: true,
      webPreferences: { session: printSession(deps.session), javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, images: false, spellcheck: false, webgl: false },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    await window.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(request.html, 'utf8').toString('base64')}`);
    const pdf = Buffer.from(await window.webContents.printToPDF(PDF_OPTIONS));
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') return { ok: false, reason: 'failed' };
    return { ok: true, pdfBase64: pdf.toString('base64') };
  } catch {
    return { ok: false, reason: 'failed' };
  } finally {
    try { if (window && !window.isDestroyed()) window.destroy(); } catch { /* already gone */ }
  }
}

module.exports = Object.freeze({ printReport, hasDevanagariFont, PRINT_PARTITION, PDF_OPTIONS });
