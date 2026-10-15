/**
 * TL tools adapters over models-ext's plugin methods (`platform/runtime/smallapps/plugin-methods.ts`):
 * wrapping a tool from outside (`smallapps.pluginWrap`, then `smallapps.pluginInstall` with the exact
 * document it returned), the plugin network door (`pluginPrepareRemote` → `pluginRemotePreview` →
 * `pluginApproveRemote` → `pluginCallRemote` once, and `pluginLedger`), and the pending request list
 * models-ext adds this round (`smallapps.pendingRequests`, contract in docs/lanes/models-ext.md
 * "TL-07 pending requests"). Every reply is checked; every piece of outside text arrives marked
 * `{ kind: 'untrusted-text', text }` and is kept only as text to show as data.
 */
import type { Language } from '../../../app/presentation.ts';
import { ShapeError, bool, int, list, oneOf, optStr, rec, str, strings, type Rec } from '../../trust/kit/validate.ts';
import { id, optWhen, when } from '../validate.ts';

export const REMOTE = {
  wrap: 'smallapps.pluginWrap', install: 'smallapps.pluginInstall', list: 'smallapps.pluginList', get: 'smallapps.pluginGet',
  prepare: 'smallapps.pluginPrepareRemote', preview: 'smallapps.pluginRemotePreview', approve: 'smallapps.pluginApproveRemote',
  call: 'smallapps.pluginCallRemote', ledger: 'smallapps.pluginLedger', pending: 'smallapps.pendingRequests',
} as const;
/** The only approve methods a request sheet may call, each with exactly `{ previewId, digest }`. */
export const APPROVE_METHODS: ReadonlySet<string> = new Set([REMOTE.approve]);

const DIGEST = /^[a-f0-9]{64}$/;
function digestOf(value: unknown, path: string): string {
  const d = str(value, path, 64);
  if (!DIGEST.test(d)) throw new ShapeError(path);
  return d;
}
/** Outside text as models-ext marks it; only its text is kept, to be shown as data. */
export function outside(value: unknown, path: string, max = 65536): string {
  if (typeof value === 'string') return str(value, path, max);
  const u = rec(value, path);
  if (u['kind'] !== 'untrusted-text') throw new ShapeError(`${path}.kind`);
  return str(u['text'], `${path}.text`, max);
}
function optOutside(value: unknown, path: string): string | null { return value === null || value === undefined ? null : outside(value, path); }
/** The engine's own two-language words, in this language. */
function engineWords(value: unknown, path: string, language: Language): string {
  const w = rec(value, path);
  return str(w[language] ?? w['en'], `${path}.${language}`, 2000);
}
function optWords(value: unknown, path: string, language: Language): string | null {
  return value === null || value === undefined ? null : engineWords(value, path, language);
}

// ---- TL-06 wrap ----

