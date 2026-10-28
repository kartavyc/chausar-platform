// Social repurpose boundary (5D1): original tests from the catalogue, no outside code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceInventory } from '../runtime/venture/playbooks/social/inventory.ts';
const source = 'Claim: Our shop opened in Pune.\nNumber: We serve 40 customers each day.\nStory: We started at a small family counter.\nMistake: We used to skip follow-ups.\nQuote: "Ask before you promise."';
test('a repurpose inventory counts only distinct source-backed items and retains their exact spans', () => {
 const result = sourceInventory(source);
 assert.deepEqual(result.counts, { claims: 1, numbers: 1, stories: 1, mistakes: 1, quotes: 1, total: 5 });
 assert.equal(result.items.length, 5);
 for (const item of result.items) assert.equal(source.slice(item.from, item.to), item.text);
 assert.equal(result.items.find(item => item.kind === 'numbers')?.text, 'Number: We serve 40 customers each day.');
 assert.deepEqual(result.items.find(item => item.kind === 'numbers')?.numbers, ['40']);
});

test('inventory preserves offsets with CRLF and deduplicates the same evidence', () => {
 const text = '  Claim: We bake daily.\r\nClaim: We bake daily.\n\tNumber: ४० orders.';
 const result = sourceInventory(text);
 assert.equal(result.counts.total, 2);
 assert.deepEqual(result.items[1].numbers, ['४०']);
 for (const item of result.items) assert.equal(text.slice(item.from, item.to), item.text);
});

test('a source is bounded and cannot inflate its inventory with blank labels', () => {
 assert.equal(sourceInventory('Claim:\nStory: \nNumber:').counts.total, 0);
 assert.throws(() => sourceInventory('a'.repeat(100001)), { code: 'SOCIAL_SOURCE_INVALID' });
});

test('thin source and ungrounded facts stop repurposing; hooks cannot repeat within seven days', async () => {
 const { repurposeSource, repurposeClaims, hookVariety } = await import('../runtime/venture/playbooks/social/repurpose.ts');
 assert.throws(() => repurposeSource('We opened a shop.'), { code: 'SOURCE_THIN' });
 assert.equal(repurposeSource(source).counts.total, 5);
 assert.equal(repurposeClaims('We serve 40 customers each day.', source).passed, true);
 assert.equal(repurposeClaims('We serve 400 customers each day.', source).passed, false);
 const history = [{ formula: 'lesson', at: '2026-10-20T12:00:00Z' }];
 assert.equal(hookVariety('lesson', history, '2026-10-27T11:59:59Z').passed, false);
 assert.equal(hookVariety('lesson', history, '2026-10-27T12:00:00Z').passed, true);
});
