// Community report behavior, original tests; reddit-skills is no-licence, ideas only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { communityReport } from '../runtime/venture/playbooks/lead-generation/community.ts';
const input = () => ({ product: 'We help bakeries answer customer questions. Owners review every answer.', confirmed: true, problem: 'answering shop questions', categories: ['bakery'], painWords: ['missed questions'], days: 7, posts: [{ id: 'p1', url: 'https://community.example/p1', community: 'bakers', rulesUrl: 'https://community.example/rules', rulesCheckedOn: '2026-10-27', readingAllowed: true, on: '2026-10-26', removed: false, text: 'I keep missing questions and need help answering shop questions.', votes: [{ dimension: 'pain', score: 4, quote: 'missing questions' }, { dimension: 'fit', score: 5, quote: 'shop questions' }, { dimension: 'intent', score: 2, quote: 'need help' }] }] });
test('community report keeps evidenced votes, surfaces two strong dimensions, counts coverage and never acts', () => {
  const source = input();
  source.posts.push({ ...source.posts[0], id: 'p2', on: '2026-10-25', votes: source.posts[0].votes.map(v => ({ ...v, score: 2 })) });
  source.posts.push({ ...source.posts[0], id: 'gone', removed: true, text: '[removed]', on: '2026-10-24' });
  const report = communityReport(source);
  assert.deepEqual(report.posts.map(p => p.id), ['p1']);
  assert.equal(report.coverage, 'covered 2 of 7 days');
  assert.deepEqual(report.actions, []);
  assert.equal(JSON.stringify(report).includes('[removed]'), false);
});
test('community votes without exact evidence, rules or product confirmation refuse', () => {
  const source = input();
  source.posts[0].votes[0].quote = 'invented demand';
  assert.throws(() => communityReport(source), { code: 'COMMUNITY_QUOTE_MISSING' });
  const rules = input(); rules.posts[0].readingAllowed = false;
  assert.throws(() => communityReport(rules), { code: 'COMMUNITY_RULES_REQUIRED' });
  assert.throws(() => communityReport({ ...input(), confirmed: false }), { code: 'PRODUCT_CONFIRM_REQUIRED' });
});


test('community report rejects malformed exact nested records and impossible calendar days', () => {
  const badPosts = [null, { ...input().posts[0], extra: true }, { ...input().posts[0], id: '' }, { ...input().posts[0], community: '' }, { ...input().posts[0], on: '2026-02-30' }, { ...input().posts[0], removed: 'false' }, { ...input().posts[0], votes: [null, ...input().posts[0].votes.slice(1)] }, { ...input().posts[0], votes: [{ ...input().posts[0].votes[0], extra: true }, ...input().posts[0].votes.slice(1)] }];
  for (const post of badPosts) assert.throws(() => communityReport({ ...input(), posts: [post] } as any), { code: 'INVALID_VENTURE_REQUEST' });
  assert.throws(() => communityReport({ ...input(), posts: [{ ...input().posts[0], rulesCheckedOn: '2026-02-30' }] }), { code: 'COMMUNITY_RULES_REQUIRED' });
  assert.throws(() => communityReport(null as any), { code: 'INVALID_VENTURE_REQUEST' });
  assert.throws(() => communityReport({ ...input(), extra: true } as any), { code: 'INVALID_VENTURE_REQUEST' });
});

