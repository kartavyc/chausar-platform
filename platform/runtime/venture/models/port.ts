// Chausar venture launcher, package P2 (models): the model port.
// Every call is recorded before it is sent, with the exact text and a cost worked out by code. The workspace
// send setting rules every send. Client data leaves only after one approval of its exact text (preview, then
// runPreview), and the content guard refuses it under standing consent. One dispatch per call: no retry, no
// reroute, no fallback model. No ModelPort method is ever called inside a venture transaction.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorize, ChausarError, check, type Context, type State } from '../../contracts.ts';
import { MODEL_PURPOSES, PURPOSE_TIER, VENTURE_ERRORS } from '../contracts.ts';
import type {
  ModelOutcome, ModelPort, ModelPortOptions, ModelPreset, ModelPresetId, ModelPreview, ModelPurpose, ModelStatusView, ModelTask, ModelTier,
  VentureDeps,
} from '../contracts.ts';
import { MAX_STORED_PAYLOAD, currentVenture, digest, formatMicros, listRecords, ventureAction, type VentureTx } from '../records.ts';
import { ANTHROPIC_URL, anthropicBody, anthropicHeaders, parseAnthropic } from './anthropic.ts';
import {
  SCHEMA_PLACEHOLDER, TEMP_PREFIX, claudePlan, cliEnv, codexCommand, codexHost, codexPlan, parseClaudeCli, parseCodexCli, type CliPlan, type CodexHost,
} from './cli.ts';
import { callCostMicros, costDisplay, estimateMaxCostMicros } from './cost.ts';
import { clientDataFindings } from './guard.ts';
import { OPENAI_URL, openaiBody, openaiHeaders, parseOpenAI } from './openai.ts';
import { AVAILABILITY_REASONS, PRESETS, availabilityOf, presetSpec, type PresetSpec } from './presets.ts';
import { assertSchemaSafe } from './schema.ts';
import {
  HTTP_TIMEOUT_MS, PREVIEW_TTL_MS, PROCESS_TIMEOUT_MS, STALE_DISPATCH_MESSAGE, STALE_DISPATCH_MS, VERSION_CHECK_TIMEOUT_MS, isPlainRecord,
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
const SECRET = (id: ModelPresetId) => `model:${id}` as const;
const monthOf = (iso: string) => iso.slice(0, 7);

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
    if (view !== call) replaceRecord(tx, view);
  }
}

/**
 * This month's spend on the preset, plus what every dispatching call of that preset reserves, plus this
 * estimate, must stay within the connection's monthly limit (months in UTC).
 */
function checkBudget(calls: CallRecord[], connection: ConnectionRecord, spec: PresetSpec, estimate: string, month: string) {
  let total = BigInt(estimate);
  for (const call of calls) {
    if (call.presetId !== connection.presetId) continue;
    if (call.status === 'dispatching') total += BigInt(call.estimatedMaxCostMicros);
    else if (call.costMicros !== null && monthOf(call.at) === month) total += BigInt(call.costMicros);
  }
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
  let input: string | undefined;
  try { input = JSON.stringify(task.input); } catch { input = undefined; }
  if (typeof input !== 'string') throw malformed('input must be plain JSON');
}

