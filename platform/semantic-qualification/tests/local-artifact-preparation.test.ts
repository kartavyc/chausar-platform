import assert from 'node:assert/strict';
import test from 'node:test';
import { compileMapping, hashData, qualifyCase, SemanticError, sha256Bytes, type DatasetManifest, type QualificationInput } from '../src/index.ts';
import { prepareSyntheticSuite } from '../fixtures/prepare-suite.ts';
import type {
  ArtifactObservation, ImplementationIdentity, LocalArtifactPreparationHost,
  LocalArtifactPreparationRequest, ObservedCell,
  PreparedLocalArtifact, ProjectedArtifact, ProjectionPlan,
} from '../src/local-artifact-preparation/contracts.ts';
import {
  revalidateLocalArtifactPreparation, prepareLocalArtifact, preparationEvidenceBinding,
  privacyReviewSubject, rightsReviewSubject,
} from '../src/local-artifact-preparation/preparation.ts';

const at = '2026-10-03T12:00:00.000Z';
const expiresAt = '2026-10-04T12:00:00.000Z';
const original = new TextEncoder().encode('HAND-AUTHORED SYNTHETIC FIXTURE, NOT XLSX OR OBSERVED EXTERNAL DATA\nfixture-revision: 1\n');
const identity = (id: string): ImplementationIdentity => ({ id, version: 'fixture-v1', buildHash: hashData(`${id}-build`), profileHash: hashData(`${id}-bounded-profile`) });
const parser = identity('synthetic-inspector');
const minimizer = identity('synthetic-minimizer');
const limitation = 'Authored synthetic syntax only; no observed workbook, accounting meanings, parser or minimizer qualification.';
const cell = (sheetId: string, row: number, columnId: string, type: ObservedCell['type'], lexeme: string, displayLexeme: string | null = null, numberFormat: string | null = null): ObservedCell => ({ sheetId, row, columnId, type, lexeme, displayLexeme, numberFormat, formula: null, cachedLexeme: null });

/** Expected observations and projections are authored here, independently of the implementation. */
function authoredObservation(): ArtifactObservation {
  return {
    contractVersion: 1, originalSha256: sha256Bytes(original), parserHash: hashData(parser), mediaType: 'synthetic-fixture',
    parts: [
      { path: 'xl/workbook.xml', sha256: hashData('synthetic-workbook-part'), byteLength: 51, inspected: true },
      { path: 'xl/worksheets/sales.xml', sha256: hashData('synthetic-sales-part'), byteLength: 217, inspected: true },
      { path: 'xl/worksheets/notes.xml', sha256: hashData('synthetic-hidden-notes-part'), byteLength: 37, inspected: true },
    ],
    sheets: [
      { id: 'sales', name: 'Sales', partPath: 'xl/worksheets/sales.xml', visibility: 'visible', dataRows: [2, 3], columns: [
        { id: 'invoice', label: 'InvoiceNo', index: 1, types: ['text'] },
        { id: 'quantity', label: 'Quantity', index: 2, types: ['number'] },
        { id: 'date', label: 'InvoiceDate', index: 3, types: ['date'] },
        { id: 'price', label: 'UnitPrice', index: 4, types: ['number'] },
        { id: 'customer', label: 'CustomerID', index: 5, types: ['text'] },
        { id: 'country', label: 'Country', index: 6, types: ['text'] },
        { id: 'description', label: 'Description', index: 7, types: ['text', 'blank'] },
      ] },
      { id: 'notes', name: 'Hidden Notes', partPath: 'xl/worksheets/notes.xml', visibility: 'hidden', dataRows: [7], columns: [
        { id: 'label', label: 'DatasetLabel', index: 1, types: ['text'] },
        { id: 'private', label: 'PersonalNote', index: 2, types: ['text'] },
      ] },
    ],
    cells: [
      cell('sales', 2, 'invoice', 'text', 'C-0001'),
      cell('sales', 2, 'quantity', 'number', '-02.000'),
      cell('sales', 2, 'date', 'date', '40491.375', '2010-11-15 09:00', 'yyyy-mm-dd hh:mm'),
      cell('sales', 2, 'price', 'number', '001.2300', '1.23', '0.00'),
      cell('sales', 2, 'customer', 'text', 'SYNTHETIC-CUSTOMER-1'),
      cell('sales', 2, 'country', 'text', 'SYNTHETIC-COUNTRY'),
      cell('sales', 2, 'description', 'text', 'SYNTHETIC DESCRIPTION'),
      cell('sales', 3, 'invoice', 'text', '000002'),
      cell('sales', 3, 'quantity', 'number', '0'),
      cell('sales', 3, 'date', 'date', '40492.500000', '2010-11-16 12:00', 'yyyy-mm-dd hh:mm'),
      cell('sales', 3, 'price', 'number', '1E-03', '0.001', '0.000'),
      cell('sales', 3, 'customer', 'text', 'SYNTHETIC-CUSTOMER-2'),
      cell('sales', 3, 'country', 'text', 'SYNTHETIC-COUNTRY'),
      cell('sales', 3, 'description', 'blank', ''),
      cell('notes', 7, 'label', 'text', 'SYNTHETIC REFERENCE'),
      cell('notes', 7, 'private', 'text', 'SYNTHETIC PRIVATE NOTE'),
    ],
    inspection: { allPartsInspected: true, encrypted: false, activeContent: false, externalLinks: [] },
    limitations: [limitation],
  };
}

