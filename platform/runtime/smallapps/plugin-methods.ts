/**
 * `smallapps.plugin*`: wrap, inspect, install, grant and run `chausar.plugin.v1` files.
 * Data parts live in the models-ext namespace under `plugins`; WebAssembly parts are installed,
 * enabled and run only through the core PluginService (`plugins.*`), which keeps them in the
 * isolated locked box: no sockets, no files, no keys. Declared network requests are made by
 * Chausar itself (plugin-network.ts), and doors are answered host-side (plugin-host.ts).
 */
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { ChausarError, audit, check, newId, now } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import { canonical, current, digest } from '../actions.ts';
import { moduleState, peekModuleState } from '../modules/types.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { MODULE_ID } from '../models-ext/part.ts';
import type { ModulePart } from '../models-ext/part.ts';
import { RUN_INPUT_LIMIT } from '../plugins.ts';
import { guardOutbound } from '../plugins.ts'; // core-gateway-auth: canary
import type { HostFunction, PluginManifest } from '../plugins.ts';
import { contentFindings, documentDigest, keyIdOf, parseDocument, publicKeyObject, rawPublicKey, reviewDocument, runnable, signDocument, untrusted } from './plugin-format.ts';
import type { DataEntry, Doors, PluginDocument, SkillEntry, ToolEntry, TrustedKey } from './plugin-format.ts';
import { buildDocument, wrapAgentSkill, wrapMcpServer } from './plugin-wrap.ts';
import { schemaProblems, stripAnnotations, takesArguments, validateArguments } from './plugin-schema.ts';
import { NETWORK_LIMITS, credentialFor, fetchTransport, performRequest, requestUrl } from './plugin-network.ts';
import type { CredentialBroker, Fetched, LedgerEntry, RequestSpec, Transport } from './plugin-network.ts';
import { bindDoors, checkRecipe, liveGrant, notChecked, prepareGranted, validateCodeGrant } from './plugin-host.ts';
import type { CodeGrant, Grant, HostInput, RecipeVerdict } from './plugin-host.ts';

type InstalledCode = { codeId: string; corePluginId: string; digest: string; moduleDigest: string };
type Installed = { id: string; digest: string; publisherId: string; name: string; version: string; description: string; signature: { status: string; keyId: string | null; origin: string | null }; unverifiedAccepted: boolean; support: 'supported' | 'experimental'; installedAt: string; installedBy: string; skills: SkillEntry[]; tools: ToolEntry[]; data: DataEntry[]; code: InstalledCode[]; doors: Doors; recipeChecks?: Record<string, RecipeVerdict> };
type PluginsState = { trustedKeys: TrustedKey[]; blocked: { keyIds: string[]; digests: string[] }; installed: Installed[]; grants?: Record<string, Grant>; ledger?: LedgerEntry[]; remote?: RemoteState };
type CorePlugin = { id: string; digest: string; status: 'disabled' | 'enabled'; manifest: PluginManifest };

const empty = (): PluginsState => ({ trustedKeys: [], blocked: { keyIds: [], digests: [] }, installed: [] });
function writable(state: Parameters<typeof moduleState>[0]): PluginsState { const ns = moduleState<Record<string, any>>(state, MODULE_ID, () => ({})); return (ns.plugins ??= empty()) as PluginsState; }
const peek = (state: State): PluginsState | undefined => peekModuleState<Record<string, any>>(state, MODULE_ID)?.plugins;
const readable = (host: ModuleHost): PluginsState => structuredClone(peek(host.store.read()) ?? empty());

function fields(payload: Record<string, any>, allowed: string[], required: string[] = []) {
  check(Object.keys(payload).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(payload, key)), 'INVALID_PLUGIN_REQUEST', 'The request has missing or unknown fields.');
}
function appOnly(ctx: Context) {
  check(!ctx.sourceTainted, 'PLUGIN_TAINTED_CONTEXT', 'A request that has read outside text cannot change plugins.');
  check(ctx.channel === 'desktop', 'PLUGIN_APP_ONLY', 'Review and change plugins inside the desktop app.');
}
const hostFunctions = (host: ModuleHost): Readonly<Record<string, HostFunction>> => host.services.plugins?.hostFunctions ?? {};

function hostKeys(host: ModuleHost): TrustedKey[] {
  const keys = host.options.publisherKeys ?? [];
  check(Array.isArray(keys) && keys.length <= 32, 'PLUGIN_HOST_OPTIONS_INVALID', 'Trusted publisher keys are a short list.');
  return keys.map(key => {
    check(key && typeof key === 'object' && typeof key.publisherId === 'string' && typeof key.publicKey === 'string', 'PLUGIN_HOST_OPTIONS_INVALID', 'Each trusted key names its publisher and public key.');
    publicKeyObject(key.publicKey); return { keyId: keyIdOf(key.publicKey), publisherId: key.publisherId, publicKey: key.publicKey, origin: 'host' as const };
  });
}
const allKeys = (host: ModuleHost, ns: PluginsState) => [...hostKeys(host), ...ns.trustedKeys];
const review = (host: ModuleHost, ns: PluginsState, doc: PluginDocument) => reviewDocument(doc, { hostFunctions: hostFunctions(host), keys: allKeys(host, ns), blocked: ns.blocked });

const IDENTIFIER = /^[a-z0-9][a-z0-9.-]{0,99}$/;
function wrap(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  check(payload.kind === 'agentSkill' || payload.kind === 'mcpServer', 'INVALID_PLUGIN_REQUEST', 'Wrap an agentSkill or an mcpServer.');
  if (payload.kind === 'agentSkill') fields(payload, ['kind', 'publisherId', 'name', 'version', 'description', 'skillMd', 'files', 'sign'], ['kind', 'publisherId', 'version', 'skillMd']);
  else fields(payload, ['kind', 'publisherId', 'name', 'version', 'description', 'toolsList', 'serverInfo', 'code', 'requests', 'sign'], ['kind', 'publisherId', 'name', 'version', 'toolsList']);
  check(typeof payload.publisherId === 'string' && IDENTIFIER.test(payload.publisherId), 'INVALID_PLUGIN_REQUEST', 'Use a lowercase publisher id.');
  check(payload.sign === undefined || typeof payload.sign === 'boolean', 'INVALID_PLUGIN_REQUEST', 'Sign is true or false.');
  check(payload.description === undefined || (typeof payload.description === 'string' && payload.description.length <= 1024), 'INVALID_PLUGIN_REQUEST', 'Keep the description short.');
  let doc: PluginDocument; let refused; let ignoredFields: string[] = [];
  if (payload.kind === 'agentSkill') {
    const wrapped = wrapAgentSkill(payload.skillMd, payload.files ?? {}); refused = wrapped.refused; ignoredFields = wrapped.ignoredFields;
    doc = buildDocument({ publisherId: payload.publisherId, name: payload.name ?? wrapped.skill.name, version: payload.version, description: payload.description ?? wrapped.skill.description, skills: [wrapped.skill] });
  } else {
    const wrapped = wrapMcpServer(payload.toolsList, { serverInfo: payload.serverInfo, code: payload.code, requests: payload.requests }); refused = wrapped.refused;
    doc = buildDocument({ publisherId: payload.publisherId, name: payload.name, version: payload.version, description: payload.description ?? '', tools: wrapped.tools, code: wrapped.code, sites: wrapped.sites });
  }
  doc = parseDocument(doc);
  if (payload.sign === true) {
    // Signing with this app's key makes a file that installs as verified, so only the owner may do it, in the app, untainted.
    appOnly(ctx); current(host.store.read(), ctx, 'admin');
    check(ctx.role === 'owner', 'PLUGIN_OWNER_REQUIRED', 'Only an owner can sign a plugin with this app’s key.');
    const signing = host.options.pluginSigningKey as { publisherId?: unknown; privateKeyPem?: unknown } | undefined;
    check(signing && typeof signing.privateKeyPem === 'string' && signing.publisherId === doc.publisher.id, 'PLUGIN_SIGNING_KEY_REQUIRED', 'Signing needs the publisher key, which this app does not hold.');
    doc = signDocument(doc, signing.privateKeyPem);
  }
  return { document: doc, digest: documentDigest(doc), signed: !!doc.signature, refused, ignoredFields, review: review(host, readable(host), doc) };
}

