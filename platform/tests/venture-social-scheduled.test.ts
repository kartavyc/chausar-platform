// Chausar S12 runtime scheduling regressions. Original tests; all posting ports are local stubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTACTS, net, personNamed } from './venture-network-env.ts';
import { setup, owner, code } from './venture-views-env.ts';
import { seedPostDraft } from './venture-post-drafts.ts';
import { proposePost } from '../runtime/venture/build/posting.ts';
import { ventureAction, listRecords } from '../runtime/venture/records.ts';
import { sweepWholeJournal } from '../runtime/venture/build/journal-sweep.ts';
import { SCHEDULED_DESK } from '../runtime/venture/playbooks/social/scheduled-desk.ts';
import { runSocialScheduledDue, forgetScheduledApprovals } from '../runtime/venture/playbooks/social/scheduled.ts';
const base = { playbook: 'social-agency' as const, kind: 'scheduled' };
async function fixture(empty = false, initialAccount:string|null = '@cafe',text='Fresh idli is served until noon.') {
    let account=initialAccount;
    const env = await setup();
    const jobs: string[] = [];
    env.deps.connectors = { browser: { async signedInAccount(){return account;}, async probe() { return { present: true, reason: 'Local test port.' }; }, async post(job) { jobs.push(job.postId); return { outcome: 'posted', line: 'X showed the post.', url: null }; } }, postLog: { read: () => [], append: () => { } } };
    const draft = await seedPostDraft(env.deps, ['X: '+text]);
    const source = await ventureAction(env.deps, owner, 'prepare', 'seed.source', tx => tx.put({ ...tx.base('venture-upload'), name: 'brief.csv', format: 'csv', bytes: 3, digest: 'stored-original-digest', contentBase64: Buffer.from('old').toString('base64'), scope: { kind: 'order', orderId: draft.orderId }, clientData: true }));
    const post = empty ? null : await proposePost(env.deps, owner, { connectorId: 'x', draftId: draft.id });
    const desk = SCHEDULED_DESK.scheduled!;
    const dueAt = new Date(Date.parse(env.now()) + 5 * 60000).toISOString();
    const made: any = await desk.act!(env.deps, owner, { ...base, id: 'new', action: 'create', payload: { postId: post?.id ?? null, connectorId: 'x', dueAt } });
    const get = () => desk.get!(env.deps, owner, { ...base, id: made.id }) as Promise<any>;
    const approve = async () => { const view = await get(); return desk.act!(env.deps, owner, { ...base, id: made.id, action: 'approve', payload: {}, digest: view.digest }); };
    return { ...env, jobs, draft, source, post, desk, get, approve, id: made.id, setAccount:(value:string|null)=>{account=value;} };
}
test('the actual due tick waits for exact owner approval and posts once after a busy post clears within sixty minutes', async () => {
    const env = await fixture();
    await assert.rejects(env.desk.act!(env.deps, { ...owner, channel: 'mcp' }, { ...base, id: env.id, action: 'approve', payload: {}, digest: (await env.get()).digest }), code('APP_APPROVAL_REQUIRED'));
    await runSocialScheduledDue(env.deps, owner);
    assert.equal(env.jobs.length, 0);
    await env.approve();
    env.advance(5 * 60000);
    const busy = await ventureAction(env.deps, owner, 'prepare', 'seed.busy', tx => tx.put({ ...env.post!, ...tx.base('venture-connector-post'), state: 'approved', claimedAt: tx.now, approval: null }));
    await runSocialScheduledDue(env.deps, owner);
    assert.equal(env.jobs.length, 0);
    assert.equal((await env.get()).item.state, 'waiting');
    await ventureAction(env.deps, owner, 'prepare', 'seed.clear', tx => tx.replace({ ...busy, state: 'rejected', outcome: { by: 'engine', line: 'No post was sent.', url: null } }));
    env.advance(10 * 60000);
    await sweepWholeJournal(env.deps, owner);
    assert.equal(env.jobs.length, 1, JSON.stringify((await env.get()).item));
    assert.equal((await env.get()).item.state, 'posted');
    await sweepWholeJournal(env.deps, owner);
    assert.equal(env.jobs.length, 1);
});
test('empty slots say nothing-ready once, then report missed after the sixty-minute deadline', async () => {
    const env = await fixture(true);
    await env.approve();
    env.advance(5 * 60000);
    await runSocialScheduledDue(env.deps, owner);
    const first = await env.get();
    assert.match(first.item.reason, /nothing ready/i);
    assert.ok(first.item.nothingReadyAt);
    const reports = () => listRecords(env.store.read(), 'venture-event').filter(row => row.name === 'desk.changed' && (row.data as {
        id?: string;
    })?.id === env.id).length;
    const count = reports();
    assert.equal(count, 3, 'create, approval and exactly one nothing-ready report');
    await runSocialScheduledDue(env.deps, owner);
    assert.equal(reports(), count);
    assert.equal((await env.get()).digest, first.digest);
    env.advance(60 * 60000 + 1);
    await runSocialScheduledDue(env.deps, owner);
    assert.equal((await env.get()).item.state, 'missed');
    assert.equal(env.jobs.length, 0);
});
test('a changed reviewed source and a lost in-memory approval each block posting with a sentence', async () => {
    const env = await fixture();
    await env.approve();
    await ventureAction(env.deps, owner, 'prepare', 'seed.changed', tx => tx.replace({ ...env.draft, renderedText: 'X: Different words.', editedText: 'X: Different words.', status: 'edited' }));
    env.advance(5 * 60000);
    await runSocialScheduledDue(env.deps, owner);
    assert.equal(env.jobs.length, 0);
    assert.equal((await env.get()).item.state, 'blocked');
    assert.match((await env.get()).item.reason, /changed.*\./i);
    const restart = await fixture();
    await restart.approve();
    forgetScheduledApprovals(restart.store);
    restart.advance(5 * 60000);
    await runSocialScheduledDue(restart.deps, owner);
    assert.equal(restart.jobs.length, 0);
    assert.equal((await restart.get()).item.state, 'blocked');
    assert.match((await restart.get()).item.reason, /approv.*again.*\./i);
});
test('changed source bytes cannot post even when a stored digest was not updated', async () => {
    const env = await fixture();
    await env.approve();
    await ventureAction(env.deps, owner, 'prepare', 'seed.changed-bytes', tx => tx.replace({ ...env.source, contentBase64: Buffer.from('new').toString('base64') }));
    env.advance(5 * 60000);
    await runSocialScheduledDue(env.deps, owner);
    assert.equal(env.jobs.length, 0);
    assert.equal((await env.get()).item.state, 'blocked');
});
test('an approved future slot is not sent history and does not block preparing another post', async () => {
    const env = await fixture();
    await env.approve();
    const other = await seedPostDraft(env.deps, ['X: A pottery workshop starts on Saturday.']);
    const proposal = await proposePost(env.deps, owner, { connectorId: 'x', draftId: other.id });
    assert.equal(proposal.state, 'described');
});
test('cancelling an exact slot prevents later sending and LinkedIn remains manual', async () => {
    const env = await fixture();
    await env.approve();
    const view = await env.get();
    await env.desk.act!(env.deps, owner, { ...base, id: env.id, action: 'cancel', payload: {}, digest: view.digest });
    env.advance(5 * 60000);
    await runSocialScheduledDue(env.deps, owner);
    assert.equal(env.jobs.length, 0);
    assert.equal((await env.get()).item.state, 'cancelled');
    await assert.rejects(env.desk.act!(env.deps, owner, { ...base, id: 'new', action: 'create', payload: { postId: null, connectorId: 'linkedin', dueAt: env.now() } }), code('NOT_BUILT_YET'));
});
test('missed and restart-blocked slots release their unused post approval for a fresh owner decision', async () => {
    const env = await fixture();
    await env.approve();
    env.advance(65 * 60000);
    await runSocialScheduledDue(env.deps, owner);
    assert.equal((await env.get()).item.state, 'missed');
    assert.equal(env.jobs.length, 0);
    const again = await proposePost(env.deps, owner, { connectorId: 'x', draftId: env.draft.id });
    assert.equal(again.state, 'described');
    const restart = await fixture();
    await restart.approve();
    forgetScheduledApprovals(restart.store);
    restart.advance(5 * 60000);
    await runSocialScheduledDue(restart.deps, owner);
    assert.equal((await proposePost(restart.deps, owner, { connectorId: 'x', draftId: restart.draft.id })).state, 'described');
});

