import { authorize, audit, check, hash, newId, now, type Context, type Fact, type State, type StateStore } from './contracts.ts';
import { currentAccess, insertFacts, markStale, selectFacts, validDate, validatePeriod, type FactFilter, type Period } from './memory.ts';
import { assertSourceAccess, sourceAllowed, trustFingerprint, visibleFacts } from './trust.ts';

export const PROFILE_CATEGORIES = ['industry', 'products', 'customers', 'business_model', 'location'] as const;
export type ProfileCategory = typeof PROFILE_CATEGORIES[number];
export type BusinessContextRequest = { sourceIds?: string[]; branch?: string; asOf?: string; onDate?: string; period?: Period };
export type BusinessEvidenceRefs = { sourceIds: string[]; managedSourceIds: string[]; factIds: string[]; profileIds: string[]; request: BusinessContextRequest };
export type BusinessEvidenceReadiness = { qualifiedSourceIds: string[] };
/** Installed engine hook only. Callers and models cannot supply qualification evidence. */
export type BusinessContextHooks = { assertEvidenceReady?: (context: Context, refs: BusinessEvidenceRefs, view?: StateStore) => BusinessEvidenceReadiness | void };
export type BusinessCitation = {
  id: string; kind: 'workspace' | 'dictionary' | 'fact' | 'profile'; referenceId: string; path: string; contentHash: string;
  sourceId?: string; factId?: string; sourceRow?: number; branch?: string; validFrom?: string; validTo?: string | null; learnedAt?: string;
};
export type BusinessClaim = {
  /** Generic selection alias, immutable within the exact manifest digest. Never an underlying object ID. */
  id: string; category: 'workspace' | 'definitions' | 'records' | ProfileCategory; text: string;
  origin: 'workspace-metadata' | 'published-definition' | 'source-observation' | 'owner-told' | 'draft-assumption';
  qualification: 'metadata-only' | 'unqualified-observation' | 'evidence-qualified' | 'owner-stated' | 'draft'; citationIds: string[];
};
export type BusinessProfileRecord = {
  id: string; kind: 'business-profile-claim-v1'; factId: string; workspaceId: string; field: ProfileCategory; value: string;
  origin: 'owner-told' | 'draft-assumption'; sourceId: string; branch?: string; validFrom: string; learnedAt: string;
  by: string; sourceTainted: boolean; replacesId?: string; factHash: string;
};
export type BusinessProfileInput = {
  field: ProfileCategory; value: string; origin: 'owner-told' | 'draft-assumption'; sourceId: string;
  branch?: string; validFrom: string; replacesId?: string;
};
export type BusinessContextManifest = {
  schemaVersion: 1; kind: 'business-context-manifest'; workspaceId: string; memberId: string; epoch: number;
  request: BusinessContextRequest & { asOf: string; onDate: string }; dictionaryHash: string | null;
  claims: BusinessClaim[]; citations: BusinessCitation[]; unknownCategories: ProfileCategory[];
  sourceIds: string[]; rowIds: string[]; profileIds: string[];
  conflicts: { category: 'records' | ProfileCategory; citationIds: string[]; reason: string }[];
  scope: { branch: string | null; asOf: string; onDate: string; syntheticFixture: boolean; corpus: 'currently-authorized-local-evidence'; completeness: 'bounded'; limitations: string[] };
  trustFingerprint: string; observedContentHash: string; digest: string;
};
export type BusinessSelection = { claimIds: string[]; unknownCategories: ProfileCategory[] };