async function install(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  fields(payload, ['document', 'acceptUnverifiedPublisher'], ['document']); appOnly(ctx);
  check(payload.acceptUnverifiedPublisher === undefined || typeof payload.acceptUnverifiedPublisher === 'boolean', 'INVALID_PLUGIN_REQUEST', 'Accepting an unverified publisher is true or false.');
  const doc = parseDocument(payload.document); const ns = readable(host); const reviewed = review(host, ns, doc);
  check(!reviewed.blocked, 'PLUGIN_BLOCKED', 'This plugin or its publisher key is blocked.');
  check(reviewed.signature.status !== 'invalid', 'PLUGIN_SIGNATURE_INVALID', 'The signature does not match the file.');
  if (reviewed.signature.status !== 'verified') {
    check(payload.acceptUnverifiedPublisher === true, reviewed.signature.status === 'unsigned' ? 'PLUGIN_UNSIGNED' : 'PLUGIN_UNKNOWN_KEY', reviewed.signature.status === 'unsigned' ? 'The plugin is not signed. Only an owner can accept an unverified publisher.' : 'The publisher key is not trusted. Only an owner can accept an unverified publisher.');
    check(ctx.role === 'owner', 'PLUGIN_OWNER_REQUIRED', 'Only an owner can accept an unverified publisher.');
  }
  const dev = devKeyId(host);
  if (dev !== null && reviewed.signature.keyId === dev) check(ctx.role === 'owner', 'PLUGIN_OWNER_REQUIRED', 'Only an owner can install a plugin signed with this app’s own key.');
  check(reviewed.refusals.length === 0, reviewed.refusals[0]?.code ?? 'PLUGIN_REFUSED', 'The plugin failed a check. Inspect it to see why.');
  check(!ns.installed.some(item => item.publisherId === doc.publisher.id && item.name === doc.name), 'PLUGIN_ALREADY_INSTALLED', 'Remove the installed plugin before installing another version.');
  const { manifests } = contentFindings(doc, hostFunctions(host));
  const installedCode: InstalledCode[] = [];
  const rollback = async () => { for (const code of installedCode) await host.call('plugins.remove', { id: code.corePluginId }).catch(() => undefined); };
  try {
    for (const entry of doc.contents.code) {
      const manifest = manifests.get((entry.manifest as PluginManifest).id)!;
      const core = await host.call('plugins.install', { manifest, moduleBase64: entry.moduleBase64 }) as { id: string; digest: string; moduleDigest: string };
      installedCode.push({ codeId: manifest.id, corePluginId: core.id, digest: core.digest, moduleDigest: core.moduleDigest });
    }
    return await host.store.update(state => {
      const mine = writable(state);
      check(!mine.blocked.digests.includes(reviewed.digest) && !(reviewed.signature.keyId && mine.blocked.keyIds.includes(reviewed.signature.keyId)), 'PLUGIN_BLOCKED', 'This plugin or its publisher key is blocked.');
      check(!mine.installed.some(item => item.publisherId === doc.publisher.id && item.name === doc.name), 'PLUGIN_ALREADY_INSTALLED', 'Remove the installed plugin before installing another version.');
      const record: Installed = { id: newId('xplugin'), digest: reviewed.digest, publisherId: doc.publisher.id, name: doc.name, version: doc.version, description: doc.description, signature: { status: reviewed.signature.status, keyId: reviewed.signature.keyId, origin: reviewed.signature.origin }, unverifiedAccepted: reviewed.signature.status !== 'verified', support: reviewed.support, installedAt: now(), installedBy: ctx.memberId, skills: doc.contents.skills, tools: doc.contents.tools, data: doc.contents.data, code: installedCode, doors: doc.doors,
        recipeChecks: Object.fromEntries(doc.contents.data.filter(entry => entry.kind === 'recipe').map(entry => [entry.name, notChecked(entry.digest)])) };
      mine.installed.push(record);
      audit(state, 'smallapps.plugin.installed', { pluginId: record.id, digest: record.digest, signature: record.signature.status, code: installedCode.map(code => code.corePluginId) });
      return { id: record.id, digest: record.digest, support: record.support, signature: record.signature, code: installedCode.map(code => ({ ...code, status: 'disabled', enableWith: { method: 'plugins.enable', id: code.corePluginId, digest: code.digest } })) };
    });
  } catch (error) { await rollback(); throw error; }
}

function grantSummary(ns: PluginsState, item: Installed) {
  const grant = ns.grants?.[item.id];
  return grant ? { sites: grant.sites, code: grant.code, grantedBy: grant.grantedBy.memberId, grantedAt: grant.grantedAt, current: grant.digest === item.digest } : null;
}
function summary(item: Installed, ns: PluginsState) {
  return { id: item.id, name: item.name, publisherId: item.publisherId, version: item.version, digest: item.digest, signature: item.signature, unverifiedAccepted: item.unverifiedAccepted, support: item.support, installedAt: item.installedAt, contains: { skills: item.skills.length, tools: item.tools.length, data: item.data.length, code: item.code.length }, code: item.code, doors: { ...item.doors, sourceIds: item.doors.sourceIds.map(id => untrusted(id)) }, grant: grantSummary(ns, item) };
}
const findInstalled = (ns: PluginsState, id: unknown) => { check(typeof id === 'string', 'INVALID_PLUGIN_REQUEST', 'Name the plugin.'); const item = ns.installed.find(entry => entry.id === id); check(item, 'PLUGIN_NOT_FOUND', 'That plugin is not installed.'); return item; };

