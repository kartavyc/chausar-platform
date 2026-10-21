// Chausar venture launcher: posting to social and video platforms (package P2-connectors).
// Three modes per platform, each labelled with what the code does today:
// - 'api' needs the platform's app review and a posting client. No client ships in this build, so it stays planned.
// - 'owner-browser-session' drives the owner's own signed-in browser on this computer, only when Playwright with
//   Chromium is already here, after the owner approves each post. It always carries "The platform may restrict this account."
// - 'handoff': the engine prepares the link or the text, but no screen opens it yet, so it is planned.
// Every post is one journalled record, moved by the general action journal (venture/journal/): described, then approved
// inside the app with a token bound to the post's digest, the owner, the session and the business, then claimed in its
// own commit before the browser starts, then applied, rejected or outcome_unknown. An agent's proposal waits fifteen
// minutes. An unknown outcome is never retried: the owner checks the platform and records it.
// Not built, on purpose: proxy or VPN rotation, hiding the automation, posting to accounts that are not the owner's.
// The described / approved / applied journal follows cloudflare/cloudflare-os (Apache-2.0); this is a rewrite, not a copy.
import { authorize, check, ChausarError, type Context, type State } from '../../contracts.ts';
import type {
  BrowserPort, BrowserPostResult, BrowserProbe, ConnectorPorts, ConnectorPostRecord, JournalEntry, PostingModeName, PostingOption,
  VentureDeps,
} from '../contracts.ts';
import { currentVenture, digest, exactPayload, identifier, isAppChannel, listRecords, plainText, singleLine, ventureAction } from '../records.ts';
import { AGENT_WINDOW_MS, JOURNAL_ACTIONS, applyAction, approveAction, rejectAction, resolveUnknown, sweepJournal } from '../journal/journal.ts';
import { playwrightBrowserPort } from './browser.ts';

export const OWNER_SESSION_RISK = 'The platform may restrict this account.';
const DEFAULT_STEP_TIMEOUT_MS = 30000;
const STEPS_PER_POST = 4; // open, fill, click, confirm: the whole post may take this many step timeouts
const SWEEP_MARGIN_MS = 60000;

type PostingProfile = {
  id: string;
  name: string;
  maxChars: number; // counted in characters as people see them
  apiRequires: readonly string[];
  browser: 'text' | 'media'; // 'media': a picture or video upload, not built
  handoffWhat: string;
  handoffUrl: (text: string) => string;
};

const PROFILES: Readonly<Record<string, PostingProfile>> = Object.freeze({
  linkedin: {
    id: 'linkedin', name: 'LinkedIn', maxChars: 3000, apiRequires: ['LinkedIn app review for posting'], browser: 'text',
    handoffWhat: 'Copies your post and opens LinkedIn. You paste it and press Post there.', handoffUrl: () => 'https://www.linkedin.com/feed/',
  },
  x: {
    id: 'x', name: 'X', maxChars: 280, apiRequires: ['A paid X API plan'], browser: 'text',
    handoffWhat: 'Opens X with your post filled in. You press Post there.', handoffUrl: text => `https://x.com/intent/post?text=${encodeURIComponent(text)}`,
  },
  instagram: {
    id: 'instagram', name: 'Instagram', maxChars: 2200, apiRequires: ['Meta app review', 'An Instagram professional account'], browser: 'media',
    handoffWhat: 'Copies your caption and opens Instagram. You add the picture and post there.', handoffUrl: () => 'https://www.instagram.com/',
  },
  youtube: {
    id: 'youtube', name: 'YouTube', maxChars: 5000, apiRequires: ['Google API audit, or uploads stay private', 'Google sign-in verification'], browser: 'media',
    handoffWhat: 'Copies the title and description and opens YouTube Studio. You upload and publish there.', handoffUrl: () => 'https://studio.youtube.com/',
  },
});

/** The connectors that post: LinkedIn, X, Instagram and YouTube. */
export const POSTING_CONNECTORS: readonly string[] = Object.freeze(Object.keys(PROFILES));

export type PostingEnvironment = { browser: BrowserProbe; appReviewed: readonly string[]; apiClients: readonly string[] };
export const NOT_PROBED: PostingEnvironment = Object.freeze({
  browser: Object.freeze({ present: false, reason: 'Chausar has not looked for Playwright on this computer yet.' }),
  appReviewed: Object.freeze([]), apiClients: Object.freeze([]),
});
const HOSTED_REASON = 'Posting through your own browser works only in the desktop app.';

