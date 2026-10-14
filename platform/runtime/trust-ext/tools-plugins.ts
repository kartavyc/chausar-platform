/** TL-04 plugins and TL-05 inspection before install: the locked box, its doors and its asks. */
import { createPublicKey, verify } from 'node:crypto';
import { check, ChausarError, now } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { digest } from '../actions.ts';
import { inspectWasm, validateManifest } from '../plugins.ts';
import { fields, sha256, shipped, tools } from './tools-common.ts';

type Blocked = { version: number; checkedAt: string; blocked: { pluginId?: string; moduleSha256?: string; reason: string }[]; checked: string[] };
const BLOCKED = shipped<Blocked>('tools-blocked.v1.json');
const INSTRUCTION = /ignore (all |any )?(previous|prior|above)|disregard|you are\b|system prompt|\bsend\b|call the tool|\btool call|\bassistant:|act as\b|instructions?\b/i;
const KEPT = 'What it produced stays, labelled with its name.';
type Ask = { id: string; kind: 'calculation' | 'action' | 'site'; name: string; answer: false };

function blockedEntry(pluginId: unknown, moduleSha: string | null) {
  return BLOCKED.blocked.find(entry => (entry.pluginId !== undefined && entry.pluginId === pluginId) || (moduleSha !== null && entry.moduleSha256 === moduleSha));
}
function levelOf(pluginId: unknown, moduleSha: string | null): 'checked' | 'community' | 'blocked' {
  return blockedEntry(pluginId, moduleSha) ? 'blocked' : moduleSha !== null && BLOCKED.checked.includes(moduleSha) ? 'checked' : 'community';
}

function signatureOf(state: State, bytes: Buffer, pkg: Record<string, any>): 'valid' | 'invalid' | 'missing' | 'key-changed' {
  const publisher = pkg.publisher;
  if (!publisher || pkg.signature === undefined) return 'missing';
  if (typeof publisher.name !== 'string' || typeof publisher.publicKey !== 'string' || typeof pkg.signature !== 'string') return 'invalid';
  const stored = tools(state).publisherKeys?.[publisher.name];
  if (stored !== undefined && stored !== publisher.publicKey) return 'key-changed';
  try {
    const key = publisher.publicKey.includes('BEGIN') ? createPublicKey(publisher.publicKey) : createPublicKey({ key: Buffer.from(publisher.publicKey, 'base64'), format: 'der', type: 'spki' });
    check(key.asymmetricKeyType === 'ed25519', 'INVALID_KEY', 'Ed25519 keys only.');
    return verify(null, bytes, key, Buffer.from(pkg.signature, 'base64')) ? 'valid' : 'invalid';
  } catch { return 'invalid'; }
}

/** Reads a package without installing it. Anything not built for the locked box is refused in the reply, never thrown. */
export function inspect(state: State, host: ModuleHost, pkg: Record<string, any>) {
  fields(pkg, ['manifest', 'moduleBase64', 'publisher', 'signature', 'licence', 'answers', 'digest']);
  const manifest = pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {};
  const bytes = typeof pkg.moduleBase64 === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(pkg.moduleBase64) && pkg.moduleBase64.length <= 1398104 ? Buffer.from(pkg.moduleBase64, 'base64') : null;
  const moduleSha = bytes ? sha256(bytes) : null;
  let refused: string | null = null; let valid: ReturnType<typeof validateManifest> | null = null;
  try {
    valid = validateManifest(pkg.manifest);
    check(bytes, 'INVALID_WASM', 'Use a base64 WebAssembly module.');
    const imports = inspectWasm(bytes, valid.maxMemoryPages).imports;
    check(digest([...new Set(imports)].sort()) === digest(valid.capabilities), 'CAPABILITY_MISMATCH', 'Every function the module imports must be named in its manifest.');
    for (const capability of valid.capabilities) check(host.services.plugins.hostFunctions?.[capability], 'UNSUPPORTED_CAPABILITY', 'It asks for a calculation this computer does not offer.');
  } catch (error) { if (!(error instanceof ChausarError)) throw error; refused = error.message; }
  const blocked = blockedEntry(manifest.id, moduleSha);
  if (!refused && blocked) refused = `Stopped by Chausar's blocked list: ${blocked.reason}`;
  const asks: Ask[] = valid ? [
    ...valid.capabilities.map(name => ({ id: `calculation:${name}`, kind: 'calculation' as const, name, answer: false as const })),
    ...valid.sourceIds.map(name => ({ id: `source:${name}`, kind: 'calculation' as const, name, answer: false as const })),
  ] : [];
  const flagged: { field: string; text: string }[] = [];
  const texts: [string, unknown][] = [...Object.entries(manifest).filter(([key]) => !['id', 'runtime', 'entrypoint'].includes(key)).map(([key, value]) => [`manifest.${key}`, value] as [string, unknown]), ['licence', pkg.licence], ['publisher.name', pkg.publisher?.name]];
  for (const [field, value] of texts) for (const text of Array.isArray(value) ? value : [value])
    if (typeof text === 'string' && INSTRUCTION.test(text)) flagged.push({ field, text: text.slice(0, 200) });
  return {
    maker: typeof pkg.publisher?.name === 'string' ? pkg.publisher.name.slice(0, 100) : 'Unknown maker',
    level: levelOf(manifest.id, moduleSha), version: typeof manifest.version === 'string' ? manifest.version.slice(0, 40) : 'unknown',
    licence: typeof pkg.licence === 'string' ? pkg.licence.slice(0, 100) : 'Not stated', signature: bytes ? signatureOf(state, bytes, pkg) : 'missing',
    digest: digest({ manifest: valid ?? null, moduleSha256: moduleSha }),
    doors: [{ id: 'read-calculations', open: asks.length > 0 }, { id: 'propose-actions', open: false }, { id: 'reach-sites', open: false }, { id: 'read-files', open: false }, { id: 'hold-keys', open: false }],
    asks, flagged, refused,
  };
}