function transport(host: ModuleHost): Transport {
  const injected = host.options.pluginTransport;
  check(injected === undefined || typeof injected === 'function', 'PLUGIN_HOST_OPTIONS_INVALID', 'The plugin transport is a function.');
  return (injected as Transport | undefined) ?? fetchTransport;
}
function credentials(host: ModuleHost): CredentialBroker | null {
  const broker = host.options.pluginCredentials;
  check(broker === undefined || typeof broker === 'function', 'PLUGIN_HOST_OPTIONS_INVALID', 'The plugin credential broker is a function.');
  return (broker as CredentialBroker | undefined) ?? null;
}
/** Milliseconds now: a trusted host clock when one is given (tests, fixtures), else the system clock. */
function clockMs(host: ModuleHost): number {
  const clock = host.options.clock; if (clock === undefined) return Date.now();
  check(typeof clock === 'function', 'PLUGIN_HOST_OPTIONS_INVALID', 'The configured clock is not usable.');
  const value = clock(); const ms = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : value;
  check(typeof ms === 'number' && Number.isFinite(ms), 'PLUGIN_HOST_OPTIONS_INVALID', 'The configured clock is not usable.');
  return ms;
}
async function appendLedger(host: ModuleHost, entries: LedgerEntry[]) {
  if (!entries.length) return;
  await host.store.update(state => {
    const mine = writable(state); mine.ledger ??= [];
    for (const entry of entries) { mine.ledger.push(entry); audit(state, 'network.request', { ...entry }); }
    mine.ledger.splice(0, Math.max(0, mine.ledger.length - NETWORK_LIMITS.ledger));
  });
}
const isBlocked = (ns: PluginsState, item: Installed) => ns.blocked.digests.includes(item.digest) || (item.signature.keyId !== null && ns.blocked.keyIds.includes(item.signature.keyId));
const notBlocked = (ns: PluginsState, item: Installed) => check(!isBlocked(ns, item), 'PLUGIN_BLOCKED', 'This plugin or its publisher key is blocked.');
/**
 * The key id a credential is bound to: only for a plugin whose signature was verified at install with a key that
 * is still trusted for its publisher. An unsigned or unverified plugin never causes a key to be sent.
 */
function credentialKeyId(host: ModuleHost, ns: PluginsState, item: Installed): string | null {
  const keyId = item.signature.status === 'verified' ? item.signature.keyId : null;
  return keyId && allKeys(host, ns).some(key => key.keyId === keyId && key.publisherId === item.publisherId) && !ns.blocked.keyIds.includes(keyId) ? keyId : null;
}
/** The key id of the development signing key this engine holds, if any. */
function devKeyId(host: ModuleHost): string | null {
  const signing = host.options.pluginSigningKey as { privateKeyPem?: unknown } | undefined;
  if (!signing || typeof signing.privateKeyPem !== 'string') return null;
  try { return keyIdOf(rawPublicKey(createPublicKey(createPrivateKey(signing.privateKeyPem)))); } catch { return null; }
}

/**
 * Product rule: every number shown carries a receipt. A plugin's own number is never presented as a figure. It is
 * returned as a `plugin-signal` only when it exactly equals a calculator figure bound for this run (that receipt is
 * attached), or when it is a whole-number code from 0 to 255 (a status or flag the tool documents). Anything else
 * is refused with PLUGIN_RESULT_UNRECEIPTED.
 */
export const SIGNAL_MAX = 255;
const SIGNAL_NOTE = { en: 'A code from plugin code, not a figure. It has no calculator receipt; read it only as the status or flag the tool documents.', hi: 'प्लगइन कोड से आया एक कोड, कोई आँकड़ा नहीं। इसकी कोई कैलकुलेटर रसीद नहीं; इसे केवल टूल द्वारा बताई गई स्थिति या संकेत की तरह पढ़ें।' };
const FIGURE_NOTE = { en: 'The plugin returned exactly this calculator figure; the receipt is the calculator’s.', hi: 'प्लगइन ने ठीक यही कैलकुलेटर आँकड़ा लौटाया; रसीद कैलकुलेटर की है।' };
export function pluginSignal(result: number, inputs: readonly HostInput[]) {
  const figure = Number.isSafeInteger(result) ? inputs.find((input): input is Extract<HostInput, { capability: 'calculate' }> => input.capability === 'calculate' && BigInt(input.minor) === BigInt(result)) : undefined;
  if (figure) return { kind: 'plugin-signal' as const, value: result, meaning: 'calculator-figure' as const, receipt: { receiptId: figure.receiptId, figure: figure.figure, minor: figure.minor, display: figure.display }, note: FIGURE_NOTE };
  check(Number.isInteger(result) && result >= 0 && result <= SIGNAL_MAX, 'PLUGIN_RESULT_UNRECEIPTED', 'The plugin returned a number with no calculator receipt, so it is not shown.');
  return { kind: 'plugin-signal' as const, value: result, meaning: 'code' as const, receipt: null, note: SIGNAL_NOTE };
}

type ResolvedRun = { item: Installed; tool: ToolEntry; requests: RequestSpec[]; code?: InstalledCode; core?: CorePlugin };
type CodeRun = ResolvedRun & { code: InstalledCode; core: CorePlugin };
/** Shared checks before anything runs or leaves: installed, not blocked, the tool, its schema and its enabled code. */
async function resolveRun(host: ModuleHost, ns: PluginsState, payload: { id?: unknown; tool?: unknown }, remote: boolean): Promise<ResolvedRun> {
  const item = findInstalled(ns, payload.id); notBlocked(ns, item);
  const tool = item.tools.find(entry => entry.name === payload.tool); check(tool, 'PLUGIN_TOOL_NOT_FOUND', 'That plugin has no such tool.');
  const requests = tool.requests ?? [];
  if (remote) check(requests.length > 0, tool.sites.length ? 'PLUGIN_TOOL_REQUESTS_UNDECLARED' : 'PLUGIN_TOOL_NOT_REMOTE', tool.sites.length ? 'This tool needs the internet but declares no request Chausar could make for it.' : 'This tool does not reach the internet. Call it with smallapps.pluginCallTool.');
  else {
    check(tool.sites.length === 0, requests.length ? 'PLUGIN_NETWORK_USE_REMOTE' : 'PLUGIN_TOOL_REQUESTS_UNDECLARED', requests.length ? 'This tool reaches the internet. Prepare it with smallapps.pluginPrepareRemote.' : 'This tool needs the internet but declares no request Chausar could make for it.');
    check(tool.code !== null, 'PLUGIN_TOOL_HAS_NO_CODE', 'This tool is a description only. It has no WebAssembly code to run.');
  }
  check(runnable(tool) && schemaProblems(tool.inputSchema).length === 0, 'PLUGIN_SCHEMA_UNSUPPORTED', 'This tool declares a schema Chausar cannot fully enforce, so it does not run.');
  if (tool.code === null) return { item, tool, requests };
  const code = item.code.find(entry => entry.codeId === tool.code); check(code, 'PLUGIN_CODE_MISSING', 'The code for this tool is not installed.');
  const core = (await host.call('plugins.list', {}) as CorePlugin[]).find(plugin => plugin.id === code.corePluginId);
  check(core, 'PLUGIN_CODE_MISSING', 'The code for this tool is not installed.');
  check(core.digest === code.digest, 'PREVIEW_CHANGED', 'The installed code changed since this plugin was installed.');
  check(core.status === 'enabled', 'PLUGIN_DISABLED', 'Enable the plugin after reviewing its exact permissions.');
  return { item, tool, requests, code, core };
}

