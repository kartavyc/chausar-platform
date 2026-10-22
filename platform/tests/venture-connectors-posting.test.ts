// P2-connectors: posting modes on social and video connectors (api, owner-browser-session, handoff), each post approved
// on its own through a 'connector' queue row, journalled described -> approved -> applied | rejected | outcome_unknown,
// and never sent twice. The browser is a fake port or a fake Playwright module: no real browser, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Context } from '../runtime/contracts.ts';
import { VENTURE_ERRORS } from '../runtime/venture/contracts.ts';
import type { BrowserPort, BrowserPostJob, BrowserPostResult, ConnectorCard, ConnectorPostRecord, VentureDeps } from '../runtime/venture/contracts.ts';
import { houseStyleFindings, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { CONNECTOR_CATALOGUE, handlers } from '../runtime/venture/build/index.ts';
import { connectorCard } from '../runtime/venture/build/connectors.ts';
import {
  OWNER_SESSION_RISK, POSTING_CONNECTORS, connectorQueueRows, decideConnectorRow, decidePost, postHandoff, postJournal, proposePost,
  resolveUnknownPost, sweepStaleClaims,
} from '../runtime/venture/build/posting.ts';
import { BROWSER_SCRIPTS, LAUNCH_OPTIONS, playwrightBrowserPort } from '../runtime/venture/build/browser.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const agentCtx: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'mcp' };
const code = (expected: string) => (error: any) => { assert.equal(error.code, expected, error.message); return true; };
const PRESENT = { present: true, reason: 'Playwright with Chromium found on this computer.' };
const ABSENT = { present: false, reason: 'Playwright was not found next to Chausar. Chausar does not install it.' };

function fakeBrowser(present = true, results: (BrowserPostResult | 'hang' | 'throw')[] = [{ outcome: 'posted', line: 'X showed the post.', url: null }]) {
  const jobs: BrowserPostJob[] = [];
  const port: BrowserPort = {
    async probe() { return present ? PRESENT : ABSENT; },
    async post(job) {
      jobs.push(job);
      const next = results.shift() ?? { outcome: 'posted', line: 'Posted.', url: null };
      if (next === 'hang') return new Promise<BrowserPostResult>(() => {});
      if (next === 'throw') throw new Error('browser crashed');
      return next;
    },
  };
  return { jobs, port };
}

let tick = 0;
function setup(options: { browser?: BrowserPort; host?: string; appReviewed?: string[]; timeout?: number } = {}) {
  const store = new VentureTestStore();
  const clock = () => new Date(Date.UTC(2026, 9, 21, 10, 0, tick++));
  const deps = {
    store, clock, host: options.host ?? 'desktop',
    connectors: { browser: options.browser, appReviewed: options.appReviewed ?? [], postTimeoutMs: options.timeout ?? 40 },
  } as unknown as VentureDeps;
  return { store, deps };
}

async function seed(deps: VentureDeps) {
  return ventureAction(deps, owner, 'admin', 'seed', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Social media for cafes in Pune', ideaDigest: 'synthetic', workingName: 'Lumen Social', country: null,
    serviceType: 'agency', status: 'live', launchStage: 'approve-each', blueprintId: null, acceptedBlueprintId: null, playbookId: null,
    invoiceSequence: 0, updatedAt: tx.now,
  } as any), { create: true });
}

const list = (deps: VentureDeps) => handlers['venture.connectors.list']!(deps, owner, {}) as Promise<ConnectorCard[]>;
const option = (card: ConnectorCard, mode: string) => card.postingOptions.find(item => item.mode === mode)!;

test('posting connectors: LinkedIn, X, Instagram and YouTube carry three modes; every other card carries none', () => {
  assert.deepEqual([...POSTING_CONNECTORS].sort(), ['instagram', 'linkedin', 'x', 'youtube']);
  for (const item of CONNECTOR_CATALOGUE) {
    const card = connectorCard(item, false);
    if (!POSTING_CONNECTORS.includes(item.id as any)) {
      assert.deepEqual(card.postingOptions, [], item.id);
      assert.ok(!('posting' in card), item.id);
      continue;
    }
    assert.deepEqual(card.postingOptions.map(p => p.mode), ['api', 'owner-browser-session', 'handoff'], item.id);
    // The summary the Connections place shows: nothing available, so the owner-browser-session option with its reason.
    assert.deepEqual(card.posting, option(card, 'owner-browser-session'), item.id);
    for (const p of card.postingOptions) {
      for (const text of [p.what, p.risk ?? '', p.reason ?? '', ...p.requires]) {
        assert.deepEqual(houseStyleFindings(text), [], `${item.id} ${p.mode}: ${text}`);
        assert.ok(text.length <= 200, text);
      }
      assert.equal(p.status === 'planned', p.reason !== null, `${item.id} ${p.mode}: a planned option says why, an available one does not`);
    }
    // Without a probe (no environment given) nothing is available.
    assert.ok(card.postingOptions.every(p => p.status === 'planned'), item.id);
  }
});

