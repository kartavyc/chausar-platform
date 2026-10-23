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
// A post is never free text (W1 H6): it names a delivery draft by id and its text is that draft's line for the channel
// ("X: ..."). The draft must be one the owner accepted or edited, must have passed its checks (the prompt-leak lint
// runs again on the exact post), must carry the client's recorded approval where the playbook asks for it (the social
// agency), and must be unchanged since; otherwise each post is refused with its reasons. The check runs again when the
// owner approves. A security check or a platform block the browser met holds the channel (W1 H19): a check until the
// owner clears it, a block for 72 hours, reads too.
// The described / approved / applied journal follows cloudflare/cloudflare-os (Apache-2.0); this is a rewrite, not a copy.
// Approved before promoted, refused with a reason per post: an idea from postmill-ai/postmill-app (AGPL-3.0, ideas only).
import { authorize, check, ChausarError, type Context, type State } from '../../contracts.ts';
import type {
  BrowserPort, BrowserPostResult, BrowserProbe, BrowserSiteHold, ChannelHoldRecord, ConnectorPorts, ConnectorPostRecord, DeliveryRunRecord,
  JournalEntry, PostingModeName, PostingOption, VentureDeps,
} from '../contracts.ts';
import { promptLeakLine, promptLeaks } from '../playbooks/prompt-leak.ts';
import { caSignoffBlock } from '../playbooks/ca-firm/signoff-gate.ts';
import { SOCIAL_AGENCY_ID } from '../playbooks/social/registration.ts';
import { channelCapability, type SocialChannel } from '../playbooks/social/channels.ts';
import { postOfLine, socialPostBlocks } from '../playbooks/social/post-lines.ts';
import type { FileLike } from '../delivery/harness/files.ts';
import { currentVenture, digest, exactPayload, houseStyleFindings, identifier, isAppChannel, listRecords, singleLine, ventureAction } from '../records.ts';
import { AGENT_WINDOW_MS, JOURNAL_ACTIONS, applyAction, approveAction, rejectAction, resolveUnknown, sweepJournal } from '../journal/journal.ts';
import { FREEZE_HOURS, playwrightBrowserPort } from './browser.ts';
import { clientDraft } from './draft-text.ts';
import { gateEffect, sealApproval } from '../policy/holds.ts';

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
  // Google's videos.insert page (updated 15 October 2026, playbooks/youtube/platform-rules.ts 'api-upload-privacy') says
  // uploads from unverified API projects are no longer locked to private, so no audit is listed. API posting stays
  // planned all the same: no YouTube upload client ships in this build.
  youtube: {
    id: 'youtube', name: 'YouTube', maxChars: 5000,
    apiRequires: ['Google sign-in verification for the YouTube upload scope', 'A YouTube upload client, which this build does not ship'], browser: 'media',
    handoffWhat: 'Copies the title and description and opens YouTube Studio. You upload and publish there.', handoffUrl: () => 'https://studio.youtube.com/',
  },
});

/** The connectors that post: LinkedIn, X, Instagram and YouTube. */
export const POSTING_CONNECTORS: readonly string[] = Object.freeze(Object.keys(PROFILES));

/** holds: the line of each posting channel held by a security check or a platform block now, by connector id (W1 H19). */
export type PostingEnvironment = { browser: BrowserProbe; appReviewed: readonly string[]; apiClients: readonly string[]; holds?: Readonly<Record<string, string>> };
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
  const holds = heldChannels(deps.store.read(), deps.clock().toISOString());
  if (!ports.browser) return { browser: NOT_PROBED.browser, appReviewed, apiClients, holds };
  let browser: BrowserProbe;
  try {
    const probe = await ports.browser.probe();
    browser = { present: probe?.present === true, reason: typeof probe?.reason === 'string' ? probe.reason : 'Chausar could not tell whether Playwright is here.' };
  } catch {
    browser = { present: false, reason: 'Chausar could not check for Playwright on this computer.' };
  }
  return { browser, appReviewed, apiClients, holds };
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
  const held = env.holds?.[profile.id];
  if (held) return { ...base, status: 'planned', qualification: 'unqualified', reason: held };
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
// The draft a post comes from (W1 H6)
// ---------------------------------------------------------------------------