let defaultPorts: ConnectorPorts | null = null;
/** The real ports: a Playwright probe that installs nothing, the reviews named in CHAUSAR_APP_REVIEWED, no API clients. */
export function defaultConnectorPorts(): ConnectorPorts {
  defaultPorts ??= Object.freeze({
    browser: playwrightBrowserPort(),
    appReviewed: Object.freeze((process.env.CHAUSAR_APP_REVIEWED ?? '').split(',').map(id => id.trim()).filter(Boolean)),
    api: Object.freeze({}),
  });
  return defaultPorts;
}

function portsOf(deps: VentureDeps): ConnectorPorts {
  const fallback = defaultConnectorPorts();
  const given = deps.connectors ?? {};
  return { ...fallback, ...Object.fromEntries(Object.entries(given).filter(([, value]) => value !== undefined)) };
}

/** What this computer can do right now. On the hosted web server the owner's browser is never here. */
export async function postingEnvironment(deps: VentureDeps): Promise<PostingEnvironment> {
  const ports = portsOf(deps);
  const appReviewed = [...(ports.appReviewed ?? [])];
  const apiClients = Object.keys(ports.api ?? {});
  if (deps.host === 'hosted-web') return { browser: { present: false, reason: HOSTED_REASON }, appReviewed, apiClients };
  if (!ports.browser) return { browser: NOT_PROBED.browser, appReviewed, apiClients };
  let browser: BrowserProbe;
  try {
    const probe = await ports.browser.probe();
    browser = { present: probe?.present === true, reason: typeof probe?.reason === 'string' ? probe.reason : 'Chausar could not tell whether Playwright is here.' };
  } catch {
    browser = { present: false, reason: 'Chausar could not check for Playwright on this computer.' };
  }
  return { browser, appReviewed, apiClients };
}

function apiOption(profile: PostingProfile, env: PostingEnvironment): PostingOption {
  const what = `Posts through the ${profile.name} API after you approve each post.`;
  const requires = [...profile.apiRequires];
  if (!env.appReviewed.includes(profile.id)) {
    return { mode: 'api', status: 'planned', qualification: 'unqualified', what, risk: null, requires, reason: "Planned until the platform's review of the app is done." };
  }
  if (!env.apiClients.includes(profile.id)) {
    return { mode: 'api', status: 'planned', qualification: 'unqualified', what, risk: null, requires, reason: 'The app review is recorded, but the posting client is not in this build.' };
  }
  return { mode: 'api', status: 'available', qualification: 'unqualified', what, risk: null, requires, reason: null };
}

function browserOption(profile: PostingProfile, env: PostingEnvironment): PostingOption {
  const what = `Posts from your own signed-in ${profile.name} account in a browser on this computer, after you approve each post. Not yet checked against the live site.`;
  const requires = ['Playwright with Chromium on this computer', `You sign in to ${profile.name} yourself, once, in the Chausar browser window`];
  const base = { mode: 'owner-browser-session' as const, what, risk: OWNER_SESSION_RISK, requires };
  if (profile.browser === 'media') return { ...base, status: 'planned', qualification: 'unqualified', reason: 'Posting a picture or video through the browser is not built yet.' };
  if (!env.browser.present) return { ...base, status: 'planned', qualification: 'unqualified', reason: env.browser.reason };
  return { ...base, status: 'available', qualification: 'unqualified', reason: null };
}

function handoffOption(profile: PostingProfile): PostingOption {
  return { mode: 'handoff', status: 'planned', qualification: 'unqualified', what: profile.handoffWhat, risk: null, requires: [], reason: 'The engine prepares it, but no screen opens it yet.' };
}

/** The posting modes of one connector, in the order api, owner-browser-session, handoff. Empty for connectors that do not post. */
export function postingOptions(connectorId: string, env: PostingEnvironment = NOT_PROBED): PostingOption[] {
  const profile = PROFILES[connectorId];
  if (!profile) return [];
  return [apiOption(profile, env), browserOption(profile, env), handoffOption(profile)];
}

/** The link and the text for posting by hand. Built here; no screen opens it yet (the handoff mode is planned). */
export function postHandoff(connectorId: string, text: string): { url: string; copy: string; what: string } {
  const profile = PROFILES[connectorId];
  check(profile, 'INVALID_VENTURE_REQUEST', 'Posting works only on LinkedIn, X, Instagram and YouTube.');
  return { url: profile.handoffUrl(text), copy: text, what: profile.handoffWhat };
}

// ---------------------------------------------------------------------------
// Proposing, deciding and settling one post
// ---------------------------------------------------------------------------

function postDigest(post: Pick<ConnectorPostRecord, 'id' | 'connectorId' | 'mode' | 'account' | 'text'>): string {
  return digest({ id: post.id, connectorId: post.connectorId, mode: post.mode, account: post.account, text: post.text });
}

