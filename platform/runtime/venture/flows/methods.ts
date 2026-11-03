// Chausar venture launcher, recorded flows (wave 6, package 6H2; DECISIONS D41): venture.flows.list and
// venture.flows.act, answered by the build package's table. The owner, inside the app, records a website task once in
// the desktop's browser window (record), tests the draft with its samples (dry-run), approves that exact recipe once
// (approve), then runs it (run): exact replay with no AI that stops before any submit, payment or post. The owner's
// tap on that stop (continue, with the stop's digest) goes through the exact-approval journal (connector.write,
// operation flow-submit) before the press, and the run goes on to the next stop or the end. A password, card or code
// stop waits for the owner to type it in the window (continue with no digest). A changed page stops the run and keeps
// the controls on the page then; a repair (the owner's AI tool may propose it) picks one and becomes a new draft
// version that needs its own dry run and approval. stop closes the window. Only the desktop has the window.
import { createHash, randomUUID } from 'node:crypto';
import { authorize, check, type Context } from '../../contracts.ts';
import type { VentureDeps } from '../contracts.ts';
import { exactPayload, isAppChannel, listRecords, readVenture, ventureAction } from '../records.ts';
import { journalled } from '../journal/journal.ts';
import { gateEffect, sealApproval } from '../policy/holds.ts';
import { FLOW_WORDS } from './flow-words.ts';
import { recipeDigest, recipeFromRecording, originOf, validateRecipe, type FlowRecipe, type FlowStep } from './recipe.ts';
import { checkValues, pressApproved, replayFlow, type FlowBrowserPort, type ReplayStop } from './replay.ts';
import { flowView, runView, type FlowHeld, type FlowRecord, type FlowRunRecord, type FlowRunState, type FlowsActView, type FlowsListView } from './records.ts';

export const FLOW_ACTIONS = ['record', 'dry-run', 'approve', 'run', 'continue', 'repair', 'stop'] as const;
const EFFECT_WORDS = { submit: 'Submit', pay: 'Pay', post: 'Post' } as const;
const RUNS_SHOWN = 20;
const MAX_OPTIONS = 40;

/** The one window per desktop port: the run it belongs to and that run's values, in memory only. */
type Session = { runRecordId: string; values: Record<string, string>; busy: boolean };
const sessions = new WeakMap<FlowBrowserPort, Session>();

const appOnly = (ctx: Context) => check(isAppChannel(ctx), 'APP_APPROVAL_REQUIRED', FLOW_WORDS.app);
function portOf(deps: VentureDeps): FlowBrowserPort {
  check(deps.host === 'desktop' && deps.flowBrowser, 'FLOW_BROWSER_UNAVAILABLE', FLOW_WORDS.browser);
  return deps.flowBrowser!;
}
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const recipeOf = (row: FlowRecord): FlowRecipe => ({ name: row.name, origin: row.origin, steps: row.steps, blanks: row.blanks });

function versions(deps: VentureDeps, flowId: unknown): FlowRecord[] {
  check(typeof flowId === 'string' && /^flow_[a-f0-9-]{8,40}$/.test(flowId), 'FLOW_NOT_FOUND', FLOW_WORDS.flow);
  const rows = listRecords(deps.store.read(), 'venture-flow').filter(row => row.flowId === flowId).sort((a, b) => a.version - b.version);
  check(rows.length > 0, 'FLOW_NOT_FOUND', FLOW_WORDS.flow);
  return rows;
}
function versionOf(deps: VentureDeps, flowId: unknown, version: unknown): FlowRecord {
  const row = versions(deps, flowId).find(item => item.version === version);
  check(row, 'FLOW_NOT_FOUND', FLOW_WORDS.version);
  return row;
}
function runOf(deps: VentureDeps, runId: unknown): FlowRunRecord {
  const row = typeof runId === 'string' ? listRecords(deps.store.read(), 'venture-flow-run').find(item => item.id === runId) : undefined;
  check(row, 'FLOW_NOT_FOUND', FLOW_WORDS.run);
  return row;
}

