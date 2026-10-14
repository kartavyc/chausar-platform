import { randomBytes } from 'node:crypto';
import { authorize, audit, check, ChausarError, newId, now, type Context, type StateStore } from '../contracts.ts';
import { APPROVED_CONNECTOR_GROUPS } from '../connectors.ts';
import { readWorkbook } from '../workbook.ts';
import { currentAccess } from '../memory.ts';
import { runApiRead, type ReadCredentials } from '../adapters/read-kit.ts';
import type { BoundedHttp } from '../connectors.ts';
import type { ModuleHost } from '../modules/types.ts';
import { RECIPES, recipe as registeredRecipe, runRegistered, DECODERS } from './recipes/index.ts';
import { boardCounts, buildCatalogue, type WriteRow } from './catalogue.ts';
import { READS, readsFor } from './reads.ts';
import { commitOutcome } from './importer.ts';
import { authorizeUrl, KEY_SIGN_IN, pkce, providerFor } from './oauth.ts';
import { decide, recordRun, SCHEDULE_LIMITS, stale, validateSchedule } from './schedule.ts';
import type { ConnectorCredentialStore } from './credentials.ts';
import type { SchedulerHost } from '../modules/types.ts';
import { sourceAllowed } from '../trust.ts';
import { cxState, freshness, LIMITS, peekCx, prune, publicEnvelope, type Connection, type Envelope } from './state.ts';
import type { RecipeOutcome, Road } from './types.ts';
import { compileRecipe, runRecipe, type DecoderInput, type SourceRecipe } from './recipe.ts';
import { extractBankPdfWithOcr, pdfTextToRows } from './bank-pdf.ts';
import { matchPurchaseRegister, type MatchLine } from './gst-match.ts';
import { listTables, plainDbRead, type PlainDbConnection } from './plain-db/index.ts';

/** Trusted host options for this module (engine `modules['connectors-ext']`). Never from an RPC payload. */
export type ConnectorsHostOptions = {
  /** Returns a token or key for one system and origin; the token is never stored in workspace state. */
  credentialBroker?: (ctx: Context, request: Parameters<ReadCredentials>[0]) => Promise<string>;
  http?: BoundedHttp;
  oauthClients?: Record<string, { clientId: string; redirectUri: string }>;
  /** Resolves a database password reference held by the host keychain. */
  databaseCredentials?: (ctx: Context, ref: string) => Promise<string>;
  /** The local sealed credential store; keys typed in Trust, credentials go here, never into workspace state. */
  credentialStore?: ConnectorCredentialStore;
  tokenExchange?: (ctx: Context, request: { provider: string; code: string; verifier: string; redirectUri: string; scopes: string[]; connectionId: string; sourceId: string; settings: Record<string, string> }) => Promise<{ ok: true }>;
};
const REQUEST = 'CONNECTOR_REQUEST_INVALID';
const plain = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
export function shape(payload: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = []) {
  check(plain(payload) && Object.keys(payload).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(payload, key)), REQUEST, 'This connector request has unexpected or missing fields.');
}
const text = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
function period(value: unknown): { from: string; to: string } | null {
  if (value === undefined || value === null) return null;
  check(plain(value) && Object.keys(value).length === 2 && ISO.test(value.from) && ISO.test(value.to) && value.from <= value.to, REQUEST, 'A period has a from and a to date.');
  return { from: value.from, to: value.to };
}
function reportTotals(value: unknown) {
  if (value === undefined) return undefined;
  check(plain(value) && Object.keys(value).every(k => ['rowCount', 'total'].includes(k)) && typeof value.total === 'string' && /^-?\d{1,30}$/.test(value.total)
    && (value.rowCount === undefined || value.rowCount === null || (Number.isSafeInteger(value.rowCount) && value.rowCount >= 0)), 'INVALID_SOURCE_TOTALS', 'Enter the report total as whole minor units and an optional row count.');
  return { total: value.total as string, rowCount: (value.rowCount ?? null) as number | null };
}
const view = (store: StateStore, state: any): StateStore => ({ read: () => state, update: store.update.bind(store) });
function connection(store: StateStore, id: unknown): Connection {
  check(text(id, 100), REQUEST, 'Choose a connection.');
  const found = peekCx(store.read()).connections.find(item => item.id === id);
  check(found, 'CONNECTION_NOT_FOUND', 'This connection does not exist.');
  return found;
}
const options = (host: ModuleHost) => host.options as ConnectorsHostOptions;
/** Methods that reach outside, persist a way in, or move secrets need the person at the desktop, not text-driven or remote callers. */
function trusted(ctx: Context) {
  check((ctx.channel === undefined || ctx.channel === 'desktop') && ctx.sourceTainted !== true, 'OPEN_DESKTOP', 'Do this yourself in the desktop app.');
}
/** Branch and source trust for one connection, checked before any network access. */
function scoped(host: ModuleHost, ctx: Context, item: Connection) { currentAccess(host.store, ctx, item.branch, item.sourceId); }
/** Listings show only connections in the caller's branches and allowed sources. */
function visible(host: ModuleHost, ctx: Context) {
  const state = host.store.read(), member = authorize(host.store, ctx);
  return (item: { branch: string; sourceId: string }) => (member.branches.includes('*') || member.branches.includes(item.branch)) && sourceAllowed(state, ctx, item.sourceId);
}