function describePost(profile: PostingProfile, mode: ConnectorPostRecord['mode'], account: string | null): string {
  const who = account ? ` as ${account}` : '';
  return mode === 'api' ? `Post to ${profile.name}${who} through the ${profile.name} API.` : `Post to ${profile.name}${who} from your own browser on this computer.`;
}

/** An agent or the owner proposes one post. It waits on Today as its own 'connector' row until the owner decides. */
export async function proposePost(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ConnectorPostRecord> {
  const body = exactPayload(payload, ['connectorId', 'account', 'text', 'agent', 'mode'], ['connectorId', 'text']);
  const profile = typeof body.connectorId === 'string' ? PROFILES[body.connectorId] : undefined;
  check(profile, 'INVALID_VENTURE_REQUEST', 'Posting works only on LinkedIn, X, Instagram and YouTube.');
  const text = plainText(body.text, 'text', { min: 1, max: profile.maxChars * 2 });
  check([...text].length <= profile.maxChars, 'INVALID_VENTURE_REQUEST', `A post on ${profile.name} holds at most ${profile.maxChars} characters.`);
  const account = body.account === undefined ? null : singleLine(body.account, 'account', { max: 80 });
  const agent = body.agent === undefined ? null : singleLine(body.agent, 'agent', { max: 80 });
  check(body.mode === undefined || body.mode === 'api' || body.mode === 'owner-browser-session', 'INVALID_VENTURE_REQUEST', 'Choose api or owner-browser-session.');
  authorize(deps.store, ctx, 'prepare');
  const options = postingOptions(profile.id, await postingEnvironment(deps)).filter(option => option.mode !== 'handoff');
  const chosen = body.mode !== undefined
    ? options.find(option => option.mode === body.mode)!
    : options.find(option => option.status === 'available') ?? options.find(option => option.mode === 'owner-browser-session')!;
  check(chosen.status === 'available', 'NOT_BUILT_YET', chosen.reason ?? 'Not in this build.');
  const mode = chosen.mode as ConnectorPostRecord['mode'];
  return ventureAction(deps, ctx, 'prepare', 'connector.post.propose', tx => {
    const describe = describePost(profile, mode, account);
    const record: ConnectorPostRecord = {
      ...tx.base('venture-connector-post'), connectorId: profile.id, mode, account, text, agent, digest: '', state: 'described', describe,
      risk: chosen.risk, claimedAt: null, decidedBy: null, outcome: null,
      journal: [{ state: 'described', at: tx.now, by: agent ?? ctx.memberId, line: describe }],
      approval: null, expiresAt: new Date(Date.parse(tx.now) + AGENT_WINDOW_MS).toISOString(),
    };
    record.digest = postDigest(record);
    return tx.put(record);
  });
}

function requireWaiting(post: ConnectorPostRecord | undefined, postDigestSeen: string): ConnectorPostRecord {
  check(post, 'POST_NOT_FOUND', 'This post is not waiting for you.');
  check(post.state === 'described', 'POST_ALREADY_DECIDED', 'This post was already decided. Chausar never sends a post twice.');
  check(post.digest === postDigestSeen, 'APPROVAL_STALE', 'This post changed since you opened it.');
  return post;
}

function findPost(state: State, id: string): ConnectorPostRecord | undefined {
  return listRecords(state, 'venture-connector-post').find(post => post.id === id);
}

function nameOf(connectorId: string): string {
  return PROFILES[connectorId]?.name ?? connectorId;
}
/** The platform's name as people see it: 'X', 'LinkedIn'. The journal list shows it as the post's target. */
export const postingName = nameOf;

function timeouts(deps: VentureDeps): { step: number; whole: number } {
  const stepMs = portsOf(deps).postTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  return { step: stepMs, whole: stepMs * STEPS_PER_POST };
}

/** Runs the post once. Never throws: a crash, a timeout or an odd answer is 'unknown'. */
async function runPost(deps: VentureDeps, post: ConnectorPostRecord): Promise<BrowserPostResult> {
  const ports = portsOf(deps);
  const runner: Pick<BrowserPort, 'post'> | undefined = post.mode === 'api' ? ports.api?.[post.connectorId] : ports.browser;
  if (!runner) return { outcome: 'not-sent', line: 'No posting client is on this computer, so nothing was posted.' };
  const limits = timeouts(deps);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late: BrowserPostResult = { outcome: 'unknown', line: `${nameOf(post.connectorId)} did not answer in time.` };
  try {
    const result = await Promise.race([
      runner.post({ postId: post.id, connectorId: post.connectorId, text: post.text, timeoutMs: limits.step }),
      new Promise<BrowserPostResult>(resolve => { timer = setTimeout(() => resolve(late), limits.whole); }),
    ]);
    if (!result || !['posted', 'not-sent', 'unknown'].includes(result.outcome) || typeof result.line !== 'string') {
      return { outcome: 'unknown', line: 'The browser gave an answer Chausar could not read.' };
    }
    return result;
  } catch {
    return { outcome: 'unknown', line: 'The browser stopped part way.' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function unknownLine(connectorId: string): string {
  return `Check ${nameOf(connectorId)} before posting again: the post may have gone out. Chausar will not send it again.`;
}

export type PostDecision = { outcome: 'done' | 'refused'; line: string; post: ConnectorPostRecord };

/**
 * The owner approves or denies one post, inside the app, through the general journal. Approve mints a token bound to
 * this post, commits the claim on its own, then runs the browser or API once, then commits what happened. The token
 * goes from the approval to the apply in memory and is never stored. Decide-once: a second decision is refused.
 */
export async function decidePost(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PostDecision> {
  const body = exactPayload(payload, ['postId', 'digest', 'action'], ['postId', 'digest', 'action']);
  const postId = identifier(body.postId, 'postId');
  check(typeof body.digest === 'string' && body.digest.length > 0 && body.digest.length <= 128, 'INVALID_VENTURE_REQUEST', 'Send the digest you saw.');
  check(body.action === 'approve' || body.action === 'deny', 'INVALID_VENTURE_REQUEST', 'Choose approve or deny.');
  check(isAppChannel(ctx), 'APP_APPROVAL_REQUIRED', 'Approve this post inside the Chausar app.');
  authorize(deps.store, ctx, 'approve');
  const seen = body.digest;

  if (body.action === 'deny') {
    requireWaiting(findPost(deps.store.read(), postId), seen);
    const line = 'You chose not to post this.';
    const post = await rejectAction(deps, ctx, { entryId: postId, digest: seen, line }) as ConnectorPostRecord;
    return { outcome: 'done', line, post };
  }

  const waiting = requireWaiting(findPost(deps.store.read(), postId), seen);
  const option = postingOptions(waiting.connectorId, await postingEnvironment(deps)).find(item => item.mode === waiting.mode);
  check(option?.status === 'available', 'NOT_BUILT_YET', option?.reason ?? 'This way of posting is not in this build.');

  const { token } = await approveAction(deps, ctx, { entryId: postId, digest: seen, line: 'You approved this post.' });
  const done = await applyAction(deps, ctx, { entryId: postId, token, idempotencyKey: `${postId}.post` }, async handle => {
    const post = handle.entry as ConnectorPostRecord;
    const result = await runPost(deps, post);
    if (result.outcome === 'posted') return { outcome: 'applied', line: result.line, url: result.url, by: 'platform', value: `Posted to ${nameOf(post.connectorId)}. ${result.line}` };
    if (result.outcome === 'not-sent') return { outcome: 'not-sent', line: result.line, by: 'platform', value: result.line };
    const line = `${result.line} ${unknownLine(post.connectorId)}`;
    return { outcome: 'unknown', line, value: line };
  });
  const post = done.entry as ConnectorPostRecord;
  return { outcome: 'done', line: done.value ?? post.outcome?.line ?? post.journal[post.journal.length - 1].line, post };
}

/** After an unknown outcome the owner looks at the platform and records what they found. Nothing is sent. */
export async function resolveUnknownPost(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ConnectorPostRecord> {
  const body = exactPayload(payload, ['postId', 'found'], ['postId', 'found']);
  const postId = identifier(body.postId, 'postId');
  check(body.found === 'posted' || body.found === 'not-posted', 'INVALID_VENTURE_REQUEST', 'Say whether you found the post.');
  check(isAppChannel(ctx), 'APP_APPROVAL_REQUIRED', 'Record this inside the Chausar app.');
  const post = findPost(deps.store.read(), postId);
  check(post, 'POST_NOT_FOUND', 'This post is not here.');
  check(post.state === 'outcome_unknown', 'POST_ALREADY_DECIDED', 'This post already has an outcome.');
  const name = nameOf(post.connectorId);
  const posted = body.found === 'posted';
  const line = posted ? `You checked ${name}: the post went out.` : `You checked ${name}: the post did not go out. Propose it again to post it.`;
  return await resolveUnknown(deps, ctx, { entryId: postId, found: posted ? 'applied' : 'not-applied', line }) as ConnectorPostRecord;
}

/**
 * After a crash: a post claimed longer ago than any run could take may or may not have gone out, so it is
 * outcome_unknown and never resent. A proposal nobody decided in fifteen minutes is closed. The general journal sweep.
 */
export async function sweepStaleClaims(deps: VentureDeps, ctx: Context): Promise<ConnectorPostRecord[]> {
  const claimLimitMs = timeouts(deps).whole + SWEEP_MARGIN_MS;
  const swept = await sweepJournal(deps, ctx, {
    claimLimitMs, action: 'connector.post',
    unknownLine: record => `Chausar stopped while posting. ${unknownLine(record.kind === 'venture-connector-post' ? record.connectorId : record.target)}`,
  });
  return swept.filter((record): record is ConnectorPostRecord => record.kind === 'venture-connector-post');
}

// ---------------------------------------------------------------------------
// The queue and the journal (the shared contract's QueueRow, kind 'connector', and JournalEntry)
// ---------------------------------------------------------------------------

export type ConnectorQueueRow = {
  id: string; businessId: string; businessName: string; agent?: string; kind: 'connector';
  title: string; line?: string; digest: string; createdAt: string;
  actions: { id: 'approve' | 'deny'; label: string; primary: boolean; secondAsk?: boolean; requiresView?: boolean }[];
  viewRef?: { kind: 'draft'; id: string };
};

/** One row per post waiting for the owner. venture.queue.list adds these to Today. */
export function connectorQueueRows(state: State): ConnectorQueueRow[] {
  const venture = currentVenture(state);
  if (!venture) return [];
  return listRecords(state, 'venture-connector-post', venture.id).filter(post => post.state === 'described').map(post => {
    const name = nameOf(post.connectorId);
    const how = post.mode === 'api' ? `Through the ${name} API.` : 'From your own browser on this computer.';
    return {
      id: post.id, businessId: venture.id, businessName: venture.workingName, ...(post.agent ? { agent: post.agent } : {}), kind: 'connector' as const,
      title: `Post to ${name}${post.account ? ` as ${post.account}` : ''}`, line: post.risk ? `${how} ${post.risk}` : how,
      digest: post.digest, createdAt: post.at,
      actions: [
        { id: 'approve' as const, label: 'Approve and post', primary: true, secondAsk: true, requiresView: true },
        { id: 'deny' as const, label: 'Do not post', primary: false },
      ],
      viewRef: { kind: 'draft' as const, id: post.id },
    };
  });
}

export type ConnectorRowDecision = { outcome: 'done' | 'stale' | 'refused'; line: string; reason?: string; post?: ConnectorPostRecord; latest?: ConnectorQueueRow };

/** venture.queue.decide for kind 'connector' rows. A stale digest returns the latest row; a decided post is refused. */
export async function decideConnectorRow(deps: VentureDeps, ctx: Context, payload: { id: string; digest: string; action: string }): Promise<ConnectorRowDecision> {
  try {
    const decision = await decidePost(deps, ctx, { postId: payload.id, digest: payload.digest, action: payload.action });
    return { outcome: 'done', line: decision.line, post: decision.post };
  } catch (error) {
    if (!(error instanceof ChausarError)) throw error;
    const current = findPost(deps.store.read(), payload.id);
    if (error.code === 'APPROVAL_STALE') {
      const latest = connectorQueueRows(deps.store.read()).find(row => row.id === payload.id);
      return { outcome: 'stale', line: 'This changed since you opened it.', reason: error.message, ...(current ? { post: current } : {}), ...(latest ? { latest } : {}) };
    }
    // The journal's own refusals too: an expired proposal, an approval under way, an unknown outcome.
    if (['POST_ALREADY_DECIDED', 'POST_NOT_FOUND', 'NOT_BUILT_YET'].includes(error.code) || error.code.startsWith('JOURNAL_')) {
      return { outcome: 'refused', line: error.message, reason: error.code, ...(current ? { post: current } : {}) };
    }
    throw error;
  }
}

/**
 * Every post as a JournalEntry, newest first: one business when ventureId is given. venture.journal.list
 * (journal/list.ts) shows these beside the other journalled effects.
 */
export function postJournal(state: State, ventureId?: string): JournalEntry[] {
  return listRecords(state, 'venture-connector-post', ventureId).map(post => {
    const last = post.journal[post.journal.length - 1];
    return { id: post.id, action: JOURNAL_ACTIONS['connector.post'].label, target: nameOf(post.connectorId), state: post.state, at: last?.at ?? post.at, line: last?.line ?? post.describe };
  }).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export type { PostingModeName };