/** Why a draft's post may not go out, with the code a refusal carries. */
export type DraftPostReason = {
  code: 'POST_DRAFT_UNCHECKED' | 'POST_CLIENT_NOT_APPROVED' | 'POST_DRAFT_CHANGED' | 'DELIVERY_NOT_READY' | 'PRACTICE_DRAFT' | 'CA_SIGNOFF_REQUIRED';
  line: string;
};
/** text: the exact post. draftDigest: the digest of the draft as it is now (what a client's answer is bound to). */
export type DraftPostGate = { allowed: boolean; reasons: DraftPostReason[]; text: string; draftDigest: string };

const POSTABLE: readonly DeliveryRunRecord['status'][] = ['accepted', 'edited'];
type DraftPost = { channel: SocialChannel; text: string };

/** The posts a draft's text holds for one connector, in order, read with the social checks' own line parser. */
function draftPosts(text: string, connectorId: string): DraftPost[] {
  return text.split(/\r?\n/).flatMap(line => {
    const post = postOfLine(line);
    return post && channelCapability(post.channel).connectorId === connectorId ? [post] : [];
  });
}

/** The words of each post a draft's text holds for one connector, in order. */
export function draftPostLines(text: string, connectorId: string): string[] {
  return draftPosts(text, connectorId).map(post => post.text);
}

/** The digest a client's answer on a share link is bound to, and a post from the draft: build/draft-text.ts makes both. */
export function draftDigestOf(run: DeliveryRunRecord): string {
  return clientDraft(run).digest;
}

function flagshipOf(state: State, run: DeliveryRunRecord): string | null {
  return listRecords(state, 'venture-playbook', run.ventureId).find(playbook => playbook.id === run.playbookId)?.flagship ?? null;
}

/** The owner's edit changed the text, so the stored check results are about other words. */
function ownerEdited(run: DeliveryRunRecord): boolean {
  return run.status === 'edited' && !!run.editedText && run.editedText !== run.renderedText;
}

/**
 * The code checks again, on the exact post the owner edited: house style, and for the social agency its post checks
 * with the order's message and files as proof.
 */
function editedPostLines(state: State, run: DeliveryRunRecord, post: DraftPost, flagship: string | null): string[] {
  const lines = houseStyleFindings(post.text).map(item => (item.rule === 'em-dash' ? 'The post uses a long dash. Use a comma or a full stop.' : `The post uses "${item.match}", a word on the house avoid list.`));
  if (flagship !== SOCIAL_AGENCY_ID) return lines;
  const venture = currentVenture(state);
  const order = listRecords(state, 'venture-order', run.ventureId).find(item => item.id === run.orderId);
  const client = order ? listRecords(state, 'venture-client', run.ventureId).find(item => item.id === order.clientId) : undefined;
  const files: FileLike[] = listRecords(state, 'venture-upload', run.ventureId).filter(upload => (run.uploadIds ?? []).includes(upload.id));
  const known = [client?.name, venture?.workingName].filter((name): name is string => !!name);
  const intake = order?.intake;
  return [...lines, ...socialPostBlocks({
    channel: post.channel, text: post.text, request: order?.request ?? '', files, known,
    dateOrder: (venture?.country as { dateOrder?: 'day-month-year' | 'month-day-year' } | null | undefined)?.dateOrder ?? 'day-month-year',
    paid: !!intake?.paidPromotion, ai: { person: !!intake?.aiPresenter, voice: !!intake?.aiVoice },
  })];
}

/**
 * Why the draft does not count as checked. The stored results (the harness checks, the playbook's own) are about the
 * text they ran on; when the owner's edit changed it, the code checks run again on the exact post instead. The
 * prompt-leak lint runs on the exact post either way.
 */
function uncheckedLines(state: State, run: DeliveryRunRecord, post: DraftPost): string[] {
  const lines: string[] = [];
  const flagship = flagshipOf(state, run);
  if (run.servedBy === 'template') lines.push('This is a template outline, not a checked draft.');
  else if (ownerEdited(run)) lines.push(...editedPostLines(state, run, post, flagship));
  else {
    if (!run.checks.length) lines.push('The checks have not run on this draft.');
    const failed = run.checks.find(item => !item.passed);
    if (failed) lines.push(`The draft failed a check: ${failed.detail}`);
    if (flagship) {
      if (!run.playbookChecks?.length) lines.push("The playbook's checks have not run on this draft.");
      const own = run.playbookChecks?.find(item => item.outcome === 'fail');
      if (own) lines.push(`The draft failed a check: ${own.detail}`);
    }
  }
  const leak = promptLeakLine(promptLeaks(post.text, 'post'), 'post');
  if (leak) lines.push(leak);
  return lines;
}