async function save<R extends FlowRecord | FlowRunRecord>(deps: VentureDeps, ctx: Context, name: string, rows: R[]): Promise<void> {
  await ventureAction(deps, ctx, 'prepare', `flows.${name}`, tx => { for (const row of rows) tx.replace({ ...row }); });
}
async function endWindow(port: FlowBrowserPort, runRecordId?: string): Promise<void> {
  const session = sessions.get(port);
  if (!runRecordId || session?.runRecordId === runRecordId) sessions.delete(port);
  await port.close(runRecordId).catch(() => undefined);
}

/** One window at a time: refused while another run holds it (a stop waiting for the owner). */
function claimWindow(deps: VentureDeps, port: FlowBrowserPort): void {
  const session = sessions.get(port);
  if (!session) return;
  const run = listRecords(deps.store.read(), 'venture-flow-run').find(item => item.id === session.runRecordId);
  check(!run || !['running', 'held', 'needs-you'].includes(run.state), 'FLOW_BUSY', 'Another flow is waiting for you in the Chausar window. Finish or stop it first.');
  sessions.delete(port);
}

/** The review the owner approves at a stop: each blank filled before it, with its label and the exact value. */
function reviewOf(row: FlowRecord, values: Record<string, string>, at: number): FlowHeld['review'] {
  const labels = new Map(row.blanks.map(blank => [blank.name, blank.label]));
  return row.steps.slice(0, at).flatMap(step => (step.kind === 'fill' && 'blank' in step.value ? [{ label: labels.get(step.value.blank) ?? step.target.label, value: values[step.value.blank] ?? '' }] : []));
}

/**
 * Keeps how a replay ended on its run (and on the version, for a dry run). A window stays open only for a stop that
 * waits for the owner; every other ending closes it. A changed page keeps the controls on it for a repair.
 */
async function settle(deps: VentureDeps, ctx: Context, port: FlowBrowserPort, flow: FlowRecord, run: FlowRunRecord, stop: ReplayStop): Promise<FlowsActView> {
  const session = sessions.get(port);
  const values = session?.values ?? {};
  const now = deps.clock().toISOString();
  let next: FlowRunRecord = { ...run, line: stop.line, held: null };
  let version = flow;
  if (stop.outcome === 'held') {
    const held: FlowHeld = { digest: sha({ run: run.id, recipe: run.recipeDigest, step: stop.step, values }), effect: stop.effect, label: (flow.steps[stop.step] as Extract<FlowStep, { kind: 'gate' }>).target.label, review: reviewOf(flow, values, stop.step) };
    next = { ...next, state: 'held', step: stop.step, held };
  } else if (stop.outcome === 'needs-you') {
    next = { ...next, state: 'needs-you', step: stop.step };
  } else {
    const state: FlowRunState = stop.outcome === 'tested' ? 'tested' : stop.outcome === 'done' ? 'done' : 'stopped';
    const step = 'step' in stop ? stop.step : stop.outcome === 'tested' && stop.gate !== null ? stop.gate : flow.steps.length;
    const options = stop.outcome === 'changed' ? (await port.controls(run.id).catch(() => [])).slice(0, MAX_OPTIONS) : null;
    next = { ...next, state, step, repairOptions: options, endedAt: now };
    if (run.mode === 'dry') version = { ...flow, dryRun: { digest: flow.digest, at: now, outcome: state === 'tested' ? 'tested' : 'stopped', line: stop.line } };
    await endWindow(port, run.id);
  }
  await save(deps, ctx, 'settle', version === flow ? [next] : [version, next]);
  return { flow: flowView(version), run: runView(next) };
}