export interface WrapPreview {
  /** Sent back to `smallapps.pluginInstall` exactly as returned; the engine parses and reviews it again. */
  readonly document: Rec;
  readonly digest: string; readonly name: string; readonly version: string; readonly publisher: string;
  readonly description: string; readonly signature: string; readonly signatureWords: string;
  readonly support: 'supported' | 'experimental'; readonly experimentalReasons: readonly string[];
  readonly items: readonly { readonly kind: string; readonly name: string; readonly words: string }[];
  readonly doors: readonly { readonly door: string; readonly subject: string | null; readonly status: string; readonly words: string }[];
  readonly refusals: readonly { readonly code: string; readonly subject: string | null; readonly words: string }[];
  readonly refused: readonly { readonly path: string; readonly code: string; readonly words: string }[];
  readonly ignoredFields: readonly string[]; readonly installable: boolean;
}
export function wrapPreview(value: unknown, language: Language): WrapPreview {
  const r = rec(value), v = rec(r['review'], 'reply.review'), sig = rec(v['signature'], 'reply.review.signature');
  const digest = digestOf(r['digest'], 'reply.digest');
  if (digestOf(v['digest'], 'reply.review.digest') !== digest) throw new ShapeError('reply.review.digest');
  return {
    document: rec(r['document'], 'reply.document'), digest,
    name: str(v['name'], 'reply.review.name', 200), version: str(v['version'], 'reply.review.version', 100), publisher: str(v['publisher'], 'reply.review.publisher', 200),
    description: outside(v['description'], 'reply.review.description', 4000), signature: str(sig['status'], 'reply.review.signature.status', 40),
    signatureWords: engineWords(sig['words'], 'reply.review.signature.words', language),
    support: oneOf(v['support'], 'reply.review.support', ['supported', 'experimental'] as const), experimentalReasons: strings(v['experimentalReasons'], 'reply.review.experimentalReasons', 20),
    items: list(v['items'], 'reply.review.items', (x, p) => { const i = rec(x, p); return { kind: str(i['kind'], `${p}.kind`, 40), name: str(i['name'], `${p}.name`, 200), words: engineWords(i['words'], `${p}.words`, language) }; }, 500),
    doors: list(v['doors'], 'reply.review.doors', (x, p) => {
      const d = rec(x, p);
      return { door: str(d['door'], `${p}.door`, 40), subject: d['subject'] === null ? null : outside(d['subject'], `${p}.subject`, 500), status: str(d['status'], `${p}.status`, 40), words: engineWords(d['words'], `${p}.words`, language) };
    }, 200),
    refusals: list(v['refusals'], 'reply.review.refusals', (x, p) => {
      const f = rec(x, p);
      return { code: str(f['code'], `${p}.code`, 80), subject: f['subject'] === null || f['subject'] === undefined ? null : outside(f['subject'], `${p}.subject`, 500), words: engineWords(f['words'], `${p}.words`, language) };
    }, 200),
    refused: list(r['refused'] ?? [], 'reply.refused', (x, p) => { const f = rec(x, p); return { path: str(f['path'] ?? '', `${p}.path`, 300), code: str(f['code'], `${p}.code`, 80), words: engineWords(f['words'], `${p}.words`, language) }; }, 200),
    ignoredFields: strings(r['ignoredFields'] ?? [], 'reply.ignoredFields', 100), installable: bool(v['installable'], 'reply.review.installable'),
  };
}
export function installed(value: unknown): { readonly id: string; readonly digest: string } {
  const r = rec(value);
  return { id: id(r['id'], 'reply.id'), digest: digestOf(r['digest'], 'reply.digest') };
}

// ---- the network door ----

export interface RemoteTool { readonly name: string; readonly takesArguments: boolean; readonly runnable: boolean }
export interface PluginRow { readonly id: string; readonly name: string; readonly publisherId: string; readonly tools: number }
export function plugins(value: unknown): readonly PluginRow[] {
  return list(rec(value)['installed'], 'reply.installed', (x, p) => {
    const r = rec(x, p), contains = rec(r['contains'], `${p}.contains`);
    return { id: id(r['id'], `${p}.id`), name: str(r['name'], `${p}.name`, 200), publisherId: str(r['publisherId'], `${p}.publisherId`, 200), tools: int(contains['tools'], `${p}.contains.tools`) };
  }, 500);
}
/** The tools of one plugin that go through the network door. */
export function remoteTools(value: unknown): readonly RemoteTool[] {
  return list(rec(value)['tools'], 'reply.tools', (x, p) => {
    const t = rec(x, p);
    return { name: str(t['name'], `${p}.name`, 200), callWith: optStr(t['callWith'], `${p}.callWith`, 100), takesArguments: bool(t['takesArguments'], `${p}.takesArguments`), runnable: bool(t['runnable'], `${p}.runnable`) };
  }, 200).filter((t) => t.callWith === REMOTE.prepare).map(({ name, takesArguments, runnable }) => ({ name, takesArguments, runnable }));
}