/** The client's latest answer on this exact text, from the share links of this draft (any link, any way it was recorded). */
function clientReasons(state: State, run: DeliveryRunRecord, current: string): DraftPostReason[] {
  const answers = listRecords(state, 'venture-share-link', run.ventureId).filter(link => link.deliveryId === run.id).flatMap(link => link.decisions)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const onThis = answers.filter(answer => answer.digest === current).at(-1);
  if (onThis?.decision === 'approved') return [];
  if (onThis?.decision === 'changes') return [{ code: 'POST_CLIENT_NOT_APPROVED', line: 'Your client asked for changes to this draft.' }];
  if (answers.some(answer => answer.decision === 'approved')) {
    return [{ code: 'POST_DRAFT_CHANGED', line: 'The draft changed after your client approved it. It needs their approval again.' }];
  }
  return [{ code: 'POST_CLIENT_NOT_APPROVED', line: 'Your client has not approved this draft. Share it and record their answer first.' }];
}

/**
 * May this draft's post for this connector go out now? Every reason it may not, in order, each with its code: a
 * practice draft, a draft the owner has not accepted, checks not passed, the client's approval where the playbook asks
 * for it (the social agency approves every draft with the client), and a draft changed since draftDigest. part picks
 * one of several posts for the channel, from 1. A missing draft or a draft with no such post is a wrong request.
 */
export function draftPostGate(state: State, input: { draftId: string; connectorId: string; part?: number | null; draftDigest?: string | null }): DraftPostGate {
  const venture = currentVenture(state);
  const run = venture ? listRecords(state, 'venture-delivery-run', venture.id).find(item => item.id === input.draftId) : undefined;
  check(run, 'DELIVERY_NOT_FOUND', 'That draft was not found.');
  const name = nameOf(input.connectorId);
  // The words the client sees (secret screen applied) are the words that go out, under the digest the client approves.
  const shown = clientDraft(run);
  const posts = draftPosts(shown.text ?? '', input.connectorId);
  check(posts.length > 0, 'INVALID_VENTURE_REQUEST', `This draft has no post for ${name}. A post is a line that starts with the channel, like "${name}: ...".`);
  const part = input.part ?? null;
  check(part === null ? posts.length === 1 : part >= 1 && part <= posts.length, 'INVALID_VENTURE_REQUEST', `This draft holds ${posts.length} posts for ${name}. Say which one, from 1 to ${posts.length}.`);
  const post = posts[(part ?? 1) - 1];
  const text = post.text;
  const current = shown.digest;
  const reasons: DraftPostReason[] = [];
  if (run.practice) reasons.push({ code: 'PRACTICE_DRAFT', line: 'A practice draft never goes out.' });
  if (!POSTABLE.includes(run.status)) reasons.push({ code: 'DELIVERY_NOT_READY', line: 'Accept the draft first. Only a draft you accepted or edited is posted.' });
  for (const line of uncheckedLines(state, run, post)) reasons.push({ code: 'POST_DRAFT_UNCHECKED', line });
  if (input.draftDigest && input.draftDigest !== current) {
    reasons.push({ code: 'POST_DRAFT_CHANGED', line: 'The draft changed after this post was proposed. Propose it again from the draft as it is now.' });
  }
  if (flagshipOf(state, run) === SOCIAL_AGENCY_ID) reasons.push(...clientReasons(state, run, current));
  // AI-native CA firm: regulated papers go out only as the CA of record signed them, the owner's edit included.
  const unsigned = venture ? caSignoffBlock(state, venture, run) : null;
  if (unsigned) reasons.push({ code: 'CA_SIGNOFF_REQUIRED', line: unsigned });
  return { allowed: reasons.length === 0, reasons, text, draftDigest: current };
}

