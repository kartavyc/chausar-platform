// Chausar venture launcher, package P2 (models): the model port.
// Every call is recorded before it is sent, with the exact text and a cost worked out by code. The workspace
// send setting rules every send. Client data leaves only after one approval of its exact text (preview, then
// runPreview), and the content guard refuses it under standing consent. One dispatch per call: no retry, no
// reroute, no fallback model. No ModelPort method is ever called inside a venture transaction.
// Ink v2 wave 4 (4H1): a command-line call runs in an empty folder made for it (H39); every settled call keeps the model
// the provider's answer named, else 'not reported' (H36); the owner's Claude Code and Codex are looked at on this
// computer (cli-status.ts) and what was found rules their availability, the connection and each call. One look at a
// time per tool; the status screen's look is reused for a minute, a connection always looks again; and a real call the
// tool refuses for a route flag it does not know marks that tool's flags a mismatch for the rest of the session.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorize, ChausarError, check, type Context, type State } from '../../contracts.ts';
import { MODEL_PURPOSES, PURPOSE_TIER, VENTURE_ERRORS } from '../contracts.ts';
import type {
  CliFinding, DelegateCli, ModelOutcome, ModelPort, ModelPortOptions, ModelPreset, ModelPresetId, ModelPreview, ModelPriceTable, ModelPurpose, ModelRouteKind,
  ModelStatusView, ModelTask, ModelTier, SpendRate, VentureDeps,
} from '../contracts.ts';
import { MAX_STORED_PAYLOAD, currentVenture, digest, formatMicros, isAppChannel, listRecords, ventureAction, type VentureTx } from '../records.ts';
import {
  listRateOfTable, modelTableOf, payerWords, reserveSpend, resolveRate, settleSpend, spendRatesOf, spendRefused, type SpendOutcome, type SpendSubject,
} from '../money/spend.ts';
import { AGENT_ID, AGENT_PURPOSES } from '../views/shared.ts';
import {modelBudgetUsed} from './budget.ts';
import { writeCapDenial } from '../delivery/harness/write-caps.ts';
import { ANTHROPIC_URL, anthropicBody, anthropicHeaders, parseAnthropic } from './anthropic.ts';
import {
  SCHEMA_PLACEHOLDER, TEMP_PREFIX, claudePlan, cliEnv, cliRouteFlags, codexHost, codexPlan, parseClaudeCli, parseCodexCli, unknownRouteFlags,
  type CliPlan, type CodexHost,
} from './cli.ts';
import { callCostMicros, costDisplay, estimateMaxCostMicros } from './cost.ts';
import { clientDataFindings } from './guard.ts';
import { OPENAI_URL, openaiBody, openaiHeaders, parseOpenAI } from './openai.ts';
import {
  AVAILABILITY_REASONS, PRESETS, availabilityOf, claudeTermsOpen, cliFlagsWords, cliProblemWords, cliSentence, cliSignedOutWords, presetSpec, type PresetSpec,
} from './presets.ts';
import { CLI_STATUS_WORDS, inspectInstalledCli, lastCliTask, locateOnThisComputer } from './cli-status.ts';
import { assertSchemaSafe } from './schema.ts';
import { redactPayload, redactSecrets } from '../core/secrets.ts';
import {
  HTTP_TIMEOUT_MS, NOT_REPORTED, PREVIEW_TTL_MS, PROCESS_TIMEOUT_MS, STALE_DISPATCH_MESSAGE, STALE_DISPATCH_MS, isPlainRecord,
  type CallRecord, type ConnectionRecord, type ConnectionView, type Parsed,
} from './types.ts';

export const MESSAGES = Object.freeze({
  keyMissing: 'Enter your key again. Chausar keeps keys in memory only.',
  sendDisabled: 'Your privacy setting sends nothing to models. Change it on Trust & access, or use built-in templates.',
  templatesServe: 'No AI connected; using built-in templates',
  noModel: 'Connect an AI, or use the built-in templates for this step.',
  clientDataFlag: 'This step holds client details. Chausar shows you the exact text first and sends it only after you approve it.',
  clientDataFound: 'This text holds client details, so it was not sent. Chausar sends client details only after you approve the exact text.',
  approvalStale: 'Run it again; the approved text is no longer available.',
  appApproval: 'Approve this inside the Chausar app.',
  connectionChanged: 'The AI connection changed. Try again.',
  disconnected: 'Disconnected.',
  claudeConnected: 'Connected earlier. Not yet tried on a real task.',
});

const TIERS: readonly ModelTier[] = ['fast', 'main'];
/** Ink v2 wave 4 (4J8): the calls that may carry a file the owner dropped (core/attachment.ts), sent as 'owner-file-drop'. */
const FILE_DROP_PURPOSES: ReadonlySet<string> = new Set(['decide', 'compose', 'plan-suggest']);
const SECRET = (id: ModelPresetId) => `model:${id}` as const;
const monthOf = (iso: string) => iso.slice(0, 7);
/** How long the status screen reuses a look at a tool: a minute, as heavy work reuses its check (delegate.ts). */
export const CLI_LOOK_REUSE_MS = 60_000;
const ROUTE_OF: Readonly<Record<DelegateCli, 'claude-cli' | 'codex-cli'>> = Object.freeze({ 'claude-code': 'claude-cli', codex: 'codex-cli' });
const CLI_OF: Readonly<Record<'claude-cli' | 'codex-cli', DelegateCli>> = Object.freeze({ 'claude-cli': 'claude-code', 'codex-cli': 'codex' });

type Route =
  | { kind: 'template' }
  | { kind: 'model'; connection: ConnectionRecord; spec: PresetSpec; problem: { code: string; message: string } | null };

type Prepared =
  | { transport: 'http'; routeKind: 'anthropic-messages' | 'openai-responses'; url: string; body: string; payloadText: string }
  | { transport: 'process'; plan: CliPlan; payloadText: string };

