/**
 * Owner grants for a plugin's doors, and the host-side work behind them.
 *
 * The locked box runs in a separate process and its host imports are zero-argument scalars, so nothing is
 * computed while WebAssembly runs. Before each run Chausar checks the owner's grant for this exact plugin
 * digest and code, then does the work itself as the member calling the tool, through the ordinary engine
 * methods, and binds one number per door:
 *   calculate       one figure of a published calculation the owner chose; the receipt id stays in the tool result
 *   read_published  a shape-only count: published dictionary fields always, visible records only when the trust
 *                   send level is shape or samples; never a raw value
 *   prepare_action  1 when the owner-granted action may be prepared; after a run whose result is not zero,
 *                   Chausar prepares exactly that action through `actions.prepare` and returns the approval
 *                   card. Nothing here can approve or execute.
 */
import { ChausarError, check, now } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import { canonical, current } from '../actions.ts';
import { canSeeFact, validDate } from '../memory.ts';
import type { ModuleHost } from '../modules/types.ts';

export type CalculateGrant = { operation: string; period?: { from: string; to: string }; branch?: string; onDate?: string; figure?: string };
export type ReadGrant = { measure: 'dictionaryFields' | 'records'; kind?: string };
export type ActionGrant = { connector: string; operation: string; payload: unknown; sourceIds: string[] };
export type CodeGrant = { calculate?: CalculateGrant; read_published?: ReadGrant; prepare_action?: ActionGrant };
export type Grant = { digest: string; sites: string[]; code: Record<string, CodeGrant>; grantedBy: { memberId: string; role: Context['role']; epoch: number }; grantedAt: string };
export type HostInput = { capability: 'calculate'; receiptId: string; figure: string; minor: string; display: string } | { capability: 'read_published'; measure: ReadGrant['measure']; kind: string | null; value: number };
export const DOORS = ['calculate', 'read_published', 'prepare_action'] as const;

const plain = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function grantInvalid(condition: unknown, message: string): asserts condition { check(condition, 'PLUGIN_GRANT_INVALID', message); }
const only = (value: Record<string, any>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const shortText = (value: unknown, max = 100) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);

/** Validate one code's door grants against what that code asks for and what the caller may prepare. */
export function validateCodeGrant(input: unknown, requested: readonly string[], catalogue: { id: string; operations: { id: string }[] }[]): CodeGrant {
  grantInvalid(plain(input) && only(input, [...DOORS]), 'Grant only the doors calculate, read_published and prepare_action.');
  for (const door of Object.keys(input)) check(requested.includes(door), 'PLUGIN_CAPABILITY_NOT_REQUESTED', 'This code does not ask for that door, so it cannot be granted.');
  const out: CodeGrant = {};
  if (input.calculate !== undefined) {
    const c = input.calculate;
    grantInvalid(plain(c) && only(c, ['operation', 'period', 'branch', 'onDate', 'figure']) && shortText(c.operation, 64), 'A calculation grant names one published operation and optionally a period, branch, date and figure.');
    grantInvalid(c.period === undefined || (plain(c.period) && only(c.period, ['from', 'to']) && validDate(c.period.from) && validDate(c.period.to) && c.period.from <= c.period.to), 'Use an explicit inclusive period.');
    grantInvalid((c.branch === undefined || shortText(c.branch)) && (c.onDate === undefined || validDate(c.onDate)) && (c.figure === undefined || shortText(c.figure, 64)), 'Branch, date and figure are short plain values.');
    out.calculate = JSON.parse(canonical(c));
  }
  if (input.read_published !== undefined) {
    const r = input.read_published;
    grantInvalid(plain(r) && only(r, ['measure', 'kind']) && ['dictionaryFields', 'records'].includes(r.measure) && (r.kind === undefined || (r.measure === 'records' && shortText(r.kind, 64))), 'A read grant is one shape-only measure: dictionaryFields, or records with an optional kind.');
    out.read_published = JSON.parse(canonical(r));
  }
  if (input.prepare_action !== undefined) {
    const a = input.prepare_action;
    // Exact keys: there is no field that could ask for approval, execution or a different member.
    grantInvalid(plain(a) && only(a, ['connector', 'operation', 'payload', 'sourceIds']) && shortText(a.connector, 64) && shortText(a.operation, 64), 'An action grant names a connector, an operation, a fixed payload and its sources. A plugin can only prepare; it never approves or executes.');
    grantInvalid(catalogue.some(c => c.id === a.connector && c.operations.some(o => o.id === a.operation)), 'That action is not in the written connector catalogue.');
    grantInvalid(a.sourceIds === undefined || (Array.isArray(a.sourceIds) && a.sourceIds.length <= 32 && a.sourceIds.every((s: unknown) => shortText(s, 200))), 'Sources are a short list of identifiers.');
    let size = 0; try { size = Buffer.byteLength(canonical(a.payload)); } catch { grantInvalid(false, 'The action payload is plain data.'); }
    grantInvalid(plain(a.payload) && size <= 8192, 'The action payload is a plain object of at most 8 KiB.');
    out.prepare_action = { connector: a.connector, operation: a.operation, payload: JSON.parse(canonical(a.payload)), sourceIds: [...new Set<string>(a.sourceIds ?? [])].sort() };
  }
  return out;
}

