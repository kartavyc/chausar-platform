import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ChausarError, authorize, audit, check, newId, now } from './contracts.ts';
import type { Context, State, StateStore } from './contracts.ts';
import { canonical, current, digest, sourceAccess } from './actions.ts';
import { assertSourceAccess } from './trust.ts';
import { runOutboundChecks } from './gateway.ts';

export type PluginManifest = { id: string; name: string; version: string; runtime: 'wasm'; entrypoint: 'run'; capabilities: string[]; sourceIds: string[]; maxMemoryPages: number; timeoutMs: number };
export type HostFunction = { description: string; sourceIds?: string[]; value: (context: Context, state: State) => number; bound?: boolean };
/** Bounded bytes a trusted caller may place in the module's linear memory for one run (`alloc(len)` then `run(ptr, len)`). */
export const RUN_INPUT_LIMIT = 256 * 1024;
const unbound = (): number => { check(false, 'HOST_VALUE_NOT_BOUND', 'This door is answered only by a trusted caller that checked the owner\u2019s grant for this exact plugin.'); return 0; };
/**
 * Doors whose value the core never computes. A trusted caller (the models-ext plugin part) checks the owner's
 * per-plugin grant, does the work as the calling member through the ordinary engine path, and binds one number
 * for one run. A direct `plugins.run` without that binding is refused.
 */
export const BOUND_HOST_FUNCTIONS: Readonly<Record<string, HostFunction>> = Object.freeze({
  calculate: { description: 'One number from a published calculation the owner granted, run as the calling member. The receipt stays with Chausar.', value: unbound, bound: true },
  read_published: { description: 'One shape-only count from the published dictionary or records the caller may see. Never a raw value.', value: unbound, bound: true },
  prepare_action: { description: 'Whether the owner-granted action may be prepared after this run. Prepare only: never approve, never execute.', value: unbound, bound: true },
});
export type Plugin = { id: string; manifest: PluginManifest; moduleBase64: string; moduleDigest: string; digest: string; status: 'disabled' | 'enabled'; installedAt: string; installedBy: string; approval?: { memberId: string; role: Context['role']; epoch: number; digest: string }; runs: { id: string; at: string; result?: number; memoryPages?: number; outcome: 'success' | 'refused'; reason?: string }[] };
export type MiniappSpec = { title: string; cards: ({ kind: 'metric'; title: string; receiptId: string } | { kind: 'table'; title: string; receiptIds: string[] } | { kind: 'action'; title: string; actionId: string })[] };