const PROFILE_KIND = 'business_profile_claim';
const MAX_ROWS = 32;
const MAX_PROFILE_ROWS = 128;
const MAX_BYTES = 65536;
const INVALID = 'INVALID_BUSINESS_CONTEXT';
function plain(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function boundedJson(value: unknown, code = INVALID) {
  const visit = (v: unknown, depth: number): void => {
    check(depth <= 10, code, 'Business context nesting is too deep.');
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'string') { check(v.length <= 20000, code, 'Business context text is too long.'); return; }
    if (typeof v === 'number') { check(Number.isSafeInteger(v), code, 'Business context numbers must be safe metadata integers.'); return; }
    check(Array.isArray(v) || plain(v), code, 'Business context must contain plain JSON data.');
    check(Object.keys(v as object).length <= 256, code, 'Business context has too many entries.');
    for (const [key, item] of Object.entries(v as object)) {
      check(!['__proto__', 'prototype', 'constructor'].includes(key), code, 'Reserved business context fields are refused.');
      visit(item, depth + 1);
    }
  };
  visit(value, 0); check(Buffer.byteLength(JSON.stringify(value)) <= MAX_BYTES, code, 'Business context exceeds its transfer budget.');
}
function exactKeys(value: unknown, keys: string[], code: string): asserts value is Record<string, unknown> {
  check(plain(value) && Object.keys(value).every(key => keys.includes(key)), code, 'Undeclared business context fields are refused.');
}
function profileCategory(value: unknown): value is ProfileCategory { return typeof value === 'string' && (PROFILE_CATEGORIES as readonly string[]).includes(value); }
function stateView(state: State): StateStore { return { read: () => state, update: async () => { throw new Error('Read-only context snapshot.'); } }; }
function normalizedRequest(input: BusinessContextRequest): BusinessContextManifest['request'] {
  exactKeys(input, ['sourceIds', 'branch', 'asOf', 'onDate', 'period'], INVALID); boundedJson(input); validatePeriod(input.period);
  if (input.sourceIds !== undefined) check(Array.isArray(input.sourceIds) && input.sourceIds.length <= 64 && input.sourceIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 200) && new Set(input.sourceIds).size === input.sourceIds.length, INVALID, 'Select a bounded unique list of source identifiers.');
  if (input.branch !== undefined) check(typeof input.branch === 'string' && input.branch.length > 0 && input.branch.length <= 200, INVALID, 'Select one explicit branch.');
  const asOf = input.asOf ?? now(); check(typeof asOf === 'string' && Number.isFinite(Date.parse(asOf)), INVALID, 'Use a valid known-on timestamp.');
  const normalized = new Date(asOf).toISOString();
  const onDate = input.onDate ?? normalized.slice(0, 10); check(validDate(onDate), INVALID, 'Use a valid business date.');
  return { ...(input.sourceIds ? { sourceIds: [...input.sourceIds].sort() } : {}), ...(input.branch ? { branch: input.branch } : {}), ...(input.period ? { period: structuredClone(input.period) } : {}), asOf: normalized, onDate };
}
function citation(kind: BusinessCitation['kind'], referenceId: string, path: string, value: unknown, extra: Partial<BusinessCitation> = {}): BusinessCitation {
  const contentHash = hash(value); const body = { kind, referenceId, path, contentHash, ...extra };
  return { id: `business_citation_${hash(body)}`, ...body };
}
function factCitation(fact: Fact, kind: 'fact' | 'profile' = 'fact') {
  return citation(kind, fact.id, kind === 'profile' ? 'fields.profileValue' : 'kind', fact, {
    sourceId: fact.sourceId, factId: fact.id, sourceRow: fact.sourceRow, ...(fact.branch ? { branch: fact.branch } : {}),
    validFrom: fact.validFrom, validTo: fact.validTo, learnedAt: fact.learnedAt,
  });
}
function profileRecord(state: State, fact: Fact): BusinessProfileRecord | undefined {
  if (fact.kind !== PROFILE_KIND) return undefined;
  const record = state.conversations.find(r => r.kind === 'business-profile-claim-v1' && r.factId === fact.id) as BusinessProfileRecord | undefined;
  if (!record || record.workspaceId !== state.workspace.id || record.factHash !== hash(fact) || record.sourceId !== fact.sourceId
    || record.branch !== fact.branch || record.validFrom !== fact.validFrom || record.learnedAt !== fact.learnedAt
    || !profileCategory(record.field) || record.value !== fact.fields.profileValue || record.field !== fact.fields.profileField
    || record.origin !== fact.fields.profileOrigin || record.by !== fact.fields.profileAuthorId
    || typeof record.sourceTainted !== 'boolean' || record.sourceTainted !== fact.fields.profileTainted
    || !['owner-told', 'draft-assumption'].includes(record.origin)) return undefined;
  return record;
}

