import type {SocialRevisionRow} from '../runtime/venture/playbooks/social/revision-types.ts';
import type {Deliverable} from '../runtime/venture/contracts.ts';
const textOf=(part:Deliverable['sections'][number]['parts'][number])=>{assert.equal(part.kind,'text');return part.kind==='text'?part.text:'';};
// LinkedIn ghostwriting revisions use the live delivery path and exact per-post approvals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LINKEDIN_STRUCTURES, ghostwritingChecks } from '../runtime/venture/playbooks/social/structures.ts';
import {HOOK_FORMULAS} from '../runtime/venture/playbooks/social/post-plan.ts';
import { preserveOtherPosts } from '../runtime/venture/playbooks/social/ghostwriting.ts';
const draft = (count = 8, changed = false) => ({ title: 'Monthly posts', questionsForClient: [], sections: Array.from({ length: count }, (_, n) => ({ heading: `Post ${n + 1} | ${LINKEDIN_STRUCTURES[n % 5]!.name}`, parts: [{ kind: 'text' as const, ref: '', text: `LinkedIn: ${changed ? 'Changed' : 'Original'} post ${n + 1}.` }] })) });
const packDraft=(count=8)=>{const base=draft(count);return {...base,sections:[...base.sections,{heading:'Post plan',parts:Array.from({length:count},(_,n)=>({kind:'text' as const,ref:'',text:`Post ${n+1} | Value | Goal: Teach useful idea | Reader action: Try it | Hook: ${HOOK_FORMULAS[n]}`}))}]};};
test('ghostwriting requires eight or twelve LinkedIn posts using all five declared structures', () => {
    assert.equal(LINKEDIN_STRUCTURES.length, 5);
    for (const count of [8, 12])
        assert.ok(ghostwritingChecks({ offerKey: 'linkedin-ghostwriting', intake: { fields: { postCount: String(count) } }, deliverable: draft(count) } as any).every(x => x.outcome === 'pass'));
    for (const deliverable of [{...draft(),sections:[...draft().sections,{heading:'Extra',parts:[{kind:'text' as const,ref:'',text:'Instagram: Extra post.'}]}]},draft(7), { ...draft(), sections: draft().sections.map(s => ({ ...s, heading: 'Drafts' })) }])
        assert.ok(ghostwritingChecks({ offerKey: 'linkedin-ghostwriting', intake: { fields: { postCount: '8' } }, deliverable } as any).some(x => x.outcome === 'fail'));
});
test('ghostwriting counts every actual post line and ignores companion channel labels', () => {
    const checks = (deliverable: Deliverable) => ghostwritingChecks({ offerKey: 'linkedin-ghostwriting', intake: { fields: { postCount: '8' } }, deliverable } as any);
    for (const extra of ['LinkedIn: A hidden ninth post.', 'Instagram: A hidden other-channel post.']) {
        const pack = draft();
        pack.sections[0]!.parts[0]!.text += '\n' + extra;
        assert.equal(checks(pack).find(row => row.check === 'ghostwriting-count')?.outcome, 'fail', extra);
    }
    const companions = [{ heading: 'Alt text', parts: [{ kind: 'text' as const, ref: '', text: 'LinkedIn: A description of the picture.\nInstagram: Another picture description.' }] }];
    for (const sections of [[...companions, ...draft().sections], [...draft().sections, ...companions]]) {
        assert.ok(checks({ ...draft(), sections }).every(row => row.outcome === 'pass'));
    }
});
test('landing a one-post revision preserves every other post and the owner edits exactly', () => {
    const previous = draft();
    const candidate = draft(8, true);
    const run = { deliverable: previous, revision: { socialPost: { postId: 'run.post-2', n: 2, posts: previous.sections.map((s, n) => ({ channel: 'linkedin', text: n === 0 ? 'Owner exact words.' : s.parts[0]!.text.slice(10) })) } } } as any;
    const landed = preserveOtherPosts(run, candidate);
    assert.equal(textOf(landed.sections[0]!.parts[0]!), 'LinkedIn: Owner exact words.');
    assert.equal(textOf(landed.sections[1]!.parts[0]!), 'LinkedIn: Changed post 2.');
    assert.deepEqual(landed.sections.slice(2), previous.sections.slice(2));
    assert.throws(() => preserveOtherPosts(run, draft(1, true)), { code: 'SOCIAL_REVISION_SHAPE' });
    assert.throws(() => preserveOtherPosts({...run,deliverable:draft(7)},candidate), {code:'SOCIAL_REVISION_SHAPE'});
});
import { kitBusiness, owner } from './fixtures/venture/kit-business.ts';
import { findRecord, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { SOCIAL_REVISION_DESK } from '../runtime/venture/playbooks/social/revision-desk.ts';
import { renderDeliverable } from '../runtime/venture/delivery/deliverable.ts';
import { undoRevision } from '../runtime/venture/delivery/revise.ts';
async function fixture(count = 8) {
    const env = await kitBusiness({ now: new Date('2026-10-27T10:00:00Z') }, { idea: 'A social media agency for small shops' });
    const offer = env.offers.find(o => o.playbookOffer === 'linkedin-ghostwriting')!;
    const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: offer.id, request: 'Write grounded LinkedIn posts for the client.', intake: { fields: { postCount: String(count) }, moneyRupees: { extraRoundPrice: '250' } } });
    const started = await env.call('venture.delivery.run', { orderId: order.id });
    const run = await ventureAction(env.deps, owner, 'prepare', 'fixture.social', tx => { const original = tx.find('venture-delivery-run', started.id)!; const orderNow = tx.find('venture-order', order.id)!; tx.replace({ ...orderNow, chainStage: 3 }); return tx.replace({ ...original, chainStage: 3, status: 'ready-for-review', servedBy: 'model', practice: false, callId: null, preview: null, deliverable: packDraft(count), renderedText: renderDeliverable(packDraft(count), [], tx.venture!.country), checks: [], verdict: null, editedText: null }); });
    env.models.previewed.length = 0;
    const postId = run.id + '.post-1';
    const get = async () => await SOCIAL_REVISION_DESK.revision!.get!(env.deps, owner, { playbook: 'social-agency', kind: 'revision', id: postId }) as {item:SocialRevisionRow;digest:string};
    const act = async (action: string, payload: any = {}) => SOCIAL_REVISION_DESK.revision!.act!(env.deps, owner, { playbook: 'social-agency', kind: 'revision', id: postId, digest: (await get()).digest, action, payload: { runId: run.id, postId, words: 'Make this warmer.', ...payload } });
    return { env, order, run, postId, get, act };
}
test('real revision previews count per post, Undo restores only an unsent round, and the third needs its exact owner price', async () => {
    const f = await fixture();
    await f.act('revise');
    assert.equal((await f.get()).item.roundsUsed, 1);
    assert.equal(f.env.models.previewed.length, 1);
    await undoRevision(f.env.deps, owner, f.run.id, null);
    assert.equal((await f.get()).item.roundsUsed, 0);
    // Seed two completed rounds: the next action must stop before any model preview.
    await ventureAction(f.env.deps, owner, 'prepare', 'fixture.rounds', tx => { const order = tx.find('venture-order', f.order.id)!; tx.replace({ ...order, socialGhostwriting: { rounds: { 'post-1': 2 }, decisions: {}, charges: [] } }); });
    const before = f.env.models.previewed.length;
    await assert.rejects(f.act('revise'), (e: any) => e.code === 'OFFER_EXTRA_ROUND' && e.message.includes('250.00'));
    assert.equal(f.env.models.previewed.length, before);
    const quote = (await f.act('quote')).result as any;
    assert.equal(quote.amountMinor, '25000');
    assert.equal(typeof quote.receiptId,'string');
    const proof=await f.env.call('venture.receipt.get',{id:quote.receiptId});assert.equal(proof.figures[0]?.display,quote.display);
    await assert.rejects(f.act('revise', { quoteDigest: 'wrong' }), { code: 'OFFER_EXTRA_ROUND' });
    await f.act('revise', { quoteDigest: quote.digest });
    assert.equal((await f.get()).item.roundsUsed, 3);
    assert.equal(f.env.models.previewed.length, before + 1);
    const stored = findRecord(f.env.store.read(), 'venture-order', f.order.id)!;
    assert.equal(stored.socialGhostwriting?.charges[0]?.amountMinor, '25000');
    assert.equal(stored.socialGhostwriting?.charges[0]?.receiptId,quote.receiptId);
    await ventureAction(f.env.deps,owner,'approve','fixture.new-price',tx=>{const order=tx.find('venture-order',f.order.id)!;tx.replace({...order,intake:{...order.intake!,fields:{...order.intake!.fields,extraRoundPrice:'30000'}}});});
    assert.equal((await f.env.call('venture.receipt.get',{id:quote.receiptId})).figures[0]?.display,quote.display);
    await assert.rejects(f.env.call('venture.receipt.get',{id:quote.receiptId.replace(':25000:',':1:')}),{code:'RECEIPT_NOT_FOUND'});
});
import { draftApprovalsOfRun } from '../runtime/venture/playbooks/social/run-approvals.ts';
test('an owner-recorded client answer approves only its exact post and a changed post loses that answer', async () => {
    const f = await fixture();
    await ventureAction(f.env.deps, owner, 'approve', 'fixture.accept', tx => { const run = tx.find('venture-delivery-run', f.run.id)!; tx.replace({ ...run, status: 'accepted' }); });
    const payload = { runId: f.run.id, postId: f.postId, decision: 'approved' };
    await SOCIAL_REVISION_DESK.revision!.act!(f.env.deps, owner, { playbook: 'social-agency', kind: 'revision', id: f.postId, action: 'client-answer', digest: (await f.get()).digest, payload });
    let rows = draftApprovalsOfRun(f.env.store.read(), f.run.id);
    assert.equal(rows[0]!.approval.client.decision, 'approved');
    assert.equal(rows[1]!.approval.client.decision, null);
    await ventureAction(f.env.deps, owner, 'approve', 'fixture.edit', tx => { const run = tx.find('venture-delivery-run', f.run.id)!; tx.replace({ ...run, editedText: run.renderedText!.replace('Original post 1.', 'Different words.') }); });
    rows = draftApprovalsOfRun(f.env.store.read(), f.run.id);
    assert.notEqual(rows[0]!.approval.client.decision, 'approved');
});
test('the actual model response lands only the chosen post and runs checks on the preserved pack', async () => {
    const f = await fixture();
    await f.act('revise');
    const pending = findRecord(f.env.store.read(), 'venture-delivery-run', f.run.id)!;
    f.env.models.drafts.push(draft(8, true));
    const landed = await f.env.call('venture.delivery.approve', { runId: f.run.id, digest: pending.preview!.digest });
    assert.equal(landed.status, 'ready-for-review');
    const kept = findRecord(f.env.store.read(), 'venture-delivery-run', f.run.id)!;
    assert.match(kept.renderedText!, /Changed post 1/);
    assert.match(kept.renderedText!, /Original post 2/);
    assert.doesNotMatch(kept.renderedText!, /Changed post 2/);
    assert.equal(kept.editedText, null);
    assert.ok(kept.checks.length > 0);
});
test('concurrent revision clicks reserve one round and a failed model response does not reset it', async () => {
    const f = await fixture();
    const seen = (await f.get()).digest;
    const action = () => SOCIAL_REVISION_DESK.revision!.act!(f.env.deps, owner, { playbook: 'social-agency', kind: 'revision', id: f.postId, action: 'revise', digest: seen, payload: { runId: f.run.id, postId: f.postId, words: 'Shorten it.' } });
    const results = await Promise.allSettled([action(), action()]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await f.get()).item.roundsUsed, 1);
    const pending = findRecord(f.env.store.read(), 'venture-delivery-run', f.run.id)!;
    f.env.models.drafts.push({ bad: 'invalid model draft' });
    await assert.rejects(f.env.call('venture.delivery.approve', { runId: f.run.id, digest: pending.preview!.digest }));
    assert.equal((await f.get()).item.roundsUsed, 1);
});
test('generic social refinement preserves non-LinkedIn channels too', () => {
    const original = { title: 'Posts', questionsForClient: [], sections: [{ heading: 'Drafts', parts: [{ kind: 'text' as const, ref: '', text: 'Instagram: Keep this exact line.' }, { kind: 'text' as const, ref: '', text: 'Facebook: Original.' }] }] };
    const candidate = { ...original, sections: [{ heading: 'Drafts', parts: [{ kind: 'text' as const, ref: '', text: 'Instagram: Unwanted change.' }, { kind: 'text' as const, ref: '', text: 'Facebook: A warmer post.' }] }] };
    const run = { deliverable: original, revision: { socialPost: { n: 2, posts: [{ channel: 'instagram', text: 'Keep this exact line.' }, { channel: 'facebook', text: 'Original.' }] } } } as any;
    assert.equal(textOf(preserveOtherPosts(run, candidate).sections[0]!.parts[0]!), 'Instagram: Keep this exact line.');
    assert.equal(textOf(preserveOtherPosts(run, candidate).sections[0]!.parts[1]!), 'Facebook: A warmer post.');
});
import { clientDraft } from '../runtime/venture/build/draft-text.ts';
test('an existing exact share approval survives for untouched posts after one post is revised', async () => {
    const f = await fixture();
    await ventureAction(f.env.deps,owner,'approve','fixture.old-answer',tx=>{const order=tx.find('venture-order',f.order.id)!;tx.replace({...order,socialGhostwriting:{rounds:{},charges:[],decisions:{'post-2':{digest:'',decision:null,comment:null,at:'2020-01-01T00:00:00Z',by:'owner'}}}});});
    await ventureAction(f.env.deps, owner, 'approve', 'fixture.share', tx => { const run = tx.find('venture-delivery-run', f.run.id)!; tx.replace({ ...run, status: 'accepted' }); const shown = clientDraft(run); tx.put({ ...tx.base('venture-share-link'), deliveryId: run.id, clientId: f.order.clientId, tokenHash: 'fixture-hash', title: shown.title, text: shown.text!, draftDigest: shown.digest, expiresAt: '2026-11-01T00:00:00Z', state: 'closed', revokedAt: null, served: false, decisions: [{ draftId: run.id, digest: shown.digest, decision: 'approved', comment: null, at: tx.now, via: 'share-link', recordedBy: null }] }); });
    assert.equal(draftApprovalsOfRun(f.env.store.read(), f.run.id)[1]!.approval.client.decision, 'approved');
    await f.act('revise');
    const pending = findRecord(f.env.store.read(), 'venture-delivery-run', f.run.id)!;
    f.env.models.drafts.push(draft(8, true));
    await f.env.call('venture.delivery.approve', { runId: f.run.id, digest: pending.preview!.digest });
    const rows = draftApprovalsOfRun(f.env.store.read(), f.run.id);
    assert.equal(rows[1]!.approval.client.decision, 'approved');
    assert.notEqual(rows[1]!.approval.digest, 'the-draft-changed-since-the-answer');
    assert.equal(rows[1]!.approval.client.via, 'share-link');
    assert.notEqual(rows[0]!.approval.client.decision, 'approved');
});
test('a selected twelve-post pack keeps its schema on real revision approval', async () => {
    const f = await fixture(12);
    await f.act('revise');
    const pending = findRecord(f.env.store.read(), 'venture-delivery-run', f.run.id)!;
    f.env.models.drafts.push(draft(12, true));
    const landed = await f.env.call('venture.delivery.approve', { runId: f.run.id, digest: pending.preview!.digest });
    assert.equal(landed.status, 'ready-for-review');
    const stored = findRecord(f.env.store.read(), 'venture-delivery-run', f.run.id)!;
    assert.equal(stored.deliverable!.sections.filter(s=>s.heading!=='Post plan').length, 12);
    assert.ok(stored.playbookChecks?.some(c => c.check === 'ghostwriting-count' && c.outcome === 'pass'));
});

