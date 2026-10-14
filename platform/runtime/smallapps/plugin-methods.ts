/**
 * `smallapps.plugin*`: wrap, inspect, install and run `chausar.plugin.v1` files.
 * Data parts live in the models-ext namespace under `plugins`; WebAssembly parts are installed,
 * enabled and run only through the core PluginService (`plugins.*`), which keeps them in the
 * isolated locked box: no internet, no files, no keys. Plugin network access is not built.
 */
import { audit, check, newId, now } from '../contracts.ts';
import type { Context } from '../contracts.ts';
import { moduleState, peekModuleState } from '../modules/types.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { MODULE_ID } from '../models-ext/part.ts';
import type { ModulePart } from '../models-ext/part.ts';
import type { HostFunction, PluginManifest } from '../plugins.ts';
import { contentFindings, documentDigest, keyIdOf, parseDocument, publicKeyObject, reviewDocument, signDocument, untrusted } from './plugin-format.ts';
import type { DataEntry, Doors, PluginDocument, SkillEntry, ToolEntry, TrustedKey } from './plugin-format.ts';
import { buildDocument, wrapAgentSkill, wrapMcpServer } from './plugin-wrap.ts';

type InstalledCode = { codeId: string; corePluginId: string; digest: string; moduleDigest: string };
type Installed = { id: string; digest: string; publisherId: string; name: string; version: string; description: string; signature: { status: string; keyId: string | null; origin: string | null }; unverifiedAccepted: boolean; support: 'supported' | 'experimental'; installedAt: string; installedBy: string; skills: SkillEntry[]; tools: ToolEntry[]; data: DataEntry[]; code: InstalledCode[]; doors: Doors };
type PluginsState = { trustedKeys: TrustedKey[]; blocked: { keyIds: string[]; digests: string[] }; installed: Installed[] };

const empty = (): PluginsState => ({ trustedKeys: [], blocked: { keyIds: [], digests: [] }, installed: [] });
function writable(state: Parameters<typeof moduleState>[0]): PluginsState { const ns = moduleState<Record<string, any>>(state, MODULE_ID, () => ({})); return (ns.plugins ??= empty()) as PluginsState; }
const readable = (host: ModuleHost): PluginsState => structuredClone(peekModuleState<Record<string, any>>(host.store.read(), MODULE_ID)?.plugins ?? empty());

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
function wrap(payload: Record<string, any>, host: ModuleHost) {
  check(payload.kind === 'agentSkill' || payload.kind === 'mcpServer', 'INVALID_PLUGIN_REQUEST', 'Wrap an agentSkill or an mcpServer.');
  if (payload.kind === 'agentSkill') fields(payload, ['kind', 'publisherId', 'name', 'version', 'description', 'skillMd', 'files', 'sign'], ['kind', 'publisherId', 'version', 'skillMd']);
  else fields(payload, ['kind', 'publisherId', 'name', 'version', 'description', 'toolsList', 'serverInfo', 'code', 'sign'], ['kind', 'publisherId', 'name', 'version', 'toolsList']);
  check(typeof payload.publisherId === 'string' && IDENTIFIER.test(payload.publisherId), 'INVALID_PLUGIN_REQUEST', 'Use a lowercase publisher id.');
  check(payload.sign === undefined || typeof payload.sign === 'boolean', 'INVALID_PLUGIN_REQUEST', 'Sign is true or false.');
  check(payload.description === undefined || (typeof payload.description === 'string' && payload.description.length <= 1024), 'INVALID_PLUGIN_REQUEST', 'Keep the description short.');
  let doc: PluginDocument; let refused; let ignoredFields: string[] = [];
  if (payload.kind === 'agentSkill') {
    const wrapped = wrapAgentSkill(payload.skillMd, payload.files ?? {}); refused = wrapped.refused; ignoredFields = wrapped.ignoredFields;
    doc = buildDocument({ publisherId: payload.publisherId, name: payload.name ?? wrapped.skill.name, version: payload.version, description: payload.description ?? wrapped.skill.description, skills: [wrapped.skill] });
  } else {
    const wrapped = wrapMcpServer(payload.toolsList, { serverInfo: payload.serverInfo, code: payload.code }); refused = wrapped.refused;
    doc = buildDocument({ publisherId: payload.publisherId, name: payload.name, version: payload.version, description: payload.description ?? '', tools: wrapped.tools, code: wrapped.code, sites: wrapped.sites });
  }
  doc = parseDocument(doc);
  if (payload.sign === true) {
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
      const record: Installed = { id: newId('xplugin'), digest: reviewed.digest, publisherId: doc.publisher.id, name: doc.name, version: doc.version, description: doc.description, signature: { status: reviewed.signature.status, keyId: reviewed.signature.keyId, origin: reviewed.signature.origin }, unverifiedAccepted: reviewed.signature.status !== 'verified', support: reviewed.support, installedAt: now(), installedBy: ctx.memberId, skills: doc.contents.skills, tools: doc.contents.tools, data: doc.contents.data, code: installedCode, doors: doc.doors };
      mine.installed.push(record);
      audit(state, 'smallapps.plugin.installed', { pluginId: record.id, digest: record.digest, signature: record.signature.status, code: installedCode.map(code => code.corePluginId) });
      return { id: record.id, digest: record.digest, support: record.support, signature: record.signature, code: installedCode.map(code => ({ ...code, status: 'disabled', enableWith: { method: 'plugins.enable', id: code.corePluginId, digest: code.digest } })) };
    });
  } catch (error) { await rollback(); throw error; }
}

