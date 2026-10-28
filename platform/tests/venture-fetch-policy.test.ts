// Package 5A6 (Ink v2 wave 5): the fetch policy. Any fetch an agent or a monitor makes goes through it: sites whose
// terms bar automated reading (a dated rule set, each with its terms page) are refused in plain words before anything
// is sent, at every hop of a redirect too; Chausar asks only as itself (its own user agent, never another company's
// browser name), through no proxy and with no faked fingerprint; robots.txt is read and obeyed. The owner's own
// signed-in posting (2B) is a different path and is not touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PinnedTarget } from '../runtime/venture/core/net-guard.ts';
import {
  CHAUSAR_USER_AGENT, FETCH_POLICY_RULES, FETCH_POLICY_WORDS, checkFetchPolicy, fetchPolicySite, politeFetch, refuseDisguise, robotsAllows, robotsCheck,
} from '../runtime/venture/build/fetch-policy.ts';
import { validateRules } from '../runtime/venture/playbooks/kit/rules.ts';
import { code, owner } from './venture-views-env.ts';

const PUBLIC = '142.250.1.10';
const resolve = async () => [{ address: PUBLIC, family: 4 as const }];

/** A sender that records each request and answers from a table by URL. */
function sender(table: Record<string, { status: number; body?: string; headers?: Record<string, string> }>) {
  const sent: PinnedTarget[] = [];
  const send = async (target: PinnedTarget) => {
    sent.push(target);
    const answer = table[target.url.href] ?? { status: 404 };
    return { status: answer.status, headers: answer.headers ?? { 'content-type': 'text/plain' }, body: Buffer.from(answer.body ?? '') };
  };
  return { sent, send };
}

test('the sites whose terms bar automated reading are refused in the plain words, product pages only for the two shops', () => {
  const refused = [
    'https://www.linkedin.com/in/someone', 'https://in.linkedin.com/company/acme', 'https://www.naukri.com/job-listings-1',
    'https://www.google.com/maps/place/Cafe', 'https://maps.google.com/?q=cafe', 'https://www.justdial.com/Pune/Cafes',
    'https://dir.indiamart.com/search.mp?ss=tea', 'https://www.instagram.com/acme/', 'https://m.facebook.com/acme',
    'https://x.com/acme/status/1', 'https://twitter.com/acme', 'https://www.amazon.in/Tea-Pack/dp/B0ABCDEF12',
    'https://www.amazon.in/gp/product/B0ABCDEF12', 'https://www.flipkart.com/tea-pack/p/itmabc123',
  ];
  for (const url of refused) {
    assert.throws(() => checkFetchPolicy(url), (error: any) => {
      assert.equal(error.code, 'FETCH_POLICY_REFUSED', url);
      assert.equal(error.message, "This site's terms don't allow automated reading. Paste the text instead.");
      return true;
    }, url);
  }
  assert.equal(FETCH_POLICY_WORDS.refused, "This site's terms don't allow automated reading. Paste the text instead.");
  // Not on the list: an Amazon or Flipkart page that is not a product page, Google search's other pages, a shop's own site.
  for (const url of ['https://www.amazon.in/gp/help/customer/display.html', 'https://www.flipkart.com/helpcentre', 'https://www.google.com/search?q=tea',
    'https://cafe-aroma.example/menu', 'https://notlinkedin.com/x']) {
    assert.equal(checkFetchPolicy(url).href, new URL(url).href, url);
  }
  assert.equal(fetchPolicySite(new URL('https://www.linkedin.com/feed'))?.id, 'fetch-policy-linkedin');
});