/** The refusals a post on Today may meet when the owner approves it: its draft's, and its channel's. */
const REFUSAL_CODES: readonly string[] = [
  'POST_DRAFT_UNCHECKED', 'POST_CLIENT_NOT_APPROVED', 'POST_DRAFT_CHANGED', 'DELIVERY_NOT_READY', 'PRACTICE_DRAFT', 'CA_SIGNOFF_REQUIRED', 'CHANNEL_CHALLENGED', 'CHANNEL_FROZEN',
];

/** Throws the first reason's code with every reason's words, so each refused post says all that is wrong with it. */
function requireDraftPost(gate: DraftPostGate): void {
  if (!gate.allowed) throw new ChausarError(gate.reasons[0].code, gate.reasons.map(reason => reason.line).join(' '));
}

// ---------------------------------------------------------------------------
// Channel holds: a security check or a platform block (W1 H19)
// ---------------------------------------------------------------------------

/** How long a platform block freezes the channel, reads too (build/browser.ts keeps the same hold per computer). */
export { FREEZE_HOURS };

/** The hold on one posting channel now, or null: a check the owner has not cleared, or a block still inside its 72 hours. */
export function channelHold(state: State, connectorId: string, nowIso: string): ChannelHoldRecord | null {
  const venture = currentVenture(state);
  if (!venture) return null;
  const now = Date.parse(nowIso);
  const live = listRecords(state, 'venture-channel-hold', venture.id).filter(hold => hold.connectorId === connectorId
    && (hold.cause === 'challenge' ? hold.clearedAt === null : hold.until !== null && Date.parse(hold.until) > now));
  return live.find(hold => hold.cause === 'blocked') ?? live.at(-1) ?? null;
}

function heldChannels(state: State, nowIso: string): Record<string, string> {
  return Object.fromEntries(POSTING_CONNECTORS.flatMap(id => {
    const hold = channelHold(state, id, nowIso);
    return hold ? [[id, hold.line]] : [];
  }));
}

/** Refuses while the channel is held: CHANNEL_FROZEN for a block, CHANNEL_CHALLENGED for a check waiting for the owner. */
function requireChannelOpen(state: State, connectorId: string, nowIso: string): void {
  const hold = channelHold(state, connectorId, nowIso);
  if (hold) throw new ChausarError(hold.cause === 'blocked' ? 'CHANNEL_FROZEN' : 'CHANNEL_CHALLENGED', hold.line);
}

function holdWords(name: string, hold: BrowserSiteHold): string {
  return hold.kind === 'blocked'
    ? `${name} blocked this account or an action. Chausar froze ${name} for ${FREEZE_HOURS} hours, reads too. Do not sign in again or reconnect; wait for the freeze to end.`
    : `${name} showed a security check. Chausar will not act on ${name} until you clear the check yourself in the Chausar browser window and say so here.`;
}

/** Keeps what the browser met as a hold on the post's channel. */
async function recordHold(deps: VentureDeps, ctx: Context, post: ConnectorPostRecord, hold: BrowserSiteHold): Promise<ChannelHoldRecord> {
  return ventureAction(deps, ctx, 'approve', 'connector.hold', tx => tx.put<ChannelHoldRecord>({
    ...tx.base('venture-channel-hold'), connectorId: post.connectorId, site: hold.site, cause: hold.kind, line: holdWords(nameOf(post.connectorId), hold),
    until: hold.kind === 'blocked' ? new Date(Date.parse(tx.now) + FREEZE_HOURS * 3600000).toISOString() : null,
    postId: post.id, clearedAt: null, clearedBy: null,
  }));
}

/**
 * The owner says they cleared the security check on a channel themselves (inside the app). A block is never cleared
 * early: CHANNEL_FROZEN until its 72 hours pass. A channel with no hold is left as it is (null).
 */