function databaseConnection(item: Connection): PlainDbConnection {
  const s = item.settings;
  if (s.engine === 'sqlite') return { engine: 'sqlite', path: s.path ?? '' };
  check(s.engine === 'postgres' || s.engine === 'mysql', REQUEST, 'Choose PostgreSQL, MySQL or SQLite.');
  check(/^\d{1,5}$/.test(s.port ?? ''), REQUEST, 'Give the database port.');
  return { engine: s.engine, host: s.host ?? '', port: Number(s.port), database: s.database ?? '', user: s.user ?? '', ssl: s.ssl === 'disable' ? 'disable' : 'require', passwordRef: item.sourceId } as PlainDbConnection;
}
/** The resolver answers only for this connection's own stored password, never another source's key. */
function databaseOptions(ctx: Context, host: ModuleHost, item: Connection) {
  const resolve = options(host).databaseCredentials;
  return resolve ? { credentials: (ref: string) => { check(ref === item.sourceId, 'DB_CREDENTIAL_REQUIRED', 'Enter the database password in Trust, credentials.'); return resolve(ctx, ref); } } : {};
}
/** Summaries only: a reply never carries source rows. */
export function outcomeSummary(envelope: Envelope) { return publicEnvelope(envelope); }

async function recordEnvelope(host: ModuleHost, ctx: Context, input: { outcome: RecipeOutcome | null; failure?: { code: string }; connection: Connection | null; target: { sourceId: string; company: string; branch: string };
  recipe: SourceRecipe; road: Road; requestedPeriod: { from: string; to: string } | null; read?: Envelope['read'] }): Promise<Envelope> {
  const recipe = input.recipe, outcome = input.outcome;
  return host.store.update(state => {
    authorize(view(host.store, state), ctx, 'prepare');
    const cx = cxState(state); prune(cx, Date.now());
    const pendingRows = cx.envelopes.reduce((sum, item) => sum + (item.pending?.records.length ?? 0), 0);
    const keep = outcome?.status === 'accepted' && pendingRows + outcome.records.length <= LIMITS.pendingRecords;
    const envelope: Envelope = { id: newId('envelope'), connectionId: input.connection?.id ?? null, sourceId: input.target.sourceId, company: input.target.company, branch: input.target.branch, group: recipe.group, operation: recipe.operation,
      recipeId: recipe.id, recipeVersion: recipe.version, recipeDigest: outcome?.recipe.digest ?? '', road: input.road, fetchedAt: now(), requestedPeriod: input.requestedPeriod,
      period: outcome?.period ?? null, status: input.failure ? 'failed' : outcome!.status, refusal: input.failure ? { code: input.failure.code, reason: 'The read itself failed.' } : outcome!.refusal,
      abstention: outcome?.abstention ?? null, checks: outcome?.checks ?? [], observed: outcome?.observed ?? { rowCount: 0, total: '0', unit: '' }, sourceTotals: outcome?.sourceTotals ?? null,
      unmappedFields: outcome?.unmappedFields ?? [], excludedRows: outcome?.excludedRows ?? 0, contentHash: outcome?.contentHash ?? '', sensitivity: recipe.sensitivity, notices: outcome?.notices ?? [...(recipe.notices ?? [])],
      read: input.read ?? null, pending: keep ? { records: outcome!.records, measure: outcome!.recipe.measure, expiresAt: new Date(Date.now() + LIMITS.pendingTtlMs).toISOString() } : null,
      committed: null, createdBy: ctx.memberId };
    if (outcome?.status === 'accepted' && !keep) { envelope.status = 'refused'; envelope.refusal = { code: 'PENDING_LIMIT', reason: 'Too many rows are waiting. Import or discard earlier files first.' }; }
    cx.envelopes.push(envelope);
    audit(state, 'connectorsx.envelope', { envelopeId: envelope.id, sourceId: envelope.sourceId, status: envelope.status, code: envelope.refusal?.code ?? envelope.abstention?.reason ?? null });
    return structuredClone(envelope);
  });
}

async function writeRows(host: ModuleHost): Promise<WriteRow[] | null> {
  try {
    const reply: any = await host.call('writeback.catalogue', {});
    const rows = Array.isArray(reply) ? reply : Array.isArray(reply?.rows) ? reply.rows : null;
    if (!rows) return null;
    return rows.filter((row: any) => plain(row) && text(row.system, 80) && text(row.action, 120)).slice(0, 2000)
      .map((row: any) => ({ system: row.system, action: row.action, status: text(row.status, 40) ? row.status : 'experimental' }));
  } catch { return null; }
}