/** The grant must be for this exact plugin digest and its grantor must still be the same current owner. */
export function liveGrant(state: State, grant: Grant | undefined, digest: string): Grant {
  check(grant, 'PLUGIN_NOT_GRANTED', 'The owner has not granted this plugin any doors.');
  check(grant.digest === digest, 'PLUGIN_GRANT_STALE', 'The plugin changed after the owner granted its doors. Grant again.');
  try { current(state, grant.grantedBy, 'admin'); } catch { check(false, 'PLUGIN_GRANT_STALE', 'The owner who granted these doors no longer holds that access. Grant again.'); }
  check(grant.grantedBy.role === 'owner', 'PLUGIN_GRANT_STALE', 'Only an owner’s grant opens plugin doors.');
  return grant;
}

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
/**
 * Bind every door the code imports. All work runs as the calling member: `host.call` carries the caller's
 * own context through the full authorization path, so a plugin never reaches past the caller's permissions.
 */
export async function bindDoors(ctx: Context, host: ModuleHost, capabilities: readonly string[], grant: CodeGrant | undefined): Promise<{ bound: Record<string, number>; inputs: HostInput[]; prepare: ActionGrant | null; dictionary: Record<string, string> | null }> {
  const bound: Record<string, number> = {}; const inputs: HostInput[] = []; let prepare: ActionGrant | null = null; let dictionary: Record<string, string> | null = null;
  for (const capability of capabilities) {
    check(DOORS.includes(capability as typeof DOORS[number]), 'PLUGIN_UNKNOWN_CAPABILITY', 'The code asks for a door Chausar does not have.');
    if (capability === 'calculate') {
      const g = grant?.calculate; check(g, 'PLUGIN_CAPABILITY_NOT_GRANTED', 'The owner has not granted a calculation to this plugin’s code.');
      const receipt = await host.call('calculation.run', { operation: g.operation, ...(g.period ? { period: g.period } : {}), ...(g.branch ? { branch: g.branch } : {}), ...(g.onDate ? { onDate: g.onDate } : {}) }) as { id: string; coverage: { countedRows: number }; figures: { key: string; minor: string; display: string; unit: string }[] };
      check(receipt.coverage.countedRows > 0, 'PLUGIN_HOST_VALUE_MISSING', 'No records were counted for this calculation. Missing is not zero, so the plugin was not run.');
      const figure = g.figure ? receipt.figures.find(f => f.key === g.figure) : receipt.figures[0];
      check(figure && /^-?\d+$/.test(figure.minor), 'PLUGIN_HOST_VALUE_MISSING', 'The granted figure is not in this calculation.');
      const minor = BigInt(figure.minor); check(minor <= SAFE && minor >= -SAFE, 'PLUGIN_HOST_VALUE_UNSAFE', 'This figure is too large to hand to plugin code exactly.');
      bound.calculate = Number(minor); inputs.push({ capability: 'calculate', receiptId: receipt.id, figure: figure.key, minor: figure.minor, display: figure.display });
    } else if (capability === 'read_published') {
      const g = grant?.read_published; check(g, 'PLUGIN_CAPABILITY_NOT_GRANTED', 'The owner has not granted a published read to this plugin’s code.');
      const ontology = await host.call('ontology.get', {}) as { current: { fields: Record<string, string> } | null };
      check(ontology.current, 'PLUGIN_HOST_VALUE_MISSING', 'No dictionary is published yet.');
      dictionary = Object.fromEntries(Object.entries(ontology.current.fields).sort(([a], [b]) => a.localeCompare(b)));
      let value: number;
      if (g.measure === 'dictionaryFields') value = Object.keys(dictionary).length;
      else {
        const state = host.store.read();
        check(state.policy.send !== 'nothing', 'PLUGIN_READ_WITHHELD', 'Record counts are shape data and the trust send level is nothing, so they are withheld.');
        value = state.facts.filter(fact => !fact.deletedAt && !fact.supersededAt && (!g.kind || fact.kind === g.kind) && canSeeFact(host.store, ctx, fact)).length;
      }
      bound.read_published = value; inputs.push({ capability: 'read_published', measure: g.measure, kind: g.kind ?? null, value });
    } else {
      const g = grant?.prepare_action; check(g, 'PLUGIN_CAPABILITY_NOT_GRANTED', 'The owner has not granted an action to this plugin’s code.');
      check(ctx.role !== 'viewer', 'FORBIDDEN', 'Your role can only read.');
      bound.prepare_action = 1; prepare = structuredClone(g);
    }
  }
  return { bound, inputs, prepare, dictionary };
}