import { LEAD_GENERATION_TOOLS } from '../runtime/venture/delivery/harness/tools-lead-generation.ts';
import { leadDeskAct, leadDeskGet, leadDeskList } from '../runtime/venture/playbooks/lead-generation/desk.ts';
import { setup, owner } from './venture-views-env.ts';
import { requireVenture } from '../runtime/venture/records.ts';
import type { ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';

test('community tool uses only the exact same-business report approved through the owner desk', async () => {
  const env = await setup();
  const toolEnv = { deps: env.deps, ventureId: requireVenture(env.store.read()).id } as ToolEnv;
  await assert.rejects(LEAD_GENERATION_TOOLS['community.vote'].run(toolEnv, { report: JSON.stringify(input()) }), { code: 'COMMUNITY_OWNER_SOURCE_REQUIRED' });
  const report = (await leadDeskAct(env.deps, owner, { playbook: 'lead-generation', kind: 'source', id: 'new', action: 'community', payload: input() })).result as any;
  assert.equal(typeof report.sourceId, 'string');
  assert.equal((await leadDeskList(env.deps, owner, { playbook: 'lead-generation', kind: 'source' })).rows.some((row: any) => row.id === report.sourceId), true);
  assert.equal(((await leadDeskGet(env.deps, owner, { playbook: 'lead-generation', kind: 'source', id: report.sourceId })).item as any).posts[0].text, input().posts[0].text);
  const output = (await LEAD_GENERATION_TOOLS['community.vote'].run(toolEnv, { sourceId: report.sourceId })).result as any;
  assert.equal(output.product, input().product);
  assert.equal(output.posts[0].text, input().posts[0].text);
  await assert.rejects(LEAD_GENERATION_TOOLS['community.vote'].run({ ...toolEnv, ventureId: 'other-business' }, { sourceId: report.sourceId }), { code: 'COMMUNITY_OWNER_SOURCE_REQUIRED' });
  await assert.rejects(LEAD_GENERATION_TOOLS['community.vote'].run(toolEnv, { sourceId: report.sourceId, report: JSON.stringify({ ...input(), product: 'Changed. Product.' }) }), { code: 'INVALID_VENTURE_REQUEST' });
  await leadDeskAct(env.deps, owner, { playbook: 'lead-generation', kind: 'source', id: report.sourceId, action: 'forget-community', payload: {} });
  await assert.rejects(LEAD_GENERATION_TOOLS['community.vote'].run(toolEnv, { sourceId: report.sourceId }), { code: 'COMMUNITY_OWNER_SOURCE_REQUIRED' });
});


test('network Forget removes community evidence naming that person', async () => {
  const env = await setup();
  const manual = (await leadDeskAct(env.deps, owner, { playbook: 'lead-generation', kind: 'source', id: 'new', action: 'manual', payload: { name: 'Priya Bakery', email: 'priya@bakery.example', source: 'referral' } })).result as any;
  const source = input(); source.posts[0].text += ' Priya Bakery is asking.';
  const report = (await leadDeskAct(env.deps, owner, { playbook: 'lead-generation', kind: 'source', id: 'new', action: 'community', payload: source })).result as any;
  const { networkForget } = await import('../runtime/venture/network/forget.ts');
  await networkForget(env.deps, owner, { id: manual.personId });
  await assert.rejects(LEAD_GENERATION_TOOLS['community.vote'].run({ deps: env.deps, ventureId: requireVenture(env.store.read()).id } as ToolEnv, { sourceId: report.sourceId }), { code: 'COMMUNITY_OWNER_SOURCE_REQUIRED' });
  assert.equal(JSON.stringify(env.store.read()).includes('Priya Bakery is asking.'), false);
});

test('Forget erases earlier community evidence after a matching person is imported', async () => {
  const env = await setup();
  const source = input(); source.product = 'We help Priya Bakery. Owners approve answers.';
  const report = (await leadDeskAct(env.deps, owner, { playbook: 'lead-generation', kind: 'source', id: 'new', action: 'community', payload: source })).result as any;
  const person = (await leadDeskAct(env.deps, owner, { playbook: 'lead-generation', kind: 'source', id: 'new', action: 'manual', payload: { name: 'Priya Bakery', email: 'priya@bakery.example', source: 'referral' } })).result as any;
  assert.deepEqual((await leadDeskList(env.deps, owner, { playbook: 'lead-generation', kind: 'source' })).rows.map((row: any) => row.id), [report.sourceId, person.personId]);
  const { networkForget } = await import('../runtime/venture/network/forget.ts');
  await networkForget(env.deps, owner, { id: person.personId });
  await assert.rejects(leadDeskGet(env.deps, owner, { playbook: 'lead-generation', kind: 'source', id: report.sourceId }), { code: 'LEADS_NOT_FOUND' });
});
