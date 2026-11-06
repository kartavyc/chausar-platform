// A4 review (L3, hands-on row 113): a move file made at 01:56 IST on 3 Nov was named 2026-11-02 (the UTC day). It is
// named by this computer's own date.
import test from 'node:test';
import assert from 'node:assert/strict';

test('the move file is named by the local date, not the UTC one', async () => {
  const before = process.env.TZ;
  process.env.TZ = 'Asia/Kolkata';
  try {
    const { moveFileName } = await import('../runtime/workspace-custody-contracts.ts');
    assert.equal(moveFileName(new Date('2026-11-02T20:26:00.000Z')), 'chausar-move-2026-11-03.backup');
    assert.equal(moveFileName(new Date('2026-11-03T10:00:00.000Z')), 'chausar-move-2026-11-03.backup');
  } finally {
    if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
  }
});