type Pending = { prepared: Prepared; expiresAtMs: number };

// ---------------------------------------------------------------------------
// Record access
// ---------------------------------------------------------------------------

export function listConnections(state: State, ventureId: string): ConnectionRecord[] {
  return listRecords(state, 'venture-model-connection', ventureId);
}
export function listCalls(state: State, ventureId: string): CallRecord[] {
  return listRecords(state, 'venture-model-call', ventureId);
}
function txConnections(tx: VentureTx): ConnectionRecord[] {
  return tx.list('venture-model-connection');
}
function txCalls(tx: VentureTx): CallRecord[] {
  return tx.list('venture-model-call');
}
export function putRecord<T>(tx: VentureTx, record: T): T {
  return tx.put(record as any) as unknown as T;
}
export function replaceRecord<T>(tx: VentureTx, record: T): T {
  return tx.replace(record as any) as unknown as T;
}

/** Newest by `at`; on a tie the record stored later wins (records are kept in the order they were stored). */
function newest<T extends { at: string }>(records: T[]): T | null {
  let best: T | null = null;
  for (const record of records) if (!best || record.at >= best.at) best = record;
  return best;
}

/** Newest first: by `at`, then by storage order. */
export function newestFirst<T extends { at: string }>(records: T[]): T[] {
  return records.map((record, index) => ({ record, index }))
    .sort((a, b) => (a.record.at === b.record.at ? b.index - a.index : a.record.at < b.record.at ? 1 : -1))
    .map(item => item.record);
}

/** How a call reads now, without writing: dispatching for over ten minutes is failed; a preview past 30 minutes is expired. */
export function viewCall(call: CallRecord, nowMs: number): CallRecord {
  if (call.status === 'dispatching' && nowMs - Date.parse(call.approvedAt ?? call.at) > STALE_DISPATCH_MS) {
    return { ...call, status: 'failed', error: { code: 'MODEL_TIMEOUT', message: STALE_DISPATCH_MESSAGE } };
  }
  if (call.status === 'preview' && nowMs - Date.parse(call.at) > PREVIEW_TTL_MS) return { ...call, status: 'expired' };
  return call;
}

/** Writes the view above into the draft state. Called first in every action that records a call. */
function sweep(tx: VentureTx) {
  const nowMs = Date.parse(tx.now);
  for (const call of txCalls(tx)) {
    const view = viewCall(call, nowMs);
    if (view === call) continue;
    replaceRecord(tx, view);
    // A send that never reported back may still have been billed: its spend stays held, marked unknown.
    if (view.status === 'failed') settleSpend(tx, spendKey(call.id), { kind: 'unknown' });
  }
}

/** The spend ledger key of a model call: one charge per call record, so the same call is never paid for twice. */
const spendKey = (callId: string) => `model:${callId}`;

/** A model call on the spend ledger: its words, who pays (the connection's key) and the exact text paid for. */
function callSpend(call: Pick<CallRecord, 'id' | 'purpose' | 'connectionId' | 'payloadDigest'>, spec: PresetSpec): SpendSubject {
  return {
    key: spendKey(call.id), item: `model:${spec.id}`, label: `${spec.label}, ${call.purpose}`, payer: `connection:${call.connectionId}`,
    draftDigest: call.payloadDigest, connector: spec.id, ref: call.id,
    // Ink v2 wave 4 (4F2): the team agent the call works for, from its purpose, so the agent's own limit holds even
    // where the charge is written before the call record (generate, a rehearsal's turns on standing consent).
    agent: AGENT_PURPOSES.includes(call.purpose) ? AGENT_ID : null,
  };
}

/**
 * The price a keyed model call uses: the owner's rate card line for the preset, else the preset's list price, else a
 * refusal (never a free call). Command-line tools run on the owner's own plan and replays spend nothing, so neither
 * is metered: null, and their cost stays as the preset says.
 */
function meteredRate(state: State, ventureId: string, spec: PresetSpec, replay: boolean, subject: SpendSubject): SpendRate | null {
  if (!spec.needsKey || replay) return null;
  return resolveRate({ item: `model:${spec.id}`, list: listRateOfTable(`model:${spec.id}`, spec.priceTable), owner: spendRatesOf(state, ventureId), subject });
}

/** How a sent call settles: by the provider's usage, at the estimate when it answered without usage, held when no answer came. */
function spendOutcome(sent: boolean, usage: boolean, failed: boolean, costMicros: string | null): SpendOutcome {
  if (!sent) return { kind: 'released' };
  if (usage && costMicros !== null) return { kind: 'billed', micros: costMicros, by: 'usage' };
  return failed ? { kind: 'unknown' } : { kind: 'reservation' };
}

/**
 * This month's spend on the preset, plus what every dispatching call of that preset reserves, plus this
 * estimate, must stay within the connection's monthly limit (months in UTC).
 */
function checkBudget(calls: CallRecord[], connection: ConnectionRecord, spec: PresetSpec, estimate: string, month: string, tx:VentureTx) {
  const total = BigInt(estimate)+modelBudgetUsed(calls,tx.list('venture-spend'),connection.presetId,month);
  check(total <= BigInt(connection.monthlyCapMicros), 'BUDGET_REACHED',
    `This call could take ${spec.label} past your monthly limit of ${formatMicros(connection.monthlyCapMicros)}. Raise the limit or wait for next month.`);
}

// ---------------------------------------------------------------------------
// Task checks
// ---------------------------------------------------------------------------

