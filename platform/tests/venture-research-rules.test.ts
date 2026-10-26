// Ink v2 wave 4, package 4J16 (catalogue Q19): research evidence rules, in code. No source, no finding. A search
// result only points: its page must be read before anything rests on it. Pages from one domain make a claim "single
// source"; two domains that agree make it corroborated; pages that disagree make it conflicting; a failed search says
// so. A number carries the time its page was read and its status, and a sentinel (-1, empty, N/A) is never a number.
// The result says what it can support and what it cannot establish, with its coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { domainOf, judgeClaim, numberOf, researchFindings, type ResearchClaim } from '../runtime/venture/delivery/research-rules.ts';
import type { PersonResearch } from '../runtime/venture/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { WEB_SOURCE_LINE, webSourceStatus } from '../runtime/venture/agents/knowledge.ts';
import { net } from './venture-network-env.ts';
import { importFile, pages, searchEnv, SKINCARE, skincarePeople, webSearch } from './venture-network-search-env.ts';

const page = (url: string, value?: unknown, readAt: string | null = '2026-10-21T09:00:00.000Z') => ({ url, kind: 'page' as const, readAt, ...(value === undefined ? {} : { value }) });
const hit = (url: string) => ({ url, kind: 'search-result' as const, readAt: null });

test('domains: www and subdomains fold to one site, with two-part endings such as co.in kept', () => {
  assert.equal(domainOf('https://www.example.com/a'), 'example.com');
  assert.equal(domainOf('https://news.example.com/b'), 'example.com');
  assert.equal(domainOf('https://shop.acme.co.in/c'), 'acme.co.in');
  assert.equal(domainOf('https://incometax.gov.in/iec'), 'incometax.gov.in');
  assert.equal(domainOf('not a url'), null);
});

test('sentinels are never numbers: -1, empty, N/A and NaN read as unknown, not zero', () => {
  for (const raw of [-1, '-1', '', '  ', null, undefined, 'N/A', 'n/a', '--', Number.NaN, 'unknown']) assert.equal(numberOf(raw), null, JSON.stringify(raw));
  assert.equal(numberOf('1,250'), '1250');
  assert.equal(numberOf(0), '0');
  assert.equal(numberOf('12.5'), '12.5');
});

test('no source, no finding; a search result only points; one domain is single source; two that agree corroborate', () => {
  assert.equal(judgeClaim({ claim: 'Meera runs a design studio.', sources: [] }).status, 'no-source');
  const pointer = judgeClaim({ claim: 'Meera runs a design studio.', sources: [hit('https://example.com/meera')] });
  assert.equal(pointer.status, 'pointer-only');
  assert.equal(pointer.kept, false);
  assert.match(pointer.line, /only points/);
  const single = judgeClaim({ claim: 'Meera runs a design studio.', sources: [page('https://www.studio.in/about'), page('https://blog.studio.in/post')] });
  assert.equal(single.status, 'single-source');
  assert.equal(single.kept, true);
  assert.match(single.line, /single source/);
  const two = judgeClaim({ claim: 'Meera runs a design studio.', sources: [page('https://studio.in/about'), page('https://news.example.com/meera')] });
  assert.equal(two.status, 'corroborated');
  assert.deepEqual(two.domains, ['studio.in', 'example.com']);
});

test('numbers carry the time read and a status; pages that disagree conflict; a number with no read time is not kept', () => {
  const agreed = judgeClaim({ claim: 'The studio has 12 staff.', value: 12, sources: [page('https://studio.in/about', '12'), page('https://example.com/meera', 12)] });
  assert.equal(agreed.status, 'corroborated');
  assert.equal(agreed.value, '12');
  assert.equal(agreed.readAt, '2026-10-21T09:00:00.000Z');
  const conflict = judgeClaim({ claim: 'The studio has 12 staff.', value: 12, sources: [page('https://studio.in/about', '12'), page('https://example.com/meera', '30')] });
  assert.equal(conflict.status, 'conflicting');
  assert.equal(conflict.kept, false);
  assert.match(conflict.line, /disagree/);
  const unread = judgeClaim({ claim: 'The studio has 12 staff.', value: 12, sources: [page('https://studio.in/about', '12', null)] });
  assert.equal(unread.kept, false);
  assert.match(unread.line, /time it was read/);
  const sentinel = judgeClaim({ claim: 'Staff count.', value: -1, sources: [page('https://studio.in/about', -1)] });
  assert.equal(sentinel.value, null);
  assert.match(sentinel.line, /not a number/);
});