function summary(item: Installed) {
  return { id: item.id, name: item.name, publisherId: item.publisherId, version: item.version, digest: item.digest, signature: item.signature, unverifiedAccepted: item.unverifiedAccepted, support: item.support, installedAt: item.installedAt, contains: { skills: item.skills.length, tools: item.tools.length, data: item.data.length, code: item.code.length }, code: item.code, doors: item.doors };
}
const findInstalled = (ns: PluginsState, id: unknown) => { check(typeof id === 'string', 'INVALID_PLUGIN_REQUEST', 'Name the plugin.'); const item = ns.installed.find(entry => entry.id === id); check(item, 'PLUGIN_NOT_FOUND', 'That plugin is not installed.'); return item; };

async function callTool(payload: Record<string, any>, host: ModuleHost) {
  fields(payload, ['id', 'tool'], ['id', 'tool']);
  const item = findInstalled(readable(host), payload.id);
  const tool = item.tools.find(entry => entry.name === payload.tool); check(tool, 'PLUGIN_TOOL_NOT_FOUND', 'That plugin has no such tool.');
  check(tool.sites.length === 0, 'PLUGIN_NETWORK_NOT_BUILT', 'This tool needs the internet. Plugin network access is not built, so it cannot run.');
  check(tool.code !== null, 'PLUGIN_TOOL_HAS_NO_CODE', 'This tool is a description only. It has no WebAssembly code to run.');
  check(!(Array.isArray(tool.inputSchema.required) && tool.inputSchema.required.length > 0), 'PLUGIN_TOOL_ARGUMENTS_NOT_BUILT', 'The locked box runs code without arguments; this tool needs arguments.');
  const code = item.code.find(entry => entry.codeId === tool.code); check(code, 'PLUGIN_CODE_MISSING', 'The code for this tool is not installed.');
  const core = (await host.call('plugins.list', {}) as { id: string; digest: string }[]).find(plugin => plugin.id === code.corePluginId);
  check(core, 'PLUGIN_CODE_MISSING', 'The code for this tool is not installed.');
  check(core.digest === code.digest, 'PREVIEW_CHANGED', 'The installed code changed since this plugin was installed.');
  const run = await host.call('plugins.run', { id: code.corePluginId }) as { result: number; memoryPages: number; runId: string };
  return {
    pluginId: item.id, tool: tool.name, codeId: code.codeId, corePluginId: code.corePluginId, runId: run.runId, memoryPages: run.memoryPages,
    result: run.result, kind: 'plugin-number', receipt: null,
    label: { en: 'Plugin number: not a calculator receipt', hi: 'प्लगइन की संख्या: कैलकुलेटर रसीद नहीं' },
    note: { en: 'This number came from plugin code, not from the calculator. It has no receipt and must be labelled as a plugin number wherever it is shown.', hi: 'यह संख्या प्लगइन कोड से आई है, कैलकुलेटर से नहीं। इसकी कोई रसीद नहीं है और जहाँ भी दिखे, इसे प्लगइन की संख्या लिखा जाना चाहिए।' },
  };
}