export interface RemoteRequest { readonly site: string; readonly method: 'GET' | 'POST'; readonly url: string; readonly body: string | null; readonly bodyDigest: string | null; readonly bodyBytes: number; readonly credential: boolean }
export interface RemotePreview {
  readonly previewId: string; readonly digest: string; readonly pluginId: string; readonly tool: string;
  readonly status: 'prepared' | 'executing' | 'executed' | 'interrupted'; readonly createdBy: string; readonly createdAt: string; readonly expiresAt: string;
  readonly requests: readonly RemoteRequest[]; readonly approvable: boolean; readonly words: string;
}
export function remotePreview(value: unknown, language: Language): RemotePreview {
  const r = rec(value), previewId = id(r['previewId'], 'reply.previewId'), digest = digestOf(r['digest'], 'reply.digest');
  const status = oneOf(r['status'], 'reply.status', ['prepared', 'executing', 'executed', 'interrupted'] as const);
  const approveWith = r['approveWith'] === null || r['approveWith'] === undefined ? null : rec(r['approveWith'], 'reply.approveWith');
  if (approveWith !== null && (approveWith['method'] !== REMOTE.approve || approveWith['previewId'] !== previewId || approveWith['digest'] !== digest)) throw new ShapeError('reply.approveWith');
  if ((approveWith !== null) !== (status === 'prepared')) throw new ShapeError('reply.approveWith');
  return {
    previewId, digest, pluginId: id(r['pluginId'], 'reply.pluginId'), tool: str(r['tool'], 'reply.tool', 200), status,
    createdBy: str(r['createdBy'], 'reply.createdBy', 200), createdAt: when(r['createdAt'], 'reply.createdAt'), expiresAt: when(r['expiresAt'], 'reply.expiresAt'),
    requests: list(r['requests'], 'reply.requests', (x, p) => {
      const q = rec(x, p);
      return {
        site: str(q['site'], `${p}.site`, 253), method: oneOf(q['method'], `${p}.method`, ['GET', 'POST'] as const), url: outside(q['url'], `${p}.url`, 2000),
        body: optOutside(q['body'], `${p}.body`), bodyDigest: q['bodyDigest'] === null ? null : digestOf(q['bodyDigest'], `${p}.bodyDigest`),
        bodyBytes: int(q['bodyBytes'], `${p}.bodyBytes`), credential: bool(q['credential'], `${p}.credential`),
      };
    }, 4),
    approvable: approveWith !== null, words: engineWords(r['words'], 'reply.words', language),
  };
}
export interface RemoteApproval { readonly approvalId: string; readonly previewId: string; readonly digest: string; readonly expiresAt: string }
export function remoteApproval(value: unknown): RemoteApproval {
  const r = rec(value);
  if (r['singleUse'] !== true) throw new ShapeError('reply.singleUse');
  return { approvalId: id(r['approvalId'], 'reply.approvalId'), previewId: id(r['previewId'], 'reply.previewId'), digest: digestOf(r['digest'], 'reply.digest'), expiresAt: when(r['expiresAt'], 'reply.expiresAt') };
}
export interface RemoteResult {
  readonly receiptId: string;
  readonly network: readonly { readonly site: string; readonly method: string; readonly status: number | null; readonly responseBytes: number; readonly credential: boolean }[];
  readonly responses: readonly { readonly site: string; readonly status: number; readonly bytes: number; readonly body: string | null; readonly withheld: boolean }[];
  readonly signal: { readonly value: number; readonly receiptId: string | null } | null;
  readonly note: string | null;
}
export function remoteResult(value: unknown, language: Language): RemoteResult {
  const r = rec(value), kind = oneOf(r['kind'], 'reply.kind', ['plugin-response', 'plugin-signal'] as const);
  const receipt = r['receipt'] === null || r['receipt'] === undefined ? null : rec(r['receipt'], 'reply.receipt');
  return {
    receiptId: id(r['receiptId'], 'reply.receiptId'),
    network: list(r['network'], 'reply.network', (x, p) => {
      const n = rec(x, p);
      return { site: str(n['site'], `${p}.site`, 253), method: str(n['method'], `${p}.method`, 10), status: n['status'] === null ? null : int(n['status'], `${p}.status`), responseBytes: int(n['responseBytes'], `${p}.responseBytes`), credential: bool(n['credential'], `${p}.credential`) };
    }, 4),
    responses: kind === 'plugin-response' ? list(r['responses'], 'reply.responses', (x, p) => {
      const o = rec(x, p), withheld = bool(o['withheld'], `${p}.withheld`), body = optOutside(o['body'], `${p}.body`);
      if (withheld && body !== null) throw new ShapeError(`${p}.body`);
      return { site: str(o['site'], `${p}.site`, 253), status: int(o['status'], `${p}.status`), bytes: int(o['bytes'], `${p}.bytes`), body, withheld };
    }, 4) : [],
    signal: kind === 'plugin-signal' ? { value: int(r['value'], 'reply.value'), receiptId: receipt === null ? null : id(receipt['receiptId'], 'reply.receipt.receiptId') } : null,
    note: optWords(r['note'], 'reply.note', language),
  };
}
export interface LedgerEntry {
  readonly id: string; readonly at: string; readonly plugin: string; readonly tool: string; readonly site: string; readonly method: string;
  readonly requestBytes: number; readonly responseBytes: number; readonly status: number | null; readonly outcome: 'ok' | 'refused' | 'failed'; readonly code: string | null; readonly credential: boolean;
}
export function ledger(value: unknown, language: Language): { readonly entries: readonly LedgerEntry[]; readonly total: number; readonly words: string } {
  const r = rec(value);
  return {
    total: int(r['total'], 'reply.total'), words: engineWords(r['words'], 'reply.words', language),
    entries: list(r['entries'], 'reply.entries', (x, p) => {
      const e = rec(x, p);
      return {
        id: id(e['id'], `${p}.id`), at: when(e['at'], `${p}.at`), plugin: str(e['plugin'], `${p}.plugin`, 300), tool: str(e['tool'], `${p}.tool`, 200),
        site: str(e['site'], `${p}.site`, 253), method: str(e['method'], `${p}.method`, 10), requestBytes: int(e['requestBytes'], `${p}.requestBytes`),
        responseBytes: int(e['responseBytes'], `${p}.responseBytes`), status: e['status'] === null ? null : int(e['status'], `${p}.status`),
        outcome: oneOf(e['outcome'], `${p}.outcome`, ['ok', 'refused', 'failed'] as const), code: optStr(e['code'], `${p}.code`, 80), credential: bool(e['credential'], `${p}.credential`),
      };
    }, 1000),
  };
}