test('the result says what it supports, what it cannot establish, and its coverage; a failed search says so', () => {
  const claims: ResearchClaim[] = [
    { claim: 'Meera runs a design studio.', sources: [page('https://studio.in/about'), page('https://news.example.com/meera')] },
    { claim: 'She spoke at a Pune meetup.', sources: [page('https://meetup.example.org/talk')] },
    { claim: 'She is looking for a new agency.', sources: [] },
    { claim: 'The studio won an award.', sources: [hit('https://awards.example.net/list')] },
  ];
  const result = researchFindings(claims);
  assert.equal(result.findings.length, 2);
  assert.deepEqual(result.coverage, { claims: 4, kept: 2, corroborated: 1, singleSource: 1, conflicting: 0, dropped: 2 });
  assert.ok(result.supports.some(line => /design studio/.test(line) && /corroborated/.test(line)));
  assert.ok(result.supports.some(line => /meetup/.test(line) && /single source/.test(line)));
  assert.ok(result.cannotEstablish.some(line => /new agency/.test(line) && /No source, no finding/.test(line)));
  assert.ok(result.cannotEstablish.some(line => /award/.test(line) && /only points/.test(line)));
  const failed = researchFindings([{ claim: 'The studio won an award.', sources: [] }], { searchFailed: true });
  assert.equal(failed.findings.length, 0);
  assert.equal(failed.status, 'search-failed');
  assert.match(failed.cannotEstablish[0], /search failed/i);
});

// ---------------------------------------------------------------------------
// In "Before you write" (4D3) and the AI's web sources (4J18)
// ---------------------------------------------------------------------------

test('Before you write: each line carries its evidence status; the same sentence on two sites is corroborated, and the brief says so', async () => {
  const env = await searchEnv();
  await importFile(env, 'linkedin-connections', 'Connections.csv', SKINCARE);
  const person = skincarePeople(env).asha;
  const ABOUT = 'https://dewdrop.example/about', PRESS = 'https://press.example/d2c-summit';
  env.deps.webSearch = webSearch([{ url: ABOUT, title: 'About', snippet: '' }, { url: PRESS, title: 'Summit', snippet: '' }]);
  const site = pages({
    [ABOUT]: '<p>Asha Rao co-founded Dewdrop Naturals in 2019.</p><p>Asha Rao now leads sales for the company from Pune.</p>',
    [PRESS]: '<p>Asha Rao co-founded Dewdrop Naturals in 2019.</p>',
  });
  env.deps.net = { resolve: site.resolve, send: site.send };
  const brief = await net<PersonResearch>(env, 'venture.network.research', { personId: person.id });
  assert.deepEqual(brief.lines.map(line => line.text), ['Asha Rao co-founded Dewdrop Naturals in 2019.', 'Asha Rao now leads sales for the company from Pune.']);
  assert.match(brief.line, /1 line is on two or more sites; the rest come from a single site\./);
  const stored = listRecords(env.store.read(), 'venture-person').find(record => record.id === person.id)!;
  const statuses = stored.facts.filter(fact => fact.kind === 'web').map(fact => (fact.detail as { status?: string }).status);
  assert.deepEqual(statuses, ['corroborated', 'single-source']);
});

test('the AI\'s web sources say they are one site, read on a day, and not confirmed elsewhere', () => {
  assert.equal(webSourceStatus('https://studio.example/refunds', '2026-10-21T10:00:00.000Z'), 'single-source');
  assert.equal(webSourceStatus('not a url', '2026-10-21T10:00:00.000Z'), 'no-source');
  assert.equal(WEB_SOURCE_LINE, 'One site only: not confirmed elsewhere.');
});
