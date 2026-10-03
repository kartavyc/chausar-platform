import type { DatasetManifest } from '../contracts.ts';
import { dataOnly, digest, exactKeys, freezeData, hashData, requireThat, sha256Bytes, strings, text } from '../validation.ts';
import { PREPARATION_LIMITS } from './contracts.ts';
import type {
  ArtifactObservation, ImplementationIdentity, LocalArtifactPreparationHost, LocalArtifactPreparationReceipt,
  LocalArtifactPreparationRequest, ObservedCell, ObservedSheet, OriginalCustody, PreparationEvidenceBinding,
  PreparedLocalArtifact, ProjectedArtifact, ProjectionPlan, ReviewReference,
} from './contracts.ts';

const CELL_TYPES = ['text', 'number', 'date', 'boolean', 'blank', 'error', 'formula'];
const AUTHORITY = {
  qualification: 'UNQUALIFIED', connectorAdmission: false, vendorAdmission: false, publicationAuthority: false,
  modelDisclosureAuthority: false, redistributionAuthority: false, trainingAuthority: false,
} as const;
const LIMITATIONS = [
  'Preparation is local syntax/projection evidence only; all external datasets and named vendors remain unqualified.',
  'No workbook parser, workbook minimizer, source controls, accounting meaning or publication authority is implemented here.',
  'Cell fingerprints and projected data remain sensitive; dropping columns does not establish declassification.',
];

function utc(value: unknown): asserts value is string {
  text(value, 'UTC evidence time');
  requireThat(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
    'INVALID_TIME', 'Evidence requires an explicit real UTC ISO timestamp.');
}
function integer(value: unknown, min: number, max: number, name: string) {
  requireThat(Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max,
    'PREPARATION_LIMIT', `${name} exceeds the version 1 preparation envelope.`);
}
function path(value: unknown) {
  text(value, 'relative artifact/member path');
  requireThat((value as string).split('/').every(segment => /^[A-Za-z0-9_.-]+$/.test(segment)
    && !['.', '..'].includes(segment) && !segment.endsWith('.')
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)),
  'ARTIFACT_PATH', 'Only unambiguous relative data paths are accepted; traversal, drive/absolute paths and aliases are refused.');
}
function identity(value: ImplementationIdentity) {
  dataOnly(value); exactKeys(value, ['id', 'version', 'buildHash', 'profileHash'], 'implementation identity');
  text(value.id, 'implementation ID'); text(value.version, 'implementation version'); digest(value.buildHash); digest(value.profileHash);
}
function review(value: ReviewReference, at: string) {
  text(value.id, 'review ID'); text(value.reviewer, 'reviewer'); utc(value.at); digest(value.evidenceHash); digest(value.subjectHash);
  requireThat(value.at <= at, 'REVIEW_NOT_YET_OBSERVED', 'A future review cannot establish current preparation evidence.');
}

/** Comparison hashes only. They do not prove a license, privacy assessment or observation. */
export function rightsReviewSubject(manifest: DatasetManifest, custody: OriginalCustody) {
  dataOnly(manifest); dataOnly(custody);
  return hashData({ manifestHash: hashData(manifest), originalSha256: custody.sha256 });
}
export function privacyReviewSubject(manifest: DatasetManifest, observation: ArtifactObservation, projection: ProjectionPlan, projected: ProjectedArtifact) {
  return hashData({ manifestHash: hashData(manifest), observationHash: hashData(observation), projectionHash: hashData(projection), projectedHash: hashData(projected) });
}
export function preparationEvidenceBinding(request: LocalArtifactPreparationRequest): PreparationEvidenceBinding {
  dataOnly(request);
  return {
    contractVersion: 1, attemptId: request.attemptId, at: request.at, expiresAt: request.expiresAt, purpose: 'local-artifact-preparation',
    dependencies: {
      manifestHash: hashData(request.manifest), custodyHash: hashData(request.custody), parserHash: hashData(request.parser),
      observationHash: hashData(request.observation), schemaHash: hashData(request.observation.sheets),
      projectionHash: hashData(request.projection), projectedHash: hashData(request.projected),
      rightsReviewHash: hashData(request.rightsReview), privacyReviewHash: hashData(request.privacyReview), sourceIdentityHash: hashData(request.sourceIdentity),
    },
  };
}

