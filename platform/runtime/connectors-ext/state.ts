import type { State } from '../contracts.ts';
import { moduleState, peekModuleState } from '../modules/types.ts';
import type { Abstention, CanonicalRecord, Check, Refusal, Road, SourceTotals } from './types.ts';
import type { Schedule } from './schedule.ts';
import type { Answer, Question } from './answers.ts';
import type { SourceRecipe } from './recipe.ts';

export const MODULE_ID = 'connectors-ext';
export type Connection = {
  id: string; group: string; road: Road; label: string; company: string; branch: string; sourceId: string;
  /** Validated, non-secret settings: region, organisation id, store domain, loopback port, file path. Never a credential. */
  settings: Record<string, string>;
  status: 'active' | 'paused'; createdAt: string; createdBy: string;
  /** Repeating read, run by the module tick while autonomy is on. */
  schedule?: Schedule | null;
};
export type Envelope = {
  id: string; connectionId: string | null; sourceId: string; company: string; branch: string;
  group: string; operation: string; recipeId: string; recipeVersion: string; recipeDigest: string; road: Road;
  fetchedAt: string; requestedPeriod: { from: string; to: string } | null; period: { from: string; to: string } | null;
  status: 'accepted' | 'refused' | 'abstained' | 'failed'; refusal: Refusal | null; abstention: Abstention | null; checks: Check[];
  observed: { rowCount: number; total: string; unit: string }; sourceTotals: SourceTotals | null; balances?: { opening: string | null; closing: string | null } | null; unmappedFields: string[]; excludedRows: number;
  contentHash: string; sensitivity: 'financial' | 'personal' | 'operational'; notices: string[];
  read: { pages: number; requests: number; bytes: number } | null;
  /** Held only until the person commits or the envelope expires; cleared afterwards. */
  pending: { records: CanonicalRecord[]; measure: 'money' | 'count'; expiresAt: string } | null;
  committed: { importId: string; at: string; rows: number; duplicate: boolean } | null;
  createdBy: string;
  /** Round 4: the question an abstained read asks, with the choices `recipes.answer` accepts. */
  question?: Question | null;
  /** The source answers the recipe ran with. */
  answerIds?: string[];
  /** The latest person-run reconciliations of this read against the source's own total. */
  reconciliations?: Reconciliation[];
};
export type Reconciliation = {
  at: string; by: { memberId: string; name: string; role: string }; importId: string | null;
  status: 'matches' | 'differs' | 'rows-changed' | 'not-imported' | 'no-source-total';
  theirs: { total: string | null; rowCount: number | null; reference: string; provenance: string } | null;
  ours: { total: string | null; rowCount: number; live: number; changed: number };
  measure: 'money' | 'count'; unit: string;
};
/** The exact recipe a read used, by digest, so a later version can be compared with it. */
export type KeptRecipe = { digest: string; recipe: SourceRecipe; sourceIds: string[]; usedAt: string };
export type SignInAttempt = { state: string; provider: string; connectionId: string; verifier: string; redirectUri: string; scopes: string[]; expiresAt: string; createdBy: string };
/** A Tally export made for another computer: the requests only (never the answers), kept 30 days so the answer file can be checked. */
export type TallyExport = {
  exportId: string; connectionId: string; sourceId: string; register: 'sales' | 'purchase'; period: { from: string; to: string };
  company: string; ledgers: string[]; baseCurrency: string; requestDigests: string[]; createdAt: string; expiresAt: string; createdBy: string;
};
export type ConnectorsState = { version: 1; connections: Connection[]; envelopes: Envelope[]; signIns: SignInAttempt[]; answers?: Answer[]; recipesKept?: KeptRecipe[]; tallyExports?: TallyExport[] };
export const LIMITS = Object.freeze({ connections: 200, envelopes: 400, pendingRecords: 50_000, pendingTtlMs: 6 * 60 * 60 * 1000, signInTtlMs: 10 * 60 * 1000, tallyExports: 50, tallyExportTtlMs: 30 * 24 * 60 * 60 * 1000 });

export const cxState = (state: State): ConnectorsState => moduleState<ConnectorsState>(state, MODULE_ID, () => ({ version: 1, connections: [], envelopes: [], signIns: [] }));
export const peekCx = (state: State): ConnectorsState => peekModuleState<ConnectorsState>(state, MODULE_ID) ?? { version: 1, connections: [], envelopes: [], signIns: [] };