/** Builds local evidence, never a free-form model narrative or a financial calculation. */
export function buildBusinessContext(store: StateStore, ctx: Context, input: BusinessContextRequest = {}, hooks: BusinessContextHooks = {}): BusinessContextManifest {
  const state = store.read(), view = stateView(state); const member = authorize(view, ctx); const request = normalizedRequest(input);
  currentAccess(view, ctx, request.branch); if (request.sourceIds) assertSourceAccess(state, ctx, request.sourceIds);
  const visible = visibleFacts(view, ctx, request.sourceIds).filter(f => !request.branch || f.branch === request.branch);
  const visibleIds = new Set(visible.map(f => f.id));
  // A correction effective in the future cannot erase the older business-date view.
  const temporalState = { ...state, facts: state.facts.filter(f => f.kind !== PROFILE_KIND || f.validFrom <= request.onDate && (!f.validTo || f.validTo >= request.onDate)) };
  const filter: FactFilter = { asOf: request.asOf, ...(request.branch ? { branch: request.branch } : {}) };
  const selection = selectFacts(stateView(temporalState), ctx, filter);
  const permitted = selection.facts.filter(f => visibleIds.has(f.id));
  const citations: BusinessCitation[] = [], claims: BusinessClaim[] = [], conflicts: BusinessContextManifest['conflicts'] = [];
  const addClaim = (claim: Omit<BusinessClaim, 'citationIds'>, refs: BusinessCitation[]) => { citations.push(...refs); claims.push({ ...claim, citationIds: refs.map(ref => ref.id) }); };
  addClaim({ id: 'context_workspace', category: 'workspace', origin: 'workspace-metadata', qualification: 'metadata-only', text: `The workspace is named ${state.workspace.name}.${state.workspace.demo ? ' This is an explicitly labelled synthetic workspace.' : ''}` }, [citation('workspace', state.workspace.id, 'workspace.name,workspace.demo', { name: state.workspace.name, demo: state.workspace.demo })]);
  const dictionary = state.ontology?.current ?? (state.ontology?.operations ? state.ontology : null);
  const dictionaryHash = dictionary ? dictionary.hash ?? hash(dictionary) : null;
  if (dictionary) {
    check(typeof dictionary.pack === 'string' && typeof dictionary.label === 'string' && Array.isArray(dictionary.definitions), INVALID, 'Published definitions are unavailable in the expected form.');
    const meanings = dictionary.definitions.slice(0, 16).map((d: any) => { check(typeof d.name === 'string' && typeof d.meaning === 'string' && d.meaning.length <= 1500, INVALID, 'Definition evidence must be bounded text.'); return `${d.name}: ${d.meaning}`; });
    addClaim({ id: 'context_definitions', category: 'definitions', origin: 'published-definition', qualification: 'metadata-only', text: `The published dictionary uses the ${dictionary.label} pack. This describes selected definitions, rather than confirming the business's actual industry. ${meanings.join(' ')}` }, [citation('dictionary', dictionary.hash ?? dictionaryHash!, state.ontology?.current ? 'ontology.current' : 'ontology', dictionary)]);
  }
  const activeProfiles = permitted.filter(f => f.kind === PROFILE_KIND && f.validFrom <= request.onDate && (!f.validTo || f.validTo >= request.onDate)).map(f => ({ fact: f, record: profileRecord(state, f) })).filter((entry): entry is { fact: Fact; record: BusinessProfileRecord } => !!entry.record);
  check(activeProfiles.length <= MAX_PROFILE_ROWS, INVALID, 'Profile evidence exceeds the bounded context profile.');
  const known = new Set<ProfileCategory>();
  for (const field of PROFILE_CATEGORIES) {
    const ownerEntries = activeProfiles.filter(entry => entry.record.field === field && entry.record.origin === 'owner-told');
    const values = new Set(ownerEntries.map(entry => entry.record.value));
    if (values.size === 1) {
      known.add(field); addClaim({ id: `context_profile_${field}`, category: field, origin: 'owner-told', qualification: 'owner-stated', text: `Told by an owner, ${field.replaceAll('_', ' ')}: ${ownerEntries[0].record.value}` }, ownerEntries.map(entry => factCitation(entry.fact, 'profile')));
    } else if (values.size > 1) {
      const refs = ownerEntries.map(entry => factCitation(entry.fact, 'profile')); citations.push(...refs); conflicts.push({ category: field, citationIds: refs.map(ref => ref.id), reason: 'Permitted owner claims disagree; no business description was selected.' });
    }
    const drafts = activeProfiles.filter(entry => entry.record.field === field && entry.record.origin === 'draft-assumption');
    if (drafts.length) addClaim({ id: `context_draft_${field}`, category: field, origin: 'draft-assumption', qualification: 'draft', text: `Draft assumptions, unverified, about ${field.replaceAll('_', ' ')}: ${[...new Set(drafts.map(entry => entry.record.value))].join(' ; ')}` }, drafts.map(entry => factCitation(entry.fact, 'profile')));
  }
  const records = permitted.filter(f => f.kind !== PROFILE_KIND && f.validFrom <= request.onDate && (!f.validTo || f.validTo >= request.onDate) && (!request.period || f.validFrom >= request.period.from && f.validFrom <= request.period.to)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, MAX_ROWS);
  const managedSourceIds = [...new Set(state.imports.filter(item => {
    const domain = item.domain ?? state.imports.find(capture => capture.type === 'connector-capture-v1' && capture.id === item.captureId)?.domain;
    return ['connector-capture-v1', 'connector-consumer-binding-v1'].includes(item.type)
      && typeof item.sourceId === 'string' && sourceAllowed(state, ctx, item.sourceId)
      && (!request.sourceIds || request.sourceIds.includes(item.sourceId))
      && (!request.branch || !domain?.branches || domain.branches.includes(request.branch))
      && (member.branches.includes('*') || Array.isArray(domain?.branches) && domain.branches.some((branch: unknown) => typeof branch === 'string' && member.branches.includes(branch))
        || visible.some(fact => fact.sourceId === item.sourceId));
  }).map(item => item.sourceId as string))].sort();
  const refs: BusinessEvidenceRefs = { sourceIds: [...new Set([...records.map(f => f.sourceId), ...managedSourceIds])].sort(), managedSourceIds, factIds: records.map(f => f.id), profileIds: activeProfiles.map(entry => entry.record.id), request: structuredClone(request) };
  let qualified = false;
  check(!managedSourceIds.length || hooks.assertEvidenceReady, 'BUSINESS_EVIDENCE_UNQUALIFIED', 'Managed source evidence requires its installed current readiness gate.');
  if ((records.length || managedSourceIds.length) && hooks.assertEvidenceReady) {
    const readiness = hooks.assertEvidenceReady(ctx, structuredClone(refs), store);
    const qualifiedIds = readiness?.qualifiedSourceIds ?? [];
    check(Array.isArray(qualifiedIds) && new Set(qualifiedIds).size === qualifiedIds.length && qualifiedIds.every(id => typeof id === 'string' && managedSourceIds.includes(id)), 'BUSINESS_EVIDENCE_UNQUALIFIED', 'Readiness may qualify only explicitly managed source identifiers.');
    check(managedSourceIds.every(id => qualifiedIds.includes(id)), 'BUSINESS_EVIDENCE_UNQUALIFIED', 'Every selected managed source requires current qualified readiness.');
    qualified = records.length > 0 && records.every(f => managedSourceIds.includes(f.sourceId) && qualifiedIds.includes(f.sourceId));
  }
  if (records.length) addClaim({ id: 'context_records', category: 'records', origin: 'source-observation', qualification: qualified ? 'evidence-qualified' : 'unqualified-observation', text: `The selected permitted imported records include these record types: ${[...new Set(records.map(f => f.kind))].sort().join(', ')}. This describes imported evidence and does not establish products, industry, business model, financial totals or causes.${qualified ? '' : ' Source readiness has not been qualified for this context.'}` }, records.map(f => factCitation(f)));
  for (const conflict of selection.conflicts) {
    const rows = visible.filter(f => conflict.rowIds.includes(f.id));
    if (!rows.length) continue;
    const profile = rows.map(f => profileRecord(state, f)).find(Boolean);
    const c = rows.map(f => factCitation(f, profile ? 'profile' : 'fact')); citations.push(...c);
    conflicts.push({ category: profile?.field ?? 'records', citationIds: c.map(ref => ref.id), reason: 'Permitted sources disagree; unresolved claims were excluded.' });
  }
  const uniqueCitations = [...new Map(citations.map(ref => [ref.id, ref])).values()];
  const sourceIds = [...new Set([...managedSourceIds, ...uniqueCitations.flatMap(ref => ref.sourceId ? [ref.sourceId] : [])])].sort();
  const rowIds = [...new Set(uniqueCitations.flatMap(ref => ref.factId ? [ref.factId] : []))].sort();
  const syntheticFixture = Boolean(state.workspace.demo || state.imports.some(item => item.type === 'connector-consumer-binding-v1' && item.environment === 'synthetic' && sourceIds.includes(item.sourceId)));
  const body: Omit<BusinessContextManifest, 'digest'> = {
    schemaVersion: 1, kind: 'business-context-manifest', workspaceId: state.workspace.id, memberId: ctx.memberId, epoch: ctx.epoch,
    request, dictionaryHash, claims, citations: uniqueCitations, unknownCategories: PROFILE_CATEGORIES.filter(field => !known.has(field)),
    sourceIds, rowIds, profileIds: activeProfiles.map(entry => entry.record.id).sort(), conflicts,
    scope: { branch: request.branch ?? null, asOf: request.asOf, onDate: request.onDate, syntheticFixture, corpus: 'currently-authorized-local-evidence', completeness: 'bounded', limitations: ['Only currently permitted, retained local evidence was searched.', 'Absence in this context does not establish absence elsewhere.', 'Owner statements and draft assumptions are not verified financial results.', ...(records.length === MAX_ROWS ? ['Imported-record context is bounded; no exhaustive source coverage is claimed.'] : [])] },
    trustFingerprint: trustFingerprint(state, ctx, sourceIds),
    observedContentHash: hash({ workspace: state.workspace, ontology: dictionary, visible, imports: state.imports.filter(item => sourceIds.includes(item.sourceId)), profiles: state.conversations.filter(r => r.kind === 'business-profile-claim-v1' && visibleIds.has(r.factId)), rules: state.sourceRules.filter(r => r.kind), merges: state.merges, tombstones: state.tombstones.filter(t => rowIds.includes(t.factId) || sourceIds.includes(t.sourceId)) }),
  };
  const result = { ...body, digest: hash(body) }; boundedJson(result); return structuredClone(result);
}