async function startRun(deps: VentureDeps, ctx: Context, port: FlowBrowserPort, flow: FlowRecord, mode: 'dry' | 'run', values: Record<string, string>): Promise<FlowsActView> {
  claimWindow(deps, port);
  const run = await ventureAction(deps, ctx, 'prepare', 'flows.start', tx => tx.put<FlowRunRecord>({
    ...tx.base('venture-flow-run'), flowId: flow.flowId, version: flow.version, recipeDigest: flow.digest, mode, state: 'running', step: 0,
    line: mode === 'dry' ? 'Testing the flow.' : 'Running the flow.', held: null, repairOptions: null, journalEntryId: null, endedAt: null,
  }));
  sessions.set(port, { runRecordId: run.id, values, busy: true });
  try {
    const stop = await replayFlow({ port, runId: run.id, recipe: recipeOf(flow), values, mode });
    return await settle(deps, ctx, port, flow, run, stop);
  } catch (error) {
    await endWindow(port, run.id);
    await save(deps, ctx, 'failed', [{ ...run, state: 'stopped', line: 'The Chausar window closed or failed, so the flow stopped.', endedAt: deps.clock().toISOString() } as FlowRunRecord]);
    throw error;
  } finally {
    const session = sessions.get(port);
    if (session) session.busy = false;
  }
}

/** The owner's tap on a stop before a submit: the exact-approval journal, then the press, then the rest of the run. */
async function continueHeld(deps: VentureDeps, ctx: Context, port: FlowBrowserPort, flow: FlowRecord, run: FlowRunRecord, digest: unknown): Promise<FlowsActView> {
  const held = run.held!;
  check(typeof digest === 'string' && digest === held.digest, 'APPROVAL_STALE', 'Approve the exact current stop of this run.');
  const at = run.step;
  let pressing = false;
  const result = await journalled<boolean>(deps, ctx, {
    action: 'connector.write', operation: 'flow-submit', subject: `flow:${run.id}:${at}`, target: flow.origin, actionDigest: held.digest, descriptionComplete: true,
    line: `${EFFECT_WORDS[held.effect]}: ${held.label} on ${flow.origin}, flow ${flow.name}.`.slice(0, 300),
  }, async handle => {
    try {
      const live = runOf(deps, run.id);
      check(live.state === 'held' && live.held?.digest === held.digest, 'APPROVAL_STALE', 'This stop changed.');
      const pressed = await pressApproved(port, run.id, recipeOf(flow), at, () => {
        gateEffect({ name: 'flows.submit', digest: held.digest }, sealApproval(handle.entry, held.digest));
        pressing = true;
      });
      if (!pressed) return { outcome: 'not-sent' as const, line: 'The page changed before the press. Nothing was sent.', value: false };
      return pressed.answered
        ? { outcome: 'applied' as const, line: `The site answered after ${held.label}.`, value: true }
        : { outcome: 'unknown' as const, line: `Check the site: ${held.label} may have gone through. Chausar will not press it again.`, value: false };
    } catch {
      return pressing
        ? { outcome: 'unknown' as const, line: `Check the site: ${held.label} may have gone through. Chausar will not press it again.`, value: false }
        : { outcome: 'not-sent' as const, line: 'Stopped before the press. Nothing was sent.', value: false };
    }
  });
  const journalEntryId = result.entry.id;
  if (result.entry.state !== 'applied') {
    const state: FlowRunState = result.entry.state === 'outcome_unknown' ? 'outcome-unknown' : 'not-sent';
    const ended: FlowRunRecord = { ...run, state, held: null, journalEntryId, line: result.entry.outcome?.line ?? 'Nothing was sent.', endedAt: deps.clock().toISOString() };
    await endWindow(port, run.id);
    await save(deps, ctx, 'pressed', [ended]);
    return { flow: flowView(flow), run: runView(ended) };
  }
  const going: FlowRunRecord = { ...run, state: 'running', held: null, journalEntryId, line: 'Running the flow.' };
  await save(deps, ctx, 'pressed', [going]);
  const values = sessions.get(port)?.values ?? {};
  const stop = await replayFlow({ port, runId: run.id, recipe: recipeOf(flow), values, mode: 'run', from: at + 1 });
  return settle(deps, ctx, port, flow, going, stop);
}

/** venture.flows.list {} (read): every version of every flow, newest first, and the latest runs. */
export async function flowsList(deps: VentureDeps, ctx: Context, payload: unknown): Promise<FlowsListView> {
  exactPayload(payload ?? {}, []);
  const { state } = readVenture(deps, ctx);
  const flows = listRecords(state, 'venture-flow').sort((a, b) => b.at.localeCompare(a.at) || b.version - a.version).map(flowView);
  const runs = listRecords(state, 'venture-flow-run').sort((a, b) => b.at.localeCompare(a.at)).slice(0, RUNS_SHOWN).map(runView);
  return { flows, runs };
}