/** Keep the newest envelopes; drop expired pending rows. Committed history keeps its summary only. */
export function prune(cx: ConnectorsState, at: number): void {
  for (const envelope of cx.envelopes) if (envelope.pending && Date.parse(envelope.pending.expiresAt) <= at) envelope.pending = null;
  cx.signIns = cx.signIns.filter(item => Date.parse(item.expiresAt) > at);
  if (cx.tallyExports) { cx.tallyExports = cx.tallyExports.filter(item => Date.parse(item.expiresAt) > at); if (cx.tallyExports.length > LIMITS.tallyExports) cx.tallyExports.splice(0, cx.tallyExports.length - LIMITS.tallyExports); }
  if (cx.envelopes.length > LIMITS.envelopes) cx.envelopes.splice(0, cx.envelopes.length - LIMITS.envelopes);
}
/** Source deletion or revocation removes every envelope read from that source, and its pending rows. */
export function purgeSources(state: State, sourceIds: readonly string[]): number {
  const cx = peekModuleState<ConnectorsState>(state, MODULE_ID); if (!cx) return 0;
  const before = cx.envelopes.length;
  cx.envelopes = cx.envelopes.filter(envelope => !sourceIds.includes(envelope.sourceId));
  if (cx.tallyExports) cx.tallyExports = cx.tallyExports.filter(item => !sourceIds.includes(item.sourceId));
  // Answers and kept recipes carry the source's own values (an unknown word, a sign word): they go with the source.
  const answers = cx.answers?.length ?? 0;
  if (cx.answers) cx.answers = cx.answers.filter(answer => !sourceIds.includes(answer.sourceId));
  if (cx.recipesKept) cx.recipesKept = cx.recipesKept.map(kept => ({ ...kept, sourceIds: kept.sourceIds.filter(id => !sourceIds.includes(id)) })).filter(kept => kept.sourceIds.length > 0);
  return before - cx.envelopes.length + answers - (cx.answers?.length ?? 0);
}
export function publicEnvelope(envelope: Envelope) {
  const { pending, question, ...rest } = envelope;
  return structuredClone({ ...rest, question: question ? { reason: question.reason, field: question.field, sample: question.sample, choices: [...question.choices] } : null,
    answerIds: envelope.answerIds ?? [], reconciliations: envelope.reconciliations ?? [],
    pendingRows: pending ? pending.records.length : 0, pendingExpiresAt: pending?.expiresAt ?? null });
}

export type MonthState = 'loaded' | 'not-loaded-yet' | 'refused' | 'failed';
/** Twelve months ending at `asOf`. A month with nothing accepted is "not loaded yet", never zero. */
export function freshness(state: State, sourceId: string, asOf: string) {
  const months: string[] = []; const end = new Date(`${asOf.slice(0, 7)}-01T00:00:00.000Z`);
  for (let i = 11; i >= 0; i--) { const d = new Date(end); d.setUTCMonth(d.getUTCMonth() - i); months.push(d.toISOString().slice(0, 7)); }
  const cx = peekCx(state), envelopes = cx.envelopes.filter(item => item.sourceId === sourceId);
  const loaded = new Set(state.facts.filter(fact => fact.sourceId === sourceId && !fact.deletedAt && !fact.supersededAt).map(fact => fact.validFrom.slice(0, 7)));
  const covers = (period: { from: string; to: string } | null, month: string) => !!period && period.from.slice(0, 7) <= month && period.to.slice(0, 7) >= month;
  const squares = months.map(month => {
    let status: MonthState = loaded.has(month) ? 'loaded' : 'not-loaded-yet';
    if (status !== 'loaded') {
      const latest = [...envelopes].reverse().find(item => covers(item.period ?? item.requestedPeriod, month));
      if (latest?.status === 'failed') status = 'failed'; else if (latest && (latest.status === 'refused' || latest.status === 'abstained')) status = 'refused';
    }
    return { month, status };
  });
  const accepted = envelopes.filter(item => item.status === 'accepted');
  const imports = state.imports.filter(item => item.sourceId === sourceId && typeof item.at === 'string');
  const lastRead = [...accepted.map(item => item.fetchedAt), ...imports.map(item => item.at)].sort().at(-1) ?? null;
  const lastFailure = envelopes.filter(item => item.status !== 'accepted').at(-1) ?? null;
  return { sourceId, months: squares, lastRead, lastFailure: lastFailure ? { at: lastFailure.fetchedAt, status: lastFailure.status, code: lastFailure.refusal?.code ?? lastFailure.abstention?.reason ?? null } : null,
    unmappedFields: [...new Set(envelopes.flatMap(item => item.unmappedFields))] };
}