export function assertBusinessContextCurrent(store: StateStore, ctx: Context, manifest: BusinessContextManifest, hooks: BusinessContextHooks = {}): BusinessContextManifest {
  boundedJson(manifest); authorize(store, ctx);
  check(manifest?.kind === 'business-context-manifest' && manifest.memberId === ctx.memberId && manifest.epoch === ctx.epoch && manifest.workspaceId === store.read().workspace.id, 'BUSINESS_CONTEXT_STALE', 'This business context belongs to another workspace or authority revision.');
  const { digest, ...body } = manifest;
  check(hash(body) === digest, 'BUSINESS_CITATION_INVALID', 'The exact context or its citation map was changed.');
  const current = buildBusinessContext(store, ctx, manifest.request, hooks);
  check(current.digest === manifest.digest, 'BUSINESS_CONTEXT_STALE', 'Business evidence, permissions, definitions or readiness changed. Build a fresh context.');
  return current;
}

export function validateBusinessSelection(raw: unknown, manifest: BusinessContextManifest): BusinessSelection {
  const code = 'INVALID_BUSINESS_SELECTION'; exactKeys(raw, ['claimIds', 'unknownCategories'], code); boundedJson(raw, code);
  check(Array.isArray(raw.claimIds) && Array.isArray(raw.unknownCategories), code, 'Choose explicit claim identifiers and unknown categories.');
  const claimIds = raw.claimIds; const unknownCategories = raw.unknownCategories;
  check(claimIds.length <= 16 && new Set(claimIds).size === claimIds.length && claimIds.every(id => typeof id === 'string' && manifest.claims.some(claim => claim.id === id)), code, 'A selected claim is unavailable in this exact context.');
  check(unknownCategories.length <= PROFILE_CATEGORIES.length && new Set(unknownCategories).size === unknownCategories.length && unknownCategories.every(category => profileCategory(category) && manifest.unknownCategories.includes(category)), code, 'The model selected an undeclared unknown category.');
  return { claimIds: [...claimIds] as string[], unknownCategories: [...unknownCategories] as ProfileCategory[] };
}