/** Manifest rights remain the existing authority description; preparation verifies only its own original and review references. */
function validateManifest(request: LocalArtifactPreparationRequest) {
  const { manifest, custody } = request;
  exactKeys(manifest, ['contractVersion', 'id', 'title', 'origin', 'category', 'source', 'rights', 'artifacts', 'limitations'], 'dataset manifest');
  requireThat(manifest.contractVersion === 1, 'UNSUPPORTED_VERSION', 'Unknown dataset manifest version.');
  text(manifest.id, 'dataset ID'); text(manifest.title, 'dataset title');
  requireThat(['synthetic', 'official-public', 'authorized-upload'].includes(manifest.origin), 'INVALID_PROVENANCE', 'Record the existing manifest origin.');
  requireThat(['reference-schema', 'business-books', 'configuration-family', 'synthetic-cases'].includes(manifest.category), 'INVALID_PROVENANCE', 'Record the existing manifest category.');
  exactKeys(manifest.source, ['publisher', 'url', 'retrievedAt', 'productVersion'], 'source provenance');
  text(manifest.source.publisher, 'publisher'); text(manifest.source.productVersion, 'source product version'); text(manifest.source.retrievedAt, 'retrieval time');
  requireThat(Number.isFinite(Date.parse(manifest.source.retrievedAt)) && Date.parse(manifest.source.retrievedAt) <= Date.parse(request.at), 'INVALID_PROVENANCE', 'Provenance must already have been observed.');
  requireThat(manifest.source.url === null || (typeof manifest.source.url === 'string' && /^https:\/\//.test(manifest.source.url)), 'INVALID_PROVENANCE', 'Record an HTTPS provenance reference or null; it is never fetched.');
  exactKeys(manifest.rights, ['status', 'license', 'evidence', 'permittedUses', 'personalData', 'permissions'], 'dataset rights');
  text(manifest.rights.license, 'license'); text(manifest.rights.evidence, 'rights evidence'); strings(manifest.rights.permittedUses, 'permitted uses');
  requireThat(manifest.rights.permittedUses.every(use => ['qualification', 'redistribution'].includes(use)), 'RIGHTS_UNRESOLVED', 'Unknown manifest uses are refused.');
  exactKeys(manifest.rights.permissions, ['acquisition', 'reuse', 'redistribution', 'training'], 'per-use permissions');
  requireThat(Object.values(manifest.rights.permissions).every(value => ['allowed', 'unknown', 'denied'].includes(value)), 'RIGHTS_UNRESOLVED', 'Permission decisions must be explicit.');
  requireThat(manifest.rights.status === 'allowed' && manifest.rights.permittedUses.includes('qualification') && manifest.rights.permissions.acquisition === 'allowed' && manifest.rights.permissions.reuse === 'allowed',
    'RIGHTS_UNRESOLVED', 'Local validation preparation requires reviewed acquisition and reuse rights; availability is insufficient.');
  requireThat(['none', 'redacted'].includes(manifest.rights.personalData), 'PERSONAL_DATA_UNREVIEWED', 'Unreviewed personal data cannot enter preparation.');
  strings(manifest.limitations, 'manifest limitations', true);
  requireThat(Array.isArray(manifest.artifacts) && manifest.artifacts.length > 0 && manifest.artifacts.length <= 100, 'ARTIFACT_MISSING', 'A bounded original/review artifact manifest is required.');
  const seen = new Set<string>();
  for (const artifact of manifest.artifacts) {
    exactKeys(artifact, ['path', 'sha256', 'role'], 'manifest artifact'); path(artifact.path); digest(artifact.sha256);
    requireThat(!seen.has(artifact.path.toLowerCase()), 'ARTIFACT_PATH', 'Case-aliasing or repeated artifact paths are refused.'); seen.add(artifact.path.toLowerCase());
    requireThat(['source-rows', 'source-report', 'golden-cases', 'schema-reference', 'authorization'].includes(artifact.role), 'INVALID_PROVENANCE', 'Unknown manifest artifact role.');
  }
  const original = manifest.artifacts.find(artifact => artifact.path === custody.path);
  requireThat(original && ['source-rows', 'schema-reference'].includes(original.role) && original.sha256 === custody.sha256,
    'CUSTODY_MISMATCH', 'The retained original must match an exact original data/reference manifest artifact.');
  for (const ref of [request.rightsReview, request.privacyReview]) {
    requireThat(manifest.artifacts.some(artifact => artifact.role === 'authorization' && artifact.sha256 === ref.evidenceHash),
      'REVIEW_EVIDENCE_MISSING', 'Rights/privacy review evidence must resolve to a manifest authorization artifact and trusted current review.');
  }
  requireThat(manifest.artifacts.some(artifact => artifact.sha256 === request.sourceIdentity.evidenceHash), 'SOURCE_IDENTITY_UNVERIFIED', 'Source identity needs a manifest-bound evidence reference.');
}

function validateGrid(sheets: ObservedSheet[], cells: ObservedCell[], allowEmpty: boolean) {
  requireThat(Array.isArray(sheets) && (allowEmpty || sheets.length > 0), 'OBSERVATION_INCOMPLETE', 'Original observations require a complete sheet/table inventory.');
  integer(sheets.length, 0, PREPARATION_LIMITS.sheets, 'sheet count');
  requireThat(Array.isArray(cells), 'OBSERVATION_INCOMPLETE', 'Observed cells must be explicit.'); integer(cells.length, 0, PREPARATION_LIMITS.cells, 'cell count');
  const sheetMap = new Map<string, ObservedSheet>();
  let expectedCells = 0;
  for (const sheet of sheets) {
    exactKeys(sheet, ['id', 'name', 'partPath', 'visibility', 'columns', 'dataRows'], 'observed sheet');
    text(sheet.id, 'sheet ID'); text(sheet.name, 'sheet name'); path(sheet.partPath);
    requireThat(!sheetMap.has(sheet.id) && ['visible', 'hidden', 'very-hidden'].includes(sheet.visibility), 'OBSERVATION_INCOMPLETE', 'Sheet identities/visibility must be distinct and explicit.'); sheetMap.set(sheet.id, sheet);
    requireThat(Array.isArray(sheet.columns) && sheet.columns.length > 0, 'OBSERVATION_INCOMPLETE', 'Every represented sheet needs observed columns.'); integer(sheet.columns.length, 1, PREPARATION_LIMITS.columnsPerSheet, 'column count');
    const columnIds = new Set<string>(); let previousColumn = 0;
    for (const column of sheet.columns) {
      exactKeys(column, ['id', 'label', 'index', 'types'], 'observed column'); text(column.id, 'column ID'); text(column.label, 'column label', true); integer(column.index, 1, 16384, 'original column index');
      requireThat(!columnIds.has(column.id) && column.index > previousColumn, 'OBSERVATION_INCOMPLETE', 'Columns require unique identities and ordered original coordinates.'); columnIds.add(column.id); previousColumn = column.index;
      requireThat(Array.isArray(column.types) && column.types.length <= CELL_TYPES.length && new Set(column.types).size === column.types.length && column.types.every(type => CELL_TYPES.includes(type)), 'OBSERVATION_INCOMPLETE', 'Column types must be observed distinct cell types.');
    }
    requireThat(Array.isArray(sheet.dataRows), 'OBSERVATION_INCOMPLETE', 'The original data row coordinates must be explicit.'); integer(sheet.dataRows.length, 0, PREPARATION_LIMITS.rowsPerSheet, 'data row count');
    let previousRow = 0; for (const row of sheet.dataRows) { integer(row, 1, 1048576, 'original row index'); requireThat(row > previousRow, 'OBSERVATION_INCOMPLETE', 'Rows must be unique ordered original coordinates.'); previousRow = row; }
    expectedCells += sheet.columns.length * sheet.dataRows.length;
  }
  integer(expectedCells, 0, PREPARATION_LIMITS.cells, 'complete grid');
  requireThat(expectedCells === cells.length, 'OBSERVATION_INCOMPLETE', 'Every declared data-row/column coordinate needs a cell, including blanks.');
  const positions = new Set<string>(), observedTypes = new Map<string, Set<string>>();
  for (const cell of cells) {
    exactKeys(cell, ['sheetId', 'row', 'columnId', 'type', 'lexeme', 'displayLexeme', 'numberFormat', 'formula', 'cachedLexeme'], 'observed cell');
    const sheet = sheetMap.get(cell.sheetId), column = sheet?.columns.find(item => item.id === cell.columnId);
    requireThat(sheet && column && sheet.dataRows.includes(cell.row), 'OBSERVATION_INCOMPLETE', 'Cells must resolve to original sheet/row/column coordinates.');
    const position = hashData([cell.sheetId, cell.row, cell.columnId]); requireThat(!positions.has(position), 'OBSERVATION_INCOMPLETE', 'Duplicate cell observations are refused.'); positions.add(position);
    requireThat(CELL_TYPES.includes(cell.type), 'OBSERVATION_INCOMPLETE', 'A cell type must be observed.');
    text(cell.lexeme, 'stored lexeme', true);
    for (const lexical of [cell.displayLexeme, cell.numberFormat, cell.formula, cell.cachedLexeme]) if (lexical !== null) text(lexical, 'cell lexical evidence', true);
    requireThat(cell.type !== 'formula' && cell.type !== 'error' && cell.formula === null && cell.cachedLexeme === null,
      'UNSUPPORTED_CELL', 'Version 1 is literal-only; formulas, cached calculations and error cells need a separately qualified profile.');
    requireThat(cell.type !== 'blank' || cell.lexeme === '', 'OBSERVATION_INCOMPLETE', 'A blank cell cannot contain a fabricated stored value.');
    const key = hashData([cell.sheetId, cell.columnId]); const types = observedTypes.get(key) ?? new Set<string>(); types.add(cell.type); observedTypes.set(key, types);
  }
  for (const sheet of sheets) for (const column of sheet.columns) {
    requireThat(hashData([...column.types].sort()) === hashData([...(observedTypes.get(hashData([sheet.id, column.id])) ?? [])].sort()),
      'SCHEMA_OBSERVATION_MISMATCH', 'Schema types must equal the actual observed cells; declared or invented types are insufficient.');
  }
}

function validateObservation(observation: ArtifactObservation, request: LocalArtifactPreparationRequest) {
  exactKeys(observation, ['contractVersion', 'originalSha256', 'parserHash', 'mediaType', 'parts', 'sheets', 'cells', 'inspection', 'limitations'], 'artifact observation');
  requireThat(observation.contractVersion === 1, 'UNSUPPORTED_VERSION', 'Unknown observation version.'); digest(observation.originalSha256); digest(observation.parserHash);
  requireThat(observation.originalSha256 === request.custody.sha256 && observation.parserHash === hashData(request.parser), 'OBSERVATION_BINDING_MISMATCH', 'An observation must bind the exact original bytes and parser distribution/profile.');
  requireThat(['workbook', 'delimited-text', 'synthetic-fixture'].includes(observation.mediaType), 'UNSUPPORTED_MEDIA', 'Only explicitly inspected supported artifact profiles are represented.');
  requireThat(Array.isArray(observation.parts) && observation.parts.length > 0, 'OBSERVATION_INCOMPLETE', 'All original artifact parts must be inventoried.'); integer(observation.parts.length, 1, PREPARATION_LIMITS.parts, 'part count');
  const parts = new Set<string>(); let expandedBytes = 0;
  for (const part of observation.parts) {
    exactKeys(part, ['path', 'sha256', 'byteLength', 'inspected'], 'observed part'); path(part.path); digest(part.sha256); integer(part.byteLength, 0, PREPARATION_LIMITS.expandedBytes, 'part bytes');
    requireThat(part.inspected === true && !parts.has(part.path.toLowerCase()), 'OBSERVATION_INCOMPLETE', 'Every part must be inspected without duplicate/aliased member paths.'); parts.add(part.path.toLowerCase()); expandedBytes += part.byteLength;
  }
  integer(expandedBytes, 0, PREPARATION_LIMITS.expandedBytes, 'aggregate expanded bytes');
  exactKeys(observation.inspection, ['allPartsInspected', 'encrypted', 'activeContent', 'externalLinks'], 'whole artifact inspection');
  requireThat(observation.inspection.allPartsInspected === true && observation.inspection.encrypted === false && observation.inspection.activeContent === false && Array.isArray(observation.inspection.externalLinks) && observation.inspection.externalLinks.length === 0,
    'UNSAFE_OR_UNINSPECTED_ARTIFACT', 'Uninspected parts, encrypted/active content or external links are outside this literal-only profile.');
  validateGrid(observation.sheets, observation.cells, false);
  requireThat(observation.sheets.every(sheet => observation.parts.some(part => part.path === sheet.partPath)), 'OBSERVATION_INCOMPLETE', 'Every sheet must resolve to an inspected original part.');
  strings(observation.limitations, 'observation limitations', true);
}

/** Checks the supplied interface result; never opens or rewrites a workbook. */
function validateProjection(observation: ArtifactObservation, plan: ProjectionPlan, projected: ProjectedArtifact) {
  exactKeys(plan, ['contractVersion', 'id', 'version', 'minimizer', 'sheets'], 'projection plan');
  requireThat(plan.contractVersion === 1, 'UNSUPPORTED_VERSION', 'Unknown projection version.'); text(plan.id, 'projection ID'); text(plan.version, 'projection version'); identity(plan.minimizer);
  requireThat(Array.isArray(plan.sheets) && plan.sheets.length === observation.sheets.length, 'PROJECTION_INCOMPLETE', 'Every sheet, including hidden sheets, needs an explicit column disposition.');
  const plans = new Map<string, ProjectionPlan['sheets'][number]>();
  for (const item of plan.sheets) {
    exactKeys(item, ['sheetId', 'retainColumns', 'removeColumns'], 'sheet projection'); text(item.sheetId, 'projection sheet ID'); strings(item.retainColumns, 'retained columns', true); strings(item.removeColumns, 'removed columns', true);
    const sheet = observation.sheets.find(candidate => candidate.id === item.sheetId);
    requireThat(sheet && !plans.has(item.sheetId), 'PROJECTION_INCOMPLETE', 'Unknown or duplicate projection sheets are refused.'); plans.set(item.sheetId, item);
    const columns = sheet.columns.map(column => column.id), all = [...item.retainColumns, ...item.removeColumns];
    requireThat(new Set(all).size === columns.length && all.length === columns.length && all.every(id => columns.includes(id))
      && hashData(item.retainColumns) === hashData(columns.filter(id => item.retainColumns.includes(id)))
      && hashData(item.removeColumns) === hashData(columns.filter(id => item.removeColumns.includes(id))),
    'PROJECTION_INCOMPLETE', 'Each original column must be retained or removed exactly once in original order.');
  }
  exactKeys(projected, ['contractVersion', 'observationHash', 'projectionHash', 'sheets', 'cells', 'cellReceipts', 'limitations'], 'projected artifact');
  requireThat(projected.contractVersion === 1, 'UNSUPPORTED_VERSION', 'Unknown projected artifact version.'); digest(projected.observationHash); digest(projected.projectionHash);
  requireThat(projected.observationHash === hashData(observation) && projected.projectionHash === hashData(plan), 'PROJECTION_BINDING_MISMATCH', 'Projection must bind the exact observation and versioned plan.');
  validateGrid(projected.sheets, projected.cells, true);
  const expectedSheets = observation.sheets.filter(sheet => plans.get(sheet.id)!.retainColumns.length > 0).map(sheet => ({
    ...sheet, columns: sheet.columns.filter(column => plans.get(sheet.id)!.retainColumns.includes(column.id)).map((column, index) => ({ ...column, index: index + 1 })),
  }));
  const expectedCells = observation.cells.filter(cell => plans.get(cell.sheetId)!.retainColumns.includes(cell.columnId));
  requireThat(hashData(projected.sheets) === hashData(expectedSheets) && hashData(projected.cells) === hashData(expectedCells),
    'PROJECTION_CELL_MISMATCH', 'The literal projection must preserve every retained cell type, stored/displayed lexeme, format and original row identity exactly.');
  requireThat(Array.isArray(projected.cellReceipts) && projected.cellReceipts.length === observation.cells.length, 'CELL_RECEIPTS_INCOMPLETE', 'Every original cell, including removed cells, needs one projection receipt.');
  for (let i = 0; i < observation.cells.length; i++) {
    const cell = observation.cells[i], sheet = observation.sheets.find(item => item.id === cell.sheetId)!, column = sheet.columns.find(item => item.id === cell.columnId)!;
    const outputIndex = plans.get(cell.sheetId)!.retainColumns.indexOf(cell.columnId);
    const expected = { partPath: sheet.partPath, sheetId: cell.sheetId, row: cell.row, columnId: cell.columnId, sourceColumnIndex: column.index,
      sourceCellHash: hashData(cell), disposition: outputIndex < 0 ? 'removed' : 'retained', outputColumnIndex: outputIndex < 0 ? null : outputIndex + 1 };
    requireThat(hashData(projected.cellReceipts[i]) === hashData(expected), 'CELL_RECEIPT_MISMATCH', 'A cell receipt cannot invent, omit or retarget an original coordinate/value.');
  }
  strings(projected.limitations, 'projection limitations', true);
  requireThat(observation.limitations.every(limit => projected.limitations.includes(limit)), 'LIMITATIONS_LOST', 'Projection must preserve original observation limitations.');
}

function assertTime(request: LocalArtifactPreparationRequest, now: string) {
  utc(now);
  requireThat(request.at <= now && request.custody.capturedAt <= request.at, 'EVIDENCE_NOT_YET_OBSERVED', 'Preparation and original custody must already be observed.');
  requireThat(now < request.expiresAt && request.at < request.expiresAt && request.expiresAt <= request.custody.retainedUntil,
    'EVIDENCE_EXPIRED', 'Preparation must expire within the permitted retained original-byte evidence window.');
}
function assertHost(host: LocalArtifactPreparationHost) {
  requireThat(host && ['now', 'readOriginal', 'verifyEvidence', 'retainAudit', 'retainedReceiptHash'].every(name => typeof (host as any)[name] === 'function')
    && host.inspector && typeof host.inspector.inspect === 'function' && host.minimizer && typeof host.minimizer.project === 'function',
  'TRUSTED_PREPARATION_HOST_REQUIRED', 'Every trusted custody, inspection, projection, current review and existing audit-store port is required.');
}
function assertImplementations(host: LocalArtifactPreparationHost, request: LocalArtifactPreparationRequest) {
  identity(host.inspector.identity); identity(host.minimizer.identity);
  requireThat(hashData(host.inspector.identity) === hashData(request.parser) && hashData(host.minimizer.identity) === hashData(request.projection.minimizer),
    'IMPLEMENTATION_UNVERIFIED', 'Parser and minimizer must remain the exact trusted installed implementations/profiles.');
}
function verify(host: LocalArtifactPreparationHost, binding: PreparationEvidenceBinding, now: string) {
  const result = host.verifyEvidence(freezeData(binding), now); dataOnly(result);
  requireThat(result !== null, 'PREPARATION_EVIDENCE_UNVERIFIED', 'Current custody, implementation, rights, privacy and distinct source identity evidence must all be verifiable.');
  exactKeys(result, ['bindingHash', 'verified'], 'trusted evidence verification');
  requireThat(result.verified === true && result.bindingHash === hashData(binding), 'PREPARATION_EVIDENCE_UNVERIFIED', 'Self-consistent caller hashes cannot establish a trusted current evidence binding.');
}

function build(input: LocalArtifactPreparationRequest, host: LocalArtifactPreparationHost): { prepared: PreparedLocalArtifact; checkedAt: string } {
  dataOnly(input); const request = freezeData(input);
  exactKeys(request, ['contractVersion', 'attemptId', 'at', 'expiresAt', 'manifest', 'custody', 'parser', 'observation', 'projection', 'projected', 'rightsReview', 'privacyReview', 'sourceIdentity'], 'local artifact preparation request');
  requireThat(request.contractVersion === 1, 'UNSUPPORTED_VERSION', 'Unknown local preparation version.'); text(request.attemptId, 'preparation attempt ID'); utc(request.at); utc(request.expiresAt);
  exactKeys(request.custody, ['captureId', 'storageVersion', 'attemptId', 'path', 'sha256', 'byteLength', 'capturedAt', 'retainedUntil'], 'original custody');
  const { custody } = request; text(custody.captureId, 'capture ID'); text(custody.storageVersion, 'immutable storage version'); path(custody.path); digest(custody.sha256); utc(custody.capturedAt); utc(custody.retainedUntil);
  integer(custody.byteLength, 1, PREPARATION_LIMITS.originalBytes, 'original bytes');
  requireThat(custody.attemptId === request.attemptId, 'CUSTODY_MISMATCH', 'Custody must name this exact processing attempt.');
  identity(request.parser);
  // Shape-check evidence before any cross-reference dereference.
  exactKeys(request.rightsReview, ['id', 'reviewer', 'at', 'evidenceHash', 'subjectHash'], 'rights review');
  exactKeys(request.privacyReview, ['id', 'reviewer', 'at', 'evidenceHash', 'subjectHash', 'personalData', 'allPartsReviewed', 'residualLimitations'], 'privacy review');
  exactKeys(request.sourceIdentity, ['sourceId', 'manifestId', 'origin', 'sourceHash', 'families', 'evidenceHash'], 'distinct source identity');
  validateManifest(request); validateObservation(request.observation, request); validateProjection(request.observation, request.projection, request.projected);
  exactKeys(request.rightsReview, ['id', 'reviewer', 'at', 'evidenceHash', 'subjectHash'], 'rights review'); review(request.rightsReview, request.at);
  requireThat(request.rightsReview.subjectHash === rightsReviewSubject(request.manifest, custody), 'RIGHTS_REVIEW_STALE', 'Rights review must bind the current manifest and exact original.');
  exactKeys(request.privacyReview, ['id', 'reviewer', 'at', 'evidenceHash', 'subjectHash', 'personalData', 'allPartsReviewed', 'residualLimitations'], 'privacy review'); review(request.privacyReview, request.at);
  requireThat(request.privacyReview.personalData === request.manifest.rights.personalData && request.privacyReview.allPartsReviewed === true, 'PERSONAL_DATA_UNREVIEWED', 'Privacy review must cover all original parts and the declared residual personal-data classification.');
  strings(request.privacyReview.residualLimitations, 'residual privacy limitations', true);
  requireThat(request.privacyReview.subjectHash === privacyReviewSubject(request.manifest, request.observation, request.projection, request.projected), 'PRIVACY_REVIEW_STALE', 'Privacy review must bind both full original observations and exact projected content/cell fingerprints.');
  exactKeys(request.sourceIdentity, ['sourceId', 'manifestId', 'origin', 'sourceHash', 'families', 'evidenceHash'], 'distinct source identity'); text(request.sourceIdentity.sourceId, 'distinct source ID'); digest(request.sourceIdentity.sourceHash); digest(request.sourceIdentity.evidenceHash);
  requireThat(request.sourceIdentity.manifestId === request.manifest.id && request.sourceIdentity.origin === request.manifest.origin && request.sourceIdentity.sourceHash === hashData(request.manifest.source), 'SOURCE_IDENTITY_UNVERIFIED', 'Source identity must bind manifest provenance; an origin enum or file path is insufficient.');
  exactKeys(request.sourceIdentity.families, ['business', 'template', 'configuration'], 'source origin families');
  for (const family of Object.values(request.sourceIdentity.families)) if (family !== null) text(family, 'evidenced source family');
  assertHost(host); const now = host.now(); assertTime(request, now);
  assertImplementations(host, request);
  const binding = freezeData(preparationEvidenceBinding(request)); verify(host, binding, now);
  const original = host.readOriginal(custody);
  requireThat(original instanceof Uint8Array && original.buffer instanceof ArrayBuffer && original.byteLength === custody.byteLength, 'CUSTODY_UNVERIFIED', 'The trusted host must provide the complete retained original byte sequence.');
  const bytes = Uint8Array.from(original);
  requireThat(sha256Bytes(bytes) === custody.sha256, 'CUSTODY_MISMATCH', 'Original bytes differ from the retained manifest/custody digest.');
  assertImplementations(host, request);
  const inspected = host.inspector.inspect(bytes, PREPARATION_LIMITS); dataOnly(inspected);
  const observation = freezeData(inspected);
  assertImplementations(host, request);
  requireThat(sha256Bytes(bytes) === custody.sha256, 'CUSTODY_MISMATCH', 'The parser mutated the verified original sequence.');
  validateObservation(observation, request);
  requireThat(hashData(observation) === hashData(request.observation), 'OBSERVATION_UNVERIFIED', 'Caller-authored or rehashed observations must equal fresh trusted inspection of the exact original bytes.');
  const minimized = host.minimizer.project(observation, request.projection, PREPARATION_LIMITS); dataOnly(minimized);
  const projected = freezeData(minimized);
  assertImplementations(host, request);
  validateProjection(observation, request.projection, projected);
  requireThat(hashData(projected) === hashData(request.projected), 'PROJECTION_UNVERIFIED', 'The claimed projection must equal the exact trusted minimizer result.');
  const finalTime = host.now(); assertTime(request, finalTime);
  requireThat(finalTime >= now, 'INVALID_TIME', 'A backwards trusted clock cannot establish current evidence.');
  verify(host, binding, finalTime); assertImplementations(host, request);
  const limitations = [...new Set([...LIMITATIONS, ...request.manifest.limitations, ...request.observation.limitations, ...request.projected.limitations, ...request.privacyReview.residualLimitations])]; strings(limitations, 'preparation limitations');
  const payload = { ...binding, kind: 'local-artifact-preparation' as const, datasetId: request.manifest.id, ...AUTHORITY, limitations };
  return { prepared: freezeData({ receipt: { ...payload, id: hashData(payload) }, projected }), checkedAt: finalTime };
}

/** Refuses atomically before returning any candidate on missing/unverifiable evidence. No qualification ledger is written. */
export function prepareLocalArtifact(request: LocalArtifactPreparationRequest, host: LocalArtifactPreparationHost): PreparedLocalArtifact {
  dataOnly(request); request = freezeData(request);
  const { prepared, checkedAt } = build(request, host);
  const prior = host.retainedReceiptHash(request.attemptId);
  requireThat(prior === null || prior === prepared.receipt.id, 'PREPARATION_ATTEMPT_REUSED', 'An audited processing attempt cannot be rebound to different preparation evidence.');
  requireThat(host.retainAudit(prepared.receipt) === prepared.receipt.id && host.retainedReceiptHash(request.attemptId) === prepared.receipt.id,
    'AUDIT_UNRETAINED', 'The existing audit store must retain and independently resolve this exact preparation receipt.');
  const now = host.now(); assertTime(request, now); verify(host, preparationEvidenceBinding(request), now); assertImplementations(host, request);
  requireThat(now >= checkedAt, 'INVALID_TIME', 'A backwards trusted clock after audit cannot establish current evidence.');
  requireThat(host.retainedReceiptHash(request.attemptId) === prepared.receipt.id, 'AUDIT_UNRETAINED', 'The preparation audit anchor changed during final evidence checks.');
  return prepared;
}

/** Reinspection/current review is mandatory. Consume ONLY the returned frozen snapshot, never the
 * mutable caller DTO. A digest or historically valid receipt alone is never permission.
 */
export function revalidateLocalArtifactPreparation(prepared: PreparedLocalArtifact, request: LocalArtifactPreparationRequest, host: LocalArtifactPreparationHost): PreparedLocalArtifact {
  dataOnly(prepared); prepared = freezeData(prepared); dataOnly(request); request = freezeData(request);
  const { prepared: rebuilt, checkedAt } = build(request, host);
  requireThat(hashData(prepared) === hashData(rebuilt), 'PREPARATION_STALE', 'The preparation differs from current original, implementations, schema, projection, reviews or source identity.');
  requireThat(host.retainedReceiptHash(request.attemptId) === rebuilt.receipt.id, 'AUDIT_UNRETAINED', 'A source/caller-supplied receipt cannot supply its own retained audit anchor.');
  const now = host.now(); assertTime(request, now); verify(host, preparationEvidenceBinding(request), now); assertImplementations(host, request);
  requireThat(now >= checkedAt, 'INVALID_TIME', 'A backwards trusted clock after audit lookup cannot establish current evidence.');
  requireThat(host.retainedReceiptHash(request.attemptId) === rebuilt.receipt.id, 'AUDIT_UNRETAINED', 'The preparation audit anchor changed during final evidence checks.');
  return rebuilt;
}
