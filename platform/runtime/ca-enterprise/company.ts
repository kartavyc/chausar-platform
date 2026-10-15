/**
 * Company (experimental): one entry per sub-place of the eighth place, filled only from what other
 * engine methods answer, called as the same administrator. A method that does not exist in this
 * build is `not-built` with its code; any other refusal is `out-of-service` with its code. Facts
 * are codes, dates, booleans and counts, never text from outside the engine.
 */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ChausarError, check } from '../contracts.ts';
import type { Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { administrators, fields, requireOn } from './enterprise.ts';

type Value = string | number | boolean | null;
type Fact = { key: string; value: Value };
type SubState = 'ready' | 'not-built' | 'needs-founder' | 'out-of-service';
type Sub = { id: string; state: SubState; code: string | null; facts: Fact[] };
type Reply = { ok: true; value: any } | { ok: false; code: string };

const MISSING = new Set(['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE']);
const CODE = /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,63}$/;
/** Only a short code-like word, a date, a boolean or a count goes into a fact. */
const code = (v: unknown): Value => typeof v === 'string' && CODE.test(v) ? v : null;
const date = (v: unknown): Value => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null;
const flag = (v: unknown): Value => typeof v === 'boolean' ? v : null;
const count = (v: unknown): Value => Number.isSafeInteger(v) && (v as number) >= 0 ? v as number : null;

async function ask(host: ModuleHost, method: string, payload: Record<string, unknown> = {}): Promise<Reply> {
  try { return { ok: true, value: await host.call(method, payload) }; }
  catch (error) { return { ok: false, code: error instanceof ChausarError && CODE.test(error.code) ? error.code : 'ENTERPRISE_READ_FAILED' }; }
}
const failed = (id: string, r: { code: string }, facts: Fact[] = []): Sub => ({ id, state: MISSING.has(r.code) ? 'not-built' : 'out-of-service', code: r.code, facts });
const ready = (id: string, facts: Fact[]): Sub => ({ id, state: 'ready', code: null, facts });

/** Health: one cheap read per engine family; each fact is `ready`, `not-built` or the refusal code. */
const PROBES: readonly [string, string][] = [
  ['workspace', 'workspace.status'], ['sources', 'sources.list'], ['jobs', 'jobs.list'], ['actions', 'actions.list'], ['models', 'models.list'],
  ['trust', 'trustx.rules'], ['jobs-ext', 'jobsx.list'], ['bench', 'bench.passBars'], ['hosted', 'hosted.status'], ['sync', 'sync.status'],
];
async function health(host: ModuleHost): Promise<Sub> {
  const facts: Fact[] = []; let down: string | null = null;
  for (const [key, method] of PROBES) {
    const r = await ask(host, method);
    if (r.ok) facts.push({ key, value: 'ready' });
    else if (MISSING.has(r.code)) facts.push({ key, value: 'not-built' });
    else { facts.push({ key, value: r.code }); down ??= r.code; }
  }
  return down ? { id: 'health', state: 'out-of-service', code: down, facts } : ready('health', facts);
}

/** Recovery: the encrypted copies this engine keeps in its own backups folder, and whether a hosted backup can be reached (paired). */
async function recovery(host: ModuleHost): Promise<Sub> {
  let copies = 0, newest = 0;
  try {
    for (const name of await readdir(join(host.directory, 'backups'))) {
      if (!name.endsWith('.backup')) continue; const info = await stat(join(host.directory, 'backups', name));
      if (info.isFile()) { copies++; newest = Math.max(newest, info.mtimeMs); }
    }
  } catch (error: any) { if (error?.code !== 'ENOENT') return { id: 'recovery', state: 'out-of-service', code: 'ENTERPRISE_BACKUPS_UNREADABLE', facts: [] }; }
  const facts: Fact[] = [{ key: 'localCopies', value: copies }, { key: 'lastLocalCopyAt', value: newest ? new Date(newest).toISOString() : null }];
  const hosted = await ask(host, 'hosted.status');
  if (!hosted.ok) return failed('recovery', hosted, [...facts, { key: 'hostedPaired', value: null }]);
  return ready('recovery', [...facts, { key: 'hostedConfigured', value: flag(hosted.value?.configured) }, { key: 'hostedPaired', value: flag(hosted.value?.paired) }]);
}