/** Value-free shape aliases are snapshot-bound by the local digest, not source/object identifiers. */
export function businessContextDisclosure(manifest: BusinessContextManifest, mode: 'shape' | 'samples', samples: { claimId: string }[] = []) {
  check(['shape', 'samples'].includes(mode), 'SEND_DISABLED', 'Business context disclosure requires an allowed send level.');
  check(Array.isArray(samples) && samples.length <= 5 && (mode === 'samples' || samples.length === 0), 'SAMPLE_LIMIT', 'Only samples mode admits up to five explicitly selected claim scalars.');
  const capabilities = manifest.claims.map(claim => ({ claimId: claim.id, category: claim.category, origin: claim.origin }));
  const selected: { claimId: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const input of samples) {
    exactKeys(input, ['claimId'], 'INVALID_BUSINESS_SELECTION');
    check(typeof input.claimId === 'string' && !seen.has(input.claimId), 'INVALID_BUSINESS_SELECTION', 'Select each approved scalar once.'); seen.add(input.claimId);
    const claim = manifest.claims.find(item => item.id === input.claimId); check(claim, 'INVALID_BUSINESS_SELECTION', 'This sample claim is unavailable.');
    check(Buffer.byteLength(claim.text) <= 4096, 'SAMPLE_LIMIT', 'A selected claim scalar exceeds its sample budget.');
    selected.push({ claimId: claim.id, text: claim.text });
  }
  const output = { purpose: 'business-context-selection', capabilities, unknownCategories: [...manifest.unknownCategories], ...(mode === 'samples' ? { samples: selected } : {}) };
  boundedJson(output); return output;
}

