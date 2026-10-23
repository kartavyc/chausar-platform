// Chausar venture launcher: the posting steps as checked on this computer (Ink v2 wave 2, 2B2; catalogue K2).
// venture.posting.checkSteps opens the platform's post box in the owner's own signed-in session, finds every candidate
// of every step without typing or clicking (build/browser.ts), and keeps today's date on each candidate that matched
// exactly one visible element. A step none matched asks the owner to click its element once in the window; what they
// picked becomes dated candidates that the next post tries first. A post that went out dates the candidates it used,
// the confirmation's too (its confirm element, or the response rule 'response:<method> <path>' when the platform's own
// answer confirmed it): the confirmation shows only after a post, so a dry run never dates it, and the screen shows the
// box and button date (boxAndButtonCheckedOn) until the first post does.
// venture.connectors.list shows stepsCheckedOn on the browser mode: the oldest day across the three steps on which one
// of the step's candidates last worked, or null while any step has none. The record holds dates and candidates only;
// what the owner picked was screened by the secret screen in build/browser.ts before it reached here.
import { authorize, check, ChausarError, type Context, type State } from '../../contracts.ts';
import type {
  BrowserPort, BrowserPostResult, BrowserStepsResult, ChannelHoldRecord, IsoDate, PostingCandidate, PostingStepId, PostingStepPick, PostingStepsRecord,
  PostingStepsView, VentureDeps,
} from '../contracts.ts';
import { currentVenture, exactPayload, listRecords, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import { BROWSER_SCRIPTS, DRY_RUN_STEPS, PICK_MS, POSTING_STEPS, STEP_WORDS, candidateKey, responseKey, stepCandidates } from './browser.ts';
import {
  DEFAULT_STEP_TIMEOUT_MS, FREEZE_HOURS, HOSTED_LINE, MEDIA_LINE, POSTING_CONNECTORS, channelHold, defaultConnectorPorts, postingEnvironment,
} from './posting.ts';

const MAX_KEY = 700;
const MAX_AUDIT = 60;

/** This business's steps record for one platform, if a check or a post has dated anything yet. */
export function stepsRecordOf(state: State, connectorId: string): PostingStepsRecord | undefined {
  const venture = currentVenture(state);
  return venture ? listRecords(state, 'venture-posting-steps', venture.id).find(record => record.connectorId === connectorId) : undefined;
}

/** The candidates the owner picked for a platform, newest pick first: what a post tries before the shipped ones. */
export function addedPicks(state: State, connectorId: string): PostingStepPick[] {
  return (stepsRecordOf(state, connectorId)?.added ?? []).map(item => ({ step: item.step, candidate: { ...item.candidate } }));
}

const newer = (a: IsoDate | null, b: IsoDate | null): IsoDate | null => (a === null ? b : b === null ? a : a > b ? a : b);

/** The day one candidate of one step last worked, from the record; null when never. */
function datedOn(record: PostingStepsRecord | undefined, step: PostingStepId, key: string): IsoDate | null {
  return (record?.checked ?? []).filter(item => item.step === step && item.key === key).reduce<IsoDate | null>((day, item) => newer(day, item.checkedOn), null);
}

/** The oldest of some days, or null when any is null (a step never checked). */
const oldest = (days: readonly (IsoDate | null)[]): IsoDate | null =>
  days.some(day => day === null) ? null : days.reduce((first, day) => (day! < first! ? day : first)) ?? null;

/**
 * Each step's candidates as a post tries them, the owner's picks first, each with the day it last worked; the confirm
 * step also carries the platform's response rule with the day a post it confirmed went out. stepsCheckedOn: the
 * oldest of the steps' newest days, null while any step has none. boxAndButtonCheckedOn: the same over the text box and
 * the post button only, the steps a check can see.
 */
export function postingStepsView(state: State, connectorId: string, line = ''): PostingStepsView {
  const script = BROWSER_SCRIPTS[connectorId];
  const record = stepsRecordOf(state, connectorId);
  const steps = POSTING_STEPS.map(step => {
    const owned = new Map((record?.added ?? []).filter(item => item.step === step).map(item => [candidateKey(item.candidate), item.addedOn]));
    const candidates = (script ? stepCandidates(script, step, addedPicks(state, connectorId)) : []).map(candidate => {
      const key = candidateKey(candidate);
      const addedOn = owned.get(key) ?? null;
      return { ...candidate, key, checkedOn: newer(datedOn(record, step, key), addedOn), addedBy: addedOn ? 'owner' as const : 'chausar' as const };
    });
    if (step !== 'confirm' || !script) return { step, candidates };
    const key = responseKey(script);
    return { step, candidates, response: { key, method: script.response.method, path: script.response.path, checkedOn: datedOn(record, step, key) } };
  });
  const days = steps.map(item => [...item.candidates.map(candidate => candidate.checkedOn), ('response' in item ? item.response?.checkedOn : null) ?? null]
    .reduce<IsoDate | null>((day, next) => newer(day, next), null));
  return { connectorId, steps, stepsCheckedOn: oldest(days), boxAndButtonCheckedOn: oldest(days.slice(0, DRY_RUN_STEPS.length)), line };
}

/** The browser mode's two dates for one platform; null for a platform with no browser steps. */
export function stepsDatesOf(state: State, connectorId: string): { stepsCheckedOn: IsoDate | null; boxAndButtonCheckedOn: IsoDate | null } {
  if (!BROWSER_SCRIPTS[connectorId]) return { stepsCheckedOn: null, boxAndButtonCheckedOn: null };
  const view = postingStepsView(state, connectorId);
  return { stepsCheckedOn: view.stepsCheckedOn, boxAndButtonCheckedOn: view.boxAndButtonCheckedOn };
}

/** The browser mode's stepsCheckedOn for one platform; null for a platform with no browser steps. */
export function stepsCheckedOnOf(state: State, connectorId: string): IsoDate | null {
  return stepsDatesOf(state, connectorId).stepsCheckedOn;
}

/** This platform's record in the transaction: the stored one, or a new empty one. */
function recordIn(tx: VentureTx, connectorId: string): PostingStepsRecord {
  return tx.list('venture-posting-steps').find(record => record.connectorId === connectorId)
    ?? tx.put<PostingStepsRecord>({ ...tx.base('venture-posting-steps'), connectorId, checked: [], added: [] });
}

/** Keeps day on each (step, key), one entry per pair. */
function withDates(record: PostingStepsRecord, worked: readonly { step: PostingStepId; key: string }[], day: IsoDate): PostingStepsRecord {
  const checked = [...record.checked];
  for (const item of worked) {
    const index = checked.findIndex(entry => entry.step === item.step && entry.key === item.key);
    if (index >= 0) checked[index] = { ...checked[index], checkedOn: newer(checked[index].checkedOn, day)! };
    else checked.push({ step: item.step, key: item.key, checkedOn: day });
  }
  return { ...record, checked };
}

/**
 * The keys a step may date: its known candidates now, the owner's new picks, and the confirm step's response rule.
 * Anything else from the browser is ignored.
 */
function knownKeys(state: State, connectorId: string, picked: readonly PostingStepPick[]): Set<string> {
  const script = BROWSER_SCRIPTS[connectorId];
  if (!script) return new Set();
  const added = [...picked, ...addedPicks(state, connectorId)];
  return new Set([
    ...POSTING_STEPS.flatMap(step => stepCandidates(script, step, added).map(candidate => `${step} ${candidateKey(candidate)}`)),
    `confirm ${responseKey(script)}`,
  ]);
}

const STEP_IDS: readonly string[] = POSTING_STEPS;

function isPick(value: unknown): value is PostingStepPick {
  const item = value as PostingStepPick | null;
  const candidate = item?.candidate as PostingCandidate | undefined;
  return !!item && STEP_IDS.includes(item.step) && !!candidate && ['test-id', 'role', 'aria-label', 'xpath'].includes(candidate.kind)
    && typeof candidate.value === 'string' && candidate.value.length > 0 && candidateKey(candidate).length <= MAX_KEY
    && (candidate.name === undefined || typeof candidate.name === 'string') && (candidate.lang === undefined || /^[a-z]{2,3}$/.test(candidate.lang));
}

/**
 * A posted result from the browser kept only in its known shape: the address as an http or https address of at most
 * 2,048 characters, and the steps it used as (step, key) pairs. Anything else is dropped, never the outcome.
 */
export function keptPosted(result: Extract<BrowserPostResult, { outcome: 'posted' }>): Extract<BrowserPostResult, { outcome: 'posted' }> {
  const url = typeof result.url === 'string' && result.url.length <= 2048 && /^https?:\/\/[^\s]+$/i.test(result.url) ? result.url : null;
  const checked = (Array.isArray(result.checked) ? result.checked : [])
    .filter(item => !!item && STEP_IDS.includes(item.step) && typeof item.key === 'string' && item.key.length > 0 && item.key.length <= MAX_KEY)
    .map(item => ({ step: item.step, key: item.key }));
  return { outcome: 'posted', line: result.line, url, ...(checked.length ? { checked } : {}) };
}

/**
 * A post that went out dates the candidates it used, the confirmation's included. Never throws: the post already went
 * out and its journal entry is settled; a date that could not be kept changes nothing else.
 */
export async function recordStepsWorked(deps: VentureDeps, ctx: Context, connectorId: string, worked: readonly { step: PostingStepId; key: string }[]): Promise<void> {
  if (!BROWSER_SCRIPTS[connectorId] || !worked.length) return;
  try {
    await ventureAction(deps, ctx, 'approve', 'posting.steps.worked', tx => {
      const known = knownKeys(tx.state, connectorId, []);
      const kept = worked.filter(item => known.has(`${item.step} ${item.key}`));
      if (kept.length) tx.replace(withDates(recordIn(tx, connectorId), kept, tx.now.slice(0, 10)));
    });
  } catch {
    // The post's own record is what matters; the steps are dated again by the next check or post.
  }
}

function portOf(deps: VentureDeps): BrowserPort | undefined {
  return deps.connectors?.browser ?? defaultConnectorPorts().browser;
}

/** The words of a check: what was not found, what the owner added, and why the confirmation waits for a post. */
function checkLine(view: PostingStepsView, found: ReadonlySet<PostingStepId>, picked: readonly PostingStepPick[]): string {
  const lines: string[] = [];
  const missing = (['textbox', 'submit'] as const).filter(step => !found.has(step) && !picked.some(item => item.step === step));
  const repaired = (['textbox', 'submit'] as const).filter(step => picked.some(item => item.step === step));
  if (repaired.length) lines.push(`Chausar added what you clicked for the ${repaired.map(step => STEP_WORDS[step]).join(' and the ')}.`);
  if (missing.length) lines.push(`Not found the way Chausar knows it: the ${missing.map(step => STEP_WORDS[step]).join(' and the ')}. Nothing was typed or clicked.`);
  const confirm = view.steps.find(item => item.step === 'confirm')!;
  if (!found.has('confirm') && !confirm.candidates.some(candidate => candidate.checkedOn !== null) && !confirm.response?.checkedOn) {
    lines.push('The post confirmation shows only after a post, so the first post that goes out checks it.');
  }
  if (!lines.length) lines.push('Every step was found the way Chausar knows it.');
  return lines.join(' ');
}

/** The words of a hold the check met, as posting keeps them (build/posting.ts). */
function holdLine(name: string, kind: 'challenge' | 'blocked'): string {
  return kind === 'blocked'
    ? `${name} blocked this account or an action. Chausar froze ${name} for ${FREEZE_HOURS} hours, reads too. Do not sign in again or reconnect; wait for the freeze to end.`
    : `${name} showed a security check. Chausar will not act on ${name} until you clear the check yourself in the Chausar browser window and say so here.`;
}

/** Waits for the browser at most limitMs; a check that runs longer answers POSTING_STEPS_NOT_CHECKED. */
async function within<T>(work: Promise<T>, limitMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new ChausarError('POSTING_STEPS_NOT_CHECKED', 'The check did not finish in time. Nothing was typed or clicked.')), limitMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * venture.posting.checkSteps { connectorId } (approve, inside the app, desktop only): opens the platform's post box in
 * the Chausar browser window with the owner's own session, finds every candidate of every step without typing or
 * clicking, and keeps today's date on each that matched exactly one visible element; a step none matched asks the
 * owner to click its element once. Refused on the hosted server (TIER_UNAVAILABLE), for a picture or video platform
 * (NOT_BUILT_YET), while the channel is held, with no browser here (NOT_BUILT_YET), signed out (POSTING_NOT_SIGNED_IN),
 * when the script guard refused a page script (PAGE_SCRIPT_REFUSED), and when the check could not run
 * (POSTING_STEPS_NOT_CHECKED). A security check or a block the page shows holds the channel, as a post would.
 */
export async function postingCheckSteps(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PostingStepsView> {
  requireAppChannel(ctx, 'venture.posting.checkSteps');
  const body = exactPayload(payload, ['connectorId'], ['connectorId']);
  const connectorId = typeof body.connectorId === 'string' && POSTING_CONNECTORS.includes(body.connectorId) ? body.connectorId : null;
  check(connectorId, 'INVALID_VENTURE_REQUEST', 'Posting works only on LinkedIn, X, Instagram and YouTube.');
  authorize(deps.store, ctx, 'approve');
  check(deps.host !== 'hosted-web', 'TIER_UNAVAILABLE', HOSTED_LINE);
  const script = BROWSER_SCRIPTS[connectorId];
  check(script, 'NOT_BUILT_YET', MEDIA_LINE);
  const held = channelHold(deps.store.read(), connectorId, deps.clock().toISOString());
  if (held) throw new ChausarError(held.cause === 'blocked' ? 'CHANNEL_FROZEN' : 'CHANNEL_CHALLENGED', held.line);
  const env = await postingEnvironment(deps);
  const port = portOf(deps);
  check(env.browser.present && port?.checkSteps, 'NOT_BUILT_YET', env.browser.present ? 'Checking the steps through the browser is not built here.' : env.browser.reason);
  const timeoutMs = deps.connectors?.postTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  let result: BrowserStepsResult;
  try {
    result = await within(port.checkSteps({ connectorId, timeoutMs, added: addedPicks(deps.store.read(), connectorId) }), timeoutMs * (POSTING_STEPS.length + 3) + 2 * PICK_MS);
  } catch (error) {
    if (error instanceof ChausarError) throw error;
    throw new ChausarError('POSTING_STEPS_NOT_CHECKED', `Chausar could not check the steps on ${script.name}.`);
  }
  if (!result || typeof result !== 'object') throw new ChausarError('POSTING_STEPS_NOT_CHECKED', `Chausar could not check the steps on ${script.name}.`);
  const audit = (Array.isArray(result.audit) ? result.audit : []).filter((line): line is string => typeof line === 'string').slice(-MAX_AUDIT).map(line => line.slice(0, 200));
  if (result.outcome === 'signed-out') throw new ChausarError('POSTING_NOT_SIGNED_IN', `Sign in to ${script.name} in the Chausar browser window first.`);
  if (result.outcome !== 'checked') {
    const hold = result.hold && (result.hold.kind === 'challenge' || result.hold.kind === 'blocked') && typeof result.hold.site === 'string' ? result.hold : null;
    if (hold) {
      const line = holdLine(script.name, hold.kind);
      await ventureAction(deps, ctx, 'approve', 'connector.hold', tx => tx.put<ChannelHoldRecord>({
        ...tx.base('venture-channel-hold'), connectorId, site: hold.site.slice(0, 253), cause: hold.kind, line,
        until: hold.kind === 'blocked' ? new Date(Date.parse(tx.now) + FREEZE_HOURS * 3600000).toISOString() : null, postId: null, clearedAt: null, clearedBy: null,
      }));
      throw new ChausarError(hold.kind === 'blocked' ? 'CHANNEL_FROZEN' : 'CHANNEL_CHALLENGED', line);
    }
    const line = typeof result.line === 'string' ? result.line.slice(0, 300) : `Chausar could not check the steps on ${script.name}.`;
    throw new ChausarError(result.refused ? 'PAGE_SCRIPT_REFUSED' : 'POSTING_STEPS_NOT_CHECKED', line);
  }
  const picked = (Array.isArray(result.picked) ? result.picked : []).filter(isPick).map(item => ({ step: item.step, candidate: { ...item.candidate } }));
  return ventureAction(deps, ctx, 'approve', 'posting.steps.check', tx => {
    const day = tx.now.slice(0, 10);
    const known = knownKeys(tx.state, connectorId, picked);
    const worked = (Array.isArray(result.steps) ? result.steps : [])
      .filter(item => !!item && STEP_IDS.includes(item.step) && typeof item.key === 'string' && item.visible === 1 && known.has(`${item.step} ${item.key}`))
      .map(item => ({ step: item.step, key: item.key }));
    const record = recordIn(tx, connectorId);
    const keys = new Set(record.added.map(item => `${item.step} ${candidateKey(item.candidate)}`));
    const fresh = picked.filter(item => !keys.has(`${item.step} ${candidateKey(item.candidate)}`)).map(item => ({ ...item, key: candidateKey(item.candidate), addedOn: day }));
    const updated = withDates({ ...record, added: [...fresh, ...record.added] }, [...worked, ...fresh.map(item => ({ step: item.step, key: item.key }))], day);
    tx.replace(updated);
    tx.emit('posting-steps-checked', { connectorId, found: worked.length, picked: fresh.length, audit });
    const found = new Set<PostingStepId>([...worked.map(item => item.step), ...fresh.map(item => item.step)]);
    const view = postingStepsView(tx.state, connectorId);
    return { ...view, line: checkLine(view, found, picked) };
  });
}
