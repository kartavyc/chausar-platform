import type { TestContext } from 'node:test';
import type { KdfMemo } from '../../runtime/vault.ts';
/** Synthetic test credentials only; each fixture owns and wipes its explicit memo. */
export function testKdfMemo(t: TestContext): KdfMemo {
  const memo: KdfMemo = new Map();
  t.after(() => { for (const key of memo.values()) key.fill(0); memo.clear(); });
  return memo;
}