export function renderBusinessAnswer(store: StateStore, ctx: Context, manifest: BusinessContextManifest, raw: unknown, hooks: BusinessContextHooks = {}) {
  const current = assertBusinessContextCurrent(store, ctx, manifest, hooks); const selection = validateBusinessSelection(raw, current);
  const claims = current.claims.filter(claim => selection.claimIds.includes(claim.id));
  const ids = new Set(claims.flatMap(claim => claim.citationIds)); const citations = current.citations.filter(ref => ids.has(ref.id));
  check(ids.size === citations.length, 'BUSINESS_CITATION_INVALID', 'Every released claim needs its exact current citation.');
  // A selector cannot suppress documented gaps or conflicts to make a partial description look complete.
  const unknowns = current.unknownCategories.map(category => ({ category, message: `I do not have an established ${category.replaceAll('_', ' ')} description in the currently permitted evidence.` }));
  const established = claims.some(claim => claim.origin === 'owner-told');
  const status = established ? (unknowns.length || current.conflicts.length || claims.some(claim => ['draft', 'unqualified-observation'].includes(claim.qualification)) ? 'partial' : 'grounded') : 'unknown';
  const message = [...claims.map(claim => claim.text), ...unknowns.map(unknown => unknown.message), ...(current.conflicts.length ? ['Some permitted source claims conflict, so they were not treated as established business facts.'] : [])].join('\n');
  const output = { kind: 'business-context' as const, status, message, claims, citations, unknowns, conflicts: current.conflicts, scope: current.scope, contextDigest: current.digest, sourceIds: current.sourceIds, rowIds: current.rowIds, profileIds: current.profileIds };
  boundedJson(output); return output;
}