test('scheduled posts bind the known account for review and refuse unknown or changed accounts',async()=>{
 await assert.rejects(fixture(false,null),code('ACCOUNT_FENCE'));
 const env=await fixture();assert.equal((await env.get()).item.account,'@cafe');await env.approve();env.setAccount('@other');env.advance(5*60000);await runSocialScheduledDue(env.deps,owner);assert.equal(env.jobs.length,0);assert.equal((await env.get()).item.state,'blocked');assert.match((await env.get()).item.reason,/account/i);
});

test('Forget erases a named scheduled copy and its approval while preserving an unrelated slot',async()=>{
 const env=await fixture(false,'@cafe','Asha Rao can join. Write to asha@dewdrop.example.');
 await env.approve();
 const other:any=await env.desk.act!(env.deps,owner,{...base,id:'new',action:'create',payload:{postId:null,connectorId:'x',dueAt:(await env.get()).item.dueAt}});
 await net(env,'venture.network.import',{kind:'contacts-csv',name:'contacts.csv',text:CONTACTS});
 await net(env,'venture.network.forget',{id:personNamed(env,'Asha Rao').id});
 const value=(await env.get()).item;assert.equal(value.state,'cancelled');assert.equal(value.text,'');assert.equal(value.account,null);
 assert.ok(!listRecords(env.store.read(),'venture-connector-post').some(post=>post.scheduled?.slotId===env.id));
 assert.equal((await env.desk.get!(env.deps,owner,{...base,id:other.id}) as any).item.state,'draft');
 env.advance(5*60000);await runSocialScheduledDue(env.deps,owner);assert.equal(env.jobs.length,0);
});

test('a claimed real scheduled post refuses cancellation with the public posting code',async()=>{const env=await fixture();await env.approve();const value=(await env.get()).item;await ventureAction(env.deps,owner,'prepare','seed.claim',tx=>{const post=tx.find('venture-connector-post',value.postId)!;tx.replace({...post,claimedAt:tx.now});});const view=await env.get();await assert.rejects(env.desk.act!(env.deps,owner,{...base,id:env.id,action:'cancel',payload:{},digest:view.digest}),error=>error instanceof Error&&'code' in error&&error.code==='POST_ALREADY_DECIDED'&&error.message==='This post has already started. Check its outcome.');});
