// FR-04: the recovery kit saved as a PDF through Chromium's print path (what Electron's printToPDF
// writes): one page on A4 and on Letter, the code in groups of four, the three lines in English and
// Hindi, and nothing else from the app. Skipped where no Chromium or Playwright is provisioned.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';

const browser = await import('../../../frontend-validation/policy/browser.mjs');
let available = browser.chromiumExecutable() !== undefined;
try { await browser.loadPlaywright(); } catch { available = false; }
try { await import('vite'); } catch { available = false; }

test('the printed recovery kit is one page holding only the kit, in English and Hindi', { skip: available ? false : 'no Chromium, Playwright or Vite here', timeout: 240_000 }, async () => {
  const { checkRecoveryKitPdf, printOutDir } = await import('../../../frontend-validation/print/kit-pdf.mjs');
  const result = await checkRecoveryKitPdf();
  assert.deepEqual(result.failures, []);
  for (const paper of ['A4', 'Letter']) {
    assert.equal(result.papers[paper]?.pages, 1, `${paper} is one page`);
    assert.ok(existsSync(`${printOutDir}/recovery-kit-${paper}.pdf`));
  }
  assert.ok((result.code?.length ?? 0) > 1);
  assert.deepEqual(result.printDom?.outside, []);
  assert.equal(result.control?.showsScreen, true);
});