/** Typed sourced profile claims, with an exact journal-to-fact binding; imported text cannot forge owner attribution. */
export class BusinessProfileService {
  readonly store: StateStore;
  constructor(store: StateStore) { this.store = store; }
  async record(ctx: Context, input: BusinessProfileInput): Promise<BusinessProfileRecord> {
    authorize(this.store, ctx, input?.origin === 'owner-told' ? 'admin' : 'prepare');
    check(input?.origin !== 'owner-told' || !ctx.sourceTainted, 'INVALID_PROFILE_CLAIM', 'Outside-tainted work cannot establish an owner statement.');
    exactKeys(input, ['field', 'value', 'origin', 'sourceId', 'branch', 'validFrom', 'replacesId'], 'INVALID_PROFILE_CLAIM'); boundedJson(input, 'INVALID_PROFILE_CLAIM');
    check(profileCategory(input.field) && ['owner-told', 'draft-assumption'].includes(input.origin) && typeof input.value === 'string' && input.value.trim().length > 0 && input.value.length <= 1200 && !/[\d\p{Sc}%]/u.test(input.value)
      && !/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|hundred|thousand|million|billion|lakh|lakhs|crore|crores)\b/i.test(input.value), 'INVALID_PROFILE_CLAIM', 'Provide a bounded nonfinancial profile description with its explicit origin. Numbers belong to a sourced financial or typed metadata interface.');
    check(typeof input.sourceId === 'string' && input.sourceId.length > 0 && input.sourceId.length <= 200 && validDate(input.validFrom), 'INVALID_PROFILE_CLAIM', 'A profile claim requires source provenance and a valid business date.');
    if (input.branch !== undefined) check(typeof input.branch === 'string' && input.branch.length > 0 && input.branch.length <= 200, 'INVALID_PROFILE_CLAIM', 'Choose a valid branch scope.');
    if (input.replacesId !== undefined) check(typeof input.replacesId === 'string' && input.replacesId.length > 0, 'INVALID_PROFILE_CLAIM', 'Choose an exact previous profile claim.');
    currentAccess(this.store, ctx, input.branch, input.sourceId);
    return this.store.update(state => {
      const view = stateView(state); authorize(view, ctx, input.origin === 'owner-told' ? 'admin' : 'prepare'); currentAccess(view, ctx, input.branch, input.sourceId);
      check(state.conversations.filter(r => r.kind === 'business-profile-claim-v1').length < MAX_PROFILE_ROWS, 'INVALID_PROFILE_CLAIM', 'Profile history exceeds this bounded profile writer.');
      const previous = input.replacesId ? state.conversations.find(r => r.kind === 'business-profile-claim-v1' && r.id === input.replacesId) as BusinessProfileRecord | undefined : undefined;
      if (input.replacesId) check(previous && previous.field === input.field && previous.origin === input.origin && previous.sourceId === input.sourceId && previous.branch === input.branch && this.history(ctx, input.field).some(r => r.id === previous.id), 'INVALID_PROFILE_CLAIM', 'A correction must replace an accessible claim with the same source, field, origin and branch.');
      const at = now(); const fields = { profileField: input.field, profileValue: input.value.trim(), profileOrigin: input.origin, profileAuthorId: ctx.memberId, profileTainted: Boolean(ctx.sourceTainted) };
      const [fact] = insertFacts(state, [{ entityId: `business_profile:${input.field}:${input.origin}:${input.branch ?? '*'}`, sourceId: input.sourceId, sourceRow: state.facts.filter(f => f.sourceId === input.sourceId).length + 1, kind: PROFILE_KIND, validFrom: input.validFrom, fields, ...(input.branch ? { branch: input.branch } : {}) }], at);
      check(fact, 'INVALID_PROFILE_CLAIM', 'An identical profile claim already exists; no new revision was created.');
      const record: BusinessProfileRecord = { id: newId('business_profile'), kind: 'business-profile-claim-v1', factId: fact.id, workspaceId: state.workspace.id, field: input.field, value: input.value.trim(), origin: input.origin, sourceId: input.sourceId, ...(input.branch ? { branch: input.branch } : {}), validFrom: input.validFrom, learnedAt: at, by: ctx.memberId, sourceTainted: Boolean(ctx.sourceTainted), ...(previous ? { replacesId: previous.id } : {}), factHash: hash(fact) };
      state.conversations.push(record); audit(state, 'business.profile.recorded', { profileId: record.id, factId: fact.id, origin: input.origin }); return structuredClone(record);
    });
  }
  history(ctx: Context, field?: ProfileCategory): BusinessProfileRecord[] {
    authorize(this.store, ctx); if (field !== undefined) check(profileCategory(field), 'INVALID_PROFILE_CLAIM', 'Choose a declared profile field.');
    const state = this.store.read(), visibleIds = new Set(visibleFacts(this.store, ctx).map(f => f.id));
    return state.facts.filter(f => visibleIds.has(f.id)).map(f => profileRecord(state, f)).filter((r): r is BusinessProfileRecord => !!r && (!field || r.field === field)).map(r => structuredClone(r));
  }
  async remove(ctx: Context, id: string) {
    authorize(this.store, ctx, 'admin'); const record = this.history(ctx).find(r => r.id === id); check(record, 'INVALID_PROFILE_CLAIM', 'This profile claim is unavailable under current access.');
    return this.store.update(state => {
      authorize(stateView(state), ctx, 'admin'); currentAccess(stateView(state), ctx, record.branch, record.sourceId);
      const fact = state.facts.find(f => f.id === record.factId); check(fact && profileRecord(state, fact)?.id === id, 'INVALID_PROFILE_CLAIM', 'The profile claim changed before deletion.');
      // Delete the sourced version chain so an older correction cannot silently revive it.
      const chain = state.facts.filter(item => item.entityId === fact.entityId && item.sourceId === fact.sourceId && item.kind === PROFILE_KIND);
      const factIds = new Set(chain.map(item => item.id));
      const profileIds = new Set(state.conversations.filter(item => item.kind === 'business-profile-claim-v1' && factIds.has(item.factId)).map(item => item.id));
      state.facts = state.facts.filter(item => !factIds.has(item.id)); state.conversations = state.conversations.filter(item => !profileIds.has(item.id));
      const linked = (value: unknown): boolean => typeof value === 'string' && (factIds.has(value) || profileIds.has(value)) || !!value && typeof value === 'object' && Object.values(value).some(linked);
      for (const key of ['answers', 'receipts', 'decisions', 'modelReceipts', 'conversations'] as const) {
        const deleted = state[key].filter(linked);
        if (key === 'modelReceipts') for (const item of deleted) if (item.digest) state.tombstones.push({ id: newId('tombstone'), kind: 'payload', digest: item.digest, deletedAt: now() });
        state[key] = state[key].filter(item => !linked(item));
      }
      for (const item of chain) state.tombstones.push({ id: newId('tombstone'), factId: item.id, sourceId: item.sourceId, kind: 'content', contentHash: hash(item), deletedAt: now() });
      markStale(state, 'A sourced business profile claim was removed.'); audit(state, 'business.profile.removed', { profileId: id, factId: record.factId }); return { id, factId: record.factId, removed: true, versionsRemoved: chain.length };
    });
  }
}