export function validateManifest(input: unknown): PluginManifest {
  check(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_MANIFEST', 'Provide a plugin manifest.');
  const keys = ['id', 'name', 'version', 'runtime', 'entrypoint', 'capabilities', 'sourceIds', 'maxMemoryPages', 'timeoutMs'];
  check(Object.keys(input).every(k => keys.includes(k)), 'INVALID_MANIFEST', 'Unknown manifest permissions are refused.');
  const m = input as any; check(m.runtime === 'wasm', 'UNSUPPORTED_PLUGIN_RUNTIME', 'Plugins execute WebAssembly. JavaScript, vm and vm2 plugins are refused.');
  check(m.entrypoint === 'run' && /^[a-z][a-z0-9-]{0,63}$/.test(m.id), 'INVALID_MANIFEST', 'Use a safe ID and the run export.');
  check(typeof m.name === 'string' && m.name.length > 0 && m.name.length <= 100 && /^\d+\.\d+\.\d+$/.test(m.version), 'INVALID_MANIFEST', 'Set a name and semantic version.');
  check(Array.isArray(m.capabilities) && m.capabilities.length <= 16 && m.capabilities.every((c: unknown) => typeof c === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(c)), 'INVALID_MANIFEST', 'Capabilities are explicitly named host imports.');
  check(Array.isArray(m.sourceIds) && m.sourceIds.length <= 32 && m.sourceIds.every((s: unknown) => typeof s === 'string' && s.length > 0 && s.length <= 200), 'INVALID_MANIFEST', 'Source permissions must be explicit.');
  check(Number.isInteger(m.maxMemoryPages) && m.maxMemoryPages > 0 && m.maxMemoryPages <= 256, 'INVALID_MANIFEST', 'Set a memory limit of 1–256 WASM pages (64 KiB each).');
  check(Number.isInteger(m.timeoutMs) && m.timeoutMs >= 50 && m.timeoutMs <= 5000, 'INVALID_MANIFEST', 'Set a deadline of 50–5000 ms.');
  return { id: m.id, name: m.name, version: m.version, runtime: 'wasm', entrypoint: 'run', capabilities: [...new Set<string>(m.capabilities)].sort(), sourceIds: [...new Set<string>(m.sourceIds)].sort(), maxMemoryPages: m.maxMemoryPages, timeoutMs: m.timeoutMs };
}

/** Inspect imports and memory bounds before handing bytes to the native compiler in a child. */
export function inspectWasm(bytes: Uint8Array, memoryLimit: number): { imports: string[] } {
  check(bytes.length >= 8 && bytes.length <= 1024 * 1024 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])), 'INVALID_WASM', 'Use a WASM 1 binary no larger than 1 MiB.');
  let offset = 8; const imports: string[] = []; const seen = new Set<number>();
  const uint = (end: number) => { let value = 0; let shift = 0; for (let i = 0; i < 5; i += 1) { check(offset < end, 'INVALID_WASM', 'Truncated WASM integer.'); const byte = bytes[offset++]; check(i < 4 || (byte & 0xf0) === 0, 'INVALID_WASM', 'Invalid WASM integer.'); value += (byte & 0x7f) * 2 ** shift; if (!(byte & 0x80)) return value; shift += 7; } throw new Error('Invalid WASM integer.'); };
  const name = (end: number) => { const length = uint(end); check(offset + length <= end && length <= 200, 'INVALID_WASM', 'Invalid WASM import name.'); const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + length)); offset += length; return value; };
  const limits = (end: number, maximum: number, required: boolean) => {
    check(offset < end, 'INVALID_WASM', 'Truncated WASM memory limits.'); const flags = bytes[offset++]; check(flags === 0 || flags === 1, 'UNSUPPORTED_WASM', 'Shared memories and memory64 are not supported.');
    const minimum = uint(end); const maximumValue = flags === 1 ? uint(end) : undefined;
    check(!required || maximumValue !== undefined, 'UNBOUNDED_MEMORY', 'Every WASM memory must declare a maximum.');
    check(minimum <= maximum && (maximumValue === undefined || (maximumValue >= minimum && maximumValue <= maximum)), 'MEMORY_LIMIT', 'The module exceeds its declared memory/table limit.');
  };
  while (offset < bytes.length) {
    const section = bytes[offset++]; const length = uint(bytes.length); const end = offset + length; check(end <= bytes.length && section <= 12, 'INVALID_WASM', 'Invalid WASM section.');
    if (section !== 0) { check(!seen.has(section), 'INVALID_WASM', 'Duplicate WASM section.'); seen.add(section); }
    if (section === 2) {
      const count = uint(end); check(count <= 16, 'IMPORT_LIMIT', 'Too many host imports.');
      for (let i = 0; i < count; i += 1) { const module = name(end); const field = name(end); check(offset < end, 'INVALID_WASM', 'Truncated import.'); const kind = bytes[offset++]; check(module === 'chausar' && kind === 0, 'UNSUPPORTED_IMPORT', 'Only explicitly approved chausar function imports are supported. WASI, memory and network imports are refused.'); uint(end); imports.push(field); }
      check(offset === end, 'INVALID_WASM', 'Invalid import section.');
    } else if (section === 4) {
      const count = uint(end); check(count <= 1, 'TABLE_LIMIT', 'At most one bounded function table is supported.');
      for (let i = 0; i < count; i += 1) { check(bytes[offset++] === 0x70, 'UNSUPPORTED_WASM', 'Only function reference tables are supported.'); limits(end, 65536, true); }
      check(offset === end, 'INVALID_WASM', 'Invalid table section.');
    } else if (section === 5) {
      const count = uint(end); check(count <= 1, 'MEMORY_LIMIT', 'At most one bounded memory is supported.');
      for (let i = 0; i < count; i += 1) limits(end, memoryLimit, true);
      check(offset === end, 'INVALID_WASM', 'Invalid memory section.');
    }
    offset = end;
  }
  return { imports };
}

