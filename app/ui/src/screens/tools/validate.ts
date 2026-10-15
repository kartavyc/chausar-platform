/**
 * Reply checks for the Tools screens (trustx.assistants*, trustx.plugins, trustx.inspectPlugin,
 * trustx.installPlugin, trustx.removePlugin, trustx.languagePacks), following section 1.2 of
 * docs/lanes/reports-tools-trust.md, and the local check of a plugin package file before it
 * is sent to the engine. Every value here is untrusted data and is shown only as text.
 */
import { ShapeError, bool, int, list, oneOf, optStr, rec, str, strings } from '../trust/kit/validate.ts';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** A date or an instant; only its day is ever shown. */
export function when(value: unknown, path: string): string {
  const s = str(value, path, 40);
  if (!DAY.test(s) && !INSTANT.test(s)) throw new ShapeError(path);
  return s;
}
export function optWhen(value: unknown, path: string): string | null {
  return value === null || value === undefined ? null : when(value, path);
}
/** A non-empty id the screens may put into an address or a request. */
export function id(value: unknown, path: string): string {
  const s = str(value, path, 200);
  if (s.length === 0) throw new ShapeError(path);
  return s;
}

export interface Assistants {
  readonly on: boolean;
  readonly server: { readonly version: string; readonly scope: 'this-computer' };
  readonly assistants: readonly { readonly id: string; readonly name: string; readonly pairedAt: string; readonly lastCall: string | null; readonly active: boolean }[];
  readonly calls: readonly { readonly id: string; readonly at: string; readonly client: string; readonly calculation: string; readonly receiptId: string | null; readonly removed: readonly Removal[] | 'not-recorded'; readonly refused: boolean }[];
}
/** One kind of thing the numbers server's disclosure check took out of an answer: a field name, why, and how many. Never a value. */
export interface Removal { readonly field: string; readonly why: typeof REMOVED_WHY[number]; readonly count: number }
export const REMOVED_WHY = ['personal', 'financial', 'confidential', 'withheld', 'send-level', 'own-entries'] as const;
const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
/** The engine's list (at most fifty) or the word that its record does not say. */
function removals(value: unknown, path: string): readonly Removal[] | 'not-recorded' {
  if (value === 'not-recorded') return value;
  return list(value, path, (v, p) => {
    const r = rec(v, p), field = str(r['field'], `${p}.field`, 40), count = int(r['count'], `${p}.count`);
    if (!FIELD.test(field)) throw new ShapeError(`${p}.field`);
    if (count < 1) throw new ShapeError(`${p}.count`);
    return { field, why: oneOf(r['why'], `${p}.why`, REMOVED_WHY), count };
  }, 50);
}
export function assistants(value: unknown): Assistants {
  const r = rec(value), server = rec(r['server'], 'reply.server');
  return {
    on: bool(r['on'], 'reply.on'),
    server: { version: str(server['version'], 'reply.server.version', 100), scope: oneOf(server['scope'], 'reply.server.scope', ['this-computer'] as const) },
    assistants: list(r['assistants'], 'reply.assistants', (v, p) => {
      const a = rec(v, p);
      return { id: id(a['id'], `${p}.id`), name: str(a['name'], `${p}.name`, 200), pairedAt: when(a['pairedAt'], `${p}.pairedAt`), lastCall: optWhen(a['lastCall'], `${p}.lastCall`), active: bool(a['active'], `${p}.active`) };
    }, 200),
    calls: list(r['calls'], 'reply.calls', (v, p) => {
      const c = rec(v, p);
      return {
        id: id(c['id'], `${p}.id`), at: when(c['at'], `${p}.at`), client: str(c['client'], `${p}.client`, 200), calculation: str(c['calculation'], `${p}.calculation`, 200),
        receiptId: c['receiptId'] === null ? null : id(c['receiptId'], `${p}.receiptId`), removed: removals(c['removed'], `${p}.removed`), refused: bool(c['refused'], `${p}.refused`),
      };
    }, 1000),
  };
}

export interface Pairing { readonly id: string; readonly name: string; readonly token: string; readonly expiresAt: string }
export function pairing(value: unknown): Pairing {
  const r = rec(value);
  const token = str(r['token'], 'reply.token', 500);
  if (token.length === 0) throw new ShapeError('reply.token');
  return { id: id(r['id'], 'reply.id'), name: str(r['name'], 'reply.name', 200), token, expiresAt: when(r['expiresAt'], 'reply.expiresAt') };
}

export type Level = 'built-in' | 'checked' | 'community' | 'blocked';
const LEVELS: readonly Level[] = ['built-in', 'checked', 'community', 'blocked'];
export interface PluginRow { readonly id: string; readonly name: string; readonly maker: string; readonly level: Level; readonly kind: 'data' | 'code'; readonly status: string; readonly blockedReason: string | null }
export function pluginRow(value: unknown, path = 'reply'): PluginRow {
  const r = rec(value, path);
  return {
    id: id(r['id'], `${path}.id`), name: str(r['name'], `${path}.name`, 200), maker: str(r['maker'], `${path}.maker`, 200),
    level: oneOf(r['level'], `${path}.level`, LEVELS), kind: oneOf(r['kind'], `${path}.kind`, ['data', 'code'] as const),
    status: str(r['status'], `${path}.status`, 100), blockedReason: optStr(r['blockedReason'], `${path}.blockedReason`, 1000),
  };
}
export interface Plugins { readonly plugins: readonly PluginRow[]; readonly blockedList: { readonly version: string; readonly checkedAt: string } }
export function plugins(value: unknown): Plugins {
  const r = rec(value), b = rec(r['blockedList'], 'reply.blockedList');
  return { plugins: list(r['plugins'], 'reply.plugins', pluginRow, 500), blockedList: { version: str(b['version'], 'reply.blockedList.version', 100), checkedAt: when(b['checkedAt'], 'reply.blockedList.checkedAt') } };
}