test('the list is a dated rule set: each site has its terms page, a checked date and how it was read, and it passes the kit rule check', () => {
  const ids = FETCH_POLICY_RULES.map(rule => rule.id);
  for (const site of ['linkedin', 'naukri', 'google-maps', 'justdial', 'indiamart', 'instagram', 'facebook', 'x', 'amazon-in', 'flipkart']) {
    assert.ok(ids.includes(`fetch-policy-${site}`), site);
  }
  for (const rule of FETCH_POLICY_RULES) {
    assert.equal(rule.scope, 'fetch-policy');
    assert.ok(rule.sources.length >= 1 && rule.sources.every(source => /^https:\/\//.test(source.url)), rule.id);
    assert.match(rule.checkedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(rule.how.length > 10 && rule.limitations.length > 10, rule.id);
    assert.deepEqual([...rule.usedBy], ['fetch-policy']);
  }
  assert.doesNotThrow(() => validateRules(FETCH_POLICY_RULES, { steps: [], checkIds: ['fetch-policy'] }, '2026-10-27'));
});

test('Chausar fetches only as itself: its own user agent on every hop, never another browser name, a proxy header or a faked fingerprint', async () => {
  const { sent, send } = sender({
    'https://shop.example/a': { status: 302, headers: { location: 'https://shop.example/b' } },
    'https://shop.example/b': { status: 200, body: 'Price 499' },
  });
  const answer = await politeFetch({ url: 'https://shop.example/a' }, { resolve, send });
  assert.equal(answer.status, 200);
  assert.equal(sent.length, 2);
  for (const target of sent) assert.equal(target.headers['user-agent'], CHAUSAR_USER_AGENT);
  assert.match(CHAUSAR_USER_AGENT, /^Chausar\//);
  assert.doesNotMatch(CHAUSAR_USER_AGENT, /Mozilla|Chrome|Safari|Googlebot|bingbot/i);
  const disguises: Record<string, string>[] = [{ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' }, { 'x-forwarded-for': '1.2.3.4' }, { via: '1.1 proxy' },
    { 'proxy-authorization': 'Basic x' }, { forwarded: 'for=1.2.3.4' }, { 'sec-ch-ua': '"Chromium";v="120"' }];
  for (const headers of disguises) {
    assert.throws(() => refuseDisguise(headers), code('FETCH_DISGUISE_REFUSED'));
    await assert.rejects(politeFetch({ url: 'https://shop.example/b', headers }, { resolve, send }), code('FETCH_DISGUISE_REFUSED'));
  }
  assert.equal(sent.length, 2, 'nothing was sent for a disguised request');
});

test('a redirect to a site on the list is refused at that hop, and nothing is sent to it', async () => {
  const { sent, send } = sender({ 'https://short.example/x': { status: 301, headers: { location: 'https://www.linkedin.com/in/someone' } } });
  await assert.rejects(politeFetch({ url: 'https://short.example/x' }, { resolve, send }), code('FETCH_POLICY_REFUSED'));
  assert.deepEqual(sent.map(target => target.url.hostname), ['short.example']);
  await assert.rejects(politeFetch({ url: 'https://www.instagram.com/acme/' }, { resolve, send }), code('FETCH_POLICY_REFUSED'));
  assert.equal(sent.length, 1, 'a listed site is refused before anything is sent');
  // The network guard still holds underneath: an address inside the computer is refused.
  await assert.rejects(politeFetch({ url: 'http://127.0.0.1/' }, { resolve, send }), code('NET_ADDRESS_REFUSED'));
});

test('robots.txt: Chausar reads its own group, else everyone\'s, longest rule wins and Allow wins a tie', async () => {
  const robots = ['User-agent: *', 'Disallow: /private', 'Allow: /private/menu', '', 'User-agent: SomeBot', 'Disallow: /'].join('\n');
  assert.equal(robotsAllows(robots, '/menu'), true);
  assert.equal(robotsAllows(robots, '/private/accounts'), false);
  assert.equal(robotsAllows(robots, '/private/menu/today'), true);
  assert.equal(robotsAllows(['User-agent: Chausar', 'Disallow: /prices', '', 'User-agent: *', 'Disallow: /'].join('\n'), '/menu'), true, 'its own group wins over *');
  assert.equal(robotsAllows(['User-agent: Chausar', 'Disallow: /prices'].join('\n'), '/prices/today'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /*.pdf$', '/menu.pdf'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /*.pdf$', '/menu.pdf?x=1'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow:', '/anything'), true);
  assert.equal(robotsAllows('', '/anything'), true);
  const { send } = sender({ 'https://shop.example/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /prices' } });
  assert.deepEqual(await robotsCheck(new URL('https://shop.example/prices/tea'), { resolve, send }), { allowed: false, line: 'This site asks robots not to read that page.' });
  assert.deepEqual(await robotsCheck(new URL('https://shop.example/menu'), { resolve, send }), { allowed: true, line: null });
  const none = sender({});
  assert.deepEqual(await robotsCheck(new URL('https://open.example/menu'), { resolve, send: none.send }), { allowed: true, line: null }, 'no robots.txt means no rule');
  assert.equal(none.sent[0].headers['user-agent'], CHAUSAR_USER_AGENT);
});

test('Before you write and knowledge links (4D3, 4J18) read through the same policy: a listed site is refused there too', async () => {
  const { checkResearchUrl } = await import('../runtime/venture/network/research.ts');
  assert.throws(() => checkResearchUrl('https://www.justdial.com/Pune/Cafes'), code('FETCH_POLICY_REFUSED'));
  assert.throws(() => checkResearchUrl('https://www.linkedin.com/in/someone'), code('RESEARCH_HOST_REFUSED'), 'a profile keeps its own refusal');
  assert.equal(checkResearchUrl('https://cafe-aroma.example/about').hostname, 'cafe-aroma.example');
});

test('Before you write and knowledge links read robots.txt first, as Chausar: a page robots.txt keeps robots from is not opened', async () => {
  const { searchEnv, importFile, SKINCARE, skincarePeople, pages, webSearch } = await import('./venture-network-search-env.ts');
  const { net } = await import('./venture-network-env.ts');
  const ABOUT = 'https://dewdrop.example/about', PRESS = 'https://press.example/d2c-summit';
  const env = await searchEnv();
  await importFile(env, 'linkedin-connections', 'Connections.csv', SKINCARE);
  const asha = skincarePeople(env).asha;
  const site = pages({
    'https://press.example/robots.txt': 'User-agent: *\nDisallow: /',
    [ABOUT]: '<p>Asha Rao co-founded Dewdrop Naturals in 2019.</p>',
    [PRESS]: '<p>At the Pune D2C summit, Asha Rao spoke about selling skincare online.</p>',
  });
  env.deps.webSearch = webSearch([{ url: ABOUT, title: 'About', snippet: 'x' }, { url: PRESS, title: 'Summit', snippet: 'y' }]);
  env.deps.net = { resolve: site.resolve, send: site.send };
  const brief = await net<any>(env, 'venture.network.research', { personId: asha.id });
  assert.deepEqual(site.fetched, ['https://dewdrop.example/robots.txt', ABOUT, 'https://press.example/robots.txt'], 'robots.txt first; the disallowed page never opened');
  assert.deepEqual(brief.lines.map((line: any) => line.url), [ABOUT]);

  const { agentBusiness } = await import('./venture-agent-helpers.ts');
  const shop = await agentBusiness();
  const web = pages({ 'https://studio.example/robots.txt': 'User-agent: *\nDisallow: /private', 'https://studio.example/private/faq': '<p>Refunds in 7 days.</p>' });
  shop.deps.net = { resolve: web.resolve, send: web.send };
  await assert.rejects(shop.agents('venture.knowledge.add', { source: { kind: 'link', url: 'https://studio.example/private/faq' } }, owner), (error: any) => {
    assert.equal(error.code, 'ROBOTS_REFUSED');
    assert.equal(error.message, 'This site asks robots not to read that page.');
    return true;
  });
  assert.deepEqual(web.fetched, ['https://studio.example/robots.txt']);
});


test('knowledge links obey robots.txt before every redirect hop, on the same site and another site', async () => {
  const { agentBusiness } = await import('./venture-agent-helpers.ts');
  const { pages } = await import('./venture-network-search-env.ts');
  for (const target of ['https://studio.example/private/faq', 'https://other.example/private/faq']) {
    const env = await agentBusiness();
    const web = pages({
      'https://studio.example/robots.txt': 'User-agent: *\nDisallow: /private',
      'https://other.example/robots.txt': 'User-agent: *\nDisallow: /private',
      'https://studio.example/public': { status: 302, headers: { location: target }, body: Buffer.from('') },
      [target]: '<p>Refunds are handled here.</p>',
    });
    env.deps.net = { resolve: web.resolve, send: web.send };
    await assert.rejects(env.agents('venture.knowledge.add', { source: { kind: 'link', url: 'https://studio.example/public' } }, owner), code('ROBOTS_REFUSED'));
    assert.ok(!web.fetched.includes(target), 'the disallowed target was never read');
    assert.ok(web.fetched.includes(new URL(target).origin + '/robots.txt'));
  }
});

test('Before you write obeys robots.txt again at a redirect target', async () => {
  const { searchEnv, importFile, SKINCARE, skincarePeople, pages, webSearch } = await import('./venture-network-search-env.ts');
  const { net } = await import('./venture-network-env.ts');
  const env = await searchEnv();
  await importFile(env, 'linkedin-connections', 'Connections.csv', SKINCARE);
  const asha = skincarePeople(env).asha;
  const web = pages({
    'https://dewdrop.example/robots.txt': 'User-agent: *\nDisallow: /private',
    'https://dewdrop.example/about': { status: 302, headers: { location: '/private/founder' }, body: Buffer.from('') },
    'https://dewdrop.example/private/founder': '<p>Asha Rao co-founded Dewdrop Naturals.</p>',
  });
  env.deps.webSearch = webSearch([{ url: 'https://dewdrop.example/about', title: 'About', snippet: 'x' }]);
  env.deps.net = { resolve: web.resolve, send: web.send };
  const brief = await net<any>(env, 'venture.network.research', { personId: asha.id });
  assert.ok(!web.fetched.includes('https://dewdrop.example/private/founder'), 'the disallowed target was never read');
  assert.equal(brief.lines.length, 0);
});


test('robots.txt matches the complete Chausar token, never a substring group', () => {
  for (const partial of ['Ch', 'haus', 'ChausarBot']) {
    assert.equal(robotsAllows('User-agent: ' + partial + '\nAllow: /\n\nUser-agent: *\nDisallow: /', '/private'), false, partial);
  }
  assert.equal(robotsAllows('User-agent: cHaUsAr\nAllow: /\n\nUser-agent: *\nDisallow: /', '/private'), true);
});