export async function clearChannelHold(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ChannelHoldRecord | null> {
  const body = exactPayload(payload, ['connectorId'], ['connectorId']);
  const connectorId = typeof body.connectorId === 'string' && PROFILES[body.connectorId] ? body.connectorId : null;
  check(connectorId, 'INVALID_VENTURE_REQUEST', 'Posting works only on LinkedIn, X, Instagram and YouTube.');
  check(isAppChannel(ctx), 'APP_APPROVAL_REQUIRED', 'Clear this inside the Chausar app.');
  const cleared = await ventureAction(deps, ctx, 'approve', 'connector.hold.clear', tx => {
    const hold = channelHold(tx.state, connectorId, tx.now);
    if (!hold) return null;
    check(hold.cause === 'challenge', 'CHANNEL_FROZEN', hold.line);
    let last: ChannelHoldRecord | null = null;
    for (const open of listRecords(tx.state, 'venture-channel-hold', tx.venture!.id).filter(item => item.connectorId === connectorId && item.cause === 'challenge' && item.clearedAt === null)) {
      last = tx.replace<ChannelHoldRecord>({ ...open, clearedAt: tx.now, clearedBy: ctx.memberId });
    }
    return last;
  });
  // The same check held this platform for every business on this computer (build/browser.ts): it ends there too.
  await portsOf(deps).browser?.clearHold?.(connectorId);
  return cleared;
}

// ---------------------------------------------------------------------------
// Proposing, deciding and settling one post
// ---------------------------------------------------------------------------

function postDigest(post: Pick<ConnectorPostRecord, 'id' | 'connectorId' | 'mode' | 'account' | 'text' | 'draftId' | 'draftDigest' | 'part'>): string {
  return digest({
    id: post.id, connectorId: post.connectorId, mode: post.mode, account: post.account, text: post.text,
    draftId: post.draftId ?? null, draftDigest: post.draftDigest ?? null, part: post.part ?? null,
  });
}

function describePost(profile: PostingProfile, mode: ConnectorPostRecord['mode'], account: string | null): string {
  const who = account ? ` as ${account}` : '';
  return mode === 'api' ? `Post to ${profile.name}${who} through the ${profile.name} API.` : `Post to ${profile.name}${who} from your own browser on this computer.`;
}

/**
 * An agent or the owner proposes one post from a draft, by its id; never free text. It waits on Today as its own
 * 'connector' row until the owner decides. Refused while the channel is held, and with every reason the draft may not go.
 * descriptionComplete (W1 H21): a text post shows its whole exact text, so it is complete unless the proposer says a
 * part is not shown; a platform that posts a picture or video with the text (Instagram, YouTube) is never complete,
 * because the owner sees only the words.
 */
export async function proposePost(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ConnectorPostRecord> {
  const body = exactPayload(payload, ['connectorId', 'account', 'draftId', 'part', 'agent', 'mode', 'descriptionComplete'], ['connectorId', 'draftId']);
  check(body.descriptionComplete === undefined || typeof body.descriptionComplete === 'boolean', 'INVALID_VENTURE_REQUEST', 'descriptionComplete must be true or false.');
  const profile = typeof body.connectorId === 'string' ? PROFILES[body.connectorId] : undefined;
  check(profile, 'INVALID_VENTURE_REQUEST', 'Posting works only on LinkedIn, X, Instagram and YouTube.');
  const draftId = identifier(body.draftId, 'draftId');
  check(body.part === undefined || (Number.isInteger(body.part) && (body.part as number) >= 1 && (body.part as number) <= 100), 'INVALID_VENTURE_REQUEST', 'part is a whole number from 1.');
  const part = body.part === undefined ? null : body.part as number;
  const account = body.account === undefined ? null : singleLine(body.account, 'account', { max: 80 });
  const agent = body.agent === undefined ? null : singleLine(body.agent, 'agent', { max: 80 });
  check(body.mode === undefined || body.mode === 'api' || body.mode === 'owner-browser-session', 'INVALID_VENTURE_REQUEST', 'Choose api or owner-browser-session.');
  authorize(deps.store, ctx, 'prepare');
  const gateNow = (state: State, nowIso: string): DraftPostGate => {
    requireChannelOpen(state, profile.id, nowIso);
    requireNotSent(state, { draftId, connectorId: profile.id, part });
    const gate = draftPostGate(state, { draftId, connectorId: profile.id, part });
    requireDraftPost(gate);
    check([...gate.text].length <= profile.maxChars, 'INVALID_VENTURE_REQUEST', `A post on ${profile.name} holds at most ${profile.maxChars} characters.`);
    return gate;
  };
  gateNow(deps.store.read(), deps.clock().toISOString());
  const options = postingOptions(profile.id, await postingEnvironment(deps)).filter(option => option.mode !== 'handoff');
  const chosen = body.mode !== undefined
    ? options.find(option => option.mode === body.mode)!
    : options.find(option => option.status === 'available') ?? options.find(option => option.mode === 'owner-browser-session')!;
  check(chosen.status === 'available', 'NOT_BUILT_YET', chosen.reason ?? 'Not in this build.');
  const mode = chosen.mode as ConnectorPostRecord['mode'];
  return ventureAction(deps, ctx, 'prepare', 'connector.post.propose', tx => {
    const gate = gateNow(tx.state, tx.now);
    const describe = describePost(profile, mode, account);
    const record: ConnectorPostRecord = {
      ...tx.base('venture-connector-post'), connectorId: profile.id, mode, account, text: gate.text, agent, digest: '', state: 'described', describe,
      risk: chosen.risk, claimedAt: null, decidedBy: null, outcome: null,
      journal: [{ state: 'described', at: tx.now, by: agent ?? ctx.memberId, line: describe }],
      approval: null, expiresAt: new Date(Date.parse(tx.now) + AGENT_WINDOW_MS).toISOString(),
      draftId, draftDigest: gate.draftDigest, part,
      descriptionComplete: profile.browser === 'text' && body.descriptionComplete !== false,
    };
    record.digest = postDigest(record);
    return tx.put(record);
  });
}

/**
 * One post (a draft, a connector and a part) goes out once. Refused while any proposal of it may have gone out
 * (outcome_unknown: the owner records what they found first), is under way (approved) or went out (applied). After the
 * owner records that it did not go out (rejected, venture.journal.resolve), it may be proposed again. except: the post
 * being decided.
 */
function requireNotSent(state: State, input: { draftId: string; connectorId: string; part: number | null }, except?: string): void {
  const same = listRecords(state, 'venture-connector-post').filter(post => post.id !== except && post.draftId === input.draftId
    && post.connectorId === input.connectorId && (post.part ?? 1) === (input.part ?? 1));
  const name = nameOf(input.connectorId);
  check(!same.some(post => post.state === 'outcome_unknown'), 'JOURNAL_OUTCOME_UNKNOWN',
    `${unknownLine(input.connectorId)} Check ${name} and record what you found before this post is proposed again.`);
  check(!same.some(post => post.state === 'applied' || post.state === 'approved'), 'POST_ALREADY_DECIDED',
    `This post already went out on ${name}, or is going out now. Chausar never sends a post twice.`);
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
    if (result.outcome === 'posted') return result;
    // A hold the browser met is kept only in its known shape.
    const hold = result.hold;
    const kept = hold && (hold.kind === 'challenge' || hold.kind === 'blocked') && typeof hold.site === 'string' && hold.site.length <= 253 ? { kind: hold.kind, site: hold.site } : null;
    return { outcome: result.outcome, line: result.line, ...(kept ? { hold: kept } : {}) };
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
  requireChannelOpen(deps.store.read(), waiting.connectorId, deps.clock().toISOString());
  recheckDraft(deps.store.read(), waiting);
  const option = postingOptions(waiting.connectorId, await postingEnvironment(deps)).find(item => item.mode === waiting.mode);
  check(option?.status === 'available', 'NOT_BUILT_YET', option?.reason ?? 'This way of posting is not in this build.');

  const met: { hold?: BrowserSiteHold } = {};
  const { token } = await approveAction(deps, ctx, { entryId: postId, digest: seen, line: 'You approved this post.' });
  const done = await applyAction(deps, ctx, { entryId: postId, token, idempotencyKey: `${postId}.post` }, async handle => {
    const post = handle.entry as ConnectorPostRecord;
    // The policy gate before anything leaves: posting is on the always-ask floor, so only the owner's approval sealed on
    // this post, bound to the digest the owner saw, lets it through. A refusal here is known to have sent nothing.
    gateEffect({ name: 'connector.post', digest: seen }, sealApproval(post, post.digest));
    const stop = stopBeforeSending(deps, post);
    if (stop) return { outcome: 'not-sent', line: stop, by: 'engine', value: stop };
    const result = await runPost(deps, post);
    if (result.outcome !== 'posted' && result.hold) met.hold = result.hold;
    if (result.outcome === 'posted') return { outcome: 'applied', line: result.line, url: result.url, by: 'platform', value: `Posted to ${nameOf(post.connectorId)}. ${result.line}` };
    if (result.outcome === 'not-sent') return { outcome: 'not-sent', line: result.line, by: 'platform', value: result.line };
    const line = `${result.line} ${unknownLine(post.connectorId)}`;
    return { outcome: 'unknown', line, value: line };
  });
  const post = done.entry as ConnectorPostRecord;
  if (met.hold) await recordHold(deps, ctx, post, met.hold);
  return { outcome: 'done', line: done.value ?? post.outcome?.line ?? post.journal[post.journal.length - 1].line, post };
}

/**
 * The draft is checked again when the owner approves: still checked, still approved by the client where the playbook
 * asks, and unchanged since the post was proposed. A draft that is gone or no longer holds this post has changed too.
 * And no other proposal of the same post went out, is under way, or may have gone out meanwhile.
 */
function recheckDraft(state: State, post: ConnectorPostRecord): void {
  check(post.draftId, 'POST_DRAFT_UNCHECKED', 'This post was not made from a draft. Propose it again from its draft.');
  requireNotSent(state, { draftId: post.draftId, connectorId: post.connectorId, part: post.part ?? null }, post.id);
  let gate: DraftPostGate;
  try {
    gate = draftPostGate(state, { draftId: post.draftId, connectorId: post.connectorId, part: post.part ?? null, draftDigest: post.draftDigest ?? null });
  } catch (error) {
    if (error instanceof ChausarError) throw new ChausarError('POST_DRAFT_CHANGED', 'The draft this post came from is gone or no longer holds this post. Propose it again from the draft.');
    throw error;
  }
  requireDraftPost(gate);
  check(gate.text === post.text, 'POST_DRAFT_CHANGED', 'The draft no longer says what this post says. Propose it again from the draft as it is now.');
}

/**
 * The last look, inside the apply, right before the browser or API starts: the channel is still open and the draft
 * still stands for this exact text. The words why not, or null to go on. Nothing has been sent at this point.
 */
function stopBeforeSending(deps: VentureDeps, post: ConnectorPostRecord): string | null {
  try {
    const state = deps.store.read();
    requireChannelOpen(state, post.connectorId, deps.clock().toISOString());
    recheckDraft(state, post);
    return null;
  } catch (error) {
    if (error instanceof ChausarError) return `${error.message} Nothing was posted.`;
    throw error;
  }
}

/**
 * After an unknown outcome the owner looks at the platform and records what they found. Nothing is sent. The state
 * rule is the journal's own (resolveIn): anything but an unknown outcome is refused with JOURNAL_NOT_UNKNOWN.
 */
export async function resolveUnknownPost(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ConnectorPostRecord> {
  const body = exactPayload(payload, ['postId', 'found'], ['postId', 'found']);
  const postId = identifier(body.postId, 'postId');
  check(body.found === 'posted' || body.found === 'not-posted', 'INVALID_VENTURE_REQUEST', 'Say whether you found the post.');
  check(isAppChannel(ctx), 'APP_APPROVAL_REQUIRED', 'Record this inside the Chausar app.');
  const post = findPost(deps.store.read(), postId);
  check(post, 'POST_NOT_FOUND', 'This post is not here.');
  const posted = body.found === 'posted';
  const line = postResolvedLine(post.connectorId, posted);
  return await resolveUnknown(deps, ctx, { entryId: postId, found: posted ? 'applied' : 'not-applied', line }) as ConnectorPostRecord;
}

/** The owner's finding on a post, in words that name the platform. venture.journal.resolve (journal/list.ts) uses it too. */
export function postResolvedLine(connectorId: string, posted: boolean): string {
  const name = nameOf(connectorId);
  return posted ? `You checked ${name}: the post went out.` : `You checked ${name}: the post did not go out. Propose it again to post it.`;
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
  /** False unless the proposer said the description shows everything the post sends (W1 H21). */
  descriptionComplete: boolean;
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
      descriptionComplete: post.descriptionComplete === true,
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
    // The journal's own refusals too: an expired proposal, an approval under way, an unknown outcome. And the draft's
    // (W1 H6) and the channel's (W1 H19): the row stays, says why, and the owner may still deny it.
    if (['POST_ALREADY_DECIDED', 'POST_NOT_FOUND', 'NOT_BUILT_YET', ...REFUSAL_CODES].includes(error.code) || error.code.startsWith('JOURNAL_')) {
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