test('API posting stays planned until the app review is recorded, and even then until a posting client exists', async () => {
  const { deps } = setup({ browser: fakeBrowser(false).port });
  await seed(deps);
  const cards = await list(deps);
  const youtube = cards.find(card => card.id === 'youtube')!;
  const api = option(youtube, 'api');
  assert.equal(api.status, 'planned');
  // Google's videos.insert page (updated 15 October 2026): uploads from unverified API projects are no longer locked to
  // private, so no audit is required; sign-in verification still is, and no upload client ships, so it stays planned.
  assert.ok(api.requires.some(r => /Google sign-in verification/.test(r)), api.requires.join(' / '));
  assert.ok(api.requires.some(r => /upload client, which this build does not ship/.test(r)), api.requires.join(' / '));
  assert.ok(!api.requires.some(r => /audit|stay private/i.test(r)), api.requires.join(' / '));
  assert.match(youtube.note, /no longer locks API uploads from unverified apps to private/);
  assert.match(api.reason!, /review/i);
  assert.ok(option(cards.find(card => card.id === 'instagram')!, 'api').requires.includes('Meta app review'));

  const reviewed = setup({ browser: fakeBrowser(false).port, appReviewed: ['youtube'] });
  await seed(reviewed.deps);
  const after = option((await list(reviewed.deps)).find(card => card.id === 'youtube')!, 'api');
  assert.equal(after.status, 'planned', 'a recorded review alone does not make a posting client');
  assert.notEqual(after.reason, api.reason);
  assert.match(after.reason!, /not in this build/);
});

test('owner-browser-session: planned with the reason when no local Playwright and Chromium; available with the risk line when present', async () => {
  const absent = setup({ browser: fakeBrowser(false).port });
  await seed(absent.deps);
  for (const card of (await list(absent.deps)).filter(c => POSTING_CONNECTORS.includes(c.id as any))) {
    const browser = option(card, 'owner-browser-session');
    assert.equal(browser.status, 'planned', card.id);
    assert.equal(browser.risk, OWNER_SESSION_RISK);
    assert.equal(browser.risk, 'The platform may restrict this account.');
  }
  assert.equal(option((await list(absent.deps)).find(c => c.id === 'x')!, 'owner-browser-session').reason, ABSENT.reason);

  const present = setup({ browser: fakeBrowser(true).port });
  await seed(present.deps);
  const cards = await list(present.deps);
  for (const id of ['x', 'linkedin']) {
    const browser = option(cards.find(c => c.id === id)!, 'owner-browser-session');
    assert.equal(browser.status, 'available', id);
    assert.equal(browser.qualification, 'unqualified', 'never checked against the live site');
    assert.match(browser.what, /approve each post/);
    assert.match(browser.what, /not yet checked against the live site/i);
    assert.equal(browser.risk, OWNER_SESSION_RISK);
    const card = cards.find(c => c.id === id)!;
    assert.deepEqual([card.posting?.mode, card.posting?.status, card.posting?.risk], ['owner-browser-session', 'available', OWNER_SESSION_RISK]);
  }
  for (const id of ['instagram', 'youtube']) {
    const browser = option(cards.find(c => c.id === id)!, 'owner-browser-session');
    assert.equal(browser.status, 'planned', id);
    assert.match(browser.reason!, /picture or video/);
  }

  const hosted = setup({ browser: fakeBrowser(true).port, host: 'hosted-web' });
  await seed(hosted.deps);
  const web = option((await list(hosted.deps)).find(c => c.id === 'x')!, 'owner-browser-session');
  assert.equal(web.status, 'planned');
  assert.match(web.reason!, /desktop app/);
});

test('handoff: the engine prepares the link or the text, but no screen opens it yet, so it is planned', () => {
  const x = postHandoff('x', 'Fresh pastries at 8.');
  assert.equal(x.url, 'https://x.com/intent/post?text=Fresh%20pastries%20at%208.');
  assert.equal(x.copy, 'Fresh pastries at 8.');
  assert.equal(postHandoff('youtube', 'Title\nDescription').url, 'https://studio.youtube.com/');
  assert.equal(postHandoff('linkedin', 'Hello').url, 'https://www.linkedin.com/feed/');
  const card = connectorCard(CONNECTOR_CATALOGUE.find(item => item.id === 'x')!, false);
  assert.equal(option(card, 'handoff').status, 'planned');
  assert.throws(() => postHandoff('stripe', 'x'), code('INVALID_VENTURE_REQUEST'));
});

