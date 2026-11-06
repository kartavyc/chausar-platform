// The pre-post risk gate (catalogue K5, Ink v2 wave 2 package 2B1). Chausar's own posting limits, held in a dated rule
// list with the register's PlatformRule shape (playbooks/social/post-limits.ts): three posts a day per channel, a 60
// minute gap, one post a day for a channel's first seven days, near-duplicates of the last five posts held from 85%
// (a warning from 60%), and a warning on the third post in a row linking the same site; plus the hashtag cap and the
// engagement bait rule the social checks already hold. Through venture.posting.propose with stored earlier posts as
// history, and again when the owner approves, just before the browser starts. No real browser: a fake port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '../runtime/contracts.ts';
import type { BrowserPort, BrowserPostJob, ConnectorPostRecord, PostingProposal, VentureDeps } from '../runtime/venture/contracts.ts';
import { VENTURE_ERRORS } from '../runtime/venture/contracts.ts';
import { houseStyleFindings, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as build } from '../runtime/venture/build/index.ts';
import { POSTING_CONSENT_LINE, connectorQueueRows, decideConnectorRow, decidePost, resolveUnknownPost } from '../runtime/venture/build/posting.ts';
import { HOUSE_LIMITS, HOUSE_POSTING_RULES, tightenedLimits } from '../runtime/venture/playbooks/social/post-limits.ts';
import { diskPostLog, memoryPostLog } from '../runtime/venture/build/post-log.ts';
import { linkDomains, postPrint, postingRisk, similarityPermille } from '../runtime/venture/playbooks/social/risk-gate.ts';
import { platformRule, validateRulesRegister } from '../runtime/venture/playbooks/social/register.ts';
import { code, owner, setup, type Env } from './venture-views-env.ts';
import { seedPostDraft } from './venture-post-drafts.ts';

const agent: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'mcp' };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;
const propose = (deps: VentureDeps, draftId: string, ctx: Context = agent) => (build as Record<string, Handler>)['venture.posting.propose'](deps, ctx, { draftId }) as Promise<PostingProposal>;

async function posting() {
  const env = await setup();
  const jobs: BrowserPostJob[] = [];
  const port: BrowserPort = {
    async probe() { return { present: true, reason: 'Playwright with Chromium found on this computer.' }; },
    async post(job) { jobs.push(job); return { outcome: 'posted', line: 'LinkedIn showed that the post went out.', url: null }; },
  };
  env.deps = { ...env.deps, connectors: { browser: port, appReviewed: [], postTimeoutMs: 40 } } as VentureDeps;
  return { env, deps: env.deps, jobs };
}

/** A post that went out earlier on a channel, `ago` before now: stored as the journal stores an applied or unknown post. */
async function sent(env: Env, text: string, ago: number, options: { connectorId?: string; state?: 'applied' | 'outcome_unknown' } = {}) {
  const at = new Date(Date.parse(env.now()) - ago).toISOString();
  const state = options.state ?? 'applied';
  return ventureAction(env.deps, owner, 'prepare', 'seed.post', tx => tx.put<ConnectorPostRecord>({
    ...tx.base('venture-connector-post'), at, connectorId: options.connectorId ?? 'linkedin', mode: 'owner-browser-session', account: null, text, agent: null,
    digest: 'seeded', state, describe: 'Post to LinkedIn from your own browser on this computer.', risk: null, claimedAt: at, decidedBy: 'owner',
    outcome: { line: 'Posted.', url: null, by: 'platform' }, journal: [{ state: 'described', at, by: 'owner', line: 'Seeded.' }, { state, at, by: 'platform', line: 'Seeded.' }],
    approval: null, expiresAt: null, descriptionComplete: true, draftId: 'delivery_earlier', draftDigest: null, part: null,
  }));
}

/** The channel has been posting for weeks, so its warm-up is over. */
const seasoned = (env: Env) => sent(env, 'Our first post here, a long while back, about the new menu.', 20 * DAY);
const blockedBy = (rule: string) => (error: any) => { assert.equal(error.code, 'POST_RISK_BLOCKED', error.message); assert.match(error.message, new RegExp(`rule ${rule}\\b`)); return true; };
const LONG = 'Our cafe now opens at seven on weekdays so office workers can grab filter coffee and a warm idli before the first meeting of the day starts';