function authoredProjection(): ProjectionPlan {
  return { contractVersion: 1, id: 'synthetic-reviewed-removal', version: '1', minimizer: structuredClone(minimizer), sheets: [
    { sheetId: 'sales', retainColumns: ['invoice', 'quantity', 'date', 'price'], removeColumns: ['customer', 'country', 'description'] },
    { sheetId: 'notes', retainColumns: ['label'], removeColumns: ['private'] },
  ] };
}

function authoredProjected(observation: ArtifactObservation, projection: ProjectionPlan): ProjectedArtifact {
  // These literal output cells deliberately preserve source types and number/date spelling.
  const cells = [
    cell('sales', 2, 'invoice', 'text', 'C-0001'), cell('sales', 2, 'quantity', 'number', '-02.000'),
    cell('sales', 2, 'date', 'date', '40491.375', '2010-11-15 09:00', 'yyyy-mm-dd hh:mm'),
    cell('sales', 2, 'price', 'number', '001.2300', '1.23', '0.00'),
    cell('sales', 3, 'invoice', 'text', '000002'), cell('sales', 3, 'quantity', 'number', '0'),
    cell('sales', 3, 'date', 'date', '40492.500000', '2010-11-16 12:00', 'yyyy-mm-dd hh:mm'),
    cell('sales', 3, 'price', 'number', '1E-03', '0.001', '0.000'),
    cell('notes', 7, 'label', 'text', 'SYNTHETIC REFERENCE'),
  ];
  // Literal expected coordinates/dispositions, not a call to the product projection logic.
  const coordinates: Array<[string, number, string, number, number | null]> = [
    ['sales', 2, 'invoice', 1, 1], ['sales', 2, 'quantity', 2, 2], ['sales', 2, 'date', 3, 3], ['sales', 2, 'price', 4, 4],
    ['sales', 2, 'customer', 5, null], ['sales', 2, 'country', 6, null], ['sales', 2, 'description', 7, null],
    ['sales', 3, 'invoice', 1, 1], ['sales', 3, 'quantity', 2, 2], ['sales', 3, 'date', 3, 3], ['sales', 3, 'price', 4, 4],
    ['sales', 3, 'customer', 5, null], ['sales', 3, 'country', 6, null], ['sales', 3, 'description', 7, null],
    ['notes', 7, 'label', 1, 1], ['notes', 7, 'private', 2, null],
  ];
  const independentlyAuthoredOriginalCells = authoredObservation().cells;
  return {
    contractVersion: 1, observationHash: hashData(observation), projectionHash: hashData(projection),
    sheets: [
      { id: 'sales', name: 'Sales', partPath: 'xl/worksheets/sales.xml', visibility: 'visible', dataRows: [2, 3], columns: [
        { id: 'invoice', label: 'InvoiceNo', index: 1, types: ['text'] }, { id: 'quantity', label: 'Quantity', index: 2, types: ['number'] },
        { id: 'date', label: 'InvoiceDate', index: 3, types: ['date'] }, { id: 'price', label: 'UnitPrice', index: 4, types: ['number'] },
      ] },
      { id: 'notes', name: 'Hidden Notes', partPath: 'xl/worksheets/notes.xml', visibility: 'hidden', dataRows: [7], columns: [{ id: 'label', label: 'DatasetLabel', index: 1, types: ['text'] }] },
    ], cells,
    cellReceipts: coordinates.map(([sheetId, row, columnId, sourceColumnIndex, outputColumnIndex], index) => ({
      partPath: sheetId === 'sales' ? 'xl/worksheets/sales.xml' : 'xl/worksheets/notes.xml', sheetId, row, columnId, sourceColumnIndex,
      sourceCellHash: hashData(independentlyAuthoredOriginalCells[index]), disposition: outputColumnIndex === null ? 'removed' : 'retained', outputColumnIndex,
    })),
    limitations: [limitation],
  };
}