test('a post is proposed only on a posting connector, in a mode that works now, within the platform limit', async () => {
  const { deps } = setup({ browser: fakeBrowser(false).port });
  await seed(deps);
  await assert.rejects(proposePost(deps, agentCtx, { connectorId: 'stripe', text: 'hi' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(proposePost(deps, agentCtx, { connectorId: 'x', text: 'hi' }), code('NOT_BUILT_YET'));

  const ready = setup({ browser: fakeBrowser(true).port });
  await seed(ready.deps);
  await assert.rejects(proposePost(ready.deps, agentCtx, { connectorId: 'x', text: 'a'.repeat(281) }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(proposePost(ready.deps, agentCtx, { connectorId: 'instagram', text: 'caption' }), code('NOT_BUILT_YET'));
  await assert.rejects(proposePost(ready.deps, agentCtx, { connectorId: 'x', text: 'hi', mode: 'api' }), code('NOT_BUILT_YET'));
  await assert.rejects(proposePost(ready.deps, agentCtx, { connectorId: 'x', text: 'hi', proxy: 'socks5://somewhere' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(proposePost(ready.deps, { ...owner, role: 'viewer' }, { connectorId: 'x', text: 'hi' }), code('ACCESS_REVOKED'));

  const post = await proposePost(ready.deps, agentCtx, { connectorId: 'x', account: '@lumensocial', text: 'Fresh pastries at 8.', agent: 'Social writer' });
  assert.equal(post.state, 'described');
  assert.equal(post.mode, 'owner-browser-session');
  assert.equal(post.risk, OWNER_SESSION_RISK);
  assert.deepEqual(post.journal.map(entry => entry.state), ['described']);
  assert.match(post.describe, /Post to X as @lumensocial/);
});

test('each post is its own connector queue row; the owner denies one and approves another, once each', async () => {
  const browser = fakeBrowser(true);
  const { deps, store } = setup({ browser: browser.port });
  await seed(deps);
  const first = await proposePost(deps, agentCtx, { connectorId: 'x', text: 'Post one', agent: 'Social writer' });
  const second = await proposePost(deps, agentCtx, { connectorId: 'linkedin', text: 'Post two' });

  const rows = connectorQueueRows(store.read());
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.kind, 'connector');
    assert.equal(row.businessName, 'Lumen Social');
    assert.equal(row.actions.filter(a => a.primary).length, 1);
    const approve = row.actions.find(a => a.id === 'approve')!;
    assert.ok(approve.primary && approve.secondAsk && approve.requiresView);
    assert.match(row.line!, /The platform may restrict this account\./);
    assert.deepEqual(row.viewRef, { kind: 'draft', id: row.id });
  }
  const firstRow = rows.find(row => row.id === first.id)!;
  assert.equal(firstRow.digest, first.digest);
  assert.equal(firstRow.agent, 'Social writer');

  await assert.rejects(decidePost(deps, agentCtx, { postId: first.id, digest: first.digest, action: 'approve' }), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(decidePost(deps, owner, { postId: first.id, digest: 'f'.repeat(64), action: 'approve' }), code('APPROVAL_STALE'));
  await assert.rejects(decidePost(deps, owner, { postId: 'post_missing', digest: first.digest, action: 'approve' }), code('POST_NOT_FOUND'));
  assert.equal(browser.jobs.length, 0);

  const denied = await decideConnectorRow(deps, owner, { id: second.id, digest: second.digest, action: 'deny' });
  assert.equal(denied.outcome, 'done');
  assert.equal(denied.post?.state, 'rejected');
  assert.equal(denied.post?.outcome?.by, 'owner');
  assert.equal(browser.jobs.length, 0, 'a denied post never touches the browser');

  const approved = await decidePost(deps, owner, { postId: first.id, digest: first.digest, action: 'approve' });
  assert.equal(approved.outcome, 'done');
  assert.equal(approved.post.state, 'applied');
  assert.deepEqual(approved.post.journal.map(entry => entry.state), ['described', 'approved', 'applied']);
  assert.equal(browser.jobs.length, 1);
  assert.deepEqual({ ...browser.jobs[0], timeoutMs: 0 }, { postId: first.id, connectorId: 'x', text: 'Post one', timeoutMs: 0 });

  await assert.rejects(decidePost(deps, owner, { postId: first.id, digest: first.digest, action: 'approve' }), code('POST_ALREADY_DECIDED'));
  const refused = await decideConnectorRow(deps, owner, { id: first.id, digest: first.digest, action: 'approve' });
  assert.equal(refused.outcome, 'refused');
  assert.equal(browser.jobs.length, 1, 'decide-once: the browser ran one time');
  assert.deepEqual(connectorQueueRows(store.read()), []);
  const journal = postJournal(store.read());
  assert.deepEqual(journal.map(entry => entry.state).sort(), ['applied', 'rejected']);
});

test('a timeout, a crash or an unclear browser result is outcome_unknown, and the post is never sent again', async () => {
  for (const result of ['hang', 'throw', { outcome: 'unknown', line: 'X did not confirm the post.' }] as const) {
    const browser = fakeBrowser(true, [result as any]);
    const { deps } = setup({ browser: browser.port, timeout: 30 });
    await seed(deps);
    const post = await proposePost(deps, agentCtx, { connectorId: 'x', text: 'Maybe posted' });
    const decision = await decidePost(deps, owner, { postId: post.id, digest: post.digest, action: 'approve' });
    assert.equal(decision.post.state, 'outcome_unknown', String(result));
    assert.match(decision.line, /Check X before posting again/);
    await assert.rejects(decidePost(deps, owner, { postId: post.id, digest: post.digest, action: 'approve' }), code('POST_ALREADY_DECIDED'));
    assert.equal(browser.jobs.length, 1);

    const settled = await resolveUnknownPost(deps, owner, { postId: post.id, found: result === 'throw' ? 'not-posted' : 'posted' });
    assert.equal(settled.state, result === 'throw' ? 'rejected' : 'applied');
    assert.equal(settled.outcome?.by, 'owner');
    assert.equal(browser.jobs.length, 1, 'recording what the owner found never resends');
    await assert.rejects(resolveUnknownPost(deps, owner, { postId: post.id, found: 'posted' }), code('POST_ALREADY_DECIDED'));
  }
});

test('the platform never reached: rejected by the platform with the reason; a crash mid-claim becomes outcome_unknown on sweep', async () => {
  const browser = fakeBrowser(true, [{ outcome: 'not-sent', line: 'Sign in to X in the Chausar browser window first.' }]);
  const { deps, store } = setup({ browser: browser.port });
  await seed(deps);
  const post = await proposePost(deps, agentCtx, { connectorId: 'x', text: 'Signed out' });
  const decision = await decidePost(deps, owner, { postId: post.id, digest: post.digest, action: 'approve' });
  assert.equal(decision.post.state, 'rejected');
  assert.equal(decision.post.outcome?.by, 'platform');
  assert.match(decision.line, /Sign in to X/);

  // A crash after the claim: the record says approved with a claim and nothing else.
  const crashed = await proposePost(deps, agentCtx, { connectorId: 'linkedin', text: 'Crashed' });
  await store.update(state => {
    const record = state.conversations.find(r => r.id === crashed.id) as ConnectorPostRecord;
    record.state = 'approved';
    record.claimedAt = '2026-10-21T09:00:00.000Z';
    record.journal.push({ state: 'approved', at: record.claimedAt, by: 'owner', line: 'Approved.' });
  });
  const swept = await sweepStaleClaims(deps, owner);
  assert.deepEqual(swept.map(item => item.id), [crashed.id]);
  const after = listRecords(store.read(), 'venture-connector-post').find(item => item.id === crashed.id)!;
  assert.equal(after.state, 'outcome_unknown');
  assert.equal(browser.jobs.length, 1, 'the sweep never resends');
});

// ---------------------------------------------------------------------------
// The real Playwright port, driven against a fake Playwright module
// ---------------------------------------------------------------------------

function fakePlaywright(options: { exePresent?: boolean; url?: string; failAt?: 'fill' | 'confirm' } = {}) {
  const calls: string[] = [];
  const launches: { dir: string; options: Record<string, unknown> }[] = [];
  let closed = 0;
  const locator = (selector: string) => ({
    first() { return this; },
    async fill(text: string) { calls.push(`fill ${selector} ${text}`); if (options.failAt === 'fill') throw new Error('no textbox'); },
    async click() { calls.push(`click ${selector}`); },
    async waitFor() { calls.push(`wait ${selector}`); if (options.failAt === 'confirm') throw new Error('Timeout 30000ms exceeded'); },
  });
  const page = {
    async goto(url: string) { calls.push(`goto ${url}`); },
    url: () => options.url ?? 'https://x.com/compose/post',
    locator,
  };
  const module = {
    chromium: {
      executablePath: () => 'C:/fake/chromium/chrome.exe',
      async launchPersistentContext(dir: string, launchOptions: Record<string, unknown>) {
        launches.push({ dir, options: launchOptions });
        return { pages: () => [page], newPage: async () => page, close: async () => { closed += 1; } };
      },
    },
  };
  const port = playwrightBrowserPort({
    load: async () => module, exists: () => options.exePresent !== false, profileRoot: 'C:/profiles',
  });
  return { port, calls, launches, closedCount: () => closed };
}

test('the Playwright port: probes without installing anything, and reports absent with a reason', async () => {
  const none = playwrightBrowserPort({ load: async () => null, exists: () => true, profileRoot: 'C:/profiles' });
  assert.deepEqual(await none.probe(), { present: false, reason: 'Playwright was not found next to Chausar. Chausar does not install it.' });
  const noChromium = fakePlaywright({ exePresent: false });
  assert.deepEqual(await noChromium.port.probe(), { present: false, reason: "Playwright is here but its Chromium is not. Chausar does not download it." });
  assert.deepEqual(await fakePlaywright().port.probe(), PRESENT);
  const source = await readFile(new URL('../runtime/venture/build/browser.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(npx|npm|install\(|child_process|execFile|spawn)\b/, 'the probe never installs or downloads');
});

test('the Playwright port posts from the owner profile with plain launch options: no proxy, no user agent, no extra arguments', async () => {
  const fake = fakePlaywright();
  const result = await fake.port.post({ postId: 'post_1', connectorId: 'x', text: 'Hello', timeoutMs: 1000 });
  assert.equal(result.outcome, 'posted');
  const script = BROWSER_SCRIPTS.x;
  assert.deepEqual(fake.calls, [`goto ${script.composeUrl}`, `fill ${script.textbox} Hello`, `click ${script.submit}`, `wait ${script.confirm}`]);
  assert.equal(fake.launches.length, 1);
  assert.match(fake.launches[0].dir.replaceAll('\\', '/'), /^C:\/profiles\/x$/);
  assert.deepEqual(fake.launches[0].options, { ...LAUNCH_OPTIONS });
  for (const key of ['proxy', 'userAgent', 'args', 'ignoreDefaultArgs', 'extraHTTPHeaders', 'locale', 'timezoneId', 'geolocation']) {
    assert.ok(!(key in fake.launches[0].options), key);
  }
  assert.equal(fake.closedCount(), 1);
  assert.equal(script.checkedOn, null, 'never checked against the live site; the label says so');
});

test('the Playwright port: signed out or no textbox is not-sent; a missing confirmation after the click is unknown', async () => {
  const signedOut = fakePlaywright({ url: 'https://x.com/i/flow/login' });
  const out = await signedOut.port.post({ postId: 'post_1', connectorId: 'x', text: 'Hello', timeoutMs: 1000 });
  assert.equal(out.outcome, 'not-sent');
  assert.match(out.line, /Sign in to X/);
  assert.ok(!signedOut.calls.some(call => call.startsWith('click')));
  assert.equal(signedOut.closedCount(), 1);

  const noBox = fakePlaywright({ failAt: 'fill' });
  assert.equal((await noBox.port.post({ postId: 'post_1', connectorId: 'x', text: 'Hello', timeoutMs: 1000 })).outcome, 'not-sent');
  assert.equal(noBox.closedCount(), 1);

  const unclear = fakePlaywright({ failAt: 'confirm' });
  const maybe = await unclear.port.post({ postId: 'post_1', connectorId: 'x', text: 'Hello', timeoutMs: 1000 });
  assert.equal(maybe.outcome, 'unknown');
  assert.match(maybe.line, /may have gone out/);
  assert.equal(unclear.closedCount(), 1);

  const instagram = await fakePlaywright().port.post({ postId: 'post_1', connectorId: 'instagram', text: 'Hello', timeoutMs: 1000 });
  assert.equal(instagram.outcome, 'not-sent');
});

test('static: the posting files throw only declared codes, keep the house style and never build evasion', async () => {
  for (const file of ['posting.ts', 'browser.ts']) {
    const source = await readFile(new URL(`../runtime/venture/build/${file}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/'([A-Z]+(?:_[A-Z]+)+)'/g)) {
      assert.ok((VENTURE_ERRORS as readonly string[]).includes(match[1]), `${file}: ${match[1]}`);
    }
    assert.ok(!source.includes('\u2014'), `${file} has a long dash`);
    assert.deepEqual(houseStyleFindings(source), [], file);
    assert.doesNotMatch(source, /stealth|fingerprint|rotateProxy|proxyList/i, file);
  }
});
