// Original Chausar social rule tests, catalogue S2/S5/S13; no outside code.
import test from 'node:test';
import assert from 'node:assert/strict';

test('every social register row explicitly declares its professional confirmation requirement', async () => {
 const { SOCIAL_RULES_REGISTER } = await import('../runtime/venture/playbooks/social/register.ts');
 for (const row of SOCIAL_RULES_REGISTER) assert.ok(['ca','lawyer',null].includes((row as any).needs), row.id);
});

test('format routing explains its choice and never promises footage or images absent from the order', async () => {
 const { socialFormats } = await import('../runtime/venture/playbooks/social/formats.ts');
 const formats = socialFormats({ channels: ['linkedin', 'instagram', 'x'], footage: false, images: false });
 assert.equal(formats.length, 3);
 assert.equal(formats.find(x => x.channel === 'linkedin')?.format, 'text');
 assert.equal(formats.find(x => x.channel === 'instagram')?.format, 'image-brief');
 assert.equal(formats.find(x => x.channel === 'instagram')?.ready, false);
 assert.ok(formats.every(x => x.trace.length > 0 && x.format !== 'video'));
 assert.throws(() => socialFormats({ channels: ['linkedin', 'linkedin', 'x'], footage: false, images: false }), { code: 'SOCIAL_INPUT_INVALID' });
});

test('selling share uses exact counts, and each draft has one goal and one audience action', async () => {
 const { socialSlots } = await import('../runtime/venture/playbooks/social/slot-kinds.ts');
 const slots = Array.from({ length: 5 }, (_, i) => ({ id: String(i), kind: i === 0 ? 'sell' as const : 'value' as const, goals: ['teach'], actions: ['reply'] }));
 assert.equal(socialSlots(slots).passed, true);
 assert.equal(socialSlots([{ ...slots[0], id: 'extra' }, ...slots]).passed, false);
 assert.equal(socialSlots([{ ...slots[0], goals: ['teach', 'sell'] }], 100).findings[0]?.check, 'one-goal');
 assert.throws(() => socialSlots(slots, NaN), { code: 'SOCIAL_INPUT_INVALID' });
});

test('community decisions cite the exact owner-pasted rule and block prohibited content before drafting', async () => {
 const { communityDecision, requireCommunityGo } = await import('../runtime/venture/playbooks/social/community.ts');
 const rules = 'Be helpful.\nNo self-promotion.\nFlair is required.\nNo links.';
 const result = communityDecision({ rules, promotion: true, links: true, flair: '' });
 assert.equal(result.go, false);
 assert.deepEqual(result.reasons.map(x => x.rule), ['No self-promotion.', 'Flair is required.', 'No links.']);
 assert.throws(() => requireCommunityGo(result), { code: 'COMMUNITY_NO_GO' });
 assert.equal(communityDecision({ rules, promotion: false, links: false, flair: 'Help' }).go, true);
 assert.throws(() => communityDecision({ rules: '', promotion: false, links: false, flair: '' }), { code: 'COMMUNITY_RULES_REQUIRED' });
});