function fixture() {
  const observation = authoredObservation(), projection = authoredProjection(), projected = authoredProjected(observation, projection);
  const rightsHash = hashData('independently retained synthetic rights review'), privacyHash = hashData('independently retained synthetic all-parts privacy review'), sourceHash = hashData('independently retained synthetic source origin identity');
  const manifest: DatasetManifest = {
    contractVersion: 1, id: 'synthetic-local-preparation', title: 'Authored synthetic local artifact', origin: 'authorized-upload', category: 'reference-schema',
    source: { publisher: 'Synthetic fixture author', url: null, retrievedAt: '2026-10-03T11:00:00.000Z', productVersion: 'fixture-1' },
    rights: { status: 'allowed', license: 'Authored test fixture only', evidence: 'Synthetic fixture review; no real source grants claimed', permittedUses: ['qualification'], personalData: 'redacted', permissions: { acquisition: 'allowed', reuse: 'allowed', redistribution: 'unknown', training: 'unknown' } },
    artifacts: [
      { path: 'synthetic/original.bin', sha256: sha256Bytes(original), role: 'source-rows' },
      { path: 'synthetic/rights-review.json', sha256: rightsHash, role: 'authorization' },
      { path: 'synthetic/privacy-review.json', sha256: privacyHash, role: 'authorization' },
      { path: 'synthetic/source-identity.json', sha256: sourceHash, role: 'schema-reference' },
    ], limitations: [limitation],
  };
  const custody = { captureId: 'fixture-capture', storageVersion: 'immutable-fixture-v1', attemptId: 'fixture-attempt', path: 'synthetic/original.bin', sha256: sha256Bytes(original), byteLength: original.byteLength, capturedAt: '2026-10-03T11:30:00.000Z', retainedUntil: '2026-10-05T12:00:00.000Z' };
  const request: LocalArtifactPreparationRequest = {
    contractVersion: 1, attemptId: custody.attemptId, at, expiresAt, manifest, custody, parser: structuredClone(parser), observation, projection, projected,
    rightsReview: { id: 'fixture-rights-review', reviewer: 'Synthetic rights reviewer', at: '2026-10-03T11:45:00.000Z', evidenceHash: rightsHash, subjectHash: rightsReviewSubject(manifest, custody) },
    privacyReview: { id: 'fixture-privacy-review', reviewer: 'Synthetic privacy reviewer', at: '2026-10-03T11:50:00.000Z', evidenceHash: privacyHash, subjectHash: privacyReviewSubject(manifest, observation, projection, projected), personalData: 'redacted', allPartsReviewed: true, residualLimitations: [limitation] },
    sourceIdentity: { sourceId: 'synthetic-source-identity', manifestId: manifest.id, origin: manifest.origin, sourceHash: hashData(manifest.source), families: { business: null, template: null, configuration: null }, evidenceHash: sourceHash },
  };
  // Trusted synthetic fixture callbacks pin exact inputs independently of later request mutations.
  // This is not a production custody/review verifier or a workbook parser/minimizer.
  const expectedObservation = structuredClone(observation), expectedProjected = structuredClone(projected);
  let expectedBindingHash = hashData(preparationEvidenceBinding(request));
  const audit = new Map<string, string>();
  const counts = { inspections: 0, projections: 0, verifications: 0, auditWrites: 0 };
  const host: LocalArtifactPreparationHost = {
    now: () => at,
    readOriginal: () => Uint8Array.from(original),
    inspector: { identity: structuredClone(parser), inspect: () => { counts.inspections++; return structuredClone(expectedObservation); } },
    minimizer: { identity: structuredClone(minimizer), project: () => { counts.projections++; return structuredClone(expectedProjected); } },
    verifyEvidence: binding => { counts.verifications++; return hashData(binding) === expectedBindingHash ? { bindingHash: expectedBindingHash, verified: true } : null; },
    retainAudit: receipt => {
      // This synchronous fixture models atomic insert-if-absent; it never replaces a competing attempt.
      const existing = audit.get(receipt.attemptId);
      if (existing !== undefined) return existing === receipt.id ? receipt.id : null;
      counts.auditWrites++; audit.set(receipt.attemptId, receipt.id); return receipt.id;
    },
    retainedReceiptHash: attemptId => audit.get(attemptId) ?? null,
  };
  function repinEvidence() {
    request.projected.observationHash = hashData(request.observation);
    request.projected.projectionHash = hashData(request.projection);
    request.rightsReview.subjectHash = rightsReviewSubject(request.manifest, request.custody);
    request.privacyReview.subjectHash = privacyReviewSubject(request.manifest, request.observation, request.projection, request.projected);
    expectedBindingHash = hashData(preparationEvidenceBinding(request));
  }
  function pinInspectorAndMinimizer() {
    // Deliberately trusted-but-invalid fixtures must still pass structural/lineage validation.
    const inspectorResult = structuredClone(request.observation), minimizerResult = structuredClone(request.projected);
    host.inspector.inspect = () => { counts.inspections++; return structuredClone(inspectorResult); };
    host.minimizer.project = () => { counts.projections++; return structuredClone(minimizerResult); };
  }
  return { request, host, audit, counts, repinEvidence, pinInspectorAndMinimizer };
}

type Fixture = ReturnType<typeof fixture>;
function refuses(f: Fixture, code?: string) {
  assert.throws(() => prepareLocalArtifact(f.request, f.host), (error: unknown) => error instanceof SemanticError && (code === undefined || error.code === code));
  assert.equal(f.audit.size, 0, 'Refusal must not establish an independently retained preparation receipt.');
}
function refusesReuse(prepared: PreparedLocalArtifact, f: Fixture) {
  assert.throws(() => revalidateLocalArtifactPreparation(prepared, f.request, f.host), SemanticError);
}
function prepared(f = fixture()) { return { f, value: prepareLocalArtifact(f.request, f.host) }; }

