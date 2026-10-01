import { check, type Context, type State, type StateStore } from './contracts.ts';
import { digest, current } from './actions.ts';
import { assertSourceAccess, trustFingerprint } from './trust.ts';
import { ImportService } from './ingest.ts';
import type { ConnectorSemanticInput, ConnectorSemanticPort, ConnectorSemanticProof } from './engine-connectors.ts';
import {
  ConnectorCapabilityRegistry, CursorImportService, connectorOperationKey, readAuthorityScopeHash,
  type ConnectorCapture, type ReadClock,
} from './connector-framework/index.ts';
import {
  compileMapping, evaluateConnectorSemanticGate, mapBatch, qualifyCase, hashData, sha256Bytes, verifyLedger,
  type QualificationInput, type ConnectorSemanticBinding, type CurrentSemanticDependencies,
  type ConnectorSemanticGateHost,
} from '../semantic-qualification/src/index.ts';
import type { OperationEvidence, OperationId, MappingResult } from '../semantic-qualification/src/contracts.ts';

export type EngineSemanticInput = ConnectorSemanticInput;
export type EngineSemanticProof = ConnectorSemanticProof & {
  qualification: 'synthetic-qualified'; liveVerified: false; writebackQualified: false;
};
export type { ConnectorSemanticPort } from './engine-connectors.ts';
/** Installed rights/expectations, never a corpus, manifest or approval supplied by RPC. */
export type EngineSemanticDossier = {
  profileId: string; sourceId: string; recipeHash: string; runtimeOntologyHash: string; decoderDefinitionHash: string;
  current: QualificationInput; goldenCases: QualificationInput[]; holdoutCases: QualificationInput[];
};
export type EngineSemanticOptions = {
  registry: ConnectorCapabilityRegistry; clock: ReadClock; maximumEvidenceAgeMs: number;
  dossiers: readonly EngineSemanticDossier[] | ((state: State) => readonly EngineSemanticDossier[]);
};
type EvidenceRecord = {
  type: 'engine-semantic-evidence-v1'; id: string; sourceId: string; captureId: string; generation: number;
  binding: ConnectorSemanticBinding; dossierDigest: string; sourceTotalsHash: string;
  ledger: OperationEvidence[]; evidenceIds: string[]; proof: EngineSemanticProof;
};
type Anchor = { type: 'engine-semantic-anchor-v1'; id: string; sourceId: string; captureId: string; generation: number; head: string; bindingHash: string; proofHash: string };
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const view = (state: State): StateStore => ({ read: () => structuredClone(state), update: async () => { throw new Error('Semantic readiness is read only.'); } });
const rowsOf = (capture: ConnectorCapture) => capture.pages.flatMap(page => page.rows);
const inputHash = (input: QualificationInput) => hashData({ ...input, at: null, artifactBytes: Object.fromEntries(Object.entries(input.artifactBytes).map(([path, bytes]) => [path, sha256Bytes(bytes)])) });
const dossierHash = (dossier: EngineSemanticDossier) => hashData({ ...dossier, current: inputHash(dossier.current), goldenCases: dossier.goldenCases.map(inputHash), holdoutCases: dossier.holdoutCases.map(inputHash) });
const evidenceId = (captureId: string) => `semantic-evidence:${captureId}`;
const anchorId = (captureId: string) => `semantic-anchor:${captureId}`;