function failureOf(error: unknown, fallback: { code: string; message: string }): { code: string; message: string } {
  if (error instanceof ChausarError && (VENTURE_ERRORS as readonly string[]).includes(error.code)) return { code: error.code, message: error.message };
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
  const codex: CodexHost | null = codexHost(options.codexCli);
  const cliFound = new Set<ModelPresetId>();
  const pending = new Map<string, Pending>();

  const problemOf = (spec: PresetSpec): { code: string; message: string } | null => {
    if (spec.needsKey && !secrets.has(SECRET(spec.id))) return { code: 'MODEL_KEY_MISSING', message: MESSAGES.keyMissing };
    if (spec.kind === 'codex-cli' && !codex) return { code: 'PRESET_UNAVAILABLE', message: AVAILABILITY_REASONS.codexMissing };
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
    if (spec.kind === 'claude-cli' && !cliFound.has(spec.id)) return { usable: true, reason: MESSAGES.claudeConnected };
    return { usable: true, reason: availabilityOf(spec.id, { claudeFound: cliFound.has('claude-code-cli'), codexProfile: !!codex }).availabilityReason };
  };

  const prepare = (connection: ConnectionRecord, spec: PresetSpec, task: ModelTask<unknown>): Prepared => {
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
  const dispatch = async (prepared: Prepared, apiKey: string | null, purpose: ModelPurpose): Promise<Parsed> => {
    const transportFailure = { code: 'MODEL_FAILED', message: 'The model call failed. Chausar did not retry it.' };
    if (prepared.transport === 'http') {
      const headers = prepared.routeKind === 'anthropic-messages' ? anthropicHeaders(apiKey ?? '') : openaiHeaders(apiKey ?? '');
      try {
        const response = await transport.http({ url: prepared.url, method: 'POST', headers, body: prepared.body, timeoutMs: HTTP_TIMEOUT_MS, purpose });
        if (!response || typeof response.status !== 'number' || typeof response.body !== 'string') return { ok: false, ...transportFailure, usage: null };
        return prepared.routeKind === 'anthropic-messages' ? parseAnthropic(response) : parseOpenAI(response);
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
      const args = plan.args.map(arg => (arg === SCHEMA_PLACEHOLDER ? schemaPath : arg));
      const response = await transport.process({ command: plan.command, args, env: cliEnv(plan.kind, plan.maxOutputTokens), stdin: plan.stdin, timeoutMs: PROCESS_TIMEOUT_MS, purpose });
      if (!response || typeof response.exitCode !== 'number') return { ok: false, ...transportFailure, usage: null };
      return plan.kind === 'claude-cli' ? parseClaudeCli(response) : parseCodexCli(response);
    } catch (error) {
      return { ok: false, ...failureOf(error, transportFailure), usage: null };
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  };

  /** Steps 8 to 11: dispatch once, parse, validate, then record the result in its own action. */
  const send = async <T>(ctx: Context, level: 'prepare' | 'approve', call: CallRecord, prepared: Prepared, spec: PresetSpec, validate: (raw: unknown) => T): Promise<ModelOutcome<T>> => {
    const apiKey = spec.needsKey ? secrets.get(SECRET(spec.id)) : null;
    const parsed: Parsed = spec.needsKey && !apiKey
      ? { ok: false, code: 'MODEL_KEY_MISSING', message: MESSAGES.keyMissing, usage: null }
      : await dispatch(prepared, apiKey, call.purpose);
    let failure = parsed.ok ? null : { code: parsed.code, message: parsed.message };
    let value: T | undefined;
    if (parsed.ok) {
      try { value = validate(parsed.value); } catch (error) {
        failure = failureOf(error, { code: 'MODEL_OUTPUT_REJECTED', message: "The model answer did not pass Chausar's checks." });
      }
    }
    const table = spec.priceTable;
    const costMicros = parsed.usage ? callCostMicros(parsed.usage, table) : failure ? null : table ? call.estimatedMaxCostMicros : '0';
    const outputDigest = parsed.ok ? digest(parsed.value) : null;
    await ventureAction(actionDeps, ctx, level, 'models.result', tx => {
      const current = tx.find('venture-model-call', call.id);
      check(current, 'INVALID_VENTURE_REQUEST', 'This model call record no longer exists.');
      replaceRecord(tx, { ...current, status: failure ? 'failed' : 'completed', usage: parsed.usage, costMicros, outputDigest, error: failure });
    });
    if (failure) throw new ChausarError(failure.code, failure.message);
    return { value: value as T, by: 'model', callId: call.id, presetId: spec.id, model: call.model, costMicros: costMicros ?? '0', priceConfirmed: call.priceConfirmed };
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

  const newCall = (tx: VentureTx, route: Extract<Route, { kind: 'model' }>, tier: ModelTier, task: ModelTask<unknown>, prepared: Prepared, estimate: string, consent: CallRecord['consent']): CallRecord => {
    const { connection, spec } = route;
    return {
      ...tx.base('venture-model-call'), purpose: task.purpose, tier, presetId: spec.id, connectionId: connection.id, routeKind: spec.kind,
      model: connection.model, consent, endpoint: connection.endpoint,
      payloadText: prepared.payloadText.slice(0, MAX_STORED_PAYLOAD), payloadDigest: digest(prepared.payloadText),
      payloadTruncated: prepared.payloadText.length > MAX_STORED_PAYLOAD, containsClientData: task.containsClientData,
      status: consent === 'standing' ? 'dispatching' : 'preview', approvedDigest: null, approvedAt: null, approvedBy: null,
      estimatedMaxCostMicros: estimate, priceConfirmed: spec.priceTable?.confirmed ?? true,
      usage: null, costMicros: null, outputDigest: null, error: null, replay: transport.replay === true,
    };
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
        return { ...structuredClone(connection), keyLoaded: spec.needsKey && secrets.has(SECRET(spec.id)), ...usableOf(connection, spec, state) };
      });
      const tiers = {} as ModelStatusView['tiers'];
      for (const tier of TIERS) {
        const route = resolveTier(state, venture?.id ?? null, tier);
        tiers[tier] = route.kind === 'template'
          ? { presetId: 'built-in-templates', model: null, usable: true, reason: MESSAGES.templatesServe }
          : { presetId: route.spec.id, model: route.connection.model, ...usableOf(route.connection, route.spec, state) };
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
      const live = { claudeFound: cliFound.has('claude-code-cli'), codexProfile: !!codex };
      return PRESETS.map(spec => ({ ...structuredClone(spec), ...availabilityOf(spec.id, live) }));
    },

    async checkCli(presetId: ModelPresetId): Promise<void> {
      check(presetId === 'claude-code-cli' || presetId === 'codex-cli', 'INVALID_VENTURE_REQUEST', 'Only the command-line options can be checked on this computer.');
      const claude = presetId === 'claude-code-cli';
      const missing = claude
        ? 'Claude Code was not found on this computer. Install it and sign in, then try again.'
        : 'Codex was not found on this computer. Check the reviewed Codex install, then try again.';
      let command = 'claude';
      if (!claude) {
        check(codex, 'PRESET_UNAVAILABLE', AVAILABILITY_REASONS.codexMissing);
        command = codexCommand(codex);
      }
      let response: { exitCode: number; stdout: string } | undefined;
      try {
        response = await transport.process({ command, args: ['--version'], env: cliEnv(claude ? 'claude-cli' : 'codex-cli'), stdin: '', timeoutMs: VERSION_CHECK_TIMEOUT_MS, purpose: 'version-check' });
      } catch {
        throw new ChausarError('CLI_UNAVAILABLE', missing);
      }
      check(response && response.exitCode === 0 && typeof response.stdout === 'string' && response.stdout.trim().length > 0, 'CLI_UNAVAILABLE', missing);
      cliFound.add(presetId);
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
      const estimate = estimateMaxCostMicros(prepared.payloadText.length, task.maxOutputTokens, route.spec.priceTable);
      const call = await ventureAction(actionDeps, ctx, 'prepare', 'models.call', tx => {
        sweep(tx);
        check(tx.state.policy.send !== 'nothing', 'SEND_DISABLED', MESSAGES.sendDisabled);
        const connection = requireCurrentConnection(tx, route.connection);
        checkBudget(txCalls(tx), connection, route.spec, estimate, monthOf(tx.now));
        return putRecord(tx, newCall(tx, route, tier, task, prepared, estimate, 'standing'));
      });
      return send(ctx, 'prepare', call, prepared, route.spec, task.validate);
    },

    async preview<T>(ctx: Context, task: ModelTask<T>): Promise<ModelPreview | null> {
      const { state, tier, route } = start(ctx, task, false);
      if (route.kind === 'template') return null;
      check(state.policy.send !== 'nothing', 'SEND_DISABLED', MESSAGES.sendDisabled);
      if (route.problem) throw new ChausarError(route.problem.code, route.problem.message);
      const prepared = prepare(route.connection, route.spec, task);
      const estimate = estimateMaxCostMicros(prepared.payloadText.length, task.maxOutputTokens, route.spec.priceTable);
      const call = await ventureAction(actionDeps, ctx, 'prepare', 'models.preview', tx => {
        sweep(tx);
        requireCurrentConnection(tx, route.connection);
        return putRecord(tx, newCall(tx, route, tier, task, prepared, estimate, 'approved-preview'));
      });
      const expiresAtMs = Date.parse(call.at) + PREVIEW_TTL_MS;
      prunePending(clock().getTime());
      pending.set(call.id, { prepared, expiresAtMs });
      return {
        callId: call.id, payloadText: prepared.payloadText, digest: call.payloadDigest, presetId: call.presetId, model: call.model, endpoint: call.endpoint,
        estimatedMaxCostMicros: estimate, estimatedMaxCostDisplay: costDisplay(estimate, call.priceConfirmed, call.routeKind),
        expiresAt: new Date(expiresAtMs).toISOString(),
      };
    },

    async runPreview<T>(ctx: Context, callId: string, approvedDigest: string, validate: (raw: unknown) => T): Promise<ModelOutcome<T>> {
      check(ctx?.channel === 'desktop' && !ctx.sourceTainted, 'APP_APPROVAL_REQUIRED', MESSAGES.appApproval);
      check(typeof callId === 'string' && typeof approvedDigest === 'string' && typeof validate === 'function', 'INVALID_VENTURE_REQUEST', 'Send the call id, the approved digest and a validator.');
      // The claim is the first await: two approvals of one preview send at most once.
      const claimed: { held?: Pending } = {};
      const call = await ventureAction(actionDeps, ctx, 'approve', 'models.approve', tx => {
        sweep(tx);
        const nowMs = Date.parse(tx.now);
        const current = tx.find('venture-model-call', callId);
        const held = pending.get(callId);
        const stale = new ChausarError('APPROVAL_STALE', MESSAGES.approvalStale);
        if (!current || current.status !== 'preview' || current.approvedDigest !== null || current.payloadDigest !== approvedDigest || !held) throw stale;
        if (nowMs > Date.parse(current.at) + PREVIEW_TTL_MS) throw stale;
        const spec = presetSpec(current.presetId);
        const connection = current.connectionId ? txConnections(tx).find(item => item.id === current.connectionId) : undefined;
        if (!connection || connection.status !== 'connected' || connection.presetId !== current.presetId || connection.model !== current.model
          || connection.endpoint !== current.endpoint || connection.consentDigest !== spec.consentDigest) throw stale;
        check(tx.state.policy.send !== 'nothing', 'SEND_DISABLED', MESSAGES.sendDisabled);
        const problem = problemOf(spec);
        if (problem) throw new ChausarError(problem.code, problem.message);
        checkBudget(txCalls(tx), connection, spec, current.estimatedMaxCostMicros, monthOf(tx.now));
        const approved = replaceRecord(tx, { ...current, status: 'dispatching' as const, approvedDigest, approvedAt: tx.now, approvedBy: ctx.memberId, consent: 'approved-preview' as const });
        pending.delete(callId);
        claimed.held = held;
        return approved;
      });
      check(claimed.held, 'APPROVAL_STALE', MESSAGES.approvalStale);
      return send(ctx, 'approve', call, claimed.held.prepared, presetSpec(call.presetId), validate);
    },
  };
}