function checkTask(task: ModelTask<unknown>) {
  const malformed = (why: string) => new ChausarError('INVALID_VENTURE_REQUEST', `The model task is malformed: ${why}.`);
  if (!isPlainRecord(task)) throw malformed('it is not an object');
  if (!(MODEL_PURPOSES as readonly unknown[]).includes(task.purpose)) throw malformed('unknown purpose');
  if (typeof task.instructions !== 'string' || task.instructions.length < 1 || task.instructions.length > 20000) throw malformed('instructions must be text');
  if (typeof task.schemaName !== 'string' || !/^[a-z][a-z0-9-]{0,40}$/.test(task.schemaName)) throw malformed('schemaName must be lower-case words joined by dashes');
  if (!Number.isInteger(task.maxOutputTokens) || task.maxOutputTokens < 256 || task.maxOutputTokens > 8192) throw malformed('maxOutputTokens must be from 256 to 8192');
  if (typeof task.validate !== 'function') throw malformed('validate must be a function');
  if (task.template !== undefined && typeof task.template !== 'function') throw malformed('template must be a function when given');
  if (typeof task.containsClientData !== 'boolean') throw malformed('containsClientData must be true or false');
  if (task.capLeftMicros !== undefined && (typeof task.capLeftMicros !== 'string' || !/^\d{1,30}$/.test(task.capLeftMicros))) throw malformed('capLeftMicros must be whole micro units');
  let input: string | undefined;
  try { input = JSON.stringify(task.input); } catch { input = undefined; }
  if (typeof input !== 'string') throw malformed('input must be plain JSON');
}

/** A model id as providers write them ('claude-sonnet-5-5-20261001', 'gpt-6-luna'); anything else is not taken. */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,99}$/;
const modelName = (value: unknown): string | null => (typeof value === 'string' && MODEL_NAME.test(value) ? value : null);

/**
 * The model a provider's answer names (H36), read from the raw answer: Anthropic's and OpenAI's `model`; Claude Code's
 * `model`, else the model in its `modelUsage` that wrote the most; a Codex event's `model`. Null when it names none.
 */
export function reportedModel(kind: ModelRouteKind, text: string): string | null {
  try {
    if (kind === 'codex-cli') {
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const event: unknown = JSON.parse(line);
        const named = isPlainRecord(event) ? modelName(event.model) : null;
        if (named) return named;
      }
      return null;
    }
    const data: unknown = JSON.parse(text);
    if (!isPlainRecord(data)) return null;
    const named = modelName(data.model);
    if (named || kind !== 'claude-cli' || !isPlainRecord(data.modelUsage)) return named;
    let best: { name: string; output: number } | null = null;
    for (const [name, usage] of Object.entries(data.modelUsage)) {
      const output = isPlainRecord(usage) && typeof usage.outputTokens === 'number' ? usage.outputTokens : 0;
      if (modelName(name) && (!best || output > best.output)) best = { name, output };
    }
    return best?.name ?? null;
  } catch {
    return null;
  }
}