type BoundDoors = Awaited<ReturnType<typeof bindDoors>>;
const NO_DOORS: BoundDoors = { bound: {}, inputs: [], prepare: null, dictionary: null };
/** Run the locked box with arguments and (redacted) responses as bytes, then shape its number as a signal. A post-run prepare never approves. */
async function runCode(ctx: Context, host: ModuleHost, run: CodeRun, args: Record<string, unknown>, fetched: Fetched[], doors: BoundDoors) {
  let inputBase64: string | undefined;
  if (takesArguments(run.tool.inputSchema) || run.requests.length) {
    const bytes = Buffer.from(canonical({ arguments: args, responses: fetched.map(f => ({ site: f.site, status: f.status, contentType: f.contentType, body: f.text })), ...(doors.dictionary ? { published: { fields: doors.dictionary } } : {}) }), 'utf8');
    check(bytes.length <= RUN_INPUT_LIMIT, 'PLUGIN_INPUT_TOO_LARGE', 'The arguments and answers together are larger than the locked box accepts.');
    inputBase64 = bytes.toString('base64');
  }
  const result = await host.services.plugins.run(ctx, run.code.corePluginId, { bound: doors.bound, inputBase64 }) as { result: number; memoryPages: number; runId: string };
  const signal = pluginSignal(result.result, doors.inputs);
  const approvalCard = doors.prepare && signal.value !== 0 ? await prepareGranted(host, doors.prepare, result.runId) : null;
  return { codeId: run.code.codeId, corePluginId: run.code.corePluginId, runId: result.runId, memoryPages: result.memoryPages, ...signal, inputs: doors.inputs, approvalCard, inputBytes: inputBase64 === undefined ? 0 : Buffer.from(inputBase64, 'base64').length };
}

/** Run one local tool: validate arguments as data, check the enabled code and the owner's grant for this exact plugin, answer its doors as the caller. */
async function runTool(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  fields(payload, ['id', 'tool', 'arguments'], ['id', 'tool']);
  const ns = readable(host); const run = await resolveRun(host, ns, payload, false) as CodeRun;
  const args = validateArguments(run.tool.inputSchema, payload.arguments ?? {});
  const capabilities = run.core.manifest.capabilities;
  // A grant is keyed by this installed plugin and its exact digest; another plugin's grant never applies.
  const grant = capabilities.length ? liveGrant(host.store.read(), ns.grants?.[run.item.id], run.item.digest) : undefined;
  const doors = await bindDoors(ctx, host, capabilities, grant?.code[run.code.codeId]);
  return { pluginId: run.item.id, tool: run.tool.name, ...await runCode(ctx, host, run, args, [], doors), network: [] };
}

/*
 * Remote tools: prepare → approve exactly this → do once → read back.
 * `smallapps.pluginPrepareRemote` builds the exact requests (URL, method, canonical body and its digest, whether a key
 * will be attached, never its value) and keeps a preview. An owner or cofounder approves exactly that digest in the
 * desktop app (`smallapps.pluginApproveRemote`); the approval is single-use and expires. `smallapps.pluginCallRemote`
 * re-plans from the kept arguments, refuses any difference, consumes the approval before the first byte leaves,
 * performs each request once and records a receipt of digests, sizes and status (no body, no key).
 */
const REMOTE = { previewMs: 15 * 60_000, approvalMs: 5 * 60_000, previews: 100, receipts: 1000 };
type RemoteRequest = { site: string; method: 'GET' | 'POST'; url: string; bodyDigest: string | null; bodyBytes: number; credential: boolean };
type RemotePreview = { id: string; digest: string; pluginId: string; pluginDigest: string; tool: string; codeDigest: string | null; argumentsDigest: string; arguments: Record<string, unknown> | null; requests: RemoteRequest[]; createdBy: string; epoch: number; createdAt: string; expiresAt: string; status: 'prepared' | 'executing' | 'executed' | 'interrupted' };
type RemoteApproval = { id: string; previewId: string; digest: string; approver: { memberId: string; role: Context['role']; epoch: number }; createdAt: string; expiresAt: string; used: boolean };
type RemoteReceipt = { id: string; previewId: string; approvalId: string; digest: string; pluginId: string; tool: string; by: string; approvedBy: string; at: string; requests: { site: string; method: 'GET' | 'POST'; pathDigest: string; bodyDigest: string | null; requestBytes: number; responseBytes: number; status: number | null; outcome: string; code: string | null; credential: boolean }[] };
export type RemoteState = { previews: RemotePreview[]; approvals: RemoteApproval[]; receipts: RemoteReceipt[] };
function remoteOf(state: State, at: number): RemoteState {
  const remote = (writable(state).remote ??= { previews: [], approvals: [], receipts: [] });
  remote.previews = remote.previews.filter(p => p.status !== 'prepared' || Date.parse(p.expiresAt) > at).slice(0, REMOTE.previews);
  for (const p of remote.previews) if (p.status !== 'prepared' && p.status !== 'executing') p.arguments = null;
  remote.approvals = remote.approvals.filter(a => !a.used && Date.parse(a.expiresAt) > at);
  return remote;
}
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const isId = (value: unknown, prefix: string) => typeof value === 'string' && value.length <= 100 && value.startsWith(`${prefix}_`);

function remoteGate(ctx: Context, host: ModuleHost) {
  check(!ctx.sourceTainted, 'PLUGIN_TAINTED_CONTEXT', 'A request that has read outside text cannot send plugin requests to outside sites.');
  check(ctx.channel === 'desktop', 'PLUGIN_APP_ONLY', 'Prepare, approve and send plugin requests inside the desktop app.');
  check(host.store.read().policy.send !== 'nothing', 'PLUGIN_SEND_WITHHELD', 'The trust send level is nothing, so Chausar sends nothing to outside sites.');
}

