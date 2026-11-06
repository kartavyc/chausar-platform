// C1 tool integration: actual specs, source amounts, stored calculator receipts.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../runtime/venture/delivery/harness/tools.ts';
import { CA_W5_TOOLS } from '../runtime/venture/delivery/harness/tools-ca.ts';
import { setup } from './venture-views-env.ts';
import type { ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
import { digest } from '../runtime/venture/records.ts';
import { rederiveCaReceipt } from '../runtime/venture/playbooks/ca-firm/stored-receipt.ts';
test('advance tool reads the client estimate from file cells and stores a re-derivable receipt', async () => {
    const env = await setup();
    const content = 'Tax,TDS,TCS,Relief\n100000.00,0.00,0.00,0.00';
    const te: ToolEnv = { deps: env.deps, ventureId: env.venture.id, memberId: 'owner', epoch: 1, currency: 'INR', dateOrder: 'day-month-year', runRef: { kind: 'practice', episodeId: 'practice_ca' } as any, files: [{ id: 'upload_estimate', name: 'estimate.csv', format: 'csv', bytes: Buffer.byteLength(content), digest: digest(content), contentBase64: Buffer.from(content).toString('base64'), clientData: true }], tables: [], receipts: [], dictionary: [], sandbox: undefined, now: () => env.now(), allowed: [], rateUse: { mode: 'rehearsal', confirmations: [] } };
    const pick = (column: string) => [{ table: 'f1', row: 'r1', column }];
    const result = await CA_W5_TOOLS['tax.advance'].run(te, { financialYear: '2026-27', estimate: { tax: pick('Tax'), tds: pick('TDS'), tcs: pick('TCS'), relief: pick('Relief'), residency: 'resident', ageBand: 'below-60', hasBusinessIncome: 'yes', presumptive: 'no' } });
    assert.equal(result.receipts?.length, 1);
    assert.equal(result.receipts![0].ca?.engine, 'advance-tax');
    assert.equal(rederiveCaReceipt(result.receipts![0]).rederived, 'same');
    assert.equal(result.receipts![0].figures.find(row => row.key === 'instalment-1')?.minor, '1500000');
    const citations: any = (await CA_W5_TOOLS['tax.citations'].run(te, { draft: 'section 80C', incomeDate: '2026-04-01' })).result;
    assert.equal(citations.passed, false);
    assert.equal(citations.draftDigest, digest('section 80C'));
});