export type Signature = 'valid' | 'invalid' | 'missing' | 'key-changed';
export type AskKind = 'calculation' | 'action' | 'site';
export interface Inspection {
  readonly maker: string; readonly level: Level; readonly version: string; readonly licence: string; readonly signature: Signature; readonly digest: string;
  readonly doors: readonly { readonly id: string; readonly open: boolean }[];
  readonly asks: readonly { readonly id: string; readonly kind: AskKind; readonly name: string; readonly answer: false }[];
  readonly flagged: readonly { readonly field: string; readonly text: string }[];
  readonly refused: string | null;
}
export function inspection(value: unknown): Inspection {
  const r = rec(value);
  const digest = id(r['digest'], 'reply.digest');
  return {
    maker: str(r['maker'], 'reply.maker', 200), level: oneOf(r['level'], 'reply.level', LEVELS), version: str(r['version'], 'reply.version', 100),
    licence: str(r['licence'], 'reply.licence', 200), signature: oneOf(r['signature'], 'reply.signature', ['valid', 'invalid', 'missing', 'key-changed'] as const), digest,
    doors: list(r['doors'], 'reply.doors', (v, p) => { const d = rec(v, p); return { id: id(d['id'], `${p}.id`), open: bool(d['open'], `${p}.open`) }; }, 20),
    asks: list(r['asks'], 'reply.asks', (v, p) => {
      const a = rec(v, p);
      if (a['answer'] !== false) throw new ShapeError(`${p}.answer`);
      return { id: id(a['id'], `${p}.id`), kind: oneOf(a['kind'], `${p}.kind`, ['calculation', 'action', 'site'] as const), name: str(a['name'], `${p}.name`, 300), answer: false as const };
    }, 200),
    flagged: list(r['flagged'], 'reply.flagged', (v, p) => { const f = rec(v, p); return { field: str(f['field'], `${p}.field`, 200), text: str(f['text'], `${p}.text`, 4000) }; }, 100),
    refused: optStr(r['refused'], 'reply.refused', 1000),
  };
}

export interface Removed { readonly removed: true; readonly kept: string }
export function removed(value: unknown): Removed {
  const r = rec(value);
  if (r['removed'] !== true) throw new ShapeError('reply.removed');
  return { removed: true, kept: str(r['kept'], 'reply.kept', 1000) };
}

export interface LanguagePack { readonly id: string; readonly name: string; readonly passed: number; readonly total: number; readonly supported: boolean; readonly reviewed: boolean }
export function languagePacks(value: unknown): readonly LanguagePack[] {
  return list(rec(value)['packs'], 'reply.packs', (v, p) => {
    const k = rec(v, p), cases = rec(k['cases'], `${p}.cases`);
    const passed = int(cases['passed'], `${p}.cases.passed`), total = int(cases['total'], `${p}.cases.total`);
    if (passed < 0 || total < 0 || passed > total) throw new ShapeError(`${p}.cases`);
    return { id: id(k['id'], `${p}.id`), name: str(k['name'], `${p}.name`, 100), passed, total, supported: bool(k['supported'], `${p}.supported`), reviewed: bool(k['reviewed'], `${p}.reviewed`) };
  }, 100);
}

/** Any object: for a change whose reply the screen does not draw (it reloads instead). */
export function anyObject(value: unknown): Readonly<Record<string, unknown>> { return rec(value); }

// ---- the plugin package file, checked before anything is sent ----

/** Largest package file read from disk. */
export const PACKAGE_MAX_BYTES = 2 * 1024 * 1024;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
export interface PluginPackage {
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly moduleBase64: string;
  readonly publisher?: { readonly name: string; readonly publicKey: string };
  readonly signature?: string;
  readonly licence?: string;
}
/** Parse a package file's text as data. Throws `ShapeError` for anything that is not a package. */
export function pluginPackage(text: string): PluginPackage {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ShapeError('package'); }
  const r = rec(parsed, 'package');
  if (Object.keys(r).some((k) => !['manifest', 'moduleBase64', 'publisher', 'signature', 'licence'].includes(k))) throw new ShapeError('package');
  const moduleBase64 = str(r['moduleBase64'], 'package.moduleBase64', PACKAGE_MAX_BYTES);
  if (moduleBase64.length === 0 || moduleBase64.length % 4 !== 0 || !BASE64.test(moduleBase64)) throw new ShapeError('package.moduleBase64');
  const out: { -readonly [K in keyof PluginPackage]: PluginPackage[K] } = { manifest: rec(r['manifest'], 'package.manifest'), moduleBase64 };
  if (r['publisher'] !== undefined) {
    const p = rec(r['publisher'], 'package.publisher');
    out.publisher = { name: str(p['name'], 'package.publisher.name', 200), publicKey: str(p['publicKey'], 'package.publisher.publicKey', 4000) };
  }
  if (r['signature'] !== undefined) out.signature = str(r['signature'], 'package.signature', 4000);
  if (r['licence'] !== undefined) out.licence = str(r['licence'], 'package.licence', 200);
  return out;
}