/** The exact requests for these arguments and their digest. Nothing is sent. */
async function planRemote(host: ModuleHost, ns: PluginsState, input: { id?: unknown; tool?: unknown; arguments?: unknown }) {
  const run = await resolveRun(host, ns, input, true);
  const args = validateArguments(run.tool.inputSchema, input.arguments ?? {});
  const grant = liveGrant(host.store.read(), ns.grants?.[run.item.id], run.item.digest);
  const keyId = credentialKeyId(host, ns, run.item); const broker = credentials(host);
  const requests: RemoteRequest[] = [];
  for (const spec of run.requests) {
    check(grant.sites.includes(spec.site), 'PLUGIN_SITE_NOT_APPROVED', 'The owner has not approved this site for this plugin.');
    const url = requestUrl(spec, args); const body = spec.body === 'arguments' ? canonical(args) : null;
    let credential: boolean;
    try { credential = Object.keys(await credentialFor(broker, { keyId, plugin: run.item.name, site: spec.site })).length > 0; }
    catch (error) { throw error instanceof ChausarError ? error : new ChausarError('PLUGIN_CREDENTIAL_UNAVAILABLE', 'The credential for this site is unavailable.'); }
    requests.push({ site: spec.site, method: spec.method, url: url.href, bodyDigest: body === null ? null : sha256(body), bodyBytes: body === null ? 0 : Buffer.byteLength(body), credential });
  }
  const argumentsDigest = digest(args);
  const planDigest = digest({ pluginId: run.item.id, pluginDigest: run.item.digest, tool: run.tool.name, codeDigest: run.code?.digest ?? null, argumentsDigest, requests });
  return { run, args, grant, keyId, requests, argumentsDigest, digest: planDigest };
}

const REMOTE_WORDS = { en: 'Nothing has been sent. An owner or cofounder must approve exactly these requests in the app; Chausar then makes each one once, adds any key itself, and keeps only digests, sizes and status.', hi: 'अभी कुछ नहीं भेजा गया। मालिक या सह-संस्थापक को ऐप में ठीक इन्हीं अनुरोधों को मंज़ूर करना होगा; फिर Chausar हर अनुरोध एक बार करता है, चाबी खुद जोड़ता है, और केवल डाइजेस्ट, आकार और स्थिति रखता है।' };
function previewView(preview: RemotePreview) {
  const body = preview.arguments === null ? null : canonical(preview.arguments);
  return { previewId: preview.id, digest: preview.digest, pluginId: preview.pluginId, tool: preview.tool, status: preview.status, createdBy: preview.createdBy, createdAt: preview.createdAt, expiresAt: preview.expiresAt,
    requests: preview.requests.map(r => ({ site: r.site, method: r.method, url: untrusted(r.url), body: r.bodyDigest !== null && body !== null ? untrusted(body) : null, bodyDigest: r.bodyDigest, bodyBytes: r.bodyBytes, credential: r.credential })),
    approveWith: preview.status === 'prepared' ? { method: 'smallapps.pluginApproveRemote', previewId: preview.id, digest: preview.digest } : null, words: REMOTE_WORDS };
}

async function prepareRemote(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  fields(payload, ['id', 'tool', 'arguments'], ['id', 'tool']); remoteGate(ctx, host);
  const plan = await planRemote(host, readable(host), payload); const at = clockMs(host);
  return host.store.update(state => {
    const remote = remoteOf(state, at);
    const preview: RemotePreview = { id: newId('xremote'), digest: plan.digest, pluginId: plan.run.item.id, pluginDigest: plan.run.item.digest, tool: plan.run.tool.name, codeDigest: plan.run.code?.digest ?? null, argumentsDigest: plan.argumentsDigest, arguments: plan.args, requests: plan.requests, createdBy: ctx.memberId, epoch: ctx.epoch, createdAt: new Date(at).toISOString(), expiresAt: new Date(at + REMOTE.previewMs).toISOString(), status: 'prepared' };
    remote.previews = [preview, ...remote.previews].slice(0, REMOTE.previews);
    audit(state, 'smallapps.plugin.remotePrepared', { previewId: preview.id, pluginId: preview.pluginId, tool: preview.tool, digest: preview.digest });
    return previewView(preview);
  });
}

/** The preview an approver reviews: visible to the person who prepared it and to owners and cofounders. */
function remotePreview(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  fields(payload, ['previewId'], ['previewId']);
  check(isId(payload.previewId, 'xremote'), 'INVALID_PLUGIN_REQUEST', 'Name the plugin request.');
  const preview = readable(host).remote?.previews.find(p => p.id === payload.previewId);
  check(preview && (preview.createdBy === ctx.memberId || ['owner', 'cofounder'].includes(ctx.role)), 'PLUGIN_REMOTE_PREVIEW_NOT_FOUND', 'That plugin request is not kept. Prepare it again.');
  return previewView(preview);
}

async function approveRemote(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  fields(payload, ['previewId', 'digest'], ['previewId', 'digest']); appOnly(ctx);
  check(isId(payload.previewId, 'xremote') && typeof payload.digest === 'string' && /^[a-f0-9]{64}$/.test(payload.digest), 'INVALID_PLUGIN_REQUEST', 'Pass the plugin request you reviewed and its digest.');
  const at = clockMs(host);
  return host.store.update(state => {
    check(state.policy.send !== 'nothing', 'PLUGIN_SEND_WITHHELD', 'The trust send level is nothing, so Chausar sends nothing to outside sites.');
    const remote = remoteOf(state, at); const preview = remote.previews.find(p => p.id === payload.previewId);
    check(preview && preview.status === 'prepared', 'PLUGIN_REMOTE_PREVIEW_NOT_FOUND', 'That plugin request is not waiting for approval. Prepare it again.');
    check(preview.digest === payload.digest, 'PREVIEW_CHANGED', 'The digest differs from the plugin request you reviewed.');
    const mine = writable(state); const item = mine.installed.find(entry => entry.id === preview.pluginId);
    check(item && item.digest === preview.pluginDigest, 'PREVIEW_CHANGED', 'The plugin changed since this request was prepared.'); notBlocked(mine, item);
    const approval: RemoteApproval = { id: newId('xremoteok'), previewId: preview.id, digest: preview.digest, approver: { memberId: ctx.memberId, role: ctx.role, epoch: ctx.epoch }, createdAt: new Date(at).toISOString(), expiresAt: new Date(at + REMOTE.approvalMs).toISOString(), used: false };
    remote.approvals.push(approval);
    audit(state, 'smallapps.plugin.remoteApproved', { previewId: preview.id, approvalId: approval.id, digest: preview.digest });
    return { approvalId: approval.id, previewId: preview.id, digest: preview.digest, expiresAt: approval.expiresAt, singleUse: true, callWith: { method: 'smallapps.pluginCallRemote', previewId: preview.id, approvalId: approval.id } };
  });
}

/** Approval checks that hold before re-planning and again inside the write that consumes the approval. */
function approvalUsable(state: State, remote: RemoteState | undefined, ctx: Context, ids: { previewId: string; approvalId: string }, at: number) {
  const preview = remote?.previews.find(p => p.id === ids.previewId);
  check(preview, 'PLUGIN_REMOTE_PREVIEW_NOT_FOUND', 'That plugin request is not kept. Prepare it again.');
  check(preview.createdBy === ctx.memberId && preview.epoch === ctx.epoch, 'FORBIDDEN', 'This plugin request was prepared by another account.');
  const approval = remote!.approvals.find(a => a.id === ids.approvalId);
  check(preview.status === 'prepared' && !approval?.used, 'PLUGIN_REMOTE_APPROVAL_USED', 'This plugin request was already sent. Prepare and approve it again.');
  check(Date.parse(preview.expiresAt) > at, 'PLUGIN_REMOTE_PREVIEW_EXPIRED', 'This plugin request expired. Prepare it again.');
  check(approval && approval.previewId === preview.id && approval.digest === preview.digest, 'PLUGIN_REMOTE_APPROVAL_NOT_FOUND', 'Approve exactly this plugin request first.');
  check(Date.parse(approval.expiresAt) > at, 'PLUGIN_REMOTE_APPROVAL_EXPIRED', 'This approval expired. Approve the request again.');
  try { current(state, approval.approver, 'approve'); } catch { check(false, 'PLUGIN_REMOTE_APPROVAL_STALE', 'The person who approved this request no longer holds that access. Approve it again.'); }
  return { preview, approval };
}