test('a newer exact client share answer supersedes an owner-recorded per-post answer',async()=>{
 const f=await fixture();await ventureAction(f.env.deps,owner,'approve','fixture.accept',tx=>tx.replace({...tx.find('venture-delivery-run',f.run.id)!,status:'accepted'}));
 await SOCIAL_REVISION_DESK.revision!.act!(f.env.deps,owner,{playbook:'social-agency',kind:'revision',id:f.postId,action:'client-answer',digest:(await f.get()).digest,payload:{runId:f.run.id,postId:f.postId,decision:'approved'}});
 await ventureAction(f.env.deps,owner,'approve','fixture.new-answer',tx=>{const run=tx.find('venture-delivery-run',f.run.id)!;const shown=clientDraft(run);tx.put({...tx.base('venture-share-link'),deliveryId:run.id,clientId:f.order.clientId,tokenHash:'fixture-hash',title:shown.title,text:shown.text!,draftDigest:shown.digest,expiresAt:'2030-11-01T00:00:00Z',state:'closed',revokedAt:null,served:false,decisions:[{draftId:run.id,digest:shown.digest,decision:'changes',comment:'Try again.',at:tx.now,via:'share-link',recordedBy:null}]});});
 assert.equal(draftApprovalsOfRun(f.env.store.read(),f.run.id)[0]!.approval.client.decision,'changes');
});
test('client approval binds the channel as well as exact post words',async()=>{
 const f=await fixture();await ventureAction(f.env.deps,owner,'approve','fixture.accept',tx=>tx.replace({...tx.find('venture-delivery-run',f.run.id)!,status:'accepted'}));
 await SOCIAL_REVISION_DESK.revision!.act!(f.env.deps,owner,{playbook:'social-agency',kind:'revision',id:f.postId,action:'client-answer',digest:(await f.get()).digest,payload:{runId:f.run.id,postId:f.postId,decision:'approved'}});
 await ventureAction(f.env.deps,owner,'approve','fixture.channel',tx=>{const run=tx.find('venture-delivery-run',f.run.id)!;tx.replace({...run,editedText:run.renderedText!.replace('LinkedIn: Original post 1.','Instagram: Original post 1.')});});
 assert.notEqual(draftApprovalsOfRun(f.env.store.read(),f.run.id)[0]!.approval.client.decision,'approved');
});