/** The concrete two-stage join. It qualifies only authored synthetic-register cases. */
export class EngineSemanticService implements ConnectorSemanticPort {
  readonly #store: StateStore; readonly #options: EngineSemanticOptions;
  constructor(store: StateStore, options: EngineSemanticOptions) {
    check(options?.registry instanceof ConnectorCapabilityRegistry && options.clock && typeof options.clock.nowMs === 'function'
      && Number.isSafeInteger(options.maximumEvidenceAgeMs) && options.maximumEvidenceAgeMs > 0,
    'SEMANTIC_HOST_REQUIRED', 'Supply the actual registry, clock and explicit evidence validity policy.');
    this.#store = store; this.#options = { ...options, dossiers: typeof options.dossiers === 'function' ? options.dossiers : structuredClone(options.dossiers) };
  }
  #now() { return new Date(this.#options.clock.nowMs()).toISOString(); }
  #dossier(input: EngineSemanticInput) {
    // The producer and this adapter may read a moving clock on different ticks.
    // All decisions below derive their time exclusively from the installed host clock.
    check(input.registry === this.#options.registry, 'SEMANTIC_HOST_CHANGED', 'Use the actual installed registry; payload timestamps cannot select the decision time.');
    check(input.profile.environment === 'synthetic' && input.profile.syntheticFixture === true, 'EXTERNAL_SEMANTICS_UNQUALIFIED', 'This semantic adapter qualifies explicit synthetic fixtures only.');
    const dossiers = typeof this.#options.dossiers === 'function' ? this.#options.dossiers(view(input.state).read()) : this.#options.dossiers;
    const matches = dossiers.filter(dossier => dossier.profileId === input.profile.id && dossier.sourceId === input.capture.sourceId);
    check(matches.length === 1, 'SEMANTIC_DOSSIER_REQUIRED', 'Install exactly one rights-reviewed authored dossier for this profile and source.');
    const dossier = structuredClone(matches[0]);
    check(dossier.recipeHash === input.capture.recipeHash && dossier.runtimeOntologyHash === input.capture.ontologyHash
      && dossier.runtimeOntologyHash === digest(input.state.ontology) && dossier.decoderDefinitionHash === input.decoderDescriptor.definitionHash
      && dossier.decoderDefinitionHash === input.capture.decoderDefinitionHash,
    'SEMANTIC_BINDING_CHANGED', 'The semantic dossier must bind the exact reviewed recipe, runtime dictionary and decoder definition.');
    const compiled = dossier.current.compiled;
    check(hashData(compileMapping(compiled.pack, compiled.rules, compiled.ontology)) === hashData(compiled),
      'SEMANTIC_COMPILER_CHANGED', 'The installed compiler bytes and compiled meaning must still match publication evidence.');
    const dictionary = input.state.ontology?.current ?? input.state.ontology;
    const kinds: Record<string, string> = { billed: 'invoice', earned: 'sale', refunds: 'refund', received: 'payment', purchases: 'purchase', costs: 'cost' };
    check(dictionary?.definitions?.every((definition: any) => kinds[definition.name] === definition.kind
      && definition.field === 'amountMinor' && definition.currency === dictionary.currency && definition.nulls === 'reject'
      && (definition.sign === undefined || definition.sign === 1) && compiled.ontology.operations.includes(definition.name)),
      'SEMANTIC_RUNTIME_DEFINITION_REQUIRED', 'Every runtime measure must preserve its qualified event kind, exact net-money field, currency, null and sign meaning.');
    return dossier;
  }
  #access(ctx: Context, input: EngineSemanticInput) {
    const { state, capture, profile, readLink } = input;
    const member = current(state, ctx); assertSourceAccess(state, ctx, [capture.sourceId]);
    check(state.workspace.id === this.#store.read().workspace.id && capture.sourceId === profile.sourceId
      && digest(capture.domain) === digest(profile.domain) && capture.domain.period
      && capture.domain.branches.every(branch => member.branches.includes('*') || member.branches.includes(branch)),
    'SEMANTIC_ACCESS_CHANGED', 'The current workspace, source, company, branch and period must match this capture.');
    const installed = state.imports.find(item => item.type === 'connector-capture-v1' && item.id === capture.id) as ConnectorCapture | undefined;
    check(installed && digest(installed) === digest(capture), 'SEMANTIC_CAPTURE_CHANGED', 'Use the exact authoritative capture and generation.');
    const binding = state.imports.find(item => item.type === 'connector-consumer-binding-v1' && item.captureId === capture.id);
    check(binding && binding.profileId === profile.id && binding.sourceId === capture.sourceId
      && binding.environment === 'synthetic' && binding.acquiredBy?.memberId === capture.owner
      && binding.authorityRevision === capture.authority, 'SEMANTIC_CUSTODY_REQUIRED', 'A trusted acquisition owner and consumer binding must precede semantic qualification.');
    const acquired = binding.acquiredBy as Context; current(state, acquired);
    assertSourceAccess(state, acquired, [capture.sourceId]);
    check(trustFingerprint(state, acquired, [capture.sourceId]) === capture.authority, 'SEMANTIC_ACCESS_CHANGED', 'Acquisition authority changed after capture.');
    const review = state.imports.find(item => item.type === 'connector-mapping-review-v1' && item.id === capture.reviewId);
    const reviewer = review && state.members.find(person => person.id === review.reviewer.memberId);
    check(review && reviewer?.active && reviewer.epoch === review.reviewer.epoch && ['owner', 'cofounder'].includes(reviewer.role)
      && review.recipeHash === capture.recipeHash && review.sourceId === capture.sourceId && review.operationKey === capture.operationKey
      && review.decoderId === capture.decoderId && review.decoderVersion === capture.decoderVersion && review.schemaSha256 === capture.schemaSha256,
    'SEMANTIC_REVIEW_CHANGED', 'The exact reviewed mapping and its current human reviewer authority are required.');
    const persisted = state.imports.find(item => item.type === 'connector-read-import-link-v1' && item.id === readLink.id);
    check(persisted && digest(persisted) === digest(readLink), 'SEMANTIC_CUSTODY_REQUIRED', 'Read custody must come from the persisted Engine-owned bridge link.');
  }
  #custody(ctx: Context, input: EngineSemanticInput) {
    this.#access(ctx, input);
    const { state, capture, profile, readLink: link, decoderDescriptor: decoder } = input;
    const authority = { tenantId: state.workspace.id, sourceId: profile.sourceId, companyId: profile.companyId, ...(profile.organizationId ? { organizationId: profile.organizationId } : {}) };
    const authorityHash = readAuthorityScopeHash(authority), domainHash = digest(capture.domain), readKey = connectorOperationKey(profile.readOperation);
    check(capture.snapshot.kind === 'source-snapshot' && capture.terminal && capture.gaps.length === 0
      && capture.pages.length > 0 && capture.pages.length === link.pages.length
      && link.captureId === capture.id && link.sourceId === capture.sourceId && link.importOperationKey === capture.operationKey
      && capture.operationKey === connectorOperationKey(profile.importOperation)
      && link.authorityScopeHash === authorityHash && link.dataScopeHash === domainHash
      && link.decoderDefinitionHash === decoder.definitionHash && link.identityNamespace === decoder.identityNamespace
      && capture.decoderId === decoder.id && capture.decoderVersion === decoder.version && capture.schemaSha256 === decoder.schemaSha256
      && capture.identityNamespace === decoder.identityNamespace && link.readReceipt.outcome === 'complete'
      && link.readReceipt.environment === 'synthetic' && link.readReceipt.minimumQualification === 'synthetic-tested'
      && link.readReceipt.operationKey === readKey && link.readReceipt.authorityScopeHash === authorityHash
      && link.readReceipt.dataScopeHash === domainHash && link.readReceipt.pages === capture.pages.length,
    'SEMANTIC_CUSTODY_CHANGED', 'The exact raw read receipt, decoder, installation, snapshot and acquisition scope must be preserved.');
    const snapshotId = capture.snapshot.id;
    for (const [index, page] of capture.pages.entries()) {
      const source = link.pages[index]; const provenance = source.provenance;
      check(source.deliveryId === page.deliveryId && page.sha256 === sha256Bytes(page.content)
        && page.bytes === Buffer.byteLength(page.content) && provenance.contentSha256 === page.sha256
        && provenance.byteLength === page.bytes && link.readReceipt.contentHashes[index] === page.sha256
        && provenance.operationKey === readKey && provenance.authorityScopeHash === authorityHash && provenance.dataScopeHash === domainHash
        && provenance.schemaFingerprint === decoder.schemaSha256 && page.schemaSha256 === decoder.schemaSha256
        && provenance.source.snapshotId === snapshotId && provenance.source.completeness === 'reported-complete'
        && typeof provenance.source.generatedAtMs === 'number' && page.sourceObservedAt === new Date(provenance.source.generatedAtMs).toISOString()
        && hashData(profile.decoder.decode(page.content)) === hashData(page.rows),
      'SEMANTIC_RAW_BYTES_CHANGED', 'Raw original bytes and their independently issued page lineage must match the decoded rows.');
      const generatedAt = provenance.source.generatedAtMs!, nowMs = this.#options.clock.nowMs();
      check(generatedAt <= nowMs && nowMs - generatedAt <= profile.maximumSourceAgeMs,
        'SEMANTIC_SOURCE_NOT_CURRENT', 'The independently observed source time must still satisfy the explicit host freshness policy.');
    }
    check(link.readReceipt.rows === rowsOf(capture).length && link.readReceipt.bytes === capture.pages.reduce((sum, page) => sum + page.bytes, 0), 'SEMANTIC_CUSTODY_CHANGED', 'Source receipt counts must cover every raw page and decoded row.');
    const at = this.#now();
    const read = this.#options.registry.assertDefinition(profile.readOperation, profile.readImplementationDigest, at, 'synthetic-tested');
    const imported = this.#options.registry.assertDefinition(profile.importOperation, profile.importImplementationDigest, at, 'synthetic-tested');
    for (const capability of ['raw-provenance', 'coverage', 'freshness', 'authentication-expiry'] as const) this.#options.registry.assertCapability(profile.readOperation, capability, at, 'synthetic-tested');
    check(read.level === 'synthetic-tested' && imported.level === 'synthetic-tested'
      && link.readReceipt.qualification?.definitionDigest === read.definitionDigest && link.readReceipt.qualification.evidenceDigest === read.evidenceDigest
      && capture.qualificationDigest === imported.digest, 'SEMANTIC_CONNECTOR_CHANGED', 'The actual current read/import definition and capability evidence must match acquisition.');
    return { read, imported };
  }
  #source(input: EngineSemanticInput, dossier: EngineSemanticDossier): QualificationInput {
    const configured = structuredClone(dossier.current); const rows = rowsOf(input.capture);
    const { capture, sourceTotals: totals } = input;
    check(configured.batch.rowsHash === hashData(rows) && hashData(configured.batch.rows) === hashData(rows)
      && configured.batch.company === capture.domain.company && hashData(configured.compiled.rules.branches) === hashData(capture.domain.branches)
      && hashData(configured.compiled.rules.period) === hashData(capture.domain.period)
      && capture.snapshot.kind === 'source-snapshot' && capture.snapshot.id === configured.batch.snapshotId,
    'SEMANTIC_SOURCE_SCOPE_MISMATCH', 'The complete decoded source must be the exact authored dataset, company, branch, period and snapshot.');
    const report = configured.report;
    check([input.profile.readOperation, input.profile.importOperation].every(scope => scope.connectorId === configured.batch.system
      && scope.applicability.applicationVersion === configured.batch.product.version && scope.applicability.edition === configured.batch.product.edition
      && scope.applicability.configuration === configured.batch.product.configuration)
      && input.decoderDescriptor.schemaSha256 === configured.compiled.schemaHash,
    'SEMANTIC_PRODUCT_SCOPE_MISMATCH', 'Acquisition, import, decoder schema and semantic evidence must share the exact authored system/version/edition/configuration.');
    check(totals.provenance === 'independent-source-report' && totals.reportId === report.reportId && totals.sha256 === report.evidenceHash
      && totals.company === report.company && totals.dataset === capture.domain.dataset && totals.domainHash === digest(capture.domain)
      && totals.snapshotId === report.snapshotId && totals.rowCount === report.sourceRowCount
      && report.totals.every(bucket => bucket.currency === totals.currency)
      && totals.amountMinor === String(report.totals.reduce((sum, bucket) => sum + BigInt(bucket.netMinor), 0n))
      && configured.compiled.rules.currencies[totals.currency]?.scale === 2,
    'SEMANTIC_SOURCE_REPORT_MISMATCH', 'Runtime controls must preserve the separately authored per-kind, currency, net, tax and gross source report.');
    return { ...configured, at: this.#now(), batch: { ...configured.batch, receiptId: input.readLink.id, rows: structuredClone(rows), rowsHash: hashData(rows) } };
  }
  #projection(ctx: Context, input: EngineSemanticInput, mapped: MappingResult) {
    const rows = rowsOf(input.capture), fields = Object.keys(rows[0] ?? {});
    const cell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const content = [fields.map(cell).join(','), ...rows.map(row => fields.map(field => cell(row[field])).join(','))].join('\n');
    const preview = new ImportService(view(input.state)).preview(ctx, { sourceId: input.capture.sourceId, format: 'csv', content,
      recipe: input.capture.recipe, expectedTotals: { rowCount: input.sourceTotals.rowCount, amountMinor: input.sourceTotals.amountMinor } });
    check(preview.accepted && preview.facts.length === mapped.facts.length && mapped.exclusions.length === 0,
      'SEMANTIC_RUNTIME_TRANSLATION_REQUIRED', 'The runtime mapping must preserve every admitted row and exclusion; unsupported translations cannot publish qualified facts.');
    for (const fact of mapped.facts) {
      // The existing CSV preview numbers its header as row 1. Semantic source rows are 1-based data rows.
      const candidate = preview.facts.find(item => item.sourceRow === fact.source.row + 1 && item.entityId === fact.entityId && item.kind === fact.kind);
      check(candidate && candidate.validFrom === fact.date && candidate.branch === fact.branch && candidate.fields.amountMinor === fact.netMinor
        && candidate.fields.taxMinor === fact.taxMinor && candidate.fields.currency === fact.currency && candidate.fields.company === fact.company
        && candidate.fields.taxRegistration === fact.taxRegistration && candidate.fields.unit === fact.unit
        && /^\d+$/.test(fact.quantity) && Number.isSafeInteger(Number(fact.quantity)) && candidate.fields.quantity === Number(fact.quantity)
        && (fact.relatedIdentity === null || candidate.fields.invoiceId === fact.relatedIdentity) && !candidate.fields._fx,
      'SEMANTIC_RUNTIME_TRANSLATION_REQUIRED', 'The typed runtime recipe differs from qualified identity, date, tax, currency, quantity, unit, company or link meaning.');
    }
    return preview.facts;
  }
  #publishedProjection(input: EngineSemanticInput, dossier: EngineSemanticDossier) {
    const source = this.#source(input, dossier), mapped = mapBatch(source.compiled, source.batch);
    check(mapped.decision === 'mapped', 'SEMANTIC_RUNTIME_TRANSLATION_REQUIRED', 'The current exact source must still preserve its compiled meaning.');
    const acquired = input.state.imports.find(item => item.type === 'connector-consumer-binding-v1' && item.captureId === input.capture.id).acquiredBy as Context;
    const expected = this.#projection(acquired, input, mapped);
    check(input.capture.rowIds.length === expected.length && new Set(input.capture.rowIds).size === expected.length,
      'SEMANTIC_PUBLISHED_FACTS_CHANGED', 'Published lineage must contain exactly the qualified typed rows.');
    for (const fact of expected) {
      const actual = input.state.facts.find(item => input.capture.rowIds.includes(item.id) && item.entityId === fact.entityId && item.kind === fact.kind);
      check(actual && !actual.deletedAt && actual.sourceId === fact.sourceId && actual.sourceRow === fact.sourceRow
        && actual.validFrom === fact.validFrom && actual.validTo === (fact.validTo ?? null) && actual.branch === fact.branch
        && digest(actual.fields) === digest(fact.fields), 'SEMANTIC_PUBLISHED_FACTS_CHANGED', 'Published typed facts differ from the exact qualified runtime projection.');
    }
  }
  #record(input: EngineSemanticInput): EvidenceRecord {
    const record = input.state.imports.find(item => item.type === 'engine-semantic-evidence-v1' && item.id === evidenceId(input.capture.id)) as EvidenceRecord | undefined;
    check(record && record.captureId === input.capture.id && record.sourceId === input.capture.sourceId && record.generation === input.capture.generation,
      'SEMANTIC_EVIDENCE_REQUIRED', 'Publication needs its retained exact semantic qualification ledger.');
    return record;
  }
  #anchor(input: EngineSemanticInput): Anchor {
    const anchor = input.state.imports.find(item => item.type === 'engine-semantic-anchor-v1' && item.id === anchorId(input.capture.id)) as Anchor | undefined;
    check(anchor && anchor.captureId === input.capture.id && anchor.sourceId === input.capture.sourceId && anchor.generation === input.capture.generation
      && sha(anchor.head), 'SEMANTIC_ANCHOR_REQUIRED', 'Use the separately retained Engine-owned ledger anchor, never a supplied ledger head.');
    return anchor;
  }
  #dependencies(input: EngineSemanticInput, dossier: EngineSemanticDossier): CurrentSemanticDependencies {
    return { mappingFingerprint: dossier.current.compiled.fingerprint, schemaHash: dossier.current.compiled.schemaHash,
      rowsHash: hashData(rowsOf(input.capture)), snapshotId: input.capture.snapshot.kind === 'source-snapshot' ? input.capture.snapshot.id : '',
      sourceReportHash: hashData(dossier.current.report), manifestHash: hashData({ manifest: dossier.current.manifest, provenance: dossier.current.provenance }),
      splitPlanHash: hashData(dossier.current.splitPlan), goldenCaseHash: hashData(dossier.current.goldenCase) };
  }
  beforePublish(ctx: Context, input: EngineSemanticInput): EngineSemanticProof {
    const dossier = this.#dossier(input), { read, imported } = this.#custody(ctx, input), source = this.#source(input, dossier);
    const ledger: OperationEvidence[] = []; const qualified = qualifyCase(source, ledger);
    check(qualified.mapped.decision === 'mapped' && qualified.evidence.length > 0 && qualified.evidence.every(item => item.decision === 'qualified' && item.qualification === 'synthetic-qualified'),
      'SEMANTIC_CASE_UNQUALIFIED', 'Independent source controls and golden semantic assertions must qualify every declared measure before insertion.');
    this.#projection(ctx, input, qualified.mapped);
    check(dossier.goldenCases.length > 0 && dossier.holdoutCases.length > 0, 'SEMANTIC_CORPUS_REQUIRED', 'Require explicit independent tuning and public synthetic holdout evidence.');
    const splitMembership = (caseInput: QualificationInput) => {
      const { mappingFingerprint: _perProduct, ...membership } = caseInput.splitPlan;
      return hashData(membership);
    };
    const member = (caseInput: QualificationInput) => ({ businessId: caseInput.goldenCase.businessId, datasetId: caseInput.batch.datasetId,
      rowsHash: caseInput.batch.rowsHash, origins: caseInput.batch.origins });
    const ordered = (values: unknown[]) => values.map(hashData).sort();
    check(hashData(ordered(dossier.goldenCases.map(member))) === hashData(ordered(source.splitPlan.tuning))
      && hashData(ordered(dossier.holdoutCases.map(member))) === hashData(ordered(source.splitPlan.holdout))
      && [...dossier.goldenCases, ...dossier.holdoutCases].every(caseInput => splitMembership(caseInput) === splitMembership(source)
        && caseInput.compiled.ontologyHash === source.compiled.ontologyHash && caseInput.compiled.compilerBuildHash === source.compiled.compilerBuildHash),
      'SEMANTIC_CORPUS_SCOPE_MISMATCH', 'Execute exactly the declared disjoint whole-company/template/configuration corpus under the same semantic ontology and compiler.');
    const run = (cases: QualificationInput[], split: 'tuning' | 'holdout') => cases.map(caseInput => {
      check(caseInput.goldenCase.split === split && caseInput.manifest.origin === 'synthetic', 'SEMANTIC_CORPUS_SCOPE_MISMATCH', 'Disclose the exact synthetic tuning/holdout scope.');
      const result = qualifyCase({ ...structuredClone(caseInput), at: this.#now() }, ledger);
      check(result.mapped.decision === 'mapped' && result.evidence.every(item => item.decision === 'qualified'), 'SEMANTIC_CORPUS_UNQUALIFIED', 'An independent corpus case failed qualification.');
      return result.evidence;
    });
    const golden = run(dossier.goldenCases, 'tuning'), holdout = run(dossier.holdoutCases, 'holdout');
    const currentEvidence = qualified.evidence, evidence = currentEvidence[0], at = this.#now();
    const observedMs = Math.min(...input.readLink.pages.map(page => page.provenance.source.generatedAtMs!));
    const binding: ConnectorSemanticBinding = {
      contractVersion: 1, workspaceId: input.state.workspace.id, sourceId: input.capture.sourceId,
      readScope: structuredClone(input.profile.readOperation), importScope: structuredClone(input.profile.importOperation),
      readDefinitionDigest: read.definitionDigest, readEvidenceDigest: read.evidenceDigest, importDefinitionDigest: imported.definitionDigest,
      importEvidenceDigest: imported.evidenceDigest, importImplementationDigest: input.profile.importImplementationDigest,
      recipeHash: input.capture.recipeHash, semanticMappingFingerprint: evidence.mappingFingerprint,
      captureId: input.capture.id, generation: input.capture.generation, reviewId: input.capture.reviewId, decoder: { ...input.decoderDescriptor },
      domain: { ...structuredClone(input.capture.domain), period: structuredClone(input.capture.domain.period!) }, datasetManifestId: evidence.datasetId,
      sourceReceiptId: input.readLink.id, sourceRowsHash: evidence.rowsHash, originalPageHashes: [...input.readLink.readReceipt.contentHashes],
      snapshot: { kind: 'source-snapshot', id: evidence.scope.snapshotId }, sourceObservedAt: new Date(observedMs).toISOString(),
      at, expiresAt: new Date(Date.parse(at) + this.#options.maximumEvidenceAgeMs).toISOString(), minimum: 'synthetic-tested',
    };
    const proof: EngineSemanticProof = { mappingPackDigest: source.compiled.packHash, goldenRunDigest: hashData(golden), holdoutRunDigest: hashData(holdout),
      reconciliationRunDigest: hashData({ report: source.report, controls: qualified.mapped.controls, rows: qualified.mapped.sourceRowCount, evidence: currentEvidence.map(item => item.id) }),
      qualification: 'synthetic-qualified', liveVerified: false, writebackQualified: false };
    const record: EvidenceRecord = { type: 'engine-semantic-evidence-v1', id: evidenceId(input.capture.id), sourceId: input.capture.sourceId,
      captureId: input.capture.id, generation: input.capture.generation, binding, dossierDigest: dossierHash(dossier), sourceTotalsHash: digest(input.sourceTotals),
      ledger, evidenceIds: currentEvidence.map(item => item.id), proof };
    check(!input.state.imports.some(item => item.id === record.id || item.id === anchorId(input.capture.id)), 'SEMANTIC_EVIDENCE_CONFLICT', 'This capture already has a retained semantic publication.');
    const head = verifyLedger(ledger).head!;
    input.state.imports.push(record, { type: 'engine-semantic-anchor-v1', id: anchorId(input.capture.id), sourceId: input.capture.sourceId,
      captureId: input.capture.id, generation: input.capture.generation, head, bindingHash: hashData(binding), proofHash: hashData(proof) } satisfies Anchor);
    return structuredClone(proof);
  }
  assertReady(ctx: Context, input: EngineSemanticInput): EngineSemanticProof {
    const dossier = this.#dossier(input); this.#custody(ctx, input); this.#publishedProjection(input, dossier);
    const record = this.#record(input), anchor = this.#anchor(input);
    check(record.dossierDigest === dossierHash(dossier) && record.sourceTotalsHash === digest(input.sourceTotals)
      && anchor.bindingHash === hashData(record.binding) && anchor.proofHash === hashData(record.proof), 'SEMANTIC_EVIDENCE_CHANGED', 'Current rights, compiler, mapping, corpus, source controls, proof or binding differ from retained evidence.');
    const requested = input.measures ?? dossier.current.compiled.ontology.operations;
    check(Array.isArray(requested) && requested.length > 0 && requested.every(measure => dossier.current.compiled.ontology.operations.includes(measure as OperationId)),
      'SEMANTIC_MEASURE_UNQUALIFIED', 'Each requested numeric definition needs its own qualified semantic evidence.');
    const host: ConnectorSemanticGateHost = {
      now: () => this.#now(), retainedLedgerHead: binding => {
        check(hashData(binding) === anchor.bindingHash, 'SEMANTIC_BINDING_CHANGED', 'Readiness must use the retained publication binding.'); return this.#anchor(input).head;
      },
      verifyCustody: binding => { this.#custody(ctx, input); check(hashData(binding) === anchor.bindingHash, 'SEMANTIC_CUSTODY_CHANGED', 'The source cannot select its own binding.'); return { bindingHash: anchor.bindingHash, verified: true }; },
      assertCurrentAccess: () => { this.#access(ctx, input); return true; },
      assertCaptureReady: () => {
        new CursorImportService(view(input.state), this.#options.registry, input.profile.decoder, { now: () => this.#now(), minimumQualification: 'synthetic-tested' })
          .assertReady(ctx, input.capture.sourceId, input.capture.domain, true); return true;
      },
      qualification: (scope, at) => {
        const implementation = scope.kind === 'import' ? input.profile.importImplementationDigest : input.profile.readImplementationDigest;
        const current = this.#options.registry.assertDefinition(scope, implementation, at, 'synthetic-tested');
        return { permitted: current.permitted, level: current.level, definitionDigest: current.definitionDigest, evidenceDigest: current.evidenceDigest, implementationDigest: implementation };
      }, currentDependencies: () => this.#dependencies(input, dossier),
    };
    for (const measure of new Set(requested)) {
      const evidence = record.ledger.find(item => record.evidenceIds.includes(item.id) && item.operation === measure);
      check(evidence, 'SEMANTIC_MEASURE_UNQUALIFIED', 'The exact requested measure has no retained scoped receipt.');
      const decision = evaluateConnectorSemanticGate({ binding: record.binding, ledger: record.ledger, expectedHead: anchor.head, measure: measure as OperationId, evidenceId: evidence.id }, host);
      check(decision.permitted && decision.level === 'synthetic-tested', 'SEMANTIC_SOURCE_NOT_READY', `Semantic readiness refused: ${decision.reasonCodes.join(', ')}.`);
    }
    return structuredClone(record.proof);
  }
}