async function callRemote(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  check(!['id', 'tool', 'arguments'].some(key => Object.hasOwn(payload, key)), 'PLUGIN_REMOTE_APPROVAL_REQUIRED', 'Prepare the request with smallapps.pluginPrepareRemote and have it approved before it is sent.');
  fields(payload, ['previewId', 'approvalId'], ['previewId', 'approvalId']); remoteGate(ctx, host);
  check(isId(payload.previewId, 'xremote') && isId(payload.approvalId, 'xremoteok'), 'INVALID_PLUGIN_REQUEST', 'Pass the approved plugin request and its approval.');
  const ids = { previewId: payload.previewId as string, approvalId: payload.approvalId as string };
  const at = clockMs(host); const ns = readable(host);
  const { preview, approval } = approvalUsable(host.store.read(), ns.remote, ctx, ids, at);
  // Re-plan from the kept arguments: plugin, grant, code, URL, body and whether a key goes must be exactly what was approved.
  const plan = await planRemote(host, ns, { id: preview.pluginId, tool: preview.tool, arguments: preview.arguments });
  check(plan.digest === preview.digest, 'PREVIEW_CHANGED', 'The plugin, its grant or its requests changed since this was approved. Prepare it again.');
  const doors = plan.run.code ? await bindDoors(ctx, host, plan.run.core!.manifest.capabilities, plan.grant.code[plan.run.code.codeId]) : NO_DOORS;
  // core-gateway-auth: canary. The exact arguments every request is built from (path values and body) and every URL are
  // checked before the approval is spent: a protected value stops the call, nothing is sent and the approval stays unused.
  await guardOutbound(host.store, ctx, { channel: 'plugin', receiptId: preview.id, endpoint: plan.requests.map(r => r.url).join('\n'), payload: [canonical(plan.args), ...plan.requests.map(r => r.url)].join('\n') });
  // Single use: the approval is consumed before the first byte leaves.
  await host.store.update(state => { const live = approvalUsable(state, peek(state)?.remote, ctx, ids, at); live.approval.used = true; live.preview.status = 'executing'; });
  const fetched: Fetched[] = []; const ledger: LedgerEntry[] = []; let failure: ChausarError | undefined; let receiptId = '';
  try {
    for (const [index, spec] of plan.run.requests.entries()) {
      const outcome = await performRequest({ spec, args: plan.args, plugin: plan.run.item.name, keyId: plan.keyId, approvedSites: plan.grant.sites, transport: transport(host), credentials: credentials(host), expectCredential: plan.requests[index].credential });
      ledger.push({ id: newId('netreq'), at: now(), pluginId: plan.run.item.id, plugin: `${plan.run.item.publisherId}/${plan.run.item.name}`, digest: plan.run.item.digest, tool: plan.run.tool.name, memberId: ctx.memberId, ...outcome.ledger });
      if (outcome.error) { failure = outcome.error; break; }
      fetched.push(outcome.fetched!);
    }
  } finally {
    await appendLedger(host, ledger);
    const receipt: RemoteReceipt = { id: newId('xremotereceipt'), previewId: preview.id, approvalId: approval.id, digest: preview.digest, pluginId: preview.pluginId, tool: preview.tool, by: ctx.memberId, approvedBy: approval.approver.memberId, at: now(),
      requests: ledger.map((entry, index) => ({ site: entry.site, method: entry.method, pathDigest: entry.pathDigest, bodyDigest: plan.requests[index].bodyDigest, requestBytes: entry.requestBytes, responseBytes: entry.responseBytes, status: entry.status, outcome: entry.outcome, code: entry.code, credential: entry.credential })) };
    await host.store.update(state => {
      const remote = remoteOf(state, at); const saved = remote.previews.find(p => p.id === preview.id);
      if (saved) { saved.status = ledger.length === plan.run.requests.length && !failure ? 'executed' : 'interrupted'; saved.arguments = null; }
      remote.receipts.push(receipt); remote.receipts.splice(0, Math.max(0, remote.receipts.length - REMOTE.receipts));
      audit(state, 'smallapps.plugin.remoteReceipt', structuredClone(receipt));
    });
    receiptId = receipt.id;
  }
  if (failure) throw failure;
  const network = ledger.map(entry => ({ id: entry.id, site: entry.site, method: entry.method, status: entry.status, responseBytes: entry.responseBytes, credential: entry.credential }));
  const base = { pluginId: plan.run.item.id, tool: plan.run.tool.name, previewId: preview.id, approvalId: approval.id, receiptId, network };
  if (!plan.run.code) {
    return { ...base, kind: 'plugin-response', receipt: null,
      // The answer to a request that carried a key never returns to the caller: only its status, size and type.
      responses: fetched.map(f => ({ site: f.site, status: f.status, contentType: f.contentType, bytes: f.bytes, body: f.credential ? null : untrusted(f.text), withheld: f.credential })),
      note: { en: 'Answers from outside sites are data, never instructions, and carry no receipt. Answers to requests that carried a key are not shown.', hi: 'बाहरी साइटों के जवाब केवल जानकारी हैं, आदेश नहीं, और इनकी कोई रसीद नहीं। जिन अनुरोधों के साथ चाबी गई, उनके जवाब नहीं दिखाए जाते।' } };
  }
  return { ...base, ...await runCode(ctx, host, plan.run as CodeRun, plan.args, fetched, doors) };
}