function row(state: State, plugin: any) {
  const meta = tools(state).pluginMeta?.[plugin.id]; const moduleSha = meta?.moduleSha256 ?? null; const blocked = blockedEntry(plugin.manifest.id, moduleSha);
  return { id: plugin.id as string, name: plugin.manifest.name as string, maker: meta?.maker ?? 'Unknown maker', level: levelOf(plugin.manifest.id, moduleSha), kind: plugin.manifest.runtime === 'wasm' ? 'code' as const : 'data' as const,
    status: plugin.status as string, ...(blocked ? { blockedReason: blocked.reason } : {}) };
}
export function pluginsView(ctx: Context, host: ModuleHost) {
  const state = host.store.read();
  return { plugins: (host.services.plugins.list(ctx) as any[]).map(plugin => row(state, plugin)), blockedList: { version: String(BLOCKED.version), checkedAt: BLOCKED.checkedAt } };
}

/** Installs only the inspected package; it is enabled only when every ask was answered Yes. */
export async function installPlugin(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const inspection = inspect(host.store.read(), host, payload);
  check(!inspection.refused, 'PLUGIN_REFUSED', 'This plugin is not built for the locked box, or it is blocked.');
  check(typeof payload.digest === 'string' && payload.digest === inspection.digest, 'PREVIEW_CHANGED', 'The plugin changed after you inspected it.');
  check(inspection.signature !== 'invalid', 'SIGNATURE_INVALID', 'The signature does not match the plugin.');
  const answers = payload.answers;
  check(answers && typeof answers === 'object' && !Array.isArray(answers) && Object.values(answers).every(value => typeof value === 'boolean'), 'INVALID_REQUEST', 'Answer each ask with yes or no.');
  const installed = await host.services.plugins.install(ctx, { manifest: payload.manifest, moduleBase64: payload.moduleBase64 });
  await host.store.update(state => {
    const t = tools(state);
    (t.pluginMeta ??= {})[installed.id] = { maker: inspection.maker, moduleSha256: sha256(Buffer.from(payload.moduleBase64, 'base64')), installedAt: now(), answers: structuredClone(answers) };
    if (inspection.signature === 'valid') (t.publisherKeys ??= {})[payload.publisher.name] = payload.publisher.publicKey;
  });
  const missing = inspection.asks.filter(ask => answers[ask.id] !== true).map(ask => ask.id);
  if (!missing.length) await host.services.plugins.enable(ctx, installed.id, installed.digest);
  const plugin = host.store.read().plugins.find(item => item.id === installed.id);
  return { ...row(host.store.read(), plugin), missing };
}

export async function removePlugin(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const { id } = fields(payload, ['id']);
  check(typeof id === 'string' && id.length <= 200, 'INVALID_REQUEST', 'Choose a plugin.');
  const plugin = host.store.read().plugins.find(item => item.id === id);
  await host.services.plugins.remove(ctx, id);
  // Its permissions and module go at once; the results of its runs are kept under its name.
  await host.store.update(state => { const t = tools(state); delete t.pluginMeta?.[id];
    if (plugin?.runs?.length) (t.pluginProduced ??= {})[id] = { name: plugin.manifest.name, removedAt: now(), runs: plugin.runs.filter((run: any) => run.outcome === 'success').map((run: any) => ({ id: run.id, at: run.at, result: run.result })) }; });
  return { removed: true as const, kept: KEPT };
}

/** Grants and notes for plugins that are no longer installed. */
export function purgePluginMeta(state: State): number {
  const meta = tools(state).pluginMeta; if (!meta) return 0;
  let removed = 0; for (const id of Object.keys(meta)) if (!state.plugins.some(plugin => plugin.id === id)) { delete meta[id]; removed++; }
  return removed;
}