test('authored local preparation binds all evidence and always remains UNQUALIFIED', () => {
  const { f, value } = prepared();
  assert.equal(value.receipt.contractVersion, 1); assert.equal(value.receipt.kind, 'local-artifact-preparation');
  assert.equal(value.receipt.qualification, 'UNQUALIFIED');
  for (const name of ['connectorAdmission', 'vendorAdmission', 'publicationAuthority', 'modelDisclosureAuthority', 'redistributionAuthority', 'trainingAuthority'] as const) assert.equal(value.receipt[name], false);
  assert.deepEqual(value.projected, authoredProjected(authoredObservation(), authoredProjection()));
  assert.deepEqual(value.receipt.dependencies, preparationEvidenceBinding(f.request).dependencies);
  assert.equal(f.audit.get(f.request.attemptId), value.receipt.id);
  assert.equal(f.counts.auditWrites, 1);
  assert.ok(f.counts.verifications >= 2, 'Evidence is independently verified before inspection and before final receipt.');
  assert.deepEqual(revalidateLocalArtifactPreparation(value, f.request, f.host), value);
  assert.equal(f.counts.auditWrites, 1, 'Reuse checks cannot mint a replacement audit receipt.');
  assert.deepEqual(prepareLocalArtifact(f.request, f.host), value, 'An identical attempt may idempotently confirm its existing anchor.');
  assert.equal(f.counts.auditWrites, 1, 'Idempotent preparation cannot replace the existing audit entry.');
  assert.equal(value.projected.cells.find(c => c.columnId === 'price')!.lexeme, '001.2300');
  assert.equal(value.projected.cells.find(c => c.columnId === 'date')!.type, 'date');
  assert.equal(value.projected.cellReceipts.filter(r => r.disposition === 'removed').length, 7);
  const { id, ...receiptPayload } = value.receipt;
  assert.equal(id, hashData(receiptPayload), 'The independently retained id hashes the exact receipt payload.');
  assert.ok(Object.isFrozen(value.receipt) && Object.isFrozen(value.projected.cells));
});

test('declared origin and source-family identities remain distinct and grant no admission', async t => {
  for (const origin of ['synthetic', 'authorized-upload', 'official-public'] as const) await t.test(origin, () => {
    const f = fixture(); f.request.manifest.origin = origin; f.request.sourceIdentity.origin = origin;
    f.repinEvidence(); const value = prepareLocalArtifact(f.request, f.host);
    assert.equal(value.receipt.qualification, 'UNQUALIFIED'); assert.equal(value.receipt.vendorAdmission, false);
    assert.deepEqual(f.request.sourceIdentity.families, { business: null, template: null, configuration: null });
  });
  const f = fixture(); f.request.sourceIdentity.origin = 'official-public'; f.repinEvidence(); refuses(f);
});

test('missing and tampered original-byte custody refuse before any observation is accepted', async t => {
  const cases: Array<[string, (f: Fixture) => void]> = [
    ['missing bytes', f => { f.host.readOriginal = () => null; }],
    ['changed byte', f => { f.host.readOriginal = () => { const bytes = Uint8Array.from(original); bytes[0] ^= 1; return bytes; }; }],
    ['changed length', f => { f.request.custody.byteLength++; }],
    ['changed digest', f => { f.request.custody.sha256 = '0'.repeat(64); }],
    ['missing custody', f => { delete (f.request as Partial<LocalArtifactPreparationRequest>).custody; }],
    ['wrong attempt', f => { f.request.custody.attemptId = 'other-attempt'; }],
    ['unretained original', f => { f.request.custody.retainedUntil = at; }],
    ['changed storage version', f => { f.request.custody.storageVersion = 'replacement-storage'; }],
    ['unverifiable evidence', f => { f.host.verifyEvidence = () => null; }],
    ['wrong independently verified binding', f => { f.host.verifyEvidence = () => ({ verified: true, bindingHash: hashData('wrong-binding') }); }],
  ];
  for (const [name, change] of cases) await t.test(name, () => { const f = fixture(); change(f); refuses(f); assert.equal(f.counts.inspections, 0); });
});

test('unknown or denied acquisition/reuse and discovery-only rights refuse', async t => {
  for (const permission of ['acquisition', 'reuse'] as const) for (const state of ['unknown', 'denied'] as const) await t.test(`${permission} ${state}`, () => {
    const f = fixture(); f.request.manifest.rights.permissions[permission] = state; f.repinEvidence(); refuses(f);
  });
  for (const status of ['discovery-only', 'denied'] as const) await t.test(status, () => { const f = fixture(); f.request.manifest.rights.status = status; f.repinEvidence(); refuses(f); });
  const f = fixture(); f.request.manifest.rights.evidence = ''; f.repinEvidence(); refuses(f);
});

test('unreviewed personal data or incomplete and unbound privacy/rights evidence refuses', async t => {
  const cases: Array<[string, (f: Fixture) => void]> = [
    ['manifest unreviewed', f => { f.request.manifest.rights.personalData = 'unreviewed'; }],
    ['privacy unreviewed', f => { (f.request.privacyReview as { personalData: string }).personalData = 'unreviewed'; }],
    ['hidden parts not reviewed', f => { (f.request.privacyReview as { allPartsReviewed: boolean }).allPartsReviewed = false; }],
    ['classification mismatch', f => { f.request.privacyReview.personalData = 'none'; }],
    ['privacy evidence missing from manifest', f => { f.request.manifest.artifacts = f.request.manifest.artifacts.filter(a => a.path !== 'synthetic/privacy-review.json'); }],
    ['rights evidence has wrong role', f => { f.request.manifest.artifacts.find(a => a.path === 'synthetic/rights-review.json')!.role = 'schema-reference'; }],
    ['source identity evidence absent', f => { f.request.sourceIdentity.evidenceHash = hashData('unsupported-origin-claim'); }],
  ];
  for (const [name, change] of cases) await t.test(name, () => { const f = fixture(); change(f); f.repinEvidence(); refuses(f); });
  for (const review of ['rightsReview', 'privacyReview'] as const) await t.test(`${review} stale subject`, () => { const f = fixture(); f.request[review].subjectHash = hashData('stale-subject'); refuses(f); });
});