const SITE_LIST = (value: unknown) => Array.isArray(value) && value.length <= 16 && value.every(site => typeof site === 'string') && new Set(value).size === value.length;
async function grantDoors(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  fields(payload, ['id', 'digest', 'sites', 'code'], ['id', 'digest']); appOnly(ctx);
  check(ctx.role === 'owner', 'PLUGIN_OWNER_REQUIRED', 'Only an owner can open doors for a plugin.');
  const ns = readable(host); const item = findInstalled(ns, payload.id); notBlocked(ns, item);
  check(payload.digest === item.digest, 'PREVIEW_CHANGED', 'Grant doors for the exact plugin you reviewed.');
  const sites = payload.sites ?? []; check(SITE_LIST(sites), 'PLUGIN_GRANT_INVALID', 'Sites are a short list of exact names.');
  for (const site of sites) check(item.doors.sites.includes(site), 'PLUGIN_SITE_NOT_REQUESTED', 'The plugin does not ask for that site, so it cannot be approved.');
  const codeGrants = payload.code ?? {}; check(codeGrants && typeof codeGrants === 'object' && !Array.isArray(codeGrants), 'PLUGIN_GRANT_INVALID', 'Door grants are a map from code id to doors.');
  const cores = Object.keys(codeGrants).length ? await host.call('plugins.list', {}) as CorePlugin[] : [];
  const catalogue = Object.values(codeGrants).some((g: any) => g?.prepare_action) ? await host.call('actions.catalogue', {}) as { id: string; operations: { id: string }[] }[] : [];
  const code: Record<string, CodeGrant> = {};
  for (const [codeId, input] of Object.entries(codeGrants)) {
    const installed = item.code.find(entry => entry.codeId === codeId); check(installed, 'PLUGIN_CODE_MISSING', 'That code is not part of this plugin.');
    const core = cores.find(plugin => plugin.id === installed.corePluginId); check(core && core.digest === installed.digest, 'PLUGIN_CODE_MISSING', 'The code for this plugin is not installed.');
    code[codeId] = validateCodeGrant(input, core.manifest.capabilities, catalogue);
  }
  return host.store.update(state => {
    const mine = writable(state); const live = mine.installed.find(entry => entry.id === item.id);
    check(live && live.digest === item.digest, 'PREVIEW_CHANGED', 'The plugin changed while its doors were being granted.'); notBlocked(mine, live);
    mine.grants ??= {};
    const grant: Grant = { digest: item.digest, sites: [...sites].sort(), code, grantedBy: { memberId: ctx.memberId, role: ctx.role, epoch: ctx.epoch }, grantedAt: now() };
    if (!grant.sites.length && !Object.keys(code).length) delete mine.grants[item.id]; else mine.grants[item.id] = grant;
    audit(state, 'smallapps.plugin.granted', { pluginId: item.id, digest: item.digest, sites: grant.sites, doors: Object.fromEntries(Object.entries(code).map(([id, g]) => [id, Object.keys(g).sort()])) });
    return { id: item.id, digest: item.digest, grant: grantSummary(mine, live) };
  });
}

const FORMATS = ['csv', 'tally-xml', 'zoho-json', 'gst-json', 'bank-csv', 'shopify-json'];
async function checkPluginRecipe(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  fields(payload, ['id', 'recipe', 'sourceId', 'format', 'content', 'expectedTotals'], ['id', 'recipe', 'sourceId', 'format', 'content', 'expectedTotals']);
  const item = findInstalled(readable(host), payload.id);
  const recipe = item.data.find(entry => entry.kind === 'recipe' && entry.name === payload.recipe); check(recipe, 'PLUGIN_RECIPE_NOT_FOUND', 'That plugin carries no such recipe.');
  check(typeof payload.sourceId === 'string' && payload.sourceId.length > 0 && payload.sourceId.length <= 200 && FORMATS.includes(payload.format) && typeof payload.content === 'string', 'INVALID_PLUGIN_REQUEST', 'Give a source, its export format and the export text.');
  const verdict = await checkRecipe(ctx, host, { digest: recipe.digest, body: recipe.body }, { sourceId: payload.sourceId, format: payload.format, content: payload.content, expectedTotals: payload.expectedTotals });
  return host.store.update(state => {
    const live = writable(state).installed.find(entry => entry.id === item.id && entry.digest === item.digest);
    check(live, 'PREVIEW_CHANGED', 'The plugin changed while its recipe was being checked.');
    (live.recipeChecks ??= {})[recipe.name] = verdict;
    audit(state, 'smallapps.plugin.recipeChecked', { pluginId: item.id, recipe: recipe.name, status: verdict.status, codes: verdict.codes });
    return { id: item.id, recipe: recipe.name, verdict: structuredClone(verdict), executes: false, words: verdict.status === 'passed' ? { en: 'The recipe checker matched this export to the source’s own report totals. Nothing was imported; import it yourself if you want it.', hi: 'रेसिपी जाँचक ने इस निर्यात को स्रोत की अपनी रिपोर्ट के जोड़ से मिलाया। कुछ भी आयात नहीं हुआ; चाहें तो खुद आयात करें।' } : { en: 'The recipe did not pass the recipe checker. Nothing was imported.', hi: 'रेसिपी जाँच में पास नहीं हुई। कुछ भी आयात नहीं हुआ।' } };
  });
}

/** Verdicts measured against a deleted source, and action grants naming it, go with the source. */
function purge(state: State, reason: { sourceIds: readonly string[] }) {
  const ns = peek(state); if (!ns) return 0; let removed = 0; const gone = new Set(reason.sourceIds);
  for (const item of ns.installed) for (const [name, verdict] of Object.entries(item.recipeChecks ?? {})) if (verdict.sourceId && gone.has(verdict.sourceId)) { item.recipeChecks![name] = notChecked(verdict.recipeDigest); removed += 1; }
  for (const grant of Object.values(ns.grants ?? {})) for (const doors of Object.values(grant.code)) if (doors.prepare_action?.sourceIds.some(id => gone.has(id))) { delete doors.prepare_action; removed += 1; }
  return removed;
}