function failureOf(error: unknown, fallback: { code: string; message: string }): { code: string; message: string; cause?: string } {
  if (error instanceof ChausarError && (VENTURE_ERRORS as readonly string[]).includes(error.code)) {
    // Ink v2 wave 4 (4F2): the transport's own class of the failure (such as 'not-connected'), kept so the owner's
    // words come from it and never from the message's text.
    const cause = (error as ChausarError & { details?: { cause?: unknown } }).details?.cause;
    return { code: error.code, message: error.message, ...(typeof cause === 'string' ? { cause } : {}) };
  }
  if (error instanceof ChausarError && error.code === 'RESPONSE_TOO_LARGE') return { code: 'MODEL_FAILED', message: 'The model returned too much data. Chausar did not retry it.' };
  if (error instanceof ChausarError && error.code === 'CLI_HOST_EVIDENCE_INVALID') return { code: 'CLI_UNAVAILABLE', message: 'The reviewed Codex install changed or could not be checked.' };
  return fallback;
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

export function createModelPort(options: ModelPortOptions): ModelPort {
  const { store, clock, transport, secrets } = options;
  const actionDeps = { store, clock } as unknown as VentureDeps;
  const hosted = options.host === 'hosted-web';
  const claudeTerms = options.claudeCodeTerms;
  // The hosted web server never runs a command-line tool: no Codex profile is honoured there, whatever was passed.
  const codex: CodexHost | null = hosted ? null : codexHost(options.codexCli);
  const locate = options.locateCli ?? locateOnThisComputer;
  // The newest look at each command-line tool this session (4H1). In memory only: a restart looks again.
  const looks = new Map<DelegateCli, CliFinding>();
  /** When each kept look started, on the port's clock, for the status screen's minute of reuse. */
  const lookedAt = new Map<DelegateCli, number>();
  /** The look under way at each tool: every other asker joins it, so one look runs at a time per tool. */
  const flights = new Map<DelegateCli, Promise<CliFinding>>();
  /** Route flags a real call showed a tool does not know: every later look keeps them as a mismatch this session. */
  const refusedFlags = new Map<DelegateCli, Set<string>>();
  const answered = (cli: DelegateCli) => looks.get(cli)?.answered === true;
  const pending = new Map<string, Pending>();

  /** What availabilityOf needs now: the looks, the terms gate, the Codex profile, and whether a real task on each worked. */
  const liveOf = (state: State) => {
    const ventureId = currentVenture(state)?.id ?? null;
    return {
      claudeFound: answered('claude-code'), codexProfile: !!codex, hosted, claudeTerms,
      claude: looks.get('claude-code') ?? null, codex: looks.get('codex') ?? null,
      worked: {
        'claude-code': lastCliTask(state, ventureId, 'claude-code')?.outcome === 'succeeded',
        codex: lastCliTask(state, ventureId, 'codex')?.outcome === 'succeeded',
      },
    };
  };

  /** A finding with the flags real calls were refused on: a mismatch, listed in the route's order with the help's own. */
  const withRefused = (finding: CliFinding): CliFinding => {
    const refused = refusedFlags.get(finding.cli);
    if (!refused?.size || !finding.answered || finding.replay) return finding;
    const missing = cliRouteFlags(ROUTE_OF[finding.cli]).filter(flag => refused.has(flag) || finding.missingFlags.includes(flag));
    return { ...finding, flags: 'mismatch', missingFlags: missing };
  };

  /** A real call was refused for these route flags: kept for the session, and the kept look says so from now. */
  const refuseFlags = (cli: DelegateCli, flags: readonly string[]) => {
    const refused = refusedFlags.get(cli) ?? new Set<string>();
    for (const flag of flags) refused.add(flag);
    refusedFlags.set(cli, refused);
    const kept = looks.get(cli);
    if (kept) looks.set(cli, withRefused(kept));
  };

  /**
   * One look at a tool on this computer, kept for availability. Never on the hosted web server. One look runs at a time
   * per tool and every other asker joins it. Unless fresh, a look started within the last minute is reused (the status
   * screen); a connection asks for a fresh one.
   */
  const look = async (cli: DelegateCli, fresh: boolean): Promise<CliFinding> => {
    check(!hosted, 'TIER_UNAVAILABLE', CLI_STATUS_WORDS.hosted);
    let flight = flights.get(cli);
    if (!flight) {
      const startedMs = clock().getTime();
      const kept = looks.get(cli), at = lookedAt.get(cli);
      if (!fresh && kept && at !== undefined && startedMs >= at && startedMs - at < CLI_LOOK_REUSE_MS) return structuredClone(kept);
      flight = inspectInstalledCli(cli, { transport, locate, codex, claudeTerms, now: () => clock().toISOString() })
        .then(finding => {
          const seen = withRefused(finding);
          looks.set(cli, seen);
          lookedAt.set(cli, startedMs);
          return seen;
        })
        .finally(() => { flights.delete(cli); });
      flights.set(cli, flight);
    }
    return structuredClone(await flight);
  };

  const problemOf = (spec: PresetSpec): { code: string; message: string } | null => {
    if (hosted && spec.runsOn === 'this-computer') return { code: 'PRESET_UNAVAILABLE', message: AVAILABILITY_REASONS.hostedCli };
    // The Claude Code terms gate holds at run time too: a connection made while it was open never runs once it is closed.
    if (spec.kind === 'claude-cli' && !claudeTermsOpen(claudeTerms)) return { code: 'PRESET_UNAVAILABLE', message: AVAILABILITY_REASONS.claudeTerms };
    if (spec.needsKey && !secrets.has(SECRET(spec.id))) return { code: 'MODEL_KEY_MISSING', message: MESSAGES.keyMissing };
    if (spec.kind === 'codex-cli' && !codex) return { code: 'PRESET_UNAVAILABLE', message: AVAILABILITY_REASONS.codexMissing };
    // The newest look at the tool (4H1): a flag it does not know, or signed out, stops the call before anything is sent.
    if (spec.kind === 'claude-cli' || spec.kind === 'codex-cli') {
      const finding = looks.get(spec.kind === 'claude-cli' ? 'claude-code' : 'codex');
      const words = cliProblemWords(finding);
      if (finding && words) return { code: finding.flags === 'mismatch' ? 'CLI_FLAGS_UNSUPPORTED' : 'CLI_UNAVAILABLE', message: cliSentence(words) };
    }
    return null;
  };

  const resolveTier = (state: State, ventureId: string | null, tier: ModelTier): Route => {
    if (!ventureId) return { kind: 'template' };
    const connection = newest(listConnections(state, ventureId).filter(item => item.status === 'connected' && item.tiers.includes(tier)));
    if (!connection || connection.presetId === 'built-in-templates') return { kind: 'template' };
    const spec = presetSpec(connection.presetId);
    return { kind: 'model', connection, spec, problem: problemOf(spec) };
  };

  const usableOf = (connection: ConnectionRecord, spec: PresetSpec, state: State): { usable: boolean; reason: string } => {
    if (connection.status !== 'connected') return { usable: false, reason: MESSAGES.disconnected };
    const problem = problemOf(spec);
    if (problem) return { usable: false, reason: problem.message };
    if (spec.kind === 'template') return { usable: true, reason: AVAILABILITY_REASONS.templates };
    if (state.policy.send === 'nothing') return { usable: false, reason: MESSAGES.sendDisabled };
    if (spec.kind === 'claude-cli' && !answered('claude-code')) return { usable: true, reason: MESSAGES.claudeConnected };
    return { usable: true, reason: availabilityOf(spec.id, liveOf(state)).availabilityReason };
  };

  const prepare = (connection: ConnectionRecord, spec: PresetSpec, given: ModelTask<unknown>): Prepared => {
    // The secret screen (W1 H17) before anything is built: the request, the preview and the call record all hold the
    // screened text, so a key or token pasted into the instructions or the input never leaves and is never kept.
    const task: ModelTask<unknown> = { ...given, instructions: redactSecrets(given.instructions), input: redactPayload(given.input) };
    const model = connection.model ?? spec.model ?? '';
    if (spec.kind === 'anthropic-messages') {
      const body = anthropicBody(model, task);
      return { transport: 'http', routeKind: spec.kind, url: ANTHROPIC_URL, body, payloadText: body };
    }
    if (spec.kind === 'openai-responses') {
      const body = openaiBody(model, task);
      return { transport: 'http', routeKind: spec.kind, url: OPENAI_URL, body, payloadText: body };
    }
    if (spec.kind === 'claude-cli') {
      const plan = claudePlan(model, task);
      return { transport: 'process', plan, payloadText: plan.payloadText };
    }
    check(codex, 'PRESET_UNAVAILABLE', AVAILABILITY_REASONS.codexMissing);
    let plan: CliPlan;
    try { plan = codexPlan(model, task, codex); } catch {
      throw new ChausarError('PRESET_UNAVAILABLE', 'The reviewed Codex host profile does not support this request.');
    }
    return { transport: 'process', plan, payloadText: plan.payloadText };
  };

  /** One dispatch through the transport, then the route's parser. Transport errors become a failed result. */
  const dispatch = async (prepared: Prepared, apiKey: string | null, purpose: ModelPurpose, onDispatch: () => void): Promise<Parsed> => {
    const transportFailure = { code: 'MODEL_FAILED', message: 'The model call failed. Chausar did not retry it.' };
    if (prepared.transport === 'http') {
      const headers = prepared.routeKind === 'anthropic-messages' ? anthropicHeaders(apiKey ?? '') : openaiHeaders(apiKey ?? '');
      try {
        onDispatch();
        const response = await transport.http({ url: prepared.url, method: 'POST', headers, body: prepared.body, timeoutMs: HTTP_TIMEOUT_MS, purpose });
        if (!response || typeof response.status !== 'number' || typeof response.body !== 'string') return { ok: false, ...transportFailure, usage: null };
        const parsed = prepared.routeKind === 'anthropic-messages' ? parseAnthropic(response) : parseOpenAI(response);
        return { ...parsed, answeredBy: reportedModel(prepared.routeKind, response.body) };
      } catch (error) {
        return { ok: false, ...failureOf(error, transportFailure), usage: null };
      }
    }
    const plan = prepared.plan;
    let directory: string | undefined;
    try {
      directory = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
      const schemaPath = join(directory, 'schema.json');
      await writeFile(schemaPath, JSON.stringify(plan.schema), { mode: 0o600 });
      // Text-only (H39): the tool works in an empty folder made for this call, beside the schema file, never in a real one.
      const workFolder = join(directory, 'work');
      await mkdir(workFolder);
      const args = plan.args.map(arg => (arg === SCHEMA_PLACEHOLDER ? schemaPath : arg));
      onDispatch();
      const response = await transport.process({ command: plan.command, args, env: cliEnv(plan.kind, plan.maxOutputTokens), stdin: plan.stdin, timeoutMs: PROCESS_TIMEOUT_MS, purpose, cwd: workFolder });
      if (!response || typeof response.exitCode !== 'number') return { ok: false, ...transportFailure, usage: null };
      // The tool refused a flag the route sends (one its help check let through, such as Claude Code's --max-turns):
      // that call fails in those words, and the tool reads as a flag mismatch from now on, so it is not offered as usable.
      const refused = response.exitCode !== 0 && transport.replay !== true
        ? unknownRouteFlags(plan.kind, `${typeof response.stderr === 'string' ? response.stderr : ''}\n${typeof response.stdout === 'string' ? response.stdout : ''}`)
        : [];
      if (refused.length > 0) {
        const cli = CLI_OF[plan.kind];
        refuseFlags(cli, refused);
        return { ok: false, code: 'CLI_FLAGS_UNSUPPORTED', message: cliSentence(cliFlagsWords(cli, looks.get(cli)?.version ?? null, refused)), usage: null };
      }
      const parsed = plan.kind === 'claude-cli' ? parseClaudeCli(response) : parseCodexCli(response);
      return { ...parsed, answeredBy: typeof response.stdout === 'string' ? reportedModel(plan.kind, response.stdout) : null };
    } catch (error) {
      return { ok: false, ...failureOf(error, transportFailure), usage: null };
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  };

  /**
   * Steps 8 to 11: dispatch once, parse, validate, then record the result in its own action. The table is the price
   * the call was reserved at (the owner's rate card or the list price); a metered call settles its spend there too.
   */
  const send = async <T>(ctx: Context, level: 'prepare' | 'approve', call: CallRecord, prepared: Prepared, spec: PresetSpec, validate: (raw: unknown) => T, table: ModelPriceTable | null, metered: boolean, beforeDispatch?: () => void): Promise<ModelOutcome<T>> => {
    const apiKey = spec.needsKey ? secrets.get(SECRET(spec.id)) : null;
    let sent = false;
    const onDispatch = () => { const result: unknown = beforeDispatch?.(); if (result && typeof (result as { then?: unknown }).then === 'function') void Promise.resolve(result).catch(() => undefined); check(result === undefined, 'INVALID_VENTURE_REQUEST', 'A dispatch guard must finish synchronously.'); sent = true; };
    const parsed: Parsed = spec.needsKey && !apiKey
      ? { ok: false, code: 'MODEL_KEY_MISSING', message: MESSAGES.keyMissing, usage: null }
      : await dispatch(prepared, apiKey, call.purpose, onDispatch);
    // 4F2: the transport's class of a failure (parsed.cause) stays on the call record beside Chausar's words.
    let failure: { code: string; message: string; cause?: string } | null = parsed.ok ? null : { code: parsed.code, message: parsed.message, ...(parsed.cause ? { cause: parsed.cause } : {}) };
    let value: T | undefined;
    if (parsed.ok) {
      try { value = validate(parsed.value); } catch (error) {
        failure = failureOf(error, { code: 'MODEL_OUTPUT_REJECTED', message: "The model answer did not pass Chausar's checks." });
      }
    }
    const costMicros = parsed.usage ? callCostMicros(parsed.usage, table) : failure ? null : table ? call.estimatedMaxCostMicros : '0';
    const outputDigest = parsed.ok ? digest(parsed.value) : null;
    // H36: the model the answer named, else 'not reported'. Kept on the call, so its spend row and run lines can say it.
    const answeredBy = parsed.answeredBy ?? NOT_REPORTED;
    await ventureAction(actionDeps, ctx, level, 'models.result', tx => {
      const current = tx.find('venture-model-call', call.id);
      check(current, 'INVALID_VENTURE_REQUEST', 'This model call record no longer exists.');
      replaceRecord(tx, { ...current, status: failure ? 'failed' : 'completed', usage: parsed.usage, costMicros, outputDigest, error: failure, answeredBy });
      if (metered) settleSpend(tx, spendKey(call.id), spendOutcome(sent, parsed.usage !== null, failure !== null, costMicros));
    });
    if (failure) throw new ChausarError(failure.code, failure.message);
    return { value: value as T, by: 'model', callId: call.id, presetId: spec.id, model: call.model, costMicros: costMicros ?? '0', priceConfirmed: call.priceConfirmed, answeredBy };
  };

  /** Shared start of generate and preview: task checks (the client-data flag first for standing consent), then the tier. */
  const start = (ctx: Context, task: ModelTask<unknown>, standing: boolean) => {
    checkTask(task);
    if (standing) check(!task.containsClientData, 'CLIENT_DATA_NEEDS_APPROVAL', MESSAGES.clientDataFlag);
    assertSchemaSafe(task.schema);
    authorize(store, ctx, 'prepare');
    const state = store.read();
    const venture = currentVenture(state);
    const tier = PURPOSE_TIER[task.purpose];
    return { state, tier, route: resolveTier(state, venture?.id ?? null, tier) };
  };

  const newCall = (tx: VentureTx, route: Extract<Route, { kind: 'model' }>, tier: ModelTier, task: ModelTask<unknown>, prepared: Prepared, estimate: string, consent: CallRecord['consent'], table: ModelPriceTable | null): CallRecord => {
    const { connection, spec } = route;
    return {
      ...tx.base('venture-model-call'), purpose: task.purpose, tier, presetId: spec.id, connectionId: connection.id, routeKind: spec.kind,
      model: connection.model, consent, endpoint: connection.endpoint,
      payloadText: prepared.payloadText.slice(0, MAX_STORED_PAYLOAD), payloadDigest: digest(prepared.payloadText),
      payloadTruncated: prepared.payloadText.length > MAX_STORED_PAYLOAD, containsClientData: task.containsClientData,
      status: consent === 'standing' ? 'dispatching' : 'preview', approvedDigest: null, approvedAt: null, approvedBy: null,
      estimatedMaxCostMicros: estimate, priceConfirmed: table?.confirmed ?? true,
      usage: null, costMicros: null, outputDigest: null, error: null, replay: transport.replay === true,
    };
  };

  /**
   * The rate a call is metered at and the price table its cost is worked from: the owner's rate card line, else the
   * preset's list price. A keyed call with neither is refused (SPEND_UNPRICED) and the refusal is written down.
   */
  const priceOf = async (ctx: Context, state: State, route: Extract<Route, { kind: 'model' }>, task: ModelTask<unknown>, prepared: Prepared): Promise<{ rate: SpendRate | null; table: ModelPriceTable | null }> => {
    const payloadDigest = digest(prepared.payloadText);
    const subject = callSpend({ id: `unsent-${payloadDigest.slice(0, 16)}`, purpose: task.purpose, connectionId: route.connection.id, payloadDigest }, route.spec);
    try {
      const rate = meteredRate(state, route.connection.ventureId, route.spec, transport.replay === true, subject);
      return { rate, table: rate ? modelTableOf(rate, subject) : route.spec.priceTable };
    } catch (error) {
      return spendRefused(actionDeps, ctx, error);
    }
  };

  const requireCurrentConnection = (tx: VentureTx, connection: ConnectionRecord): ConnectionRecord => {
    const current = txConnections(tx).find(item => item.id === connection.id);
    check(current && current.status === 'connected', 'NO_MODEL_CONNECTED', MESSAGES.connectionChanged);
    return current;
  };

  const prunePending = (nowMs: number) => {
    for (const [id, item] of pending) if (item.expiresAtMs < nowMs) pending.delete(id);
  };

  return {
    status(ctx: Context): ModelStatusView {
      authorize(store, ctx);
      const state = store.read();
      const venture = currentVenture(state);
      const now = clock();
      const nowMs = now.getTime();
      const month = monthOf(now.toISOString());
      const connections = venture ? listConnections(state, venture.id) : [];
      const calls = venture ? listCalls(state, venture.id).map(call => viewCall(call, nowMs)) : [];
      let spent = 0n;
      let estimate = false;
      for (const call of calls) {
        if (call.costMicros === null || monthOf(call.at) !== month) continue;
        spent += BigInt(call.costMicros);
        if (!call.priceConfirmed) estimate = true;
      }
      const views: ConnectionView[] = newestFirst(connections).map(connection => {
        const spec = presetSpec(connection.presetId);
        return {
          ...structuredClone(connection), verification: spec.verification, verificationNote: spec.verificationNote,
          keyLoaded: spec.needsKey && secrets.has(SECRET(spec.id)), ...usableOf(connection, spec, state),
        };
      });
      const tiers = {} as ModelStatusView['tiers'];
      for (const tier of TIERS) {
        const route = resolveTier(state, venture?.id ?? null, tier);
        tiers[tier] = route.kind === 'template'
          ? { presetId: 'built-in-templates', model: null, usable: true, reason: MESSAGES.templatesServe, verification: 'built-in', verificationNote: null }
          : {
            presetId: route.spec.id, model: route.connection.model, ...usableOf(route.connection, route.spec, state),
            verification: route.spec.verification, verificationNote: route.spec.verificationNote,
          };
      }
      const spentText = String(spent);
      return {
        connections: views,
        tiers,
        spentThisMonthMicros: spentText,
        spentThisMonthDisplay: costDisplay(spentText, !estimate),
        estimate,
        sendPolicy: state.policy.send,
        replay: { active: transport.replay === true, label: transport.replay === true ? 'synthetic recording' : null },
      };
    },

    presets(): ModelPreset[] {
      const live = liveOf(store.read());
      return PRESETS.map(spec => ({ ...structuredClone(spec), ...availabilityOf(spec.id, live) }));
    },

    /**
     * Before a command-line connection: one fresh, full look at the tool (4H1). Refuses on the hosted app, while the
     * Claude Code terms are pending (nothing of it is run then) and without Codex's reviewed profile (PRESET_UNAVAILABLE);
     * when it is not found or did not answer its version check in the real tool's form (CLI_UNAVAILABLE); when its help
     * lacks a flag the route sends, or a real call was refused for one (CLI_FLAGS_UNSUPPORTED, naming the flags); and
     * when its own status command says it is signed out (CLI_UNAVAILABLE). Unknown flags or sign-in do not refuse.
     */
    async checkCli(presetId: ModelPresetId): Promise<void> {
      check(presetId === 'claude-code-cli' || presetId === 'codex-cli', 'INVALID_VENTURE_REQUEST', 'Only the command-line options can be checked on this computer.');
      check(!hosted, 'PRESET_UNAVAILABLE', AVAILABILITY_REASONS.hostedCli);
      const claude = presetId === 'claude-code-cli';
      check(!claude || claudeTermsOpen(claudeTerms), 'PRESET_UNAVAILABLE', AVAILABILITY_REASONS.claudeTerms);
      const missing = claude
        ? 'Claude Code was not found on this computer. Install it and sign in, then try again.'
        : 'Codex was not found on this computer. Check the reviewed Codex install, then try again.';
      if (!claude) check(codex, 'PRESET_UNAVAILABLE', AVAILABILITY_REASONS.codexMissing);
      const finding = await look(claude ? 'claude-code' : 'codex', true);
      check(finding.answered, 'CLI_UNAVAILABLE', missing);
      if (finding.flags === 'mismatch') throw new ChausarError('CLI_FLAGS_UNSUPPORTED', cliSentence(cliFlagsWords(finding.cli, finding.version, finding.missingFlags)));
      if (finding.signedIn === 'no') throw new ChausarError('CLI_UNAVAILABLE', cliSentence(cliSignedOutWords(finding.cli, finding.version)));
    },

    /**
     * The status screen's look: joins one under way, else reuses one started within the last minute, unless fresh
     * ("Check again"), which always starts one when none is under way.
     */
    async inspectCli(cli: DelegateCli, options?: { fresh?: boolean }): Promise<CliFinding> {
      check(cli === 'claude-code' || cli === 'codex', 'INVALID_VENTURE_REQUEST', 'Only Claude Code and Codex can be looked for on this computer.');
      return look(cli, options?.fresh === true);
    },

    async generate<T>(ctx: Context, task: ModelTask<T>): Promise<ModelOutcome<T>> {
      const { state, tier, route } = start(ctx, task, true);
      if (route.kind === 'template') {
        check(typeof task.template === 'function', 'NO_MODEL_CONNECTED', MESSAGES.noModel);
        return { value: task.template(), by: 'template', callId: null, presetId: 'built-in-templates', model: null, costMicros: '0', priceConfirmed: true };
      }
      check(state.policy.send !== 'nothing', 'SEND_DISABLED', MESSAGES.sendDisabled);
      if (route.problem) throw new ChausarError(route.problem.code, route.problem.message);
      const prepared = prepare(route.connection, route.spec, task);
      check(clientDataFindings(prepared.payloadText, state).length === 0, 'CLIENT_DATA_NEEDS_APPROVAL', MESSAGES.clientDataFound);
      const { rate, table } = await priceOf(ctx, state, route, task, prepared);
      const estimate = estimateMaxCostMicros(prepared.payloadText.length, task.maxOutputTokens, table);
      const call = await ventureAction(actionDeps, ctx, 'prepare', 'models.call', tx => {
        sweep(tx);
        check(tx.state.policy.send !== 'nothing', 'SEND_DISABLED', MESSAGES.sendDisabled);
        const connection = requireCurrentConnection(tx, route.connection);
        // The run's own cap (W1 H4): a call that may cost more than its run has left is refused before anything is kept.
        if (task.capLeftMicros !== undefined && BigInt(estimate) > BigInt(task.capLeftMicros)) {
          throw new ChausarError('RUN_CAP_REACHED', `This call could cost up to ${formatMicros(estimate)}, more than the ${formatMicros(task.capLeftMicros)} its run has left under its spend cap, so it was not sent.`);
        }
        checkBudget(txCalls(tx), connection, route.spec, estimate, monthOf(tx.now),tx);
        const record = newCall(tx, route, tier, task, prepared, estimate, 'standing', table);
        // The charge record, in the same commit as the call record: written before anything is sent.
        if (rate) reserveSpend(tx, { ...callSpend(record, route.spec), rate, estimateMicros: estimate });
        return putRecord(tx, record);
      }).catch(error => spendRefused(actionDeps, ctx, error));
      return send(ctx, 'prepare', call, prepared, route.spec, task.validate, table, rate !== null);
    },

    async preview<T>(ctx: Context, task: ModelTask<T>): Promise<ModelPreview | null> {
      const { state, tier, route } = start(ctx, task, false);
      if (route.kind === 'template') return null;
      check(state.policy.send !== 'nothing', 'SEND_DISABLED', MESSAGES.sendDisabled);
      if (route.problem) throw new ChausarError(route.problem.code, route.problem.message);
      const prepared = prepare(route.connection, route.spec, task);
      // Priced now so the preview shows the figure; nothing is held until the owner approves and it is sent.
      const { table } = await priceOf(ctx, state, route, task, prepared);
      const estimate = estimateMaxCostMicros(prepared.payloadText.length, task.maxOutputTokens, table);
      const call = await ventureAction(actionDeps, ctx, 'prepare', 'models.preview', tx => {
        sweep(tx);
        requireCurrentConnection(tx, route.connection);
        return putRecord(tx, newCall(tx, route, tier, task, prepared, estimate, 'approved-preview', table));
      });
      const expiresAtMs = Date.parse(call.at) + PREVIEW_TTL_MS;
      prunePending(clock().getTime());
      pending.set(call.id, { prepared, expiresAtMs });
      return {
        callId: call.id, payloadText: prepared.payloadText, digest: call.payloadDigest, presetId: call.presetId, model: call.model, endpoint: call.endpoint,
        estimatedMaxCostMicros: estimate, estimatedMaxCostDisplay: costDisplay(estimate, call.priceConfirmed, call.routeKind),
        expiresAt: new Date(expiresAtMs).toISOString(),
        // Ink v2 wave 4 (4F2, M7): who pays, named before the owner approves.
        payer: payerWords(call.presetId),
      };
    },

    async runPreview<T>(ctx: Context, callId: string, approvedDigest: string, validate: (raw: unknown) => T, options?: { consent?: 'standing-judge' | 'owner-file-drop'; beforeDispatch?: () => void }): Promise<ModelOutcome<T>> {
      check(isAppChannel(ctx), 'APP_APPROVAL_REQUIRED', MESSAGES.appApproval);
      check(typeof callId === 'string' && typeof approvedDigest === 'string' && typeof validate === 'function', 'INVALID_VENTURE_REQUEST', 'Send the call id, the approved digest and a validator.');
      // The rules judge's call going on its own (delivery/judge-run.ts) is recorded under the business's standing
      // consent, never as the owner's approval of that call. Only a judge call can go that way.
      const standing = options?.consent === 'standing-judge';
      // Ink v2 wave 4 (4J8): a call carrying a file the owner dropped with their own words is sent because they asked
      // with it, recorded as 'owner-file-drop', never as an approval nobody gave. Only those calls go that way.
      const fileDrop = options?.consent === 'owner-file-drop';
      // The claim is the first await: two approvals of one preview send at most once.
      const claimed: { held?: Pending; table?: ModelPriceTable | null; metered?: boolean } = {};
      const call = await ventureAction(actionDeps, ctx, 'approve', 'models.approve', tx => {
        sweep(tx);
        const nowMs = Date.parse(tx.now);
        const current = tx.find('venture-model-call', callId);
        const held = pending.get(callId);
        const stale = new ChausarError('APPROVAL_STALE', MESSAGES.approvalStale);
        if (!current || current.status !== 'preview' || current.approvedDigest !== null || current.payloadDigest !== approvedDigest || !held) throw stale;
        if (nowMs > Date.parse(current.at) + PREVIEW_TTL_MS) throw stale;
        check(!standing || current.purpose === 'judge', 'INVALID_VENTURE_REQUEST', 'Only the judge goes on standing consent.');
        check(!fileDrop || (FILE_DROP_PURPOSES.has(current.purpose) && current.containsClientData), 'INVALID_VENTURE_REQUEST', 'Only a call that carries a file the owner dropped goes that way.');
        if (standing) {
          // Read again in the commit that claims the call: the judge setting must still be on with its consent.
          const setting = listRecords(tx.state, 'venture-judge-setting', current.ventureId).at(-1);
          check(setting && setting.auto && setting.consent, 'POLICY_DENIED', 'The judge setting is off, or its standing consent is not recorded, so nothing went on its own.');
        }
        const spec = presetSpec(current.presetId);
        const connection = current.connectionId ? txConnections(tx).find(item => item.id === current.connectionId) : undefined;
        if (!connection || connection.status !== 'connected' || connection.presetId !== current.presetId || connection.model !== current.model
          || connection.endpoint !== current.endpoint || connection.consentDigest !== spec.consentDigest) throw stale;
        // Ink v2 wave 4 (4F2, M7): the key that pays is the one the preview named. When another key now does this work
        // (a newer connection took it over), the approval is stale, so the owner reads a new preview naming who pays.
        const routed = resolveTier(tx.state, current.ventureId, current.tier);
        if (routed.kind !== 'model' || routed.connection.id !== connection.id) throw stale;
        check(tx.state.policy.send !== 'nothing', 'SEND_DISABLED', MESSAGES.sendDisabled);
        const problem = problemOf(spec);
        if (problem) throw new ChausarError(problem.code, problem.message);
        checkBudget(txCalls(tx), connection, spec, current.estimatedMaxCostMicros, monthOf(tx.now),tx);
        // Ink v2 wave 4 (4F2, H32): a call that writes a client draft is held to today's cap on drafts, read in this claim.
        if (current.purpose === 'delivery' && tx.venture) {
          const capped = writeCapDenial(tx.state, tx.venture, 'drafts', tx.now);
          if (capped) throw new ChausarError(capped.code, capped.reason);
        }
        // The charge record is written at approval, in the same commit that lets the one send go.
        const subject = callSpend(current, spec);
        const rate = meteredRate(tx.state, current.ventureId, spec, transport.replay === true, subject);
        claimed.table = rate ? modelTableOf(rate, subject) : spec.priceTable;
        claimed.metered = rate !== null;
        if (rate) reserveSpend(tx, { ...subject, rate, estimateMicros: current.estimatedMaxCostMicros });
        const approved = replaceRecord(tx, {
          ...current, status: 'dispatching' as const, approvedDigest, approvedAt: tx.now,
          approvedBy: standing || fileDrop ? null : ctx.memberId, ...(fileDrop ? { approvedAt: null } : {}),
          consent: standing ? 'standing-judge' as const : fileDrop ? 'owner-file-drop' as const : 'approved-preview' as const,
        });
        pending.delete(callId);
        claimed.held = held;
        return approved;
      }).catch(error => spendRefused(actionDeps, ctx, error));
      check(claimed.held, 'APPROVAL_STALE', MESSAGES.approvalStale);
      return send(ctx, 'approve', call, claimed.held.prepared, presetSpec(call.presetId), validate, claimed.table ?? null, claimed.metered === true, options?.beforeDispatch);
    },
  };
}