// ---- TL-07 pending requests (models-ext, this round) ----

export interface PendingRequest {
  readonly id: string; readonly kind: 'plugin-network' | 'plugin-tool' | 'mcp-call'; readonly pluginId: string; readonly plugin: string; readonly tool: string;
  readonly site: string | null; readonly method: string | null; readonly question: string; readonly receives: readonly string[];
  readonly preparedBy: string; readonly preparedAt: string; readonly expiresAt: string | null;
  /** How to approve it: only an allowlisted method is ever called, with exactly `{ previewId, digest }`. */
  readonly approveWith: { readonly method: string; readonly previewId: string; readonly digest: string; readonly allowed: boolean };
}
export function pending(value: unknown): readonly PendingRequest[] {
  return list(rec(value)['requests'], 'reply.requests', (x, p) => {
    const r = rec(x, p), a = rec(r['approveWith'], `${p}.approveWith`), method = str(a['method'], `${p}.approveWith.method`, 100);
    return {
      id: id(r['id'], `${p}.id`), kind: oneOf(r['kind'], `${p}.kind`, ['plugin-network', 'plugin-tool', 'mcp-call'] as const),
      pluginId: id(r['pluginId'], `${p}.pluginId`), plugin: str(r['plugin'], `${p}.plugin`, 300), tool: str(r['tool'], `${p}.tool`, 200),
      site: optStr(r['site'], `${p}.site`, 253), method: optStr(r['method'], `${p}.method`, 10),
      question: outside(r['question'], `${p}.question`, 4000), receives: list(r['receives'], `${p}.receives`, (v, q) => outside(v, q, 1000), 50),
      preparedBy: str(r['preparedBy'], `${p}.preparedBy`, 200), preparedAt: when(r['preparedAt'], `${p}.preparedAt`), expiresAt: optWhen(r['expiresAt'], `${p}.expiresAt`),
      approveWith: { method, previewId: id(a['previewId'], `${p}.approveWith.previewId`), digest: digestOf(a['digest'], `${p}.approveWith.digest`), allowed: APPROVE_METHODS.has(method) },
    };
  }, 500);
}