export const handlers = {
  async systems(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    shape(payload, ['group']);
    const groups = buildCatalogue(RECIPES.values(), READS.map(read => ({ group: read.group, id: read.id, label: read.label, recipe: read.recipe, live: read.live, limitation: read.limitation })), await writeRows(host));
    const selected = payload.group === undefined ? groups : groups.filter(group => group.id === payload.group);
    check(selected.length > 0, 'SYSTEM_NOT_FOUND', 'Choose one of the listed systems.');
    return { asOf: now(), groups: selected, board: boardCounts(groups), signIn: Object.fromEntries(selected.map(group => [group.id, providerFor(group.id) ? { method: 'browser', note: providerFor(group.id)!.note } : KEY_SIGN_IN[group.id] ? { method: 'key', note: KEY_SIGN_IN[group.id] } : { method: 'none', note: null }])) };
  },
  recipes(_ctx: Context, payload: Record<string, any>) {
    shape(payload, ['group']);
    return [...RECIPES.values()].filter(item => payload.group === undefined || item.group === payload.group).map(item => ({
      id: item.id, version: item.version, group: item.group, operation: item.operation, title: item.title, input: DECODERS.get(item.decoder)!.accepts,
      totals: item.totals.kind, measure: item.measure.type, sensitivity: item.sensitivity, notices: [...(item.notices ?? [])],
      fields: Object.entries(item.fields).map(([name, spec]) => ({ name, type: spec.type, required: spec.required === true, headings: [...spec.from] })) }));
  },
  async connect(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    trusted(ctx);
    shape(payload, ['group', 'road', 'label', 'company', 'branch', 'settings'], ['group', 'road', 'company']);
    const group = payload.group === 'plain-database' ? { id: 'plain-database', name: 'Plain database (read only)' } : APPROVED_CONNECTOR_GROUPS.find(item => item.id === payload.group);
    check(group, 'SYSTEM_NOT_FOUND', 'Choose one of the listed systems.');
    check((group.id === 'plain-database') === (payload.road === 'database'), REQUEST, 'A plain database is reached as a database, and only a plain database is.');
    check(['interface', 'file', 'screen', 'database'].includes(payload.road), REQUEST, 'Choose how Chausar reaches this system.');
    check(payload.road !== 'screen', 'SCREEN_EXPORT_NOT_BUILT', 'Driving the program on your screen is not built in this version. Export a file instead.');
    check(text(payload.company), REQUEST, 'Name the company this connection reads.');
    const branch = payload.branch ?? 'main'; check(text(branch, 100) && /^[A-Za-z0-9_.:-]+$/.test(branch), REQUEST, 'Name the branch.');
    const settings = payload.settings ?? {};
    check(plain(settings) && Object.keys(settings).length <= 20 && Object.values(settings).every(value => text(value, 300)), REQUEST, 'Connection settings are short text values.');
    check(!Object.keys(settings).some(key => /secret|password|token|key$|ref$/i.test(key)), 'CREDENTIAL_NOT_ACCEPTED', 'Credentials are never stored with a connection. Enter them in Trust, credentials.');
    if (payload.road === 'interface') {
      const reads = readsFor(group.id); check(reads.length > 0, 'READ_NOT_AVAILABLE', 'This system cannot be read through its own interface yet. Import an exported file.');
      const allowed = new Set(reads.flatMap(read => read.settings));
      check(Object.keys(settings).every(key => allowed.has(key)), REQUEST, 'A setting is not used by this system.');
      for (const read of reads) if (read.settings.every(key => Object.hasOwn(settings, key)) && read.parameters.length === 0) read.spec.validate(read.config(settings));
    } else if (payload.road === 'database') {
      check(Object.keys(settings).every(key => ['engine', 'host', 'port', 'database', 'user', 'ssl', 'path'].includes(key)), REQUEST, 'A setting is not used by database connections.');
      databaseConnection({ settings, sourceId: 'cx-plain-database-check' } as Connection);
    }
    else check(Object.keys(settings).length === 0, REQUEST, 'File connections take no settings.');
    return host.store.update(state => {
      const member = authorize(view(host.store, state), ctx, 'admin');
      check(member.branches.includes('*') || member.branches.includes(branch), 'FORBIDDEN_BRANCH', 'This branch is outside your current access.');
      const cx = cxState(state); check(cx.connections.length < LIMITS.connections, 'CONNECTION_LIMIT', 'Remove a connection before adding another.');
      const item: Connection = { id: newId('connection'), group: group.id, road: payload.road, label: text(payload.label, 120) ? payload.label : group.name, company: payload.company, branch,
        sourceId: `cx-${group.id}-${randomBytes(5).toString('hex')}`, settings: { ...settings }, status: 'active', createdAt: now(), createdBy: ctx.memberId };
      cx.connections.push(item); audit(state, 'connectorsx.connected', { connectionId: item.id, group: item.group, road: item.road });
      return structuredClone(item);
    });
  },
  connections(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    shape(payload, ['group']); const allowed = visible(host, ctx);
    return peekCx(host.store.read()).connections.filter(item => allowed(item) && (payload.group === undefined || item.group === payload.group)).map(item => structuredClone(item));
  },
  async pause(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    trusted(ctx);
    shape(payload, ['connectionId', 'paused'], ['connectionId', 'paused']); check(typeof payload.paused === 'boolean', REQUEST, 'Say whether to pause.');
    connection(host.store, payload.connectionId);
    return host.store.update(state => { authorize(view(host.store, state), ctx, 'admin'); const item = cxState(state).connections.find(c => c.id === payload.connectionId)!; item.status = payload.paused ? 'paused' : 'active'; audit(state, 'connectorsx.paused', { connectionId: item.id, paused: payload.paused }); return structuredClone(item); });
  },
  async disconnect(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    trusted(ctx);
    shape(payload, ['connectionId'], ['connectionId']); const gone = connection(host.store, payload.connectionId);
    options(host).credentialStore?.remove(gone.sourceId);
    return host.store.update(state => {
      authorize(view(host.store, state), ctx, 'admin'); const cx = cxState(state);
      cx.connections = cx.connections.filter(item => item.id !== payload.connectionId);
      for (const envelope of cx.envelopes) if (envelope.connectionId === payload.connectionId) envelope.pending = null;
      const removed = cx.connections.length;
      audit(state, 'connectorsx.disconnected', { connectionId: payload.connectionId, remaining: removed });
      return { removed: true, factsKept: true, note: 'Facts already imported stay until you delete the source in Books, Sources.' };
    });
  },
  async signIn(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    trusted(ctx);
    shape(payload, ['connectionId', 'operation'], ['connectionId']);
    const item = connection(host.store, payload.connectionId), provider = providerFor(item.group);
    if (!provider) return { method: KEY_SIGN_IN[item.group] ? 'key' : 'none', instruction: KEY_SIGN_IN[item.group] ?? 'This system needs no sign-in.' };
    const client = options(host).oauthClients?.[provider.id];
    check(client, 'OAUTH_CLIENT_REQUIRED', 'Sign-in for this system needs a registered sign-in app. This is a decision for the workspace owner.');
    const scopeKey = item.group === 'google-workspace' ? (payload.operation ?? 'sheets') : item.group;
    const scopes = provider.scopes[scopeKey]; check(scopes, REQUEST, 'Choose what to read.');
    const { verifier, challenge, state: nonce } = pkce();
    const url = authorizeUrl(provider, { clientId: client!.clientId, redirectUri: client!.redirectUri, scopes, settings: item.settings, challenge, state: nonce });
    await host.store.update(state => { authorize(view(host.store, state), ctx, 'admin'); const cx = cxState(state); prune(cx, Date.now());
      cx.signIns.push({ state: nonce, provider: provider.id, connectionId: item.id, verifier, redirectUri: client!.redirectUri, scopes: [...scopes], expiresAt: new Date(Date.now() + LIMITS.signInTtlMs).toISOString(), createdBy: ctx.memberId }); });
    return { method: 'browser', authorizeUrl: url, scopes: [...scopes], expiresInSeconds: LIMITS.signInTtlMs / 1000, note: provider.note };
  },
  async signInComplete(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    trusted(ctx);
    shape(payload, ['state', 'code'], ['state', 'code']); check(text(payload.state, 200) && text(payload.code, 2000), REQUEST, 'Sign-in returned an unexpected answer.');
    const exchange = options(host).tokenExchange;
    check(exchange, 'TOKEN_EXCHANGE_HOST_REQUIRED', 'The credential broker that finishes sign-in is not installed.');
    const attempt = await host.store.update(state => {
      authorize(view(host.store, state), ctx, 'admin'); const cx = cxState(state); prune(cx, Date.now());
      const index = cx.signIns.findIndex(item => item.state === payload.state && item.createdBy === ctx.memberId);
      check(index >= 0, 'SIGN_IN_EXPIRED', 'This sign-in expired or was already used. Start again.');
      return cx.signIns.splice(index, 1)[0];
    });
    const item = connection(host.store, attempt.connectionId);
    await exchange!(ctx, { provider: attempt.provider, code: payload.code, verifier: attempt.verifier, redirectUri: attempt.redirectUri, scopes: attempt.scopes, connectionId: item.id, sourceId: item.sourceId, settings: { ...item.settings } });
    return { signedIn: true, connectionId: item.id };
  },
  async read(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    trusted(ctx);
    shape(payload, ['connectionId', 'operation', 'period', 'reportTotals', 'parameters'], ['connectionId', 'operation']);
    const item = connection(host.store, payload.connectionId);
    check(item.status === 'active', 'CONNECTION_PAUSED', 'This connection is paused.'); scoped(host, ctx, item);
    check(item.road === 'interface', 'READ_NOT_AVAILABLE', 'This connection is read from files. Import an exported file.');
    const binding = readsFor(item.group).find(read => read.id === payload.operation); check(binding, 'READ_NOT_AVAILABLE', 'This system has no such read.');
    const requested = period(payload.period), totals = reportTotals(payload.reportTotals), parameters = payload.parameters ?? {};
    check(plain(parameters) && Object.keys(parameters).every(key => binding!.parameters.includes(key)) && Object.values(parameters).every(value => text(value, 200)), REQUEST, 'This read takes different choices.');
    const broker = options(host).credentialBroker;
    const credentials: ReadCredentials | undefined = broker ? request => broker(ctx, request) : undefined;
    let result: Awaited<ReturnType<typeof runApiRead>>;
    try { result = await runApiRead(binding!.spec, { config: binding!.config(item.settings, parameters), sourceId: item.sourceId, period: requested, credentials, http: options(host).http }); }
    catch (error) {
      const code = error instanceof ChausarError ? error.code : 'SOURCE_READ_FAILED';
      await recordEnvelope(host, ctx, { outcome: null, failure: { code }, connection: item, target: item, recipe: registeredRecipe(binding!.recipe), road: 'interface', requestedPeriod: requested });
      throw error instanceof ChausarError ? error : new ChausarError('SOURCE_READ_FAILED', 'The read failed. Nothing was retried.');
    }
    const declared = result.declared ?? null;
    const meta: Record<string, string> = declared ? { ...(declared.rowCount != null ? { declaredRowCount: String(declared.rowCount) } : {}), ...(declared.amount != null ? { declaredAmount: declared.amount, declaredAmountUnit: declared.amountUnit ?? 'major' } : {}), declaredReference: declared.reference ?? `${binding!.spec.system}-declared` } : {};
    const outcome = runRegistered(binding!.recipe, { records: result.records, meta }, totals ? { reportTotals: totals } : {});
    return outcomeSummary(await recordEnvelope(host, ctx, { outcome, connection: item, target: item, recipe: registeredRecipe(binding!.recipe), road: 'interface', requestedPeriod: requested, read: { pages: result.pages, requests: result.requests, bytes: result.bytes } }));
  },
  async importPreview(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    shape(payload, ['recipeId', 'connectionId', 'sourceId', 'company', 'branch', 'text', 'bytesBase64', 'pdfBase64', 'sheet', 'reportTotals'], ['recipeId']);
    const selected = registeredRecipe(payload.recipeId), decoder = DECODERS.get(selected.decoder)!;
    let target: { sourceId: string; company: string; branch: string }, item: Connection | null = null;
    if (payload.connectionId !== undefined) {
      item = connection(host.store, payload.connectionId); check(item.group === selected.group, 'RECIPE_SYSTEM_MISMATCH', 'This recipe belongs to another system.');
      check(item.status === 'active', 'CONNECTION_PAUSED', 'This connection is paused.'); target = item;
    } else {
      check(text(payload.sourceId, 100) && /^[A-Za-z0-9_.:-]+$/.test(payload.sourceId) && text(payload.company), REQUEST, 'Choose a connection, or name the source and company.');
      target = { sourceId: payload.sourceId, company: payload.company, branch: payload.branch ?? 'main' };
    }
    const input: DecoderInput = {}; let ocrNotice: string | null = null;
    if (decoder.accepts === 'text') { check(typeof payload.text === 'string' && payload.text.length <= 20 * 1024 * 1024, REQUEST, 'This recipe reads a text export.'); input.text = payload.text; }
    else if (decoder.accepts === 'rows' && payload.pdfBase64 !== undefined) {
      check(selected.decoder === 'bank-pdf-text', 'RECIPE_INPUT_MISMATCH', 'Only the bank statement PDF recipe reads PDF files.');
      // Pages with a text layer are read directly; scanned pages go to OCR (experimental) and must clear a confidence floor.
      const extracted = await extractBankPdfWithOcr(host.services.helper, payload.pdfBase64);
      input.rows = pdfTextToRows(extracted.pages).rows;
      if (extracted.ocrPages.length) ocrNotice = extracted.notice;
    } else if (decoder.accepts === 'rows') {
      check(typeof payload.bytesBase64 === 'string' && payload.bytesBase64.length <= 2_800_000 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.bytesBase64), REQUEST, 'Choose a bounded workbook.');
      const workbook = readWorkbook(Buffer.from(payload.bytesBase64, 'base64'), payload.sheet === undefined ? {} : { sheet: payload.sheet });
      check(workbook.sheets.length === 1, 'SHEET_REQUIRED', 'Choose the exact worksheet to import.');
      input.rows = workbook.sheets[0].rows;
    } else check(false, 'RECIPE_INPUT_MISMATCH', 'This recipe reads records from a connected system.');
    const outcome = runRegistered(selected.id, input, payload.reportTotals ? { reportTotals: reportTotals(payload.reportTotals) } : {});
    if (ocrNotice) outcome.notices.push(ocrNotice);
    return outcomeSummary(await recordEnvelope(host, ctx, { outcome, connection: item, target, recipe: selected, road: 'file', requestedPeriod: null }));
  },
  async importCommit(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    shape(payload, ['envelopeId'], ['envelopeId']); check(text(payload.envelopeId, 100), REQUEST, 'Choose a file or read to import.');
    const found = peekCx(host.store.read()).envelopes.find(item => item.id === payload.envelopeId);
    check(found, 'ENVELOPE_NOT_FOUND', 'This read is no longer waiting.');
    if (found.committed) return { ...outcomeSummary(found), duplicate: true };
    check(found.status === 'accepted' && found.pending, 'IMPORT_NOT_ACCEPTED', 'Only a read that passed its checks against the source\'s own totals can be imported.');
    check(Date.parse(found.pending.expiresAt) > Date.now(), 'ENVELOPE_EXPIRED', 'This read waited too long. Read or import the file again.');
    const outcome = { status: 'accepted', recipe: { id: found.recipeId, version: found.recipeVersion, group: found.group, operation: found.operation, measure: found.pending.measure, digest: found.recipeDigest },
      records: found.pending.records, observed: found.observed, sourceTotals: found.sourceTotals, checks: found.checks, unmappedFields: found.unmappedFields, excludedRows: found.excludedRows,
      refusal: null, abstention: null, period: found.period, contentHash: found.contentHash, notices: found.notices } as RecipeOutcome;
    const committed = await commitOutcome(host.store, host.services.imports, ctx, outcome, { sourceId: found.sourceId, company: found.company, branch: found.branch });
    return host.store.update(state => {
      const envelope = cxState(state).envelopes.find(item => item.id === found.id);
      check(envelope, 'ENVELOPE_NOT_FOUND', 'This read is no longer waiting.');
      envelope.committed = { importId: committed.importId, at: now(), rows: committed.rowIds.length, duplicate: committed.duplicate }; envelope.pending = null;
      audit(state, 'connectorsx.imported', { envelopeId: envelope.id, importId: committed.importId, rows: committed.rowIds.length });
      return outcomeSummary(envelope);
    });
  },
  async discard(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    shape(payload, ['envelopeId'], ['envelopeId']);
    return host.store.update(state => { authorize(view(host.store, state), ctx, 'prepare'); const envelope = cxState(state).envelopes.find(item => item.id === payload.envelopeId); check(envelope, 'ENVELOPE_NOT_FOUND', 'This read is no longer waiting.'); envelope.pending = null; return outcomeSummary(envelope); });
  },
  envelopes(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    const allowed = visible(host, ctx);
    shape(payload, ['sourceId', 'connectionId', 'limit']);
    const limit = payload.limit ?? 50; check(Number.isSafeInteger(limit) && limit >= 1 && limit <= 400, REQUEST, 'Choose how many reads to list.');
    return peekCx(host.store.read()).envelopes.filter(item => allowed(item) && (payload.sourceId === undefined || item.sourceId === payload.sourceId) && (payload.connectionId === undefined || item.connectionId === payload.connectionId))
      .slice(-limit).reverse().map(outcomeSummary);
  },
  freshness(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    const allowed = visible(host, ctx);
    shape(payload, ['sourceId', 'asOf']);
    const asOf = payload.asOf ?? now().slice(0, 10); check(typeof asOf === 'string' && ISO.test(asOf), REQUEST, 'Choose a date.');
    const state = host.store.read(), cx = peekCx(state);
    const sources = payload.sourceId !== undefined ? [payload.sourceId] : [...new Set([...cx.connections.map(item => item.sourceId), ...cx.envelopes.map(item => item.sourceId)])];
    return sources.filter(sourceId => { const item = cx.connections.find(c => c.sourceId === sourceId) ?? cx.envelopes.find(e => e.sourceId === sourceId); return !item || allowed(item); }).map(sourceId => {
      const item = cx.connections.find(c => c.sourceId === sourceId), view = freshness(state, sourceId, asOf);
      return { ...view, connection: item ? { id: item.id, group: item.group, road: item.road, label: item.label, status: item.status } : null,
        schedule: item?.schedule ? { operation: item.schedule.operation, everyHours: item.schedule.everyHours, freshnessTargetHours: item.schedule.freshnessTargetHours, catchUp: item.schedule.catchUp, lastRunAt: item.schedule.lastRunAt, lastOutcome: item.schedule.lastOutcome } : null,
        stale: stale(view.lastRead, item?.schedule ?? null, Date.now()) };
    });
  },
  async gstMatch(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    shape(payload, ['registerSourceId', 'gstr2bSourceId', 'period'], ['registerSourceId', 'gstr2bSourceId']);
    check(text(payload.registerSourceId, 100) && text(payload.gstr2bSourceId, 100) && payload.registerSourceId !== payload.gstr2bSourceId, REQUEST, 'Choose the purchase register and the GSTR-2B source.');
    const requested = period(payload.period), dictionary = host.services.ontology.current(ctx);
    check(dictionary, 'DICTIONARY_REQUIRED', 'Publish business meanings before matching.');
    const selection = host.services.memory.query(ctx, requested ? { period: requested } : {});
    const lines = (sourceId: string): MatchLine[] => selection.facts.filter((fact: any) => fact.sourceId === sourceId && fact.kind === 'purchase').map((fact: any) => ({
      entityId: fact.entityId, supplierGstin: String(fact.fields.gstin ?? fact.fields.customerId ?? ''), invoiceNumber: String(fact.fields.invoiceId ?? ''), invoiceDate: fact.validFrom,
      taxableMinor: String(fact.fields.amountMinor), taxMinor: fact.fields.taxMinor === undefined || fact.fields.taxMinor === null ? null : String(fact.fields.taxMinor), sourceRow: fact.sourceRow }));
    const register = lines(payload.registerSourceId), gstr2b = lines(payload.gstr2bSourceId);
    check(dictionary.gstMode !== 'regular' || (register.length > 0 && gstr2b.length > 0), 'GST_MATCH_SOURCES_EMPTY', 'Both the purchase register and GSTR-2B need imported purchases in this period. A source not loaded yet is not matched as empty.');
    return { gstMode: dictionary.gstMode, period: requested, ...matchPurchaseRegister({ register, gstr2b, gstMode: dictionary.gstMode, ...(requested ? { period: requested } : {}) }) };
  },
  async plainDbTables(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    trusted(ctx);
    shape(payload, ['connectionId'], ['connectionId']);
    const item = connection(host.store, payload.connectionId); check(item.road === 'database', 'READ_NOT_AVAILABLE', 'This connection is not a database.'); scoped(host, ctx, item);
    return listTables(databaseConnection(item), databaseOptions(ctx, host, item));
  },
  async plainDbRead(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    trusted(ctx);
    shape(payload, ['connectionId', 'mapping'], ['connectionId', 'mapping']);
    const item = connection(host.store, payload.connectionId); check(item.road === 'database', 'READ_NOT_AVAILABLE', 'This connection is not a database.');
    check(item.status === 'active', 'CONNECTION_PAUSED', 'This connection is paused.'); scoped(host, ctx, item);
    const read = await plainDbRead(databaseConnection(item), payload.mapping, databaseOptions(ctx, host, item));
    const recipe = compileRecipe(read.recipe, DECODERS);
    const outcome = runRecipe(recipe, DECODERS.get('api-records')!, { records: read.records, meta: Object.fromEntries(Object.entries(read.meta).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])) });
    return outcomeSummary(await recordEnvelope(host, ctx, { outcome, connection: item, target: item, recipe, road: 'database', requestedPeriod: payload.mapping?.period ?? null }));
  },
  async credentialsSet(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    shape(payload, ['connectionId', 'secret'], ['connectionId', 'secret']);
    trusted(ctx);
    const store = options(host).credentialStore; check(store, 'CREDENTIAL_STORE_REQUIRED', 'The local credential store is not available in this launch.');
    const item = connection(host.store, payload.connectionId);
    check(typeof payload.secret === 'string' && payload.secret.length >= 4 && payload.secret.length <= 4096 && !/[\u0000-\u001f]/.test(payload.secret), 'CREDENTIAL_INVALID', 'Paste the key exactly as the system shows it.');
    store!.set(item.sourceId, { kind: 'key', system: item.group, secret: payload.secret, storedAt: now() });
    await host.store.update(state => {
      authorize(view(host.store, state), ctx, 'admin'); const current = cxState(state).connections.find(c => c.id === item.id);
      audit(state, 'connectorsx.credential-stored', { connectionId: item.id });
    });
    return { stored: true, connectionId: item.id };
  },
  async credentialsRemove(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    trusted(ctx);
    shape(payload, ['connectionId'], ['connectionId']);
    const store = options(host).credentialStore; check(store, 'CREDENTIAL_STORE_REQUIRED', 'The local credential store is not available in this launch.');
    const item = connection(host.store, payload.connectionId);
    const removed = store!.remove(item.sourceId);
    await host.store.update(state => { authorize(view(host.store, state), ctx, 'admin'); audit(state, 'connectorsx.credential-removed', { connectionId: item.id }); });
    return { removed };
  },
  credentialsStatus(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    shape(payload, ['connectionId'], ['connectionId']);
    const item = connection(host.store, payload.connectionId), store = options(host).credentialStore;
    return store ? { available: true, ...store.has(item.sourceId) } : { available: false, present: false, kind: null, storedAt: null };
  },
  async schedule(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    trusted(ctx);
    shape(payload, ['connectionId', 'schedule'], ['connectionId', 'schedule']);
    const item = connection(host.store, payload.connectionId);
    let next: Connection['schedule'] = null;
    if (payload.schedule !== null) {
      check(plain(payload.schedule), REQUEST, 'Describe the schedule.');
      const chosen = validateSchedule(payload.schedule);
      check(item.road === 'interface', 'SCHEDULE_NOT_AVAILABLE', 'Only connections read through the system\'s own interface can repeat.');
      const binding = readsFor(item.group).find(read => read.id === chosen.operation);
      check(binding && binding.live && binding.parameters.length === 0, 'SCHEDULE_NOT_AVAILABLE', 'This read cannot repeat on its own.');
      check(registeredRecipe(binding!.recipe).totals.kind !== 'report', 'SCHEDULE_NEEDS_SOURCE_TOTAL', 'A read checked against a total you type cannot repeat on its own.');
      next = { ...chosen, lastRunAt: null, lastOutcome: null, runs: { day: '', count: 0 } };
    }
    return host.store.update(state => {
      authorize(view(host.store, state), ctx, 'admin'); const current = cxState(state).connections.find(c => c.id === item.id);
      check(current, 'CONNECTION_NOT_FOUND', 'This connection does not exist.');
      current.schedule = next; audit(state, 'connectorsx.scheduled', { connectionId: item.id, scheduled: next !== null });
      return structuredClone(current);
    });
  },
  unmapped(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    shape(payload, ['group']); const allowed = visible(host, ctx);
    const rows = new Map<string, { group: string; recipeId: string; field: string; seen: number; lastSeen: string }>();
    for (const envelope of peekCx(host.store.read()).envelopes) {
      if ((payload.group !== undefined && envelope.group !== payload.group) || !allowed(envelope)) continue;
      for (const field of envelope.unmappedFields) {
        const key = `${envelope.recipeId}\u0000${field}`, row = rows.get(key) ?? { group: envelope.group, recipeId: envelope.recipeId, field, seen: 0, lastSeen: envelope.fetchedAt };
        row.seen++; row.lastSeen = envelope.fetchedAt; rows.set(key, row);
      }
    }
    return { count: rows.size, fields: [...rows.values()] };
  },
};