const RUN_FAILURES = ['PLUGIN_TIMEOUT', 'PLUGIN_OUTPUT_LIMIT'];
function isolatedWasm(moduleBase64: string, manifest: PluginManifest, values: Record<string, number>, input?: string): Promise<{ result: number; memoryPages: number }> {
  const worker = fileURLToPath(new URL('./wasm-worker.mjs', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--permission', `--allow-fs-read=${worker}`, '--max-old-space-size=32', worker], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ELECTRON_RUN_AS_NODE: '1', SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' } });
    let output = ''; let done = false;
    const finish = (error?: Error, value?: { result: number; memoryPages: number }) => { if (done) return; done = true; clearTimeout(timer); if (error) { child.kill(); reject(error); } else resolve(value!); };
    const timer = setTimeout(() => finish(new Error('PLUGIN_TIMEOUT')), manifest.timeoutMs);
    child.on('error', error => finish(error));
    child.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 4096) finish(new Error('PLUGIN_OUTPUT_LIMIT')); });
    // stderr is drained and dropped: it can carry plugin-chosen text (function names in stack traces).
    child.stderr.on('data', () => undefined);
    child.on('close', code => { if (done) return; try { check(code === 0, 'PLUGIN_FAILED', 'The isolated plugin failed.'); const result = JSON.parse(output); check(Number.isFinite(result.result) && Number.isInteger(result.memoryPages) && result.memoryPages <= manifest.maxMemoryPages, 'INVALID_PLUGIN_RESULT', 'The plugin returned an invalid number or exceeded memory.'); finish(undefined, result); } catch (error) { finish(error as Error); } });
    child.stdin.on('error', error => finish(error)); child.stdin.end(JSON.stringify({ moduleBase64, values, maxMemoryPages: manifest.maxMemoryPages, ...(input === undefined ? {} : { input }) }));
  });
}