test('a one-post revision refuses surrounding owner edits before preview rather than discarding them',async()=>{
 const f=await fixture();await ventureAction(f.env.deps,owner,'approve','fixture.heading',tx=>{const run=tx.find('venture-delivery-run',f.run.id)!;tx.replace({...run,editedText:run.renderedText!.replace('Monthly posts','Owner heading')});});
 await assert.rejects(f.act('revise'),{code:'SOCIAL_REVISION_SHAPE'});assert.equal(f.env.models.previewed.length,0);
});

test('one-post landing maps actual line ordinals and preserves companion sections byte for byte',()=>{
 const original={title:'Owner title',questionsForClient:['Keep this note.'],sections:[{heading:'Alt text',parts:[{kind:'text',ref:'',text:'LinkedIn: Companion description.'}]},{heading:'Drafts',parts:[{kind:'text',ref:'',text:'  LinkedIn: First original.  \r\n LinkedIn :   Second original.  '}]},{heading:'Hashtags',parts:[{kind:'text',ref:'',text:'LinkedIn: #KeepThese'}]},{heading:'Post plan',parts:[{kind:'text',ref:'',text:'Keep this metadata.'}]}]};
 const candidate=structuredClone(original);candidate.sections[1]!.parts[0]!.text='LinkedIn: First changed.\nLinkedIn: Second changed.';
 const run={deliverable:original,revision:{socialPost:{n:2,posts:[{channel:'linkedin',text:'First original.'},{channel:'linkedin',text:'Second original.'}]}}} as any;
 const kept=preserveOtherPosts(run,candidate as any);assert.equal(textOf(kept.sections[1]!.parts[0]!), '  LinkedIn: First original.  \r\n LinkedIn :   Second changed.  ');assert.deepEqual(kept.sections[0],original.sections[0]);assert.deepEqual(kept.sections.slice(2),original.sections.slice(2));assert.equal(kept.title,original.title);assert.deepEqual(kept.questionsForClient,original.questionsForClient);
});
