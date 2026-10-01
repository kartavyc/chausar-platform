import { check, type Context } from '../../contracts.ts';
import { current, digest } from '../../actions.ts';
import { assertSourceAccess, trustFingerprint } from '../../trust.ts';
import { validatePeriod } from '../../memory.ts';
import { CursorImportService, connectorOperationKey, readAuthorityScopeHash,
  type QualifiedLevel, type ReadClock, type ReadEnvironment } from '../../connector-framework/index.ts';
import type { EngineConnectorProfile, ConnectorSemanticInput } from '../../engine-connectors.ts';
import { hashData } from '../../../semantic-qualification/src/index.ts';
import { createAccountingDecoder, proposeAccountingMapping, type AccountingDecoderConfig } from './import.ts';
import { sha256, requiredText } from './common.ts';

const systems = ['tally', 'zoho-books', 'quickbooks', 'xero'];
const minimums: Record<ReadEnvironment, QualifiedLevel> = { synthetic: 'synthetic-tested', sandbox: 'sandbox-verified', live: 'live-verified' };
const hash = (value: string) => /^[a-f0-9]{64}$/.test(value);
const unresolved = [
  'SOURCE_CLOCK_AND_SNAPSHOT_REQUIRED', 'SEMANTIC_WIRE_TRANSLATION_BINDING_REQUIRED',
  'SEMANTIC_RUNTIME_PROJECTION_REQUIRED', 'RIGHTS_GOLDEN_HOLDOUT_REQUIRED', 'CURRENT_SEMANTIC_LEDGER_ANCHOR_REQUIRED',
] as const;

/** Host-selected code/configuration only. This is never an RPC-installable connector or evidence registration. */
export type AccountingEngineRegistration = Omit<EngineConnectorProfile, 'readOperation' | 'decoder'> & {
  decoder: AccountingDecoderConfig;
  mapping: { id: string; currency: string; eventTypes: Readonly<Record<string, string>>; statuses: Readonly<Record<string, string>> };
};

/** Builds a usable Engine profile while leaving every qualification decision to the installed actual gates. */
export function createAccountingConnectorCandidate(input: AccountingEngineRegistration) {
  const readOperation = input.reader.operation, imported = input.importOperation;
  check(systems.includes(readOperation.connectorId) && imported.kind === 'import' && imported.transport === 'file'
    && imported.connectorId === readOperation.connectorId && imported.connectorVersion === readOperation.connectorVersion
    && digest(imported.applicability) === digest(readOperation.applicability),
  'ACCOUNTING_OPERATION_SCOPE_MISMATCH', 'Pin the exact same accounting product/version/edition/module/configuration for acquisition and captured import.');
  check(input.reader.environment === input.environment && Object.hasOwn(minimums, input.environment)
    && (input.environment !== 'synthetic' || input.syntheticFixture === true),
  'ACCOUNTING_ENVIRONMENT_MISMATCH', 'Use the native reader environment and explicitly label authored synthetic fixtures.');
  check(hash(input.readImplementationDigest) && hash(input.importImplementationDigest), 'ACCOUNTING_IMPLEMENTATION_REQUIRED', 'Supply independent exact read and import implementation digests.');
  check(input.domain.company === input.companyId && input.decoder.company === input.companyId
    && input.decoder.dataset === input.domain.dataset && input.domain.branches.length === 1
    && input.domain.branches[0] === input.decoder.branch,
  'ACCOUNTING_DECODER_SCOPE_MISMATCH', 'The one-branch accounting decoder must preserve the acquired company, dataset and branch.');
  validatePeriod(input.domain.period);
  check(Number.isSafeInteger(input.maximumSourceAgeMs) && input.maximumSourceAgeMs > 0 && input.maximumSourceAgeMs <= 31_536_000_000,
    'ACCOUNTING_FRESHNESS_POLICY_REQUIRED', 'Supply the explicit host freshness policy; source time remains provider evidence.');
  for (const value of [input.id, input.title, input.sourceId, input.companyId]) requiredText(value);
  const { decoder, mapping, ...metadata } = input;
  const profile: EngineConnectorProfile = { ...metadata, domain: structuredClone(input.domain), contentTypes: [...input.contentTypes],
    readOperation: structuredClone(readOperation), importOperation: structuredClone(imported), decoder: createAccountingDecoder(decoder) };
  const proposal = proposeAccountingMapping({ ...mapping, system: readOperation.connectorId, edition: readOperation.applicability.edition,
    company: input.companyId, branch: decoder.branch });
  return { profile, proposal, admission: { semanticQualification: 'unqualified' as const, ready: false as const,
    liveVerified: false as const, writebackQualified: false as const, unresolved: [...unresolved] } };
}