test('unsafe paths are refused across custody, manifest and package parts', async t => {
  const paths = ['../outside.bin', 'synthetic/../outside.bin', '/absolute.bin', 'C:\\private\\file.xlsx', 'C:/private/file.xlsx', '\\\\server\\share\\file.xlsx', 'synthetic/file:stream', 'synthetic/CON.xlsx', 'synthetic/LPT1', 'synthetic/a./file', 'synthetic//file', 'synthetic/%2e%2e/file'];
  for (const path of paths) await t.test(path, () => {
    const f = fixture(); f.request.custody.path = path; f.request.manifest.artifacts[0].path = path; f.repinEvidence(); refuses(f);
  });
  const f = fixture(); f.request.observation.parts[0].path = 'xl/../../secret.xml'; f.repinEvidence(); f.pinInspectorAndMinimizer(); refuses(f);
});

test('rehashing fabricated observations cannot replace independently pinned parser evidence', async t => {
  for (const mutate of [
    (f: Fixture) => {
      f.request.observation.cells[0].lexeme = 'FABRICATED'; f.request.projected.cells[0].lexeme = 'FABRICATED';
      f.request.projected.cellReceipts[0].sourceCellHash = hashData(f.request.observation.cells[0]);
    },
    (f: Fixture) => { f.request.observation.sheets[0].name = 'Invented workbook sheet'; f.request.projected.sheets[0].name = 'Invented workbook sheet'; },
    (f: Fixture) => { f.request.observation.parts[0].sha256 = hashData('invented-part'); },
  ]) await t.test('forged and consistently rehashed claim', () => {
    const f = fixture(); mutate(f); f.repinEvidence(); refuses(f, 'OBSERVATION_UNVERIFIED');
  });
  const f = fixture(); f.host.inspector.inspect = () => { const forged = authoredObservation(); forged.cells[0].lexeme = 'FABRICATED'; return forged; }; refuses(f);
});

test('incomplete schema/cell coverage, hidden parts and external links refuse even pinned invalid fixtures', async t => {
  const cases: Array<[string, (f: Fixture) => void]> = [
    ['missing original blank/text cell', f => { f.request.observation.cells.splice(13, 1); }],
    ['duplicate original cell coordinate', f => { f.request.observation.cells.push(structuredClone(f.request.observation.cells[0])); }],
    ['unknown source column', f => { f.request.observation.cells[0].columnId = 'unobserved-column'; }],
    ['false schema cell-type claim', f => { f.request.observation.sheets[0].columns[1].types = ['text']; }],
    ['unlisted original data row', f => { f.request.observation.cells[0].row = 4; }],
    ['missing hidden part inspection', f => { f.request.observation.parts.pop(); }],
    ['uninspected part', f => { (f.request.observation.parts[0] as { inspected: boolean }).inspected = false; }],
    ['incomplete all-parts declaration', f => { (f.request.observation.inspection as { allPartsInspected: boolean }).allPartsInspected = false; }],
    ['encrypted content', f => { (f.request.observation.inspection as { encrypted: boolean }).encrypted = true; }],
    ['active content', f => { (f.request.observation.inspection as { activeContent: boolean }).activeContent = true; }],
    ['external link', f => { f.request.observation.inspection.externalLinks.push('https://invalid.example/never-fetched'); }],
    ['formula plus cached value', f => { f.request.observation.cells[1].type = 'formula'; f.request.observation.cells[1].formula = '1+1'; f.request.observation.cells[1].cachedLexeme = '2'; }],
    ['error cell', f => { f.request.observation.cells[1].type = 'error'; f.request.observation.cells[1].lexeme = '#VALUE!'; }],
  ];
  for (const [name, change] of cases) await t.test(name, () => { const f = fixture(); change(f); f.repinEvidence(); f.pinInspectorAndMinimizer(); refuses(f); });
});