/** venture.flows.act { action, ... }: see the file head. Every action but repair is the owner's, inside the app. */
export async function flowsAct(deps: VentureDeps, ctx: Context, payload: unknown): Promise<FlowsActView> {
  const action = (payload as { action?: unknown } | null)?.action;
  check(typeof action === 'string' && (FLOW_ACTIONS as readonly string[]).includes(action), 'INVALID_VENTURE_REQUEST', FLOW_WORDS.action);
  if (action === 'repair') return repair(deps, ctx, payload);
  appOnly(ctx);
  authorize(deps.store, ctx, 'approve');
  readVenture(deps, ctx);
  if (action === 'record') {
    const body = exactPayload(payload, ['action', 'name', 'url'], ['action', 'name', 'url']);
    check(typeof body.name === 'string' && body.name.trim().length > 0 && body.name.length <= 120, 'FLOW_INVALID', FLOW_WORDS.name);
    check(typeof body.url === 'string' && body.url.length <= 2048, 'FLOW_INVALID', FLOW_WORDS.url);
    originOf(body.url);
    const port = portOf(deps);
    claimWindow(deps, port);
    const { events } = await port.record(`rec_${randomUUID()}`, body.url);
    const { recipe, samples } = recipeFromRecording(events, { name: body.name });
    const flowId = `flow_${randomUUID()}`;
    const row = await ventureAction(deps, ctx, 'prepare', 'flows.record', tx => tx.put<FlowRecord>({
      ...tx.base('venture-flow'), flowId, version: 1, ...recipe, digest: recipeDigest(recipe), state: 'draft', proposedBy: 'owner', repairOf: null,
      samples, dryRun: null, approvedAt: null, approvedBy: null,
    }));
    return { flow: flowView(row), run: null };
  }
  if (action === 'dry-run') {
    const body = exactPayload(payload, ['action', 'flowId', 'version', 'values'], ['action', 'flowId', 'version']);
    const row = versionOf(deps, body.flowId, body.version);
    check(row.state === 'draft', 'APPROVAL_STALE', 'This version is already decided. Test the newest draft.');
    const values = checkValues(recipeOf(row), body.values ?? row.samples ?? {});
    return startRun(deps, ctx, portOf(deps), row, 'dry', values);
  }
  if (action === 'approve') {
    const body = exactPayload(payload, ['action', 'flowId', 'version', 'digest'], ['action', 'flowId', 'version', 'digest']);
    const row = versionOf(deps, body.flowId, body.version);
    check(row.state === 'draft', 'APPROVAL_STALE', 'This version is already decided.');
    check(row.dryRun?.outcome === 'tested' && row.dryRun.digest === row.digest, 'FLOW_NOT_TESTED', 'Test this exact version first; then approve it.');
    check(body.digest === row.digest, 'APPROVAL_STALE', 'Approve the exact version you tested.');
    validateRecipe(recipeOf(row));
    const now = deps.clock().toISOString();
    const replaced = versions(deps, row.flowId).filter(item => item.state === 'approved').map(item => ({ ...item, state: 'replaced' as const }));
    const approved: FlowRecord = { ...row, state: 'approved', samples: null, approvedAt: now, approvedBy: ctx.memberId };
    await save(deps, ctx, 'approve', [...replaced, approved]);
    return { flow: flowView(approved), run: null };
  }
  if (action === 'run') {
    const body = exactPayload(payload, ['action', 'flowId', 'values'], ['action', 'flowId', 'values']);
    const row = versions(deps, body.flowId).find(item => item.state === 'approved');
    check(row, 'FLOW_NOT_TESTED', 'Test and approve this flow before it runs.');
    return startRun(deps, ctx, portOf(deps), row, 'run', checkValues(recipeOf(row), body.values));
  }
  const body = exactPayload(payload, ['action', 'runId', 'digest'], ['action', 'runId']);
  const run = runOf(deps, body.runId);
  const port = portOf(deps);
  if (action === 'stop') {
    const active = ['running', 'held', 'needs-you'].includes(run.state);
    await endWindow(port, run.id);
    if (!active) return { flow: null, run: runView(run) };
    const stopped: FlowRunRecord = { ...run, state: 'stopped', held: null, line: 'You stopped this flow. Nothing more was done.', endedAt: deps.clock().toISOString() };
    await save(deps, ctx, 'stop', [stopped]);
    return { flow: null, run: runView(stopped) };
  }
  check(run.state === 'held' || run.state === 'needs-you', 'FLOW_HELD', 'This run is not waiting for you.');
  const session = sessions.get(port);
  if (!session || session.runRecordId !== run.id) {
    const closed: FlowRunRecord = { ...run, state: 'stopped', held: null, line: 'The Chausar window for this run closed. Run the flow again.', endedAt: deps.clock().toISOString() };
    await save(deps, ctx, 'closed', [closed]);
    check(false, 'FLOW_BROWSER_CLOSED', closed.line);
  }
  check(!session!.busy, 'FLOW_BUSY', 'Wait for the current step to finish.');
  session!.busy = true;
  try {
    const flow = versionOf(deps, run.flowId, run.version);
    check(flow.digest === run.recipeDigest, 'APPROVAL_STALE', 'This flow changed.');
    if (run.state === 'held') return await continueHeld(deps, ctx, port, flow, run, body.digest);
    check(body.digest === undefined || body.digest === null, 'INVALID_VENTURE_REQUEST', 'A stop for you needs no digest.');
    const stop = await replayFlow({ port, runId: run.id, recipe: recipeOf(flow), values: session!.values, mode: run.mode, from: run.step });
    return await settle(deps, ctx, port, flow, run, stop);
  } finally {
    const live = sessions.get(port);
    if (live) live.busy = false;
  }
}