/** Keys: the bundled custody helper as the release lane reports it (read only; it never touches an OS store). */
async function keys(host: ModuleHost): Promise<Sub> {
  const r = await ask(host, 'native.keychainStatus'); if (!r.ok) return failed('keys', r);
  return ready('keys', [{ key: 'provider', value: code(r.value?.provider) }, { key: 'helper', value: code(r.value?.helper) },
    { key: 'sessionBus', value: code(r.value?.sessionBus) }, { key: 'qualification', value: code(r.value?.qualification) }]);
}

/** Computers: a device list is core-sync-jobs' (`devices.list`); until it answers, only this computer's sync switch is known. */
async function computers(host: ModuleHost): Promise<Sub> {
  const sync = await ask(host, 'sync.status');
  const facts: Fact[] = sync.ok ? [{ key: 'syncEnabled', value: flag(sync.value?.enabled) }, { key: 'syncTransport', value: sync.value?.transport != null }, { key: 'syncMode', value: code(sync.value?.mode) }] : [];
  const devices = await ask(host, 'devices.list');
  if (!devices.ok) return failed('computers', devices, facts);
  const list = Array.isArray(devices.value?.devices) ? devices.value.devices : null;
  return ready('computers', [...facts, { key: 'devices', value: list ? list.length : null }]);
}

/** Quality: the model bench's kept results (models-ext). */
async function quality(host: ModuleHost): Promise<Sub> {
  const r = await ask(host, 'bench.results'); if (!r.ok) return failed('quality', r);
  const results: any[] = Array.isArray(r.value?.results) ? r.value.results : [];
  const last = results.filter(x => typeof x?.finishedAt === 'string').sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))[0];
  const routes: any[] = Array.isArray(last?.routes) ? last.routes : [];
  return ready('quality', [{ key: 'benchRuns', value: results.length }, { key: 'lastBenchAt', value: last ? date(last.finishedAt) : null },
    { key: 'lastBenchPassed', value: routes.length && routes.every(x => typeof x?.passed === 'boolean') ? routes.every(x => x.passed) : null }]);
}

/** Build: the running version (engine) and the update channel (release lane). */
async function build(host: ModuleHost): Promise<Sub> {
  const status = await ask(host, 'workspace.status'); if (!status.ok) return failed('build', status);
  const facts: Fact[] = [{ key: 'version', value: code(status.value?.version) }, { key: 'storage', value: code(status.value?.storage) }];
  const release = await ask(host, 'release.status');
  if (!release.ok) return failed('build', release, facts);
  return ready('build', [...facts, { key: 'channel', value: code(release.value?.channel) }, { key: 'updatesConfigured', value: flag(release.value?.configured) },
    { key: 'vaultCompatible', value: flag(release.value?.vaultCompatible) }]);
}

export async function overview(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const state = host.store.read(); requireOn(state); fields(payload, []);
  check(administrators(state).includes(ctx.memberId), 'ENTERPRISE_NOT_ADMINISTRATOR', 'Only a person who administers the installation sees Company.');
  const subs: Sub[] = [
    // The company sign-in (OIDC) is configured on the enterprise server; this engine never sees it.
    { id: 'signin', state: 'not-built', code: 'ENTERPRISE_SERVER_ONLY', facts: [] },
    await health(host), await recovery(host), await keys(host),
    { id: 'support', state: 'needs-founder', code: 'ENTERPRISE_SUPPORT_ACCESS_NEEDS_FOUNDER', facts: [] },
    await computers(host), await quality(host), await build(host),
    { id: 'licence', state: 'needs-founder', code: 'ENTERPRISE_LICENCE_NEEDS_FOUNDER', facts: [] },
  ];
  return { subs };
}