test('projection cannot change lexemes/types, retain removed data or omit required lineage', async t => {
  const cases: Array<[string, (f: Fixture) => void]> = [
    ['normalized numeric spelling', f => { f.request.projected.cells[3].lexeme = '1.23'; }],
    ['normalized date spelling', f => { f.request.projected.cells[2].lexeme = '2010-11-15'; }],
    ['changed date type', f => { f.request.projected.cells[2].type = 'text'; }],
    ['changed displayed spelling', f => { f.request.projected.cells[2].displayLexeme = '2010-11-15'; }],
    ['changed number format', f => { f.request.projected.cells[3].numberFormat = 'General'; }],
    ['removed field leaked', f => { f.request.projected.cells.push(cell('sales', 2, 'customer', 'text', 'SYNTHETIC-CUSTOMER-1')); }],
    ['retained field dropped', f => { f.request.projected.cells.splice(0, 1); }],
    ['removed receipt dropped', f => { f.request.projected.cellReceipts.splice(4, 1); }],
    ['wrong source cell hash', f => { f.request.projected.cellReceipts[0].sourceCellHash = hashData('fabricated-cell'); }],
    ['wrong source column', f => { f.request.projected.cellReceipts[0].sourceColumnIndex = 2; }],
    ['wrong output column', f => { f.request.projected.cellReceipts[0].outputColumnIndex = 4; }],
    ['hidden cell removal unaccounted', f => { f.request.projected.cellReceipts.pop(); }],
    ['hidden sheet plan omitted', f => { f.request.projection.sheets.pop(); }],
    ['source column undisposed', f => { f.request.projection.sheets[0].removeColumns.pop(); }],
    ['source column double-disposed', f => { f.request.projection.sheets[0].removeColumns.push('invoice'); }],
    ['retained source order changed', f => { f.request.projection.sheets[0].retainColumns.reverse(); }],
    ['residual limitation suppressed', f => { f.request.projected.limitations = []; }],
  ];
  for (const [name, change] of cases) await t.test(name, () => { const f = fixture(); change(f); f.repinEvidence(); f.pinInspectorAndMinimizer(); refuses(f); });
});

test('parser/minimizer identity and fixed structural limits cannot be supplied or enlarged by a request', async t => {
  for (const change of [
    (f: Fixture) => { f.request.parser.version = 'new-version'; },
    (f: Fixture) => { f.request.parser.buildHash = hashData('new-build'); },
    (f: Fixture) => { f.request.parser.profileHash = hashData('different-containment'); },
    (f: Fixture) => { f.request.projection.minimizer.version = 'new-minimizer'; },
    (f: Fixture) => { (f.request as unknown as { limits: unknown }).limits = { originalBytes: Number.MAX_SAFE_INTEGER }; },
    (f: Fixture) => { f.request.observation.parts[0].byteLength = 33 * 1024 * 1024; },
  ]) await t.test('unqualified identity or budget drift', () => { const f = fixture(); change(f); f.repinEvidence(); refuses(f); });
});

test('data-only envelopes reject executable properties without evaluating them', () => {
  const f = fixture(); let executions = 0;
  Object.defineProperty(f.request, 'observation', { enumerable: true, get() { executions++; throw new Error('Executable observation getter'); } });
  refuses(f, 'NON_DATA_CONTRACT'); assert.equal(executions, 0);
});

test('reuse rejects changed evidence dependencies, reviews, origin, parser and original custody', async t => {
  const cases: Array<[string, (f: Fixture) => void]> = [
    ['manifest terms', f => { f.request.manifest.rights.evidence = 'Withdrawn or superseded review'; }],
    ['custody bytes', f => { f.host.readOriginal = () => new Uint8Array([1, 2, 3]); }],
    ['storage version', f => { f.request.custody.storageVersion = 'v2'; }],
    ['capture identity', f => { f.request.custody.captureId = 'different-capture'; }],
    ['parser version', f => { f.request.parser.version = 'v2'; }],
    ['observation', f => { f.request.observation.cells[0].lexeme = 'changed'; }],
    ['projection', f => { f.request.projection.version = 'v2'; }],
    ['rights review', f => { f.request.rightsReview.id = 'new-review'; }],
    ['privacy review', f => { f.request.privacyReview.id = 'new-review'; }],
    ['source identity', f => { f.request.sourceIdentity.sourceId = 'renamed-origin'; }],
    ['family identity', f => { f.request.sourceIdentity.families.business = 'invented-business-family'; }],
    ['request attempt', f => { f.request.attemptId = 'different-attempt'; }],
    ['revoked evidence', f => { f.host.verifyEvidence = () => null; }],
    ['missing retained audit', f => { f.audit.clear(); }],
    ['wrong retained audit', f => { f.audit.set(f.request.attemptId, hashData('different-receipt')); }],
  ];
  for (const [name, change] of cases) await t.test(name, () => { const { f, value } = prepared(); change(f); refusesReuse(value, f); });
});

test('forged or rehashed preparation receipts cannot supply their own audit anchor or authority', async t => {
  for (const change of [
    (value: PreparedLocalArtifact) => { value.receipt.id = '0'.repeat(64); },
    (value: PreparedLocalArtifact) => { value.projected.cells[0].lexeme = 'FORGED'; },
    (value: PreparedLocalArtifact) => { (value.receipt as { qualification: string }).qualification = 'QUALIFIED'; },
    (value: PreparedLocalArtifact) => { (value.receipt as { publicationAuthority: boolean }).publicationAuthority = true; },
    (value: PreparedLocalArtifact) => {
      value.receipt.dependencies.privacyReviewHash = hashData('replacement-review');
      const { id: _, ...payload } = value.receipt; value.receipt.id = hashData(payload);
    },
  ]) await t.test('receipt forgery', () => { const { f, value } = prepared(); const forged = structuredClone(value); change(forged); refusesReuse(forged, f); });
});