export class PluginService {
  store: StateStore; hostFunctions: Record<string, HostFunction>;
  constructor(store: StateStore, hostFunctions: Record<string, HostFunction> = {}) { this.store = store; this.hostFunctions = { ...BOUND_HOST_FUNCTIONS, ...hostFunctions }; }
  find(state: State, id: string): Plugin { const plugin = state.plugins.find(p => p.id === id); check(plugin, 'NOT_FOUND', 'Plugin not found.'); return plugin; }
  identity(plugin: Plugin) { return digest({ manifest: plugin.manifest, moduleDigest: plugin.moduleDigest }); }
  list(context: Context): Omit<Plugin, 'moduleBase64'>[] { authorize(this.store, context); return this.store.read().plugins.filter(p => { try { sourceAccess(this.store.read(), context, p.manifest.sourceIds); return true; } catch { return false; } }).map(({ moduleBase64, ...plugin }) => structuredClone(plugin)); }
  async install(context: Context, input: { manifest: unknown; moduleBase64: string }): Promise<Omit<Plugin, 'moduleBase64'>> {
    const manifest = validateManifest(input.manifest);
    check(typeof input.moduleBase64 === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(input.moduleBase64) && input.moduleBase64.length <= 1398104, 'INVALID_WASM', 'Use a base64 WASM binary.');
    const bytes = Buffer.from(input.moduleBase64, 'base64'); const inspected = inspectWasm(bytes, manifest.maxMemoryPages);
    check(canonical([...new Set(inspected.imports)].sort()) === canonical(manifest.capabilities), 'CAPABILITY_MISMATCH', 'Every imported function must be named in the exact manifest permissions.');
    for (const capability of manifest.capabilities) { const host = this.hostFunctions[capability]; check(host, 'UNSUPPORTED_CAPABILITY', `Host function ${capability} is not registered.`); check((host.sourceIds ?? []).every(s => manifest.sourceIds.includes(s)), 'CAPABILITY_MISMATCH', 'The manifest omits a host function’s source permission.'); }
    return this.store.update(state => {
      current(state, context, 'admin'); check(!context.sourceTainted, 'TAINTED_PLUGIN', 'Imported text cannot install a plugin.'); sourceAccess(state, context, manifest.sourceIds);
      check(!state.plugins.some(p => p.manifest.id === manifest.id), 'PLUGIN_EXISTS', 'Uninstall this plugin before installing a different module.');
      const plugin: Plugin = { id: newId('plugin'), manifest, moduleBase64: bytes.toString('base64'), moduleDigest: digest(bytes.toString('base64')), digest: '', status: 'disabled', installedAt: now(), installedBy: context.memberId, runs: [] }; plugin.digest = this.identity(plugin); state.plugins.push(plugin); audit(state, 'plugin.installed', { pluginId: plugin.id, moduleDigest: plugin.moduleDigest, capabilities: manifest.capabilities }); const { moduleBase64, ...preview } = plugin; return structuredClone(preview);
    });
  }
  async enable(context: Context, id: string, expectedDigest: string) { return this.store.update(state => { current(state, context, 'admin'); check(!context.sourceTainted && context.channel !== 'phone', 'APP_APPROVAL_REQUIRED', 'Plugin permissions must be approved inside the app.'); const plugin = this.find(state, id); sourceAccess(state, context, plugin.manifest.sourceIds); check(expectedDigest === plugin.digest && plugin.digest === this.identity(plugin) && plugin.moduleDigest === digest(plugin.moduleBase64), 'PREVIEW_CHANGED', 'The plugin or its permissions changed.'); plugin.status = 'enabled'; plugin.approval = { memberId: context.memberId, role: context.role, epoch: context.epoch, digest: expectedDigest }; audit(state, 'plugin.enabled', { pluginId: id, digest: expectedDigest }); const { moduleBase64, ...result } = plugin; return structuredClone(result); }); }
  async disable(context: Context, id: string) { return this.store.update(state => { current(state, context, 'admin'); const plugin = this.find(state, id); plugin.status = 'disabled'; delete plugin.approval; audit(state, 'plugin.disabled', { pluginId: id }); const { moduleBase64, ...result } = plugin; return structuredClone(result); }); }
  async remove(context: Context, id: string) { return this.store.update(state => { current(state, context, 'admin'); this.find(state, id); state.plugins = state.plugins.filter(p => p.id !== id); audit(state, 'plugin.removed', { pluginId: id }); return { removed: true }; }); }
  authorized(state: State, context: Context, plugin: Plugin) {
    current(state, context); sourceAccess(state, context, plugin.manifest.sourceIds); check(plugin.status === 'enabled' && plugin.approval, 'PLUGIN_DISABLED', 'Enable the plugin after reviewing its exact permissions.');
    current(state, { memberId: plugin.approval.memberId, role: plugin.approval.role, epoch: plugin.approval.epoch }, 'admin');
    check(plugin.digest === this.identity(plugin) && plugin.approval.digest === plugin.digest && plugin.moduleDigest === digest(plugin.moduleBase64), 'PREVIEW_CHANGED', 'The approved plugin changed.');
  }
  /** `input` is for trusted in-process callers only; the `plugins.run` engine method passes none. */
  async run(context: Context, id: string, input: { bound?: Readonly<Record<string, number>>; inputBase64?: string } = {}): Promise<{ result: number; memoryPages: number; runId: string }> {
    const plugin = structuredClone(this.find(this.store.read(), id)); this.authorized(this.store.read(), context, plugin);
    check(input.inputBase64 === undefined || (typeof input.inputBase64 === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(input.inputBase64) && Buffer.from(input.inputBase64, 'base64').length <= RUN_INPUT_LIMIT), 'INVALID_PLUGIN_INPUT', 'Run input is bounded base64 bytes.');
    const values: Record<string, number> = {};
    for (const capability of plugin.manifest.capabilities) { const host = this.hostFunctions[capability]; check(host, 'UNSUPPORTED_CAPABILITY', 'Host function no longer registered.'); sourceAccess(this.store.read(), context, host.sourceIds ?? []); values[capability] = host.bound ? (Object.hasOwn(input.bound ?? {}, capability) ? input.bound![capability] : unbound()) : host.value(context, this.store.read()); check(Number.isFinite(values[capability]), 'INVALID_HOST_VALUE', 'Host functions return a finite, scoped scalar.'); }
    let result: { result: number; memoryPages: number };
    try { result = await isolatedWasm(plugin.moduleBase64, plugin.manifest, values, input.inputBase64); }
    catch (failure) {
      // Only a fixed code is kept or forwarded; no message from the child process reaches state or the caller.
      const reason = failure instanceof ChausarError ? failure.code : failure instanceof Error && RUN_FAILURES.includes(failure.message) ? failure.message : 'PLUGIN_FAILED';
      await this.store.update(state => { const installed = state.plugins.find(p => p.id === id); installed?.runs.push({ id: newId('pluginrun'), at: now(), outcome: 'refused', reason }); audit(state, 'plugin.refused', { pluginId: id }); });
      throw failure instanceof ChausarError || reason !== 'PLUGIN_FAILED' ? failure : new ChausarError('PLUGIN_FAILED', 'The isolated plugin failed.');
    }
    return this.store.update(state => { const installed = this.find(state, id); this.authorized(state, context, installed); check(installed.digest === plugin.digest, 'PREVIEW_CHANGED', 'Plugin changed while executing.'); const runId = newId('pluginrun'); installed.runs.push({ id: runId, at: now(), outcome: 'success', ...result }); audit(state, 'plugin.ran', { pluginId: id, runId }); return { ...result, runId }; });
  }
  /** A miniapp is a constrained document. No generated code, HTML, URLs or event handlers execute. */
  miniappDescriptor(context: Context, input: MiniappSpec) {
    const state = this.store.read(); current(state, context);
    check(input && typeof input.title === 'string' && input.title.length > 0 && input.title.length <= 100 && Array.isArray(input.cards) && input.cards.length <= 20 && Object.keys(input).every(k => ['title', 'cards'].includes(k)), 'INVALID_MINIAPP', 'Miniapps use a title and up to twenty data-only cards.');
    const resolveReceipt = (id: string) => {
      const receipt = state.receipts.find(r => r.id === id); check(receipt, 'UNPUBLISHED_DATA', 'Only published calculation receipts can appear in a miniapp.'); check(!receipt.memberId || receipt.memberId === context.memberId, 'RECEIPT_FORBIDDEN', 'The receipt belongs to another scope.');
      check(receipt.epoch === undefined || receipt.epoch === context.epoch, 'RECEIPT_FORBIDDEN', 'The receipt belongs to a previous access epoch.');
      const member = current(state, context); const rows = receipt.rows ?? [];
      assertSourceAccess(state, context, receipt.sourceIds ?? receipt.provenance?.sourceIds ?? [...new Set<string>(rows.map((row: any) => row.sourceId))]);
      check(member.branches.includes('*') || rows.every((row: any) => Boolean(row.branch) && member.branches.includes(row.branch)), 'BRANCH_FORBIDDEN', 'The miniapp contains a receipt from another branch.');
      for (const row of rows) { const fact = state.facts.find(f => f.id === row.factId); check(fact && !fact.deletedAt && !fact.supersededAt && fact.sourceId === row.sourceId, 'STALE_RECEIPT', 'Published receipt contains deleted or superseded data.'); }
      check(receipt.stale !== true && receipt.verified !== false, 'STALE_RECEIPT', 'Only current published receipts can appear in a miniapp.'); return structuredClone(receipt);
    };
    const cards = input.cards.map(card => {
      check(typeof card.title === 'string' && card.title.length <= 100, 'INVALID_MINIAPP', 'Cards need a short title.');
      if (card.kind === 'metric') { check(Object.keys(card).every(k => ['kind', 'title', 'receiptId'].includes(k)), 'INVALID_MINIAPP', 'Generated scripts and URLs are refused.'); return { kind: card.kind, title: card.title, receipt: resolveReceipt(card.receiptId) }; }
      if (card.kind === 'table') { check(Object.keys(card).every(k => ['kind', 'title', 'receiptIds'].includes(k)) && Array.isArray(card.receiptIds) && card.receiptIds.length <= 50, 'INVALID_MINIAPP', 'Tables contain published receipt IDs.'); return { kind: card.kind, title: card.title, receipts: card.receiptIds.map(resolveReceipt) }; }
      check(card.kind === 'action' && Object.keys(card).every(k => ['kind', 'title', 'actionId'].includes(k)), 'INVALID_MINIAPP', 'Unknown miniapp code or card type.');
      const action = state.actions.find(a => a.id === card.actionId); check(action?.status === 'approved' && action.approval?.digest === action.digest, 'UNAPPROVED_ACTION', 'A miniapp can link only to a currently approved action.');
      sourceAccess(state, context, action.sourceIds ?? []); const approver: Context = { memberId: action.approval.memberId, role: action.approval.role, epoch: action.approval.epoch }; current(state, approver, 'approve'); sourceAccess(state, approver, action.sourceIds ?? []);
      check(action.approval.revision === action.revision && action.digest === digest({ connector: action.connector, operation: action.operation, payload: action.payload, sourceIds: action.sourceIds, idempotencyKey: action.idempotencyKey, revision: action.revision }), 'PREVIEW_CHANGED', 'The approved action changed.'); return { kind: card.kind, title: card.title, actionId: action.id, digest: action.digest };
    });
    return { schema: 'chausar.miniapp.v1', title: input.title, cards, iframe: { sandbox: '', allow: '', referrerPolicy: 'no-referrer', csp: "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'" }, executableCode: false };
  }
}