/**
 * A repair: after a changed page, one of the controls on the page then takes the place of the step's control. It is
 * a new draft version (the AI tool may propose it), never approved here: it needs its own dry run and approval.
 */
async function repair(deps: VentureDeps, ctx: Context, payload: unknown): Promise<FlowsActView> {
  authorize(deps.store, ctx, 'prepare');
  readVenture(deps, ctx);
  const body = exactPayload(payload, ['action', 'runId', 'option'], ['action', 'runId', 'option']);
  const run = runOf(deps, body.runId);
  check(run.state === 'stopped' && Array.isArray(run.repairOptions) && run.repairOptions.length > 0, 'FLOW_INVALID', 'Only a run stopped by a changed page can be repaired.');
  check(Number.isInteger(body.option) && (body.option as number) >= 0 && (body.option as number) < run.repairOptions!.length, 'FLOW_INVALID', 'Choose one of the controls the page showed.');
  const from = versionOf(deps, run.flowId, run.version);
  const step = from.steps[run.step];
  check(step && step.kind !== 'open', 'FLOW_INVALID', 'This step has no control to repair.');
  const option = run.repairOptions![body.option as number]!;
  const steps = from.steps.map((item, at) => (at === run.step && item.kind !== 'open' ? { ...item, target: { candidates: option.candidates, fingerprint: option.fingerprint, label: option.label } } : item)) as FlowStep[];
  const recipe = validateRecipe({ name: from.name, origin: from.origin, steps, blanks: from.blanks });
  const version = Math.max(...versions(deps, from.flowId).map(item => item.version)) + 1;
  const row = await ventureAction(deps, ctx, 'prepare', 'flows.repair', tx => tx.put<FlowRecord>({
    ...tx.base('venture-flow'), flowId: from.flowId, version, ...recipe, digest: recipeDigest(recipe), state: 'draft', proposedBy: isAppChannel(ctx) ? 'owner' : 'ai',
    repairOf: { version: from.version, step: run.step }, samples: null, dryRun: null, approvedAt: null, approvedBy: null,
  }));
  return { flow: flowView(row), run: null };
}