test('future or expired requests, custody/reviews and final decision times refuse', async t => {
  const cases: Array<[string, (f: Fixture) => void]> = [
    ['expired request', f => { f.host.now = () => expiresAt; }],
    ['future request', f => { f.request.at = '2026-10-03T13:00:00.000Z'; }],
    ['future custody', f => { f.request.custody.capturedAt = '2026-10-03T13:00:00.000Z'; }],
    ['future rights review', f => { f.request.rightsReview.at = '2026-10-03T13:00:00.000Z'; }],
    ['future privacy review', f => { f.request.privacyReview.at = '2026-10-03T13:00:00.000Z'; }],
    ['zero validity interval', f => { f.request.expiresAt = at; }],
    ['expires during inspection', f => { let reads = 0; f.host.now = () => ++reads === 1 ? at : expiresAt; }],
  ];
  for (const [name, change] of cases) await t.test(name, () => { const f = fixture(); change(f); f.repinEvidence(); refuses(f); });
  const { f, value } = prepared(); f.host.now = () => expiresAt; refusesReuse(value, f);
});

test('review withdrawal during inspection refuses the final audited result', () => {
  const f = fixture(); const inspect = f.host.inspector.inspect;
  f.host.inspector.inspect = (bytes, limits) => { const result = inspect(bytes, limits); f.host.verifyEvidence = () => null; return result; };
  refuses(f);
});

test('trusted callbacks receive exact isolated bytes and cannot mutate the final request snapshot', () => {
  const f = fixture(), bindingBefore = preparationEvidenceBinding(f.request);
  const inspect = f.host.inspector.inspect, project = f.host.minimizer.project;
  f.host.inspector.inspect = (bytes, limits) => {
    assert.deepEqual(bytes, original); assert.ok(Object.isFrozen(limits));
    // A caller can mutate their own request concurrently; it cannot change this processing attempt.
    f.request.attemptId = 'changed-by-caller'; f.request.manifest.title = 'changed-by-caller';
    return inspect(bytes, limits);
  };
  f.host.minimizer.project = (observed, plan, limits) => {
    assert.deepEqual(observed, authoredObservation()); assert.deepEqual(plan, authoredProjection());
    assert.ok(Object.isFrozen(observed.cells) && Object.isFrozen(plan.sheets));
    return project(observed, plan, limits);
  };
  const value = prepareLocalArtifact(f.request, f.host);
  assert.equal(value.receipt.attemptId, bindingBefore.attemptId);
  assert.deepEqual(value.receipt.dependencies, bindingBefore.dependencies);
  assert.equal(f.audit.get(bindingBefore.attemptId), value.receipt.id);
  assert.equal(f.audit.get('changed-by-caller'), undefined);
});

test('reuse returns a frozen validated snapshot when callbacks mutate the supplied receipt', () => {
  const { f, value } = prepared(), supplied = structuredClone(value);
  const inspect = f.host.inspector.inspect;
  f.host.inspector.inspect = (bytes, limits) => { supplied.projected.cells[0].lexeme = 'changed-during-callback'; return inspect(bytes, limits); };
  const validated = revalidateLocalArtifactPreparation(supplied, f.request, f.host);
  assert.deepEqual(validated, value, 'Consumers receive the original validated snapshot, independent of the mutated input.');
  assert.ok(Object.isFrozen(validated) && Object.isFrozen(validated.projected.cells));
  assert.equal(supplied.projected.cells[0].lexeme, 'changed-during-callback', 'The caller-held input remains visibly uncertified.');
  assert.equal(validated.projected.cells[0].lexeme, 'C-0001');
  refusesReuse(supplied, f);
});

test('parser mutation of original bytes and implementation identity drift during checks refuse', async t => {
  await t.test('parser mutated verified byte sequence', () => {
    const f = fixture(), inspect = f.host.inspector.inspect;
    f.host.inspector.inspect = (bytes, limits) => { const observed = inspect(bytes, limits); bytes[0] ^= 1; return observed; };
    refuses(f, 'CUSTODY_MISMATCH');
  });
  for (const implementation of ['inspector', 'minimizer'] as const) await t.test(`${implementation} identity swap`, () => {
    const f = fixture(), inspect = f.host.inspector.inspect;
    f.host.inspector.inspect = (bytes, limits) => { const observed = inspect(bytes, limits); f.host[implementation].identity.version = 'swapped-during-inspection'; return observed; };
    refuses(f, 'IMPLEMENTATION_UNVERIFIED');
  });
});

test('an existing audited attempt cannot be silently overwritten with new preparation evidence', () => {
  const { f, value } = prepared();
  f.request.rightsReview.id = 'replacement-review'; f.repinEvidence();
  assert.throws(() => prepareLocalArtifact(f.request, f.host), (error: unknown) => error instanceof SemanticError && error.code === 'PREPARATION_ATTEMPT_REUSED');
  assert.equal(f.audit.get(f.request.attemptId), value.receipt.id); assert.equal(f.counts.auditWrites, 1);
});

