// Qualification run: Windows' real file locking against the invoice share (one-shot A6 round 1, medium 1). A PDF viewer
// holds the file open with read sharing only (no delete sharing), so the share cannot rename a fresh copy over it. The
// open suite checks the share's answer on every computer with a stand-in fs whose rename throws EPERM, EACCES or EBUSY
// the way Windows does (desktop-invoice-share-a6.test.ts), so CI never needs a real lock. This file holds a real lock:
//   - a hidden PowerShell opens INV-0001.pdf as a PDF viewer does, and the rename over it really fails with one of the
//     codes the stand-in uses;
//   - the share then keeps INV-0001-2.pdf with the right bytes and leaves the held file alone.
// It lives in a subfolder so the open benchmark (platform/tests/*.test.ts) never picks it up, and it writes only to a
// temp folder. Nothing opens on screen: the share's mail app and WhatsApp are stubs, and PowerShell runs hidden.
// Run it on Windows with:
//   node --test platform/tests/qualification/invoice-share-lock-real.test.ts
// On any other platform it fails with one test that says so. It never skips, so a qualification run can't pass by
// accident.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const share = require('../../../app/desktop/invoice-share.cjs');

const PDF = Buffer.from('%PDF-1.7 synthetic invoice for a test\n'.repeat(8));
const TEXT = 'Hello Test Client One,\n\nHere is invoice INV-0001 for INR 23,305.00. The PDF is attached.';
const SUBJECT = 'Invoice INV-0001 from Ledger Cafe Books';

/** Stub deps for the share: the engine answers one PDF; nothing is opened on this computer. */
async function shareDeps(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-share-lock-'));
  // A file still held by another process (EBUSY) never fails the cleanup.
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined));
  const folder = join(root, 'share'), opened: string[] = [];
  const deps = {
    window: { webContents: {} }, folder, assertTrustedSender: () => {},
    publicError: (error: any) => ({ code: error.code, message: error.message }),
    engine: { request: async () => ({
      fileName: 'INV-0001.pdf', format: 'pdf', mimeType: 'application/pdf', contentBase64: PDF.toString('base64'), note: null,
      share: { text: TEXT, subject: SUBJECT, whatsappUrl: `https://wa.me/?text=${encodeURIComponent(TEXT)}`, mailtoUrl: `mailto:client@example.com?subject=${encodeURIComponent(SUBJECT)}` },
    }) },
    shell: { openPath: async () => '', openExternal: async (url: string) => { opened.push(url); }, showItemInFolder: () => {} },
    whatsappApp: () => true,
  };
  return { deps, folder, opened };
}

/**
 * Holds a file open the way a PDF viewer does (read sharing only, no delete sharing) in a hidden PowerShell, and
 * answers the release. Waiting for it to start is time-limited, and the release always ends the process.
 */
async function holdOpen(path: string): Promise<() => Promise<void>> {
  const holder = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$f=[System.IO.File]::Open('${path}', 'Open', 'Read', 'Read'); Write-Output held; [Console]::In.ReadLine() | Out-Null; $f.Close()`], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const exited = new Promise<void>(done => { if (holder.exitCode !== null) done(); else holder.once('exit', () => done()); });
  const release = async () => {
    holder.stdin.end();
    const late = setTimeout(() => holder.kill(), 3000);
    await Promise.race([exited, new Promise(done => setTimeout(done, 6000))]);
    clearTimeout(late);
    if (holder.exitCode === null && holder.signalCode === null) { holder.kill(); await Promise.race([exited, new Promise(done => setTimeout(done, 2000))]); }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      new Promise(done => holder.stdout.once('data', done)),
      new Promise((_, fail) => { timer = setTimeout(() => fail(new Error('The file holder did not start.')), 10_000); }),
    ]);
  } catch (error) { await release(); throw error; } finally { clearTimeout(timer); }
  return release;
}

if (process.platform !== 'win32') {
  test('this qualification run needs Windows file locking', () => {
    assert.fail(`This computer runs ${process.platform}, which has no Windows file locking. Run `
      + 'node --test platform/tests/qualification/invoice-share-lock-real.test.ts on Windows. Nothing was checked against a real lock.');
  });
} else {
  test('Windows for real: a PDF held open without delete sharing refuses the rename, and the share goes through under the next name', { timeout: 30_000 }, async t => {
    const s = await shareDeps(t);
    await mkdir(s.folder, { recursive: true });
    const path = join(s.folder, 'INV-0001.pdf');
    await writeFile(path, 'an older copy');
    const release = await holdOpen(path);
    // Released in the test itself, before the folder is cleaned up, even when an assertion fails.
    try {
      // The code Windows really gives is one the open suite's stand-in throws.
      const probe = join(s.folder, 'probe.tmp');
      await writeFile(probe, 'probe');
      const refused = await rename(probe, path).then(() => null, (error: any) => error?.code);
      assert.ok(['EPERM', 'EACCES', 'EBUSY'].includes(refused), `the rename over the held file answered ${refused}`);
      await rm(probe, { force: true });

      const reply = await share.shareInvoice({}, { invoiceId: 'inv-0001', how: 'whatsapp' }, s.deps);
      assert.deepEqual([reply.ok, reply.result?.file], [true, 'INV-0001-2.pdf']);
      assert.deepEqual(await readFile(join(s.folder, 'INV-0001-2.pdf')), PDF);
      assert.equal(await readFile(path, 'utf8'), 'an older copy', 'the held file is left alone');
      assert.ok((await readdir(s.folder)).every(name => !name.endsWith('.tmp')), 'no temporary file is left');
      assert.equal(s.opened.length, 1, 'WhatsApp is asked once (a stub here)');
    } finally { await release(); }
  });
}