test('house limits: a dated rule list with the register shape, read as house rules, each used by the publish step', () => {
  validateRulesRegister(HOUSE_POSTING_RULES);
  for (const rule of HOUSE_POSTING_RULES) {
    assert.equal(rule.read, 'house', rule.id);
    assert.match(rule.id, /^house-/);
    assert.deepEqual(rule.usedBy, ['publish'], rule.id);
    assert.ok(rule.limitations.length > 0, rule.id);
    assert.match(rule.how, /Chausar's own posting limits/);
    assert.match(rule.rule, /not a platform rule/i, rule.id);
    assert.deepEqual(houseStyleFindings([rule.rule, rule.how, ...rule.limitations].join(' ')), [], rule.id);
  }
  const value = (id: string) => platformRule(id, HOUSE_POSTING_RULES).value;
  assert.deepEqual(HOUSE_LIMITS, {
    capPer24h: value('house-post-cap-24h'), minGapMinutes: value('house-post-min-gap'), warmUpDays: value('house-warm-up'),
    duplicateBlockPermille: value('house-near-duplicate'), duplicateWarnPermille: value('house-near-duplicate-warn'),
    duplicateWindow: value('house-near-duplicate-window'), linkStreak: value('house-link-streak'),
  });
  assert.deepEqual([HOUSE_LIMITS.capPer24h, HOUSE_LIMITS.minGapMinutes, HOUSE_LIMITS.warmUpDays, HOUSE_LIMITS.duplicateBlockPermille, HOUSE_LIMITS.duplicateWarnPermille, HOUSE_LIMITS.duplicateWindow, HOUSE_LIMITS.linkStreak], [3, 60, 7, 850, 600, 5, 3]);
});

test('the owner may only tighten the house limits, never loosen them', () => {
  const tight = tightenedLimits({ capPer24h: 2, minGapMinutes: 120, warmUpDays: 14, duplicateBlockPermille: 700, duplicateWarnPermille: 400, duplicateWindow: 10, linkStreak: 2 });
  assert.deepEqual(tight, { capPer24h: 2, minGapMinutes: 120, warmUpDays: 14, duplicateBlockPermille: 700, duplicateWarnPermille: 400, duplicateWindow: 10, linkStreak: 2 });
  const loose = tightenedLimits({ capPer24h: 10, minGapMinutes: 5, warmUpDays: 0, duplicateBlockPermille: 990, duplicateWarnPermille: 900, duplicateWindow: 1, linkStreak: 9 });
  assert.deepEqual(loose, HOUSE_LIMITS);
  assert.deepEqual(tightenedLimits({ capPer24h: 1.5, minGapMinutes: -1 } as never), HOUSE_LIMITS, 'not a whole number: ignored');
});

test('similarity: word three-shingles, Jaccard in whole permille; links name their site', () => {
  assert.equal(similarityPermille(LONG, LONG), 1000);
  assert.equal(similarityPermille(LONG, 'Something else entirely about a bakery in Kochi'), 0);
  const words = LONG.split(' ');
  const lastChanged = [...words.slice(0, -1), 'begins'].join(' ');
  // 27 words make 25 shingles each; one changed word at the end changes the last shingle: 24 shared of 26.
  assert.equal(similarityPermille(LONG, lastChanged), Math.floor((24 * 1000) / 26));
  assert.equal(similarityPermille('Hello there', 'hello  THERE!'), 1000, 'case, spacing and punctuation do not count');
  assert.deepEqual(linkDomains('Read https://www.Example.com/a and http://shop.example.com/b, or www.example.com/c.'), ['example.com', 'shop.example.com']);
});

test('the fourth post on a channel in 24 hours is blocked, an unknown outcome counting as sent', async () => {
  const { env, deps } = await posting();
  await seasoned(env);
  await sent(env, 'Monday menu: masala dosa and filter coffee.', 20 * HOUR);
  await sent(env, 'Tuesday menu: pongal and ginger chai.', 10 * HOUR, { state: 'outcome_unknown' });
  const run = await seedPostDraft(deps, ['LinkedIn: Thursday menu: poha and lemon tea.']);
  // Two in the last day: the third may go.
  const third = await propose(deps, `${run.id}.post-1`);
  assert.equal(third.state, 'described');
  await sent(env, 'Wednesday menu: upma and cold coffee.', 2 * HOUR);
  const fourth = await seedPostDraft(deps, ['LinkedIn: Friday menu: idli and sambar.']);
  await assert.rejects(propose(deps, `${fourth.id}.post-1`), blockedBy('house-post-cap-24h'));
  env.advance(9 * HOUR); // the Monday post is now more than a day old
  assert.equal((await propose(deps, `${fourth.id}.post-1`)).state, 'described');
});

test('a post within 60 minutes of the last one on the channel is blocked; after the gap it goes', async () => {
  const { env, deps } = await posting();
  await seasoned(env);
  await sent(env, 'Our weekend timings are up on the board.', 30 * 60_000);
  const run = await seedPostDraft(deps, ['LinkedIn: Thursday menu: poha and lemon tea.', 'X: Thursday menu: poha and lemon tea.']);
  await assert.rejects(propose(deps, `${run.id}.post-1`), blockedBy('house-post-min-gap'));
  // Each channel has its own history: X had nothing in the last hour.
  assert.equal((await propose(deps, `${run.id}.post-2`)).connectorId, 'x');
  env.advance(31 * 60_000);
  assert.equal((await propose(deps, `${run.id}.post-1`)).connectorId, 'linkedin');
});

test('near-duplicates of the last five posts: blocked from 85%, a warning on the Today row from 60%', async () => {
  const { env, deps } = await posting();
  await seasoned(env);
  await sent(env, LONG, 3 * HOUR);
  const words = LONG.split(' ');
  const close = [...words.slice(0, -1), 'begins'].join(' ');
  assert.ok(similarityPermille(LONG, close) >= 850);
  const near = await seedPostDraft(deps, [`LinkedIn: ${close}`]);
  await assert.rejects(propose(deps, `${near.id}.post-1`), blockedBy('house-near-duplicate'));

  const twice = words.map((word, index) => (index === 5 ? 'shuts' : index === 18 ? 'vada' : word)).join(' ');
  const permille = similarityPermille(LONG, twice);
  assert.ok(permille >= 600 && permille < 850, String(permille));
  const like = await seedPostDraft(deps, [`LinkedIn: ${twice}`]);
  const proposal = await propose(deps, `${like.id}.post-1`);
  assert.equal(proposal.warnings.length, 1);
  assert.match(proposal.warnings[0], /rule house-near-duplicate-warn\b/);
  assert.match(proposal.warnings[0], new RegExp(`${Math.floor(permille / 10)}%`));
  const waiting = listRecords(env.store.read(), 'venture-connector-post').filter(post => post.state === 'described');
  assert.deepEqual(waiting.map(post => post.warnings), [[proposal.warnings[0]]]);
  // Today's row: the consent line first, then the warning, then the account risk line.
  const [row] = connectorQueueRows(env.store.read());
  assert.equal(row.line, `${POSTING_CONSENT_LINE} ${proposal.warnings[0]} The platform may restrict this account.`);
});

test("a channel's first seven days allow one post a day; the very first post goes", async () => {
  const { env, deps } = await posting();
  const first = await seedPostDraft(deps, ['LinkedIn: Hello from our cafe in Pune.']);
  assert.equal((await propose(deps, `${first.id}.post-1`)).state, 'described', 'no history: the first post goes');
  await sent(env, 'Hello from our cafe in Pune, our first post.', 3 * DAY);
  await sent(env, 'Our filter coffee is back.', 20 * HOUR);
  const next = await seedPostDraft(deps, ['LinkedIn: Thursday menu: poha and lemon tea.']);
  await assert.rejects(propose(deps, `${next.id}.post-1`), blockedBy('house-warm-up'));
  env.advance(5 * HOUR); // a day since the last post, still inside the first week
  assert.equal((await propose(deps, `${next.id}.post-1`)).state, 'described');
});

test('a third post in a row linking the same site warns; it is not blocked', async () => {
  const { env, deps } = await posting();
  await seasoned(env);
  await sent(env, 'New menu at https://www.cafearoma.example/menu', 5 * HOUR);
  await sent(env, 'Book a table at https://cafearoma.example/book', 3 * HOUR);
  const run = await seedPostDraft(deps, ['LinkedIn: Our hours are at https://cafearoma.example/hours']);
  const proposal = await propose(deps, `${run.id}.post-1`);
  assert.equal(proposal.warnings.length, 1);
  assert.match(proposal.warnings[0], /cafearoma\.example/);
  assert.match(proposal.warnings[0], /rule house-link-streak\b/);
  const other = await seedPostDraft(deps, ['LinkedIn: Our hours are at https://another.example/hours']);
  assert.deepEqual((await propose(deps, `${other.id}.post-1`)).warnings, []);
});

test('engagement bait is blocked before the connector is called; a hashtag cap reuses the channel table', async () => {
  const { env, deps } = await posting();
  await seasoned(env);
  const bait = await seedPostDraft(deps, ['LinkedIn: Tag a friend who loves filter coffee!']);
  await assert.rejects(propose(deps, `${bait.id}.post-1`), blockedBy('meta-engagement-bait'));
  // Instagram takes five hashtags at most (rule ig-hashtags-5); the gate reads the same table the draft checks read.
  const risk = postingRisk({ channel: 'instagram', name: 'Instagram', text: 'New menu #a #b #c #d #e #f', now: env.now(), history: [] });
  assert.equal(risk.blocked, true);
  assert.match(risk.blocks.join(' '), /rule ig-hashtags-5\b/);
  assert.equal(postingRisk({ channel: 'instagram', name: 'Instagram', text: 'New menu #a #b', now: env.now(), history: [] }).blocked, false);
});

test('the gate runs again when the owner approves: a post another post overtook is refused and never reaches the browser', async () => {
  const { env, deps, jobs } = await posting();
  await seasoned(env);
  const one = await seedPostDraft(deps, ['LinkedIn: Thursday menu: poha and lemon tea.']);
  const two = await seedPostDraft(deps, ['LinkedIn: Our weekend timings are up on the board.']);
  const first = await propose(deps, `${one.id}.post-1`);
  const second = await propose(deps, `${two.id}.post-1`);
  const record = (id: string) => listRecords(env.store.read(), 'venture-connector-post').find(post => post.id === id)!;
  assert.equal((await decidePost(deps, owner, { postId: first.postId, digest: record(first.postId).digest, action: 'approve' })).post.state, 'applied');
  env.advance(5 * 60_000);
  await assert.rejects(decidePost(deps, owner, { postId: second.postId, digest: record(second.postId).digest, action: 'approve' }), blockedBy('house-post-min-gap'));
  const row = await decideConnectorRow(deps, owner, { id: second.postId, digest: record(second.postId).digest, action: 'approve' });
  assert.deepEqual([row.outcome, row.reason], ['refused', 'POST_RISK_BLOCKED']);
  assert.equal(jobs.length, 1, 'the second post never reached the browser');
  assert.equal(listRecords(env.store.read(), 'venture-connector-post').find(post => post.id === second.postId)!.state, 'described', 'it still waits; the owner may deny it');

  // Another post goes out in the very commit that records the approval: the last look inside the apply stops it.
  env.advance(2 * HOUR);
  const three = await seedPostDraft(deps, ['LinkedIn: Our cafe is closed on Monday for Diwali.']);
  const third = await propose(deps, `${three.id}.post-1`);
  const thirdDigest = record(third.postId).digest;
  const overtaking = { ...structuredClone(record(first.postId)), id: 'post_overtaking', text: 'A post made at the same moment.' };
  const update = env.store.update.bind(env.store);
  let injected = false;
  env.store.update = (change => update(async state => {
    const result = await change(state);
    const approved = state.conversations.find(item => item.id === third.postId) as ConnectorPostRecord | undefined;
    if (approved?.state === 'approved' && !injected) {
      injected = true;
      state.conversations.push({ ...overtaking, at: env.now(), claimedAt: env.now() });
    }
    return result;
  })) as typeof env.store.update;
  const decided = await decidePost(deps, owner, { postId: third.postId, digest: thirdDigest, action: 'approve' });
  assert.equal(decided.post.state, 'rejected');
  assert.equal(decided.post.outcome?.by, 'engine');
  assert.match(decided.line, /rule house-post-min-gap\b/);
  assert.match(decided.line, /Nothing was posted\./);
  assert.equal(jobs.length, 1, 'nothing more was sent');
});

test('static: the risk files keep the house style and throw only declared codes', async () => {
  assert.ok((VENTURE_ERRORS as readonly string[]).includes('POST_RISK_BLOCKED'));
  for (const file of ['playbooks/social/post-limits.ts', 'playbooks/social/risk-gate.ts', 'playbooks/social/run-approvals.ts']) {
    const source = await readFile(new URL(`../runtime/venture/${file}`, import.meta.url), 'utf8');
    assert.ok(!source.includes(String.fromCharCode(0x2014)), file);
    assert.deepEqual(houseStyleFindings(source), [], file);
    for (const match of source.matchAll(/'([A-Z]+(?:_[A-Z]+)+)'/g)) assert.ok((VENTURE_ERRORS as readonly string[]).includes(match[1]), `${file}: ${match[1]}`);
  }
});

// ---------------------------------------------------------------------------
// The owner's own, stricter limits (venture.posting.limits.get and .set), and rules past their recheck
// ---------------------------------------------------------------------------

type Limits = { capPer24h: number; minGapMinutes: number; warmUpDays: number; duplicatePercent: number; linkStreak: number };
type LimitsView = { channels: { connectorId: string; name: string; house: Limits; owner: Partial<Limits>; inUse: Limits }[]; line: string };
const limitsCall = <T>(deps: VentureDeps, name: 'get' | 'set', payload: unknown = {}, ctx: Context = owner) =>
  (build as Record<string, Handler>)[`venture.posting.limits.${name}`](deps, ctx, payload) as Promise<T>;
const HOUSE: Limits = { capPer24h: 3, minGapMinutes: 60, warmUpDays: 7, duplicatePercent: 85, linkStreak: 3 };

test("the owner tightens a channel's limits; a looser number is refused; the gate uses them; clearing goes back to the house limits", async () => {
  const { env, deps } = await posting();
  const first = await limitsCall<LimitsView>(deps, 'get');
  assert.deepEqual(first.channels.map(channel => [channel.connectorId, channel.name]), [['linkedin', 'LinkedIn'], ['x', 'X']]);
  assert.deepEqual(first.channels[0], { connectorId: 'linkedin', name: 'LinkedIn', house: HOUSE, owner: {}, inUse: HOUSE });
  assert.match(first.line, /only make them stricter/);

  const set = await limitsCall<LimitsView>(deps, 'set', { connectorId: 'linkedin', limits: { capPer24h: 2, minGapMinutes: 120, duplicatePercent: 70 } });
  assert.deepEqual(set.channels[0].inUse, { ...HOUSE, capPer24h: 2, minGapMinutes: 120, duplicatePercent: 70 });
  assert.deepEqual(set.channels[1].inUse, HOUSE, 'X keeps the house limits');
  assert.equal(listRecords(env.store.read(), 'venture-posting-limits').length, 1);

  for (const looser of [{ capPer24h: 4 }, { minGapMinutes: 30 }, { warmUpDays: 3 }, { duplicatePercent: 90 }, { linkStreak: 5 }]) {
    await assert.rejects(limitsCall(deps, 'set', { connectorId: 'x', limits: looser }), (error: any) => {
      assert.equal(error.code, 'POSTING_LIMIT_LOOSER', JSON.stringify(looser));
      assert.match(error.message, /only make them stricter/);
      return true;
    });
  }
  for (const bad of [{ connectorId: 'x', limits: { capPer24h: 1.5 } }, { connectorId: 'x', limits: { capPer24h: 0 } }, { connectorId: 'x', limits: { other: 1 } }, { connectorId: 'stripe', limits: {} }, { connectorId: 'x' }]) {
    await assert.rejects(limitsCall(deps, 'set', bad), code('INVALID_VENTURE_REQUEST'), JSON.stringify(bad));
  }
  await assert.rejects(limitsCall(deps, 'set', { connectorId: 'x', limits: { capPer24h: 1 } }, agent), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(limitsCall(deps, 'set', { connectorId: 'x', limits: { capPer24h: 1 } }, { ...owner, channel: 'phone' }), code('APP_APPROVAL_REQUIRED'));

  // The gate on LinkedIn now holds a third post in a day, and wants two hours between posts.
  await seasoned(env);
  await sent(env, 'Monday menu: masala dosa and filter coffee.', 20 * HOUR);
  await sent(env, 'Tuesday menu: pongal and ginger chai.', 90 * 60_000);
  const run = await seedPostDraft(deps, ['LinkedIn: Thursday menu: poha and lemon tea.']);
  await assert.rejects(propose(deps, `${run.id}.post-1`), (error: any) => {
    assert.equal(error.code, 'POST_RISK_BLOCKED');
    assert.match(error.message, /the limit is 2\. \(rule house-post-cap-24h\)/);
    assert.match(error.message, /at least 120 minutes .*\(rule house-post-min-gap\)/);
    return true;
  });
  await limitsCall(deps, 'set', { connectorId: 'linkedin', limits: {} });
  assert.deepEqual((await limitsCall<LimitsView>(deps, 'get')).channels[0].inUse, HOUSE);
  assert.equal((await propose(deps, `${run.id}.post-1`)).state, 'described');
});

test('a rule the post rests on, past its 90-day recheck on the posting day, is a warning on the Today row, never a block', async () => {
  const { env, deps } = await posting();
  const run = await seedPostDraft(deps, ['LinkedIn: Thursday menu: poha and lemon tea.']);
  // 2026-10-15: every rule was checked within 90 days (or after today), so nothing to say.
  assert.deepEqual((await propose(deps, `${run.id}.post-1`)).warnings, []);
  env.advance(102 * DAY); // 2027-01-25
  const later = await seedPostDraft(deps, ['LinkedIn: Friday menu: idli and sambar.']);
  const proposal = await propose(deps, `${later.id}.post-1`);
  assert.equal(proposal.state, 'described');
  assert.equal(proposal.warnings.length, 1);
  const [warning] = proposal.warnings;
  assert.match(warning, /more than 90 days ago/);
  for (const id of ['linkedin-3000', 'meta-engagement-bait', 'house-post-cap-24h', 'house-post-min-gap', 'house-near-duplicate']) assert.match(warning, new RegExp(`rule ${id}[,.]`), id);
  assert.doesNotMatch(warning, /rule ig-hashtags-5\b/, "another channel's rule is not named");
  const row = connectorQueueRows(env.store.read()).find(item => item.id === proposal.postId)!;
  assert.ok(row.line?.startsWith(`${POSTING_CONSENT_LINE} ${warning}`), row.line);
});

// ---------------------------------------------------------------------------
// Review fixes: clocks moved back, Hindi words, bare links, the streak floor, and one history per computer
// ---------------------------------------------------------------------------

test('a post stamped later than now counts as now, and an unreadable time counts as now: a clock moved back never erases history', () => {
  const now = '2026-10-21T10:00:00.000Z';
  const later = { id: 'p1', text: 'Our weekend timings are up on the board.', at: '2026-10-22T10:00:00.000Z' };
  const risk = postingRisk({ channel: 'linkedin', name: 'LinkedIn', text: 'Thursday menu: poha and lemon tea.', now, history: [later] });
  assert.equal(risk.blocked, true);
  assert.match(risk.blocks.join(' '), /rule house-post-min-gap\b/);
  const broken = postingRisk({ channel: 'linkedin', name: 'LinkedIn', text: 'Thursday menu: poha and lemon tea.', now, history: [{ ...later, at: 'not a time' }] });
  assert.match(broken.blocks.join(' '), /rule house-post-min-gap\b/);
});

test('Hindi words keep their vowel signs, so a near repeat in Hindi is caught and a changed vowel is a changed word', () => {
  assert.ok(similarityPermille('हम आज नई कहानी सुनाते हैं', 'हम आज नई कहानि सुनाते हैं') < 1000, 'कहानी and कहानि are two words');
  const words = 'आज सुबह से हमारी दुकान पर ताज़ी जलेबी और गरम चाय मिल रही है तो दोस्तों के साथ ज़रूर आइए और नाश्ता कीजिए'.split(' ');
  const near = [...words.slice(0, -1), 'करिए'].join(' ');
  const risk = postingRisk({
    channel: 'linkedin', name: 'LinkedIn', text: near, now: '2026-10-21T10:00:00.000Z',
    history: [{ id: 'old', text: 'पुरानी पोस्ट', at: '2026-09-01T10:00:00.000Z' }, { id: 'p1', text: words.join(' '), at: '2026-10-21T06:00:00.000Z' }],
  });
  assert.match(risk.blocks.join(' '), /rule house-near-duplicate\b/);
});

test('links: bare addresses count, user names and passwords in a link are dropped, an email address is not a link', () => {
  assert.deepEqual(linkDomains('See cafearoma.example/menu and https://user:secret@shop.example.com/x, or write to a@b.example. Open at 8.30am.'), ['shop.example.com', 'cafearoma.example']);
});

test('the link streak never goes below 2: one link would warn on every post', () => {
  assert.equal(tightenedLimits({ linkStreak: 1 }).linkStreak, HOUSE_LIMITS.linkStreak);
  assert.equal(tightenedLimits({ linkStreak: 2 }).linkStreak, 2);
});

test('one posting history per computer: a second business on this computer, signed in to the same account, is counted too', async () => {
  const log = memoryPostLog();
  const first = await posting();
  const second = await posting();
  first.env.deps = first.deps = { ...first.deps, connectors: { ...first.deps.connectors!, postLog: log } } as VentureDeps;
  second.env.deps = second.deps = { ...second.deps, connectors: { ...second.deps.connectors!, postLog: log } } as VentureDeps;
  await seasoned(first.env);
  await seasoned(second.env);
  const one = await seedPostDraft(first.deps, ['LinkedIn: Thursday menu: poha and lemon tea.']);
  const proposed = await propose(first.deps, `${one.id}.post-1`);
  const digestOf = listRecords(first.env.store.read(), 'venture-connector-post').find(post => post.id === proposed.postId)!.digest;
  assert.equal((await decidePost(first.deps, owner, { postId: proposed.postId, digest: digestOf, action: 'approve' })).post.state, 'applied');
  assert.equal(log.entries.length, 1);
  assert.equal('text' in log.entries[0], false, 'the log keeps fingerprints of the words, not the words');

  const two = await seedPostDraft(second.deps, ['LinkedIn: Our weekend timings are up on the board.']);
  await assert.rejects(propose(second.deps, `${two.id}.post-1`), blockedBy('house-post-min-gap'));
  second.env.advance(61 * 60_000);
  assert.equal((await propose(second.deps, `${two.id}.post-1`)).state, 'described');
});

test('the owner cannot set a link streak of one', async () => {
  const { deps } = await posting();
  await assert.rejects(limitsCall(deps, 'set', { connectorId: 'x', limits: { linkStreak: 1 } }), code('INVALID_VENTURE_REQUEST'));
  assert.equal((await limitsCall<LimitsView>(deps, 'set', { connectorId: 'x', limits: { linkStreak: 2 } })).channels[1].inUse.linkStreak, 2);
});

// ---------------------------------------------------------------------------
// Re-review: the per-computer log and the vault's own posts
// ---------------------------------------------------------------------------

test('a post resolved as "did not go out" is not counted again through the log: proposing it again, as the engine says, goes', async () => {
  const env = await setup();
  const log = memoryPostLog();
  const port: BrowserPort = {
    async probe() { return { present: true, reason: 'ok' }; },
    async post() { return { outcome: 'unknown', line: 'The page went away.' }; },
  };
  env.deps = { ...env.deps, connectors: { browser: port, appReviewed: [], postTimeoutMs: 40, postLog: log } } as VentureDeps;
  const deps = env.deps;
  const run = await seedPostDraft(deps, ['LinkedIn: Thursday menu: poha and lemon tea at our cafe in Pune.']);
  const first = await propose(deps, `${run.id}.post-1`);
  const record = () => listRecords(env.store.read(), 'venture-connector-post').find(post => post.id === first.postId)!;
  assert.equal((await decidePost(deps, owner, { postId: first.postId, digest: record().digest, action: 'approve' })).post.state, 'outcome_unknown');
  assert.equal(log.entries.length, 1);
  await resolveUnknownPost(deps, owner, { postId: first.postId, found: 'not-posted' });
  assert.equal(record().state, 'rejected');
  env.advance(2 * DAY);
  assert.equal((await propose(deps, `${run.id}.post-1`)).state, 'described', 'its own log entry is not a near-duplicate of itself');
});

test('the log entry is written before the browser starts, so a crash between the claim and the outcome still counts on this computer', async () => {
  const env = await setup();
  const log = memoryPostLog();
  let seen = -1;
  const port: BrowserPort = {
    async probe() { return { present: true, reason: 'ok' }; },
    async post() { seen = log.entries.length; return { outcome: 'posted', line: 'Posted.', url: null }; },
  };
  env.deps = { ...env.deps, connectors: { browser: port, appReviewed: [], postTimeoutMs: 40, postLog: log } } as VentureDeps;
  const run = await seedPostDraft(env.deps, ['LinkedIn: Thursday menu: poha and lemon tea.']);
  const proposal = await propose(env.deps, `${run.id}.post-1`);
  const digestOf = listRecords(env.store.read(), 'venture-connector-post').find(post => post.id === proposal.postId)!.digest;
  await decidePost(env.deps, owner, { postId: proposal.postId, digest: digestOf, action: 'approve' });
  assert.equal(seen, 1, 'the entry was there when the browser was called');
  assert.equal(log.entries[0].id, proposal.postId);
});

test('the log on disk: written beside the profiles, trimmed to 30 days and 200 entries, a corrupt file or a bad time ignored', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chausar-post-log-'));
  try {
    let now = Date.parse('2026-10-21T10:00:00.000Z');
    const disk = diskPostLog(root, () => now);
    const entry = (id: string, at: string, connectorId = 'linkedin') => ({ id, connectorId, at, print: { shingles: ['a1'], domains: [] } });
    disk.append(entry('p1', '2026-10-21T09:00:00.000Z'));
    const file = JSON.parse(await readFile(join(root, 'linkedin.posts.json'), 'utf8'));
    assert.deepEqual(file.map((item: { id: string }) => item.id), ['p1']);

    // 31 days on: the old entry goes when the next is written.
    now += 31 * DAY;
    disk.append(entry('p2', new Date(now).toISOString()));
    assert.deepEqual(disk.read('linkedin').map(item => item.id), ['p2']);
    for (let index = 0; index < 205; index += 1) disk.append(entry(`q${index}`, new Date(now - index * 60_000).toISOString()));
    assert.equal(disk.read('linkedin').length, 200);

    // An entry with a time that cannot be read, or more than a day ahead, is dropped on read.
    await writeFile(join(root, 'x.posts.json'), JSON.stringify([entry('bad', 'soon', 'x'), entry('ahead', new Date(now + 2 * DAY).toISOString(), 'x'), entry('ok', new Date(now).toISOString(), 'x')]));
    assert.deepEqual(disk.read('x').map(item => item.id), ['ok']);
    // A corrupt file reads as empty and is replaced on the next write.
    await writeFile(join(root, 'x.posts.json'), '{not json');
    assert.deepEqual(disk.read('x'), []);
    disk.append(entry('r1', new Date(now).toISOString(), 'x'));
    assert.deepEqual(disk.read('x').map(item => item.id), ['r1']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the desktop and the local web host on the owner computer read the log on disk; the hosted server and tests never do', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chausar-post-log-'));
  const before = process.env.CHAUSAR_BROWSER_PROFILES;
  process.env.CHAUSAR_BROWSER_PROFILES = root;
  try {
    const { env, deps } = await posting();
    await seasoned(env);
    const run = await seedPostDraft(deps, ['LinkedIn: Thursday menu: poha and lemon tea.']);
    const proposal = await propose(deps, `${run.id}.post-1`);
    const digestOf = listRecords(env.store.read(), 'venture-connector-post').find(post => post.id === proposal.postId)!.digest;
    // Another business on this computer posted on LinkedIn ten minutes ago.
    diskPostLog(root).append({ id: 'post_other_business', connectorId: 'linkedin', at: new Date(Date.parse(env.now()) - 10 * 60_000).toISOString(), print: postPrint('Our weekend timings are up.') });
    for (const host of ['desktop', 'local-web']) {
      const here = { ...deps, connectors: undefined, host } as VentureDeps;
      await assert.rejects(decidePost(here, owner, { postId: proposal.postId, digest: digestOf, action: 'approve' }), blockedBy('house-post-min-gap'), host);
    }
    for (const host of ['hosted-web', 'test']) {
      const elsewhere = { ...deps, connectors: undefined, host } as VentureDeps;
      await assert.rejects(decidePost(elsewhere, owner, { postId: proposal.postId, digest: digestOf, action: 'approve' }), (error: any) => error.code !== 'POST_RISK_BLOCKED', host);
    }
  } finally {
    if (before === undefined) delete process.env.CHAUSAR_BROWSER_PROFILES; else process.env.CHAUSAR_BROWSER_PROFILES = before;
    await rm(root, { recursive: true, force: true });
  }
});