test('atomic audit retention rejects a competing attempt arriving after the prior lookup', () => {
  const f = fixture(), competingAnchor = hashData('independent concurrent attempt receipt');
  const atomicRetain = f.host.retainAudit;
  f.host.retainAudit = receipt => {
    // The prior retainedReceiptHash lookup found no entry; another owner wins before insertion.
    assert.equal(f.audit.has(receipt.attemptId), false);
    f.audit.set(receipt.attemptId, competingAnchor);
    return atomicRetain(receipt);
  };
  assert.throws(() => prepareLocalArtifact(f.request, f.host), (error: unknown) => error instanceof SemanticError && error.code === 'AUDIT_UNRETAINED');
  assert.equal(f.audit.get(f.request.attemptId), competingAnchor, 'A rejected candidate cannot overwrite the independently retained winner.');
  assert.equal(f.counts.auditWrites, 0);
});

test('captured mutable inspector/minimizer DTOs cannot change validated snapshots in later callbacks', async t => {
  await t.test('inspector result changed by minimizer callback', () => {
    const f = fixture(), inspected = authoredObservation(), expected = structuredClone(f.request.projected);
    f.host.inspector.inspect = () => inspected;
    const project = f.host.minimizer.project;
    f.host.minimizer.project = (observed, plan, limits) => {
      const result = project(observed, plan, limits);
      inspected.cells[0].lexeme = 'changed-inspector-dto'; inspected.sheets[0].name = 'changed-inspector-sheet';
      return result;
    };
    const value = prepareLocalArtifact(f.request, f.host);
    assert.deepEqual(value.projected, expected);
    assert.equal(value.receipt.dependencies.observationHash, hashData(authoredObservation()));
  });
  await t.test('minimizer numeric lexeme changed during final evidence verification', () => {
    const f = fixture(), minimized = authoredProjected(authoredObservation(), authoredProjection()), expected = structuredClone(minimized);
    f.host.minimizer.project = () => minimized;
    const verify = f.host.verifyEvidence;
    f.host.verifyEvidence = (binding, now) => {
      const result = verify(binding, now);
      if (f.counts.verifications === 2) minimized.cells[3].lexeme = '999999';
      return result;
    };
    const value = prepareLocalArtifact(f.request, f.host);
    assert.equal(minimized.cells[3].lexeme, '999999', 'The fixture exercised actual alias mutation.');
    assert.deepEqual(value.projected, expected);
    assert.equal(value.receipt.dependencies.projectedHash, hashData(expected));
  });
});

test('a backwards clock after audit write or current anchor lookup cannot establish current evidence', async t => {
  const clock = () => {
    const times = [at, '2026-10-03T12:00:02.000Z', '2026-10-03T12:00:01.000Z'];
    let index = 0; return () => times[Math.min(index++, times.length - 1)];
  };
  await t.test('after audit retention', () => {
    const f = fixture(); f.host.now = clock();
    assert.throws(() => prepareLocalArtifact(f.request, f.host), (error: unknown) => error instanceof SemanticError && error.code === 'INVALID_TIME');
    assert.equal(f.audit.size, 1, 'The audit remains retained while no candidate is returned after the failed current-time check.');
  });
  await t.test('after current receipt lookup', () => {
    const { f, value } = prepared(); f.host.now = clock();
    assert.throws(() => revalidateLocalArtifactPreparation(value, f.request, f.host), (error: unknown) => error instanceof SemanticError && error.code === 'INVALID_TIME');
    assert.equal(f.counts.auditWrites, 1);
  });
});

test('missing trusted host methods and failed audit retention cannot default to permission', async t => {
  for (const method of ['now', 'readOriginal', 'verifyEvidence', 'retainAudit', 'retainedReceiptHash'] as const) await t.test(method, () => {
    const f = fixture(); delete (f.host as Partial<LocalArtifactPreparationHost>)[method]; refuses(f);
  });
  const f = fixture(); f.host.retainAudit = () => null; refuses(f);
});

function semanticFixture(): QualificationInput {
  const value = prepareSyntheticSuite().find(input => input.goldenCase.id === 'tuning-retail-separated-events');
  assert.ok(value); return structuredClone(value);
}

test('local preparation leaves external-origin and named-vendor qualification fences unchanged', async t => {
  for (const origin of ['authorized-upload', 'official-public'] as const) await t.test(origin, () => {
    const input = semanticFixture(); input.manifest.origin = origin;
    const ledger: Parameters<typeof qualifyCase>[1] = [];
    assert.throws(() => qualifyCase(input, ledger), (error: unknown) => error instanceof SemanticError && error.code === 'SYSTEM_PROFILE_UNQUALIFIED');
    assert.deepEqual(ledger, []);
  });
  await t.test('named vendor', () => {
    const input = semanticFixture(), pack = structuredClone(input.compiled.pack), rules = structuredClone(input.compiled.rules);
    pack.system = 'tally'; pack.product.name = 'TallyPrime'; rules.packHash = hashData(pack);
    input.compiled = compileMapping(pack, rules, input.compiled.ontology); input.batch.system = pack.system; input.batch.product = pack.product; input.report.system = pack.system;
    const ledger: Parameters<typeof qualifyCase>[1] = [];
    assert.throws(() => qualifyCase(input, ledger), (error: unknown) => error instanceof SemanticError && error.code === 'SYSTEM_PROFILE_UNQUALIFIED');
    assert.deepEqual(ledger, []);
  });
});
