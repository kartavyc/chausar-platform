import test from 'node:test';
import assert from 'node:assert/strict';
import type { InboundRecord } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { orderScope } from '../runtime/venture/playbooks/kit/exit.ts';
import { kitDefinitions } from '../runtime/venture/playbooks/kit/installed.ts';
import { draftSalesProposal } from '../runtime/venture/playbooks/kit/proposal.ts';
import { add, cardById, withPeople } from './venture-pipeline-env.ts';
import { owner, seedBlueprint, setup } from './venture-views-env.ts';

const idea = 'A bookkeeping and cfo service for local shops.';

test('a shipped bookkeeping service keeps Hindi client scope checks while its replies stay English', () => {
  const definitions = kitDefinitions();
  assert.throws(() => orderScope({ idea }, 'मुझे निवेश सलाह चाहिए', definitions), { code: 'OUTSIDE_SCOPE' });
  const partly = orderScope({ idea }, 'bookkeeping और निवेश सलाह', definitions);
  assert.deepEqual(partly?.rest, ['investment advice']);
  assert.match(partly!.reply, /^This is outside what we do\./);
  assert.equal(orderScope({ idea }, 'bookkeeping', definitions), null);
  assert.equal(orderScope({ idea }, 'an unknown request', definitions), null);
});

test('a shipped service rejects an outside Hindi proposal and parks its follow-up without calling AI', async () => {
  const env = await setup();
  env.models.connected = true;
  env.models.preview = async () => { throw new Error('Outside-scope client data must not reach AI.'); };
  await ventureAction(env.deps, owner, 'admin', 'test.idea', tx => { tx.touch({ idea }); });
  await seedBlueprint(env, { status: 'accepted' });
  const { asha } = await withPeople(env);
  const card = (await add(env, asha)).card;
  await ventureAction(env.deps, owner, 'prepare', 'test.inbound', tx => tx.put<InboundRecord>({
    ...tx.base('venture-inbound'), messageId: '<scope-input@mail.example>', from: 'asha@dewdrop.example',
    to: ['owner@ledger.example'], date: tx.now, subject: 'मुझे निवेश सलाह चाहिए', references: [], matched: null,
    triage: 'talking', line: 'मुझे निवेश सलाह चाहिए', processed: true, screen: null, personId: asha.id,
  } as InboundRecord));
  const result = await draftSalesProposal(env.deps, owner, { personId: asha.id, offerId: 'offer_1' });
  assert.equal(result.status, 'outside');
  assert.equal(result.id, null);
  assert.deepEqual(result.exit?.rest, ['investment advice']);
  assert.equal(listRecords(env.store.read(), 'venture-sales-proposal').length, 0);
  const parked = cardById(env, card.id);
  assert.deepEqual([parked.stage, parked.askAgainFrom], ['not-now', null]);
});