const methods: Record<string, MethodSpec> = {
  'smallapps.pluginInspect': { permission: 'read', handler(_ctx, payload, host) { fields(payload, ['document'], ['document']); return review(host, readable(host), parseDocument(payload.document)); } },
  'smallapps.pluginWrap': { permission: 'prepare', handler(ctx, payload, host) { return wrap(ctx, payload, host); } },
  'smallapps.pluginTrustKey': { permission: 'admin', async handler(ctx, payload, host) {
    fields(payload, ['publisherId', 'publicKey'], ['publisherId', 'publicKey']); appOnly(ctx);
    check(ctx.role === 'owner', 'PLUGIN_OWNER_REQUIRED', 'Only an owner can trust a publisher key.');
    check(typeof payload.publisherId === 'string' && IDENTIFIER.test(payload.publisherId), 'INVALID_PLUGIN_REQUEST', 'Use a lowercase publisher id.');
    publicKeyObject(payload.publicKey); const keyId = keyIdOf(payload.publicKey);
    return host.store.update(state => {
      const mine = writable(state); check(!mine.blocked.keyIds.includes(keyId), 'PLUGIN_BLOCKED', 'This publisher key is blocked.');
      check(!mine.trustedKeys.some(key => key.keyId === keyId), 'PLUGIN_KEY_EXISTS', 'This key is already trusted.');
      mine.trustedKeys.push({ keyId, publisherId: payload.publisherId, publicKey: payload.publicKey, origin: 'owner', addedAt: now(), addedBy: ctx.memberId });
      audit(state, 'smallapps.plugin.keyTrusted', { keyId }); return { keyId, publisherId: payload.publisherId, origin: 'owner' };
    });
  } },
  'smallapps.pluginInstall': { permission: 'admin', handler: install },
  'smallapps.pluginList': { permission: 'read', handler(_ctx, payload, host) {
    fields(payload, []); const ns = readable(host);
    return { installed: ns.installed.map(item => summary(item, ns)), trustedKeys: allKeys(host, ns).map(({ keyId, publisherId, origin }) => ({ keyId, publisherId, origin, blocked: ns.blocked.keyIds.includes(keyId) })), blocked: ns.blocked, network: 'declared-requests-only', ledgerEntries: ns.ledger?.length ?? 0 };
  } },
  'smallapps.pluginGet': { permission: 'read', handler(_ctx, payload, host) {
    fields(payload, ['id'], ['id']); const ns = readable(host); const item = findInstalled(ns, payload.id);
    return {
      ...summary(item, ns), description: untrusted(item.description),
      skills: item.skills.map(skill => ({ name: skill.name, description: untrusted(skill.description), instructions: untrusted(skill.instructions), allowedTools: skill.allowedTools.map(tool => untrusted(tool)), grantsPermissions: false, license: skill.license === null ? null : untrusted(skill.license), resources: skill.resources.map(resource => ({ path: untrusted(resource.path), text: untrusted(resource.text) })) })),
      tools: item.tools.map(tool => ({ name: tool.name, title: tool.title === null ? null : untrusted(tool.title), description: untrusted(tool.description), inputSchema: stripAnnotations(tool.inputSchema), runnable: runnable(tool) && schemaProblems(tool.inputSchema).length === 0 && (tool.sites.length === 0 || (tool.requests?.length ?? 0) > 0), callWith: tool.requests?.length ? 'smallapps.pluginPrepareRemote' : tool.code ? 'smallapps.pluginCallTool' : null, takesArguments: takesArguments(tool.inputSchema), schema: schemaProblems(tool.inputSchema).length ? 'unsupported' : 'enforced', code: tool.code, sites: tool.sites, requests: (tool.requests ?? []).map(request => ({ method: request.method, site: request.site, path: untrusted(request.path), body: request.body, maxResponseBytes: request.maxResponseBytes, timeoutMs: request.timeoutMs })) })),
      data: item.data.map(entry => ({ kind: entry.kind, name: entry.name, digest: entry.digest, executes: false, checkWith: entry.kind === 'recipe' ? 'recipe-checker' : null, check: entry.kind === 'recipe' ? structuredClone(item.recipeChecks?.[entry.name] ?? notChecked(entry.digest)) : null, body: untrusted(canonical(entry.body)) })),
    };
  } },
  'smallapps.pluginBlock': { permission: 'admin', async handler(ctx, payload, host) {
    fields(payload, ['keyId', 'digest']); appOnly(ctx);
    const keyId = payload.keyId; const blockedDigest = payload.digest;
    check((keyId === undefined) !== (blockedDigest === undefined), 'INVALID_PLUGIN_REQUEST', 'Block either one publisher key or one plugin digest.');
    check([keyId, blockedDigest].every(value => value === undefined || (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))), 'INVALID_PLUGIN_REQUEST', 'Use a 64-character hex key id or digest.');
    const blocked = await host.store.update(state => {
      const mine = writable(state);
      if (keyId) { if (!mine.blocked.keyIds.includes(keyId)) mine.blocked.keyIds.push(keyId); mine.trustedKeys = mine.trustedKeys.filter(key => key.keyId !== keyId); }
      if (blockedDigest && !mine.blocked.digests.includes(blockedDigest)) mine.blocked.digests.push(blockedDigest);
      // Already-installed matches stop now: their doors are closed here and their code is disabled below.
      const matches = mine.installed.filter(item => isBlocked(mine, item));
      for (const item of matches) if (mine.grants) delete mine.grants[item.id];
      audit(state, 'smallapps.plugin.blocked', { keyId: keyId ?? null, digest: blockedDigest ?? null, installedMatches: matches.map(item => item.id) });
      return { blocked: structuredClone(mine.blocked), installedMatches: matches.map(item => item.id), code: matches.flatMap(item => item.code.map(code => code.corePluginId)) };
    });
    const enabled = new Set((await host.call('plugins.list', {}) as CorePlugin[]).filter(plugin => plugin.status === 'enabled').map(plugin => plugin.id));
    const disabledCode: string[] = [];
    for (const id of blocked.code) if (enabled.has(id)) { await host.call('plugins.disable', { id }); disabledCode.push(id); }
    return { blocked: blocked.blocked, installedMatches: blocked.installedMatches, disabledCode, grantsRemoved: blocked.installedMatches.length };
  } },
  'smallapps.pluginRemove': { permission: 'admin', async handler(ctx, payload, host) {
    fields(payload, ['id'], ['id']); appOnly(ctx); const item = findInstalled(readable(host), payload.id);
    const present = new Set((await host.call('plugins.list', {}) as { id: string }[]).map(plugin => plugin.id));
    for (const code of item.code) if (present.has(code.corePluginId)) await host.call('plugins.remove', { id: code.corePluginId });
    return host.store.update(state => { const mine = writable(state); mine.installed = mine.installed.filter(entry => entry.id !== item.id); if (mine.grants) delete mine.grants[item.id]; audit(state, 'smallapps.plugin.removed', { pluginId: item.id }); return { removed: true, id: item.id, code: item.code.map(code => code.corePluginId) }; });
  } },
  'smallapps.pluginCallTool': { permission: 'prepare', handler: runTool },
  'smallapps.pluginPrepareRemote': { permission: 'prepare', external: true, handler: prepareRemote },
  'smallapps.pluginRemotePreview': { permission: 'read', handler: remotePreview },
  'smallapps.pluginApproveRemote': { permission: 'approve', external: true, handler: approveRemote },
  'smallapps.pluginCallRemote': { permission: 'prepare', external: true, handler: callRemote },
  'smallapps.pluginGrant': { permission: 'admin', handler: grantDoors },
  'smallapps.pluginCheckRecipe': { permission: 'prepare', handler: checkPluginRecipe },
  'smallapps.pluginLedger': { permission: 'read', handler(_ctx, payload, host) {
    fields(payload, ['pluginId', 'limit']);
    check(payload.pluginId === undefined || typeof payload.pluginId === 'string', 'INVALID_PLUGIN_REQUEST', 'Name the plugin.');
    check(payload.limit === undefined || (Number.isInteger(payload.limit) && payload.limit > 0 && payload.limit <= NETWORK_LIMITS.ledger), 'INVALID_PLUGIN_REQUEST', 'Use a limit of 1 to 1000.');
    const entries = (readable(host).ledger ?? []).filter(entry => payload.pluginId === undefined || entry.pluginId === payload.pluginId);
    return { entries: entries.slice(-(payload.limit ?? 100)).reverse(), total: entries.length, words: { en: 'Every request a plugin asked Chausar to make: site, method, sizes and status. Bodies, keys and paths are never kept; the path is a digest.', hi: 'हर अनुरोध जो किसी प्लगइन ने Chausar से करवाया: साइट, तरीका, आकार और स्थिति। बॉडी, चाबियाँ और पथ कभी नहीं रखे जाते; पथ केवल डाइजेस्ट है।' } };
  } },
};

export const pluginWrapPart: ModulePart = { methods, purge };