/** core-gateway-auth: the caller of an outbound call that has no person behind it at that point (the allowance route
 *  client is built from the module host alone). It authorizes nothing and counts as touched by outside text, so a
 *  check that looks at the caller can only refuse, never grant. */
export const UNATTRIBUTED_OUTBOUND: Context = Object.freeze({ memberId: 'unattributed-outbound', role: 'viewer', epoch: -1, sourceTainted: true });
export type OutboundCall = { channel: 'plugin' | 'learning' | 'allowance'; receiptId: string; endpoint: string; payload: string };
/**
 * core-gateway-auth: the last check on the exact bytes of a call that leaves this computer outside the model gateway
 * (plugin network requests, the learning upload, the hosted allowance). It runs every registered outbound check, so the
 * trust lane's planted value, and any GSTIN, mail address or phone number from the books, stops the call with
 * CANARY_BLOCKED before anything is sent. Call it outside `store.update` (a check may record the block), after the
 * request is fully built and before any approval is spent or any byte leaves.
 */
export async function guardOutbound(store: StateStore, context: Context, outgoing: OutboundCall): Promise<void> {
  check(outgoing && ['plugin', 'learning', 'allowance'].includes(outgoing.channel) && typeof outgoing.receiptId === 'string' && outgoing.receiptId.length > 0 && outgoing.receiptId.length <= 200
    && typeof outgoing.endpoint === 'string' && outgoing.endpoint.length <= 65536 && typeof outgoing.payload === 'string', 'INVALID_OUTBOUND', 'An outbound check needs the exact call.');
  await runOutboundChecks(store, context, { receiptId: outgoing.receiptId, endpoint: outgoing.endpoint, payload: outgoing.payload });
}