/**
 * Scheduled refresh. The engine calls this only while autonomy is on and the host is awake; it
 * runs for the owner only, honours source trust, pauses, the catch-up rule and the read budgets.
 */
export async function tick(ctx: Context, host: ModuleHost, scheduler: SchedulerHost): Promise<unknown[]> {
  if (host.demo || ctx.role !== 'owner' || !scheduler.awake || (!scheduler.windowOpen && !scheduler.backgroundEnabled)) return [];
  const state = host.store.read(), results: unknown[] = [], nowMs = Date.now();
  const due = peekCx(state).connections.filter(item => item.status === 'active' && item.road === 'interface' && item.schedule);
  let reads = 0;
  for (const item of due) {
    const decision = decide(item.schedule!, nowMs);
    if (decision.action === 'wait') continue;
    if (!sourceAllowed(state, ctx, item.sourceId)) { results.push({ module: 'connectors-ext', connectionId: item.id, outcome: 'source-not-allowed' }); continue; }
    if (decision.action === 'run' && reads >= SCHEDULE_LIMITS.readsPerTick) { results.push({ module: 'connectors-ext', connectionId: item.id, outcome: 'deferred-tick-budget' }); continue; }
    let outcome: string = decision.reason, envelopeId: string | null = null;
    if (decision.action === 'run') {
      reads++;
      try {
        const today = new Date(nowMs + 19_800_000).toISOString().slice(0, 10);
        // A scheduled read covers the current month to date, in India's business calendar.
        const read: any = await handlers.read(ctx, { connectionId: item.id, operation: item.schedule!.operation, period: { from: `${today.slice(0, 7)}-01`, to: today } }, host);
        envelopeId = read.id; outcome = read.status === 'accepted' ? 'accepted' : `${read.status}:${read.refusal?.code ?? read.abstention?.reason ?? 'unknown'}`;
        if (read.status === 'accepted' && item.schedule!.autoImport) { await handlers.importCommit(ctx, { envelopeId: read.id }, host); outcome = 'imported'; }
      } catch (error) { outcome = `failed:${error instanceof ChausarError ? error.code : 'SOURCE_READ_FAILED'}`; }
    }
    await host.store.update(next => {
      const current = cxState(next).connections.find(c => c.id === item.id);
      if (!current?.schedule) return;
      if (decision.action === 'run' || decision.action === 'skip-missed') recordRun(current.schedule, nowMs, outcome);
      else current.schedule.lastOutcome = outcome;
      audit(next, 'connectorsx.scheduled-run', { connectionId: item.id, outcome: outcome.split(':')[0] });
    });
    results.push({ module: 'connectors-ext', connectionId: item.id, outcome, envelopeId });
  }
  return results;
}