const methods: Record<string, MethodSpec> = {
  'smallapps.pluginInspect': { permission: 'read', handler(_ctx, payload, host) { fields(payload, ['document'], ['document']); return review(host, readable(host), parseDocument(payload.document)); } },
  'smallapps.pluginWrap': { permission: 'prepare', handler(_ctx, payload, host) { return wrap(payload, host); } },
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
    return { installed: ns.installed.map(summary), trustedKeys: allKeys(host, ns).map(({ keyId, publisherId, origin }) => ({ keyId, publisherId, origin, blocked: ns.blocked.keyIds.includes(keyId) })), blocked: ns.blocked, network: 'not-built' };
  } },
  'smallapps.pluginGet': { permission: 'read', handler(_ctx, payload, host) {
    fields(payload, ['id'], ['id']); const item = findInstalled(readable(host), payload.id);
    return {
      ...summary(item), description: untrusted(item.description),
      skills: item.skills.map(skill => ({ name: skill.name, description: untrusted(skill.description), instructions: untrusted(skill.instructions), allowedTools: skill.allowedTools, grantsPermissions: false, license: skill.license, resources: skill.resources.map(resource => ({ path: resource.path, text: untrusted(resource.text) })) })),
      tools: item.tools.map(tool => ({ name: tool.name, title: tool.title, description: untrusted(tool.description), inputSchema: tool.inputSchema, runnable: tool.code !== null && tool.sites.length === 0, code: tool.code, sites: tool.sites })),
      data: item.data.map(entry => ({ kind: entry.kind, name: entry.name, digest: entry.digest, executes: false, checkWith: entry.kind === 'recipe' ? 'recipe-checker' : null, body: entry.body })),
    };
  } },
  'smallapps.pluginBlock': { permission: 'admin', async handler(ctx, payload, host) {
    fields(payload, ['keyId', 'digest']); appOnly(ctx);
    const keyId = payload.keyId; const blockedDigest = payload.digest;
    check((keyId === undefined) !== (blockedDigest === undefined), 'INVALID_PLUGIN_REQUEST', 'Block either one publisher key or one plugin digest.');
    check([keyId, blockedDigest].every(value => value === undefined || (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))), 'INVALID_PLUGIN_REQUEST', 'Use a 64-character hex key id or digest.');
    return host.store.update(state => {
      const mine = writable(state);
      if (keyId) { if (!mine.blocked.keyIds.includes(keyId)) mine.blocked.keyIds.push(keyId); mine.trustedKeys = mine.trustedKeys.filter(key => key.keyId !== keyId); }
      if (blockedDigest && !mine.blocked.digests.includes(blockedDigest)) mine.blocked.digests.push(blockedDigest);
      audit(state, 'smallapps.plugin.blocked', { keyId: keyId ?? null, digest: blockedDigest ?? null });
      return { blocked: structuredClone(mine.blocked), installedMatches: mine.installed.filter(item => item.digest === blockedDigest || (keyId && item.signature.keyId === keyId)).map(item => item.id) };
    });
  } },
  'smallapps.pluginRemove': { permission: 'admin', async handler(ctx, payload, host) {
    fields(payload, ['id'], ['id']); appOnly(ctx); const item = findInstalled(readable(host), payload.id);
    const present = new Set((await host.call('plugins.list', {}) as { id: string }[]).map(plugin => plugin.id));
    for (const code of item.code) if (present.has(code.corePluginId)) await host.call('plugins.remove', { id: code.corePluginId });
    return host.store.update(state => { const mine = writable(state); mine.installed = mine.installed.filter(entry => entry.id !== item.id); audit(state, 'smallapps.plugin.removed', { pluginId: item.id }); return { removed: true, id: item.id, code: item.code.map(code => code.corePluginId) }; });
  } },
  'smallapps.pluginCallTool': { permission: 'prepare', handler(_ctx, payload, host) { return callTool(payload, host); } },
};

export const pluginWrapPart: ModulePart = { methods };