/**
 * Inspect actual retained acquisition evidence for a future reviewed translation.
 * No SourceBatch, semantic proof, ledger, anchor or facts are fabricated here.
 */
export function inspectAccountingSemanticCapture(ctx: Context, input: ConnectorSemanticInput, clock: ReadClock) {
  const { state, profile, capture, readLink: link, registry, decoderDescriptor } = input;
  check(clock && typeof clock.nowMs === 'function', 'ACCOUNTING_CLOCK_REQUIRED', 'Inspection uses the installed host clock.');
  const at = new Date(clock.nowMs()).toISOString(), member = current(state, ctx); assertSourceAccess(state, ctx, [capture.sourceId]);
  check(capture.domain.branches.every(branch => member.branches.includes('*') || member.branches.includes(branch)),
    'ACCOUNTING_BRANCH_FORBIDDEN', 'Inspect only source branches in the current reader scope.');
  check(systems.includes(profile.readOperation.connectorId) && profile.sourceId === capture.sourceId
    && digest(profile.domain) === digest(capture.domain) && profile.companyId === capture.domain.company,
  'ACCOUNTING_CAPTURE_SCOPE_CHANGED', 'Use the exact installed accounting acquisition profile and domain.');
  const stored = state.imports.find(item => item.type === 'connector-capture-v1' && item.id === capture.id);
  const storedLink = state.imports.find(item => item.type === 'connector-read-import-link-v1' && item.id === link.id);
  check(stored && storedLink && digest(stored) === digest(capture) && digest(storedLink) === digest(link),
    'ACCOUNTING_CAPTURE_CUSTODY_REQUIRED', 'Inspect the authoritative persisted capture and issued read-to-import link.');
  const owner = state.members.find(member => member.id === capture.owner);
  check(owner?.active, 'ACCOUNTING_CAPTURE_AUTHORITY_CHANGED', 'The acquiring owner must still be active.');
  const acquired: Context = { memberId: owner.id, role: owner.role, epoch: owner.epoch };
  assertSourceAccess(state, acquired, [capture.sourceId]);
  check(trustFingerprint(state, acquired, [capture.sourceId]) === capture.authority,
    'ACCOUNTING_CAPTURE_AUTHORITY_CHANGED', 'The exact acquiring authority changed after capture.');
  const review = state.imports.find(item => item.type === 'connector-mapping-review-v1' && item.id === capture.reviewId);
  const reviewer = review && state.members.find(member => member.id === review.reviewer.memberId);
  check(review && reviewer?.active && reviewer.epoch === review.reviewer.epoch && ['owner', 'cofounder'].includes(reviewer.role)
    && review.recipeHash === capture.recipeHash && digest(capture.recipe) === capture.recipeHash
    && digest(state.ontology) === capture.ontologyHash && review.sourceId === capture.sourceId && review.operationKey === capture.operationKey
    && review.decoderId === capture.decoderId && review.decoderVersion === capture.decoderVersion && review.schemaSha256 === capture.schemaSha256,
  'ACCOUNTING_MAPPING_REVIEW_CHANGED', 'Keep the exact current reviewed dictionary, recipe and reviewer authority.');
  const importer = new CursorImportService({ read: () => structuredClone(state), update: async () => { throw new Error('Accounting evidence inspection is read only.'); } },
    registry, profile.decoder, { now: () => at, minimumQualification: minimums[profile.environment] });
  const installedDecoder = importer.decoderDescriptor();
  check((['id', 'version', 'schemaSha256', 'identityNamespace', 'definitionHash'] as const).every(field => installedDecoder[field] === decoderDescriptor[field])
    && capture.decoderDefinitionHash === decoderDescriptor.definitionHash && link.decoderDefinitionHash === decoderDescriptor.definitionHash
    && capture.decoderId === decoderDescriptor.id && capture.decoderVersion === decoderDescriptor.version
    && capture.identityNamespace === decoderDescriptor.identityNamespace && capture.schemaSha256 === decoderDescriptor.schemaSha256,
  'ACCOUNTING_DECODER_CHANGED', 'Use the actual pinned decoder definition and native wire schema.');
  const read = registry.assertDefinition(profile.readOperation, profile.readImplementationDigest, at, minimums[profile.environment]);
  const imported = registry.assertDefinition(profile.importOperation, profile.importImplementationDigest, at, minimums[profile.environment]);
  const authority = { tenantId: state.workspace.id, sourceId: profile.sourceId, companyId: profile.companyId,
    ...(profile.organizationId ? { organizationId: profile.organizationId } : {}) };
  check(link.captureId === capture.id && link.sourceId === capture.sourceId && link.importOperationKey === capture.operationKey
    && capture.operationKey === connectorOperationKey(profile.importOperation) && link.dataScopeHash === digest(capture.domain)
    && link.authorityScopeHash === readAuthorityScopeHash(authority) && link.pages.length === capture.pages.length
    && link.readReceipt.operationKey === connectorOperationKey(profile.readOperation) && link.readReceipt.outcome === 'complete'
    && link.readReceipt.authorityScopeHash === readAuthorityScopeHash(authority) && link.readReceipt.dataScopeHash === digest(capture.domain)
    && link.readReceipt.pages === capture.pages.length && link.identityNamespace === capture.identityNamespace
    && link.readReceipt.environment === profile.environment && link.readReceipt.qualification?.definitionDigest === read.definitionDigest
    && link.readReceipt.qualification.evidenceDigest === read.evidenceDigest && capture.qualificationDigest === imported.digest,
  'ACCOUNTING_READ_BINDING_CHANGED', 'Acquisition custody must match the exact current product, authority and qualification evidence.');
  const pages = capture.pages.map((page, pageIndex) => {
    const retained = link.pages[pageIndex], decoded = profile.decoder.decode(page.content);
    check(retained.deliveryId === page.deliveryId && retained.provenance.contentSha256 === page.sha256 && sha256(page.content) === page.sha256
      && retained.provenance.byteLength === page.bytes && page.bytes === Buffer.byteLength(page.content)
      && retained.provenance.schemaFingerprint === decoderDescriptor.schemaSha256 && page.schemaSha256 === decoderDescriptor.schemaSha256
      && retained.provenance.operationKey === connectorOperationKey(profile.readOperation)
      && retained.provenance.authorityScopeHash === readAuthorityScopeHash(authority) && retained.provenance.dataScopeHash === digest(capture.domain)
      && link.readReceipt.contentHashes[pageIndex] === page.sha256
      && digest(decoded) === digest(page.rows),
    'ACCOUNTING_ORIGINAL_BYTES_CHANGED', 'Retain original bytes and exact decoder-row lineage before reviewing a translation.');
    return { deliveryId: page.deliveryId, nativePageSha256: page.sha256, nativeWireSchemaSha256: page.schemaSha256,
      sourceGeneratedAtMs: retained.provenance.source.generatedAtMs, snapshotId: retained.provenance.source.snapshotId,
      completeness: retained.provenance.source.completeness, rows: decoded.map((row, rowIndex) => ({ row: rowIndex + 1,
        decoded: structuredClone(row), decodedRowHash: hashData(row) })) };
  });
  const rows = pages.flatMap(page => page.rows.map(row => row.decoded));
  check(link.readReceipt.rows === rows.length && link.readReceipt.bytes === capture.pages.reduce((sum, page) => sum + page.bytes, 0),
    'ACCOUNTING_READ_COUNTS_CHANGED', 'The native receipt must retain every acquired page and decoded row.');
  return { semanticQualification: 'unqualified' as const, ready: false as const, liveVerified: false as const, writebackQualified: false as const,
    captureId: capture.id, generation: capture.generation, recipeHash: capture.recipeHash, decoderDefinitionHash: decoderDescriptor.definitionHash,
    readDefinitionDigest: read.definitionDigest, importDefinitionDigest: imported.definitionDigest,
    nativeWireSchemaSha256: decoderDescriptor.schemaSha256, decodedRowsHash: hashData(rows),
    compilerSourceSchemaHash: null, compilerSourceRowsHash: null, pages, unresolved: [...unresolved] };
}