/** Prepare exactly the granted action as the caller. The idempotency key ties it to this one run. */
export async function prepareGranted(host: ModuleHost, grant: ActionGrant, runId: string) {
  const action = await host.call('actions.prepare', { connector: grant.connector, operation: grant.operation, payload: grant.payload, sourceIds: grant.sourceIds, idempotencyKey: `plugin-${runId}` }) as { id: string; digest: string; status: string; connector: string; operation: string; impact: unknown };
  check(action.status === 'prepared', 'PLUGIN_ACTION_NOT_PREPARED', 'The plugin action was not left waiting for approval.');
  return { kind: 'action' as const, id: action.id, digest: action.digest, status: action.status, connector: action.connector, operation: action.operation, impact: action.impact, waits: true, words: { en: 'Prepared only. It waits on the normal approval card; nothing was approved or done.', hi: 'केवल तैयार किया गया। यह सामान्य मंज़ूरी कार्ड पर रुका है; कुछ भी मंज़ूर या किया नहीं गया।' } };
}

export type RecipeVerdict = { status: 'not-checked' | 'passed' | 'failed' | 'refused'; checker: 'sources.preview'; recipeDigest: string; checkedAt: string | null; checkedBy: string | null; sourceId: string | null; format: string | null; contentHash: string | null; recipeHash: string | null; codes: string[]; coverage: unknown; totalsMinor: string | null; imported: false };
export const notChecked = (recipeDigest: string): RecipeVerdict => ({ status: 'not-checked', checker: 'sources.preview', recipeDigest, checkedAt: null, checkedBy: null, sourceId: null, format: null, contentHash: null, recipeHash: null, codes: [], coverage: null, totalsMinor: null, imported: false });
const ACCESS = /^(ACCESS_|FORBIDDEN|BRANCH_FORBIDDEN|SOURCE_(REVOKED|DELETED|FORBIDDEN|NOT_ALLOWED|BLOCKED)|WORKSPACE_|LOCKED|SESSION_)/;

/**
 * Hand a plugin recipe to the existing recipe checker: `sources.preview` validates the mapping data and asserts
 * the mapped rows against the source's own report totals. It never imports; the recipe is never executed.
 */
export async function checkRecipe(ctx: Context, host: ModuleHost, recipe: { digest: string; body: unknown }, evidence: { sourceId: string; format: string; content: string; expectedTotals: unknown }): Promise<RecipeVerdict> {
  const base = { ...notChecked(recipe.digest), checkedAt: now(), checkedBy: ctx.memberId, sourceId: evidence.sourceId, format: evidence.format };
  try {
    const preview = await host.call('sources.preview', { sourceId: evidence.sourceId, format: evidence.format, content: evidence.content, recipe: structuredClone(recipe.body), expectedTotals: evidence.expectedTotals }) as { accepted: boolean; errors: { code: string }[]; coverage: unknown; totalsMinor: string; contentHash: string; recipeHash: string };
    return { ...base, status: preview.accepted ? 'passed' : 'failed', codes: [...new Set(preview.errors.map(error => error.code))].sort(), coverage: structuredClone(preview.coverage), totalsMinor: preview.totalsMinor, contentHash: preview.contentHash, recipeHash: preview.recipeHash };
  } catch (error) {
    if (!(error instanceof ChausarError) || ACCESS.test(error.code)) throw error;
    return { ...base, status: 'refused', codes: [error.code] };
  }
}
