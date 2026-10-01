import { readFileSync } from 'node:fs';
import { digest } from '../../runtime/actions.ts';
import type { MappingRecipe } from '../../runtime/ingest.ts';
import { starterPacks, type DictionaryDraft } from '../../runtime/ontology.ts';
import {
  canonicalJson, compileMapping, hashData, reportPayload, sha256Bytes,
  type CompanyRules, type DatasetManifest, type GoldenCase, type MappingPack,
  type OntologyContract, type QualificationInput, type SourceBatch,
  type SourceReport, type SourceRow, type SourceSchema, type SplitPlan,
} from '../../semantic-qualification/src/index.ts';

/** Structural match for the Engine adapter; this fixture never supplies a gate callback. */
export type EngineSemanticDossier = {
  profileId: string; sourceId: string; recipeHash: string;
  runtimeOntologyHash: string; decoderDefinitionHash: string;
  current: QualificationInput; goldenCases: QualificationInput[]; holdoutCases: QualificationInput[];
};

export const fixtureDictionaryDraft: DictionaryDraft = structuredClone(starterPacks.find(pack => pack.pack === 'ecommerce')!);
fixtureDictionaryDraft.fields.taxRegistration = 'string';

const period = { from: '2026-09-01', to: '2026-09-30' };
const sourceSchema: SourceSchema = { fields: {
  id: 'text', revision: 'text', kind: 'text', date: 'text', amount: 'text', tax: 'text',
  currency: 'text', status: 'text', company: 'text', branch: 'text',
  taxRegistration: 'text', quantity: 'text', unit: 'text', related: 'text',
} };
const product: MappingPack['product'] = {
  name: 'synthetic-register', version: '1', edition: 'fixture', configuration: 'exact-minor-fixture',
};

/** Source records and expectations are authored separately, never computed from one another. */
const rows: SourceRow[] = [
  { id: 'sale-1', revision: '1', kind: 'sale', date: '2026-09-15', amount: '900719925474099325', tax: '0', currency: 'INR', status: 'posted', company: 'Synthetic Fixture', branch: 'main', taxRegistration: 'synthetic-tax', quantity: '1', unit: 'pcs', related: '' },
  { id: 'sale-2', revision: '1', kind: 'sale', date: '2026-09-16', amount: '75', tax: '0', currency: 'INR', status: 'posted', company: 'Synthetic Fixture', branch: 'main', taxRegistration: 'synthetic-tax', quantity: '1', unit: 'pcs', related: '' },
];
const sourceControls: SourceReport['totals'] = [
  { kind: 'sale', currency: 'INR', netMinor: '900719925474099400', taxMinor: '0', grossMinor: '900719925474099400' },
];
const sourceImportTotals = { rowCount: 2, amountMinor: '900719925474099400' };

const recipe: MappingRecipe = {
  version: 1, id: 'synthetic-sales', system: 'synthetic-register', edition: 'fixture',
  scope: { company: 'Synthetic Fixture', branches: ['main'] },
  bindings: [
    { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
    { target: 'kind', source: 'kind', type: 'string', nulls: 'reject', values: { sale: 'sale' } },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
    { target: 'taxMinor', source: 'tax', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
    { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' },
    { target: 'status', source: 'status', type: 'string', nulls: 'reject' },
    { target: 'company', source: 'company', type: 'string', nulls: 'reject' },
    { target: 'branch', source: 'branch', type: 'string', nulls: 'reject' },
    { target: 'taxRegistration', source: 'taxRegistration', type: 'string', nulls: 'reject' },
    { target: 'quantity', source: 'quantity', type: 'integer', nulls: 'reject' },
    { target: 'unit', source: 'unit', type: 'string', nulls: 'reject' },
  ],
  allowedKinds: ['sale'], allowedStatuses: ['posted'], onUnmapped: 'reject', ignoredFields: ['revision', 'related'],
};

const ontology: OntologyContract = {
  version: 'engine-synthetic-register-v1',
  definitions: {
    invoice: { amount: 'net-excluding-tax', dateBasis: 'event-date' },
    sale: { amount: 'net-excluding-tax', dateBasis: 'event-date' },
    refund: { amount: 'net-excluding-tax', dateBasis: 'event-date' },
    payment: { amount: 'net-excluding-tax', dateBasis: 'event-date' },
    purchase: { amount: 'net-excluding-tax', dateBasis: 'event-date' },
    cost: { amount: 'net-excluding-tax', dateBasis: 'event-date' },
  },
  operations: ['billed', 'earned', 'refunds', 'received', 'purchases', 'costs', 'net_sales'],
};
const semantics: MappingPack['semantics'] = {
  taxInclusion: 'exclusive', amountUnit: 'minor', dateFormat: 'ISO', dateBasis: 'event-date',
  calendar: 'gregorian-date', kindValues: { sale: 'sale' }, statusValues: { posted: 'include' },
  refundSign: 'positive', refundsRequireLink: true,
  missing: 'abstain', unknownState: 'abstain', onSchemaDrift: 'invalidate', quantityScale: 0,
};
const pack: MappingPack = {
  contractVersion: 1, id: 'engine-synthetic-sales-pack', version: '1', system: 'synthetic-register',
  product, ontologyHash: hashData(ontology), sourceSchema,
  bindings: {
    identity: 'id', kind: 'kind', date: 'date', amount: 'amount', tax: 'tax', currency: 'currency',
    status: 'status', company: 'company', branch: 'branch', taxRegistration: 'taxRegistration',
    quantity: 'quantity', unit: 'unit', relatedIdentity: 'related',
  },
  semantics, provenanceIds: ['engine-synthetic-sales-authored-evidence'],
};
const tuningGolden: GoldenCase = {
  id: 'engine-synthetic-sales-tuning', businessId: 'Synthetic Fixture', datasetId: 'sales',
  rationale: 'Two independently authored sale events verify exact minor units beyond the JavaScript safe-integer range; all scope, tax, quantities and units are explicit.',
  split: 'tuning', expectedDecision: 'qualified', expectedIssueCodes: [],
  expectations: [
    { operation: 'billed', values: [{ currency: 'INR', minor: '0' }] },
    { operation: 'earned', values: [{ currency: 'INR', minor: '900719925474099400' }] },
    { operation: 'refunds', values: [{ currency: 'INR', minor: '0' }] },
    { operation: 'received', values: [{ currency: 'INR', minor: '0' }] },
    { operation: 'purchases', values: [{ currency: 'INR', minor: '0' }] },
    { operation: 'costs', values: [{ currency: 'INR', minor: '0' }] },
    { operation: 'net_sales', values: [{ currency: 'INR', minor: '900719925474099400' }] },
  ],
  semanticAssertions: [
    { entityId: 'sale-1', kind: 'sale', date: '2026-09-15', company: 'Synthetic Fixture', branch: 'main', taxRegistration: 'synthetic-tax', currency: 'INR', currencyScale: 2, netMinor: '900719925474099325', taxMinor: '0', grossMinor: '900719925474099325', quantity: '1', unit: 'pcs', relatedIdentity: null, sourceRow: 1 },
    { entityId: 'sale-2', kind: 'sale', date: '2026-09-16', company: 'Synthetic Fixture', branch: 'main', taxRegistration: 'synthetic-tax', currency: 'INR', currencyScale: 2, netMinor: '75', taxMinor: '0', grossMinor: '75', quantity: '1', unit: 'pcs', relatedIdentity: null, sourceRow: 2 },
  ],
  exclusionAssertions: [],
};

/** A separate authored template, business and configuration: disclosed public synthetic holdout. */
const holdoutPack: MappingPack = {
  contractVersion: 1, id: 'engine-synthetic-holdout-pack', version: '1', system: 'synthetic-register',
  product: { name: 'synthetic-register', version: '1', edition: 'fixture', configuration: 'holdout-renamed-minor-fixture' },
  ontologyHash: hashData(ontology),
  sourceSchema: { fields: {
    documentId: 'text', revision: 'text', eventKind: 'text', eventDate: 'text', netValue: 'text', taxValue: 'text',
    currencyCode: 'text', state: 'text', business: 'text', site: 'text', registration: 'text',
    units: 'text', unitCode: 'text', originalDocument: 'text',
  } },
  bindings: {
    identity: 'documentId', kind: 'eventKind', date: 'eventDate', amount: 'netValue', tax: 'taxValue',
    currency: 'currencyCode', status: 'state', company: 'business', branch: 'site', taxRegistration: 'registration',
    quantity: 'units', unit: 'unitCode', relatedIdentity: 'originalDocument',
  },
  semantics: { ...structuredClone(semantics), kindValues: { delivered: 'sale' }, statusValues: { final: 'include' } },
  provenanceIds: ['engine-synthetic-holdout-authored-evidence'],
};
const holdoutRows: SourceRow[] = [
  { documentId: 'holdout-sale-A', revision: '1', eventKind: 'delivered', eventDate: '2026-09-22', netValue: '1200', taxValue: '0', currencyCode: 'INR', state: 'final', business: 'Synthetic Holdout Company', site: 'main', registration: 'holdout-synthetic-tax', units: '1', unitCode: 'pcs', originalDocument: '' },
];
const holdoutControls: SourceReport['totals'] = [
  { kind: 'sale', currency: 'INR', netMinor: '1200', taxMinor: '0', grossMinor: '1200' },
];
const holdoutGolden: GoldenCase = {
  id: 'engine-synthetic-sales-holdout', businessId: 'Synthetic Holdout Company', datasetId: 'holdout-sales',
  rationale: 'A separately authored company with a renamed-field template and distinct configuration has one delivered event with independently specified net, tax, gross and operation expectations. This public case is not sealed or a vendor certification.',
  split: 'holdout', expectedDecision: 'qualified', expectedIssueCodes: [],
  expectations: [
    { operation: 'billed', values: [{ currency: 'INR', minor: '0' }] },
    { operation: 'earned', values: [{ currency: 'INR', minor: '1200' }] },
    { operation: 'refunds', values: [{ currency: 'INR', minor: '0' }] },
    { operation: 'received', values: [{ currency: 'INR', minor: '0' }] },
    { operation: 'purchases', values: [{ currency: 'INR', minor: '0' }] },
    { operation: 'costs', values: [{ currency: 'INR', minor: '0' }] },
    { operation: 'net_sales', values: [{ currency: 'INR', minor: '1200' }] },
  ],
  semanticAssertions: [
    { entityId: 'holdout-sale-A', kind: 'sale', date: '2026-09-22', company: 'Synthetic Holdout Company', branch: 'main', taxRegistration: 'holdout-synthetic-tax', currency: 'INR', currencyScale: 2, netMinor: '1200', taxMinor: '0', grossMinor: '1200', quantity: '1', unit: 'pcs', relatedIdentity: null, sourceRow: 1 },
  ],
  exclusionAssertions: [],
};

function preparedCase(input: {
  pack: MappingPack; rows: SourceRow[]; goldenCase: GoldenCase; controls: SourceReport['totals'];
  rowCount: number; taxRegistration: string; template: string; receiptId: string; snapshotId: string;
}) {
  const { goldenCase } = input;
  const rules: CompanyRules = {
    contractVersion: 1, id: `${goldenCase.datasetId}-rules`, version: '1', packHash: hashData(input.pack),
    company: goldenCase.businessId, branches: ['main'], taxRegistrations: [input.taxRegistration],
    timezone: 'Asia/Kolkata', currencies: { INR: { scale: 2 } },
    units: { pcs: { canonical: 'pcs', numerator: '1', denominator: '1' } },
    period: structuredClone(period), provenanceIds: [...input.pack.provenanceIds],
  };
  const compiled = compileMapping(input.pack, rules, ontology);
  const batch: SourceBatch = {
    receiptId: input.receiptId, datasetId: goldenCase.datasetId, system: 'synthetic-register',
    product: structuredClone(input.pack.product), company: goldenCase.businessId,
    schema: structuredClone(input.pack.sourceSchema), rows: structuredClone(input.rows), rowsHash: hashData(input.rows),
    complete: true, snapshotId: input.snapshotId,
    origins: { business: goldenCase.businessId, template: input.template, configuration: input.pack.product.configuration },
  };
  const report: SourceReport = {
    reportId: `${goldenCase.datasetId}-independent-report`, datasetId: goldenCase.datasetId,
    origin: 'independent-source-report', captureMethod: 'hand-worked-synthetic', evidenceHash: '',
    company: goldenCase.businessId, system: 'synthetic-register', snapshotId: input.snapshotId,
    dateBasis: 'event-date', period: structuredClone(period), branches: ['main'], taxRegistrations: [input.taxRegistration],
    sourceRowCount: input.rowCount, includedRowCount: input.rowCount, excludedRowCount: 0,
    totals: structuredClone(input.controls),
  };
  report.evidenceHash = hashData(reportPayload(report));
  return { compiled, batch, report, goldenCase: structuredClone(goldenCase) };
}

/** Hashes are derived from exact artifact bytes; expected amounts and semantic assertions above are literals. */
export function createSyntheticSemanticFixture(at: string) {
  const tuning = preparedCase({
    pack, rows, goldenCase: tuningGolden, controls: sourceControls, rowCount: 2,
    taxRegistration: 'synthetic-tax', template: 'engine-tuning-authored-template-v1',
    receiptId: 'fixture-sales-source-receipt', snapshotId: 'fixture-sales-snapshot-v1',
  });
  const holdout = preparedCase({
    pack: holdoutPack, rows: holdoutRows, goldenCase: holdoutGolden, controls: holdoutControls, rowCount: 1,
    taxRegistration: 'holdout-synthetic-tax', template: 'engine-holdout-renamed-template-v1',
    receiptId: 'holdout-sales-source-receipt', snapshotId: 'holdout-sales-snapshot-v1',
  });
  const fixtureBytes = readFileSync(new URL('./engine-semantic-fixture.ts', import.meta.url));
  const splitEntry = (item: typeof tuning) => ({ businessId: item.goldenCase.businessId, datasetId: item.batch.datasetId, rowsHash: item.batch.rowsHash, origins: structuredClone(item.batch.origins) });
  const qualifyInput = (item: typeof tuning): QualificationInput => {
    const artifactBytes: QualificationInput['artifactBytes'] = {};
    const artifact = (path: string, role: DatasetManifest['artifacts'][number]['role'], bytes: string | Uint8Array) => {
      artifactBytes[path] = bytes; return { path, role, sha256: sha256Bytes(bytes) };
    };
    const metadata = (id: string, category: DatasetManifest['category'], artifacts: DatasetManifest['artifacts']): DatasetManifest => ({
      contractVersion: 1, id, title: id, origin: 'synthetic', category,
      source: { publisher: 'Independent authored Engine fixture lane', url: null, retrievedAt: at, productVersion: '1' },
      rights: {
        status: 'allowed', license: 'Task-authorized authored synthetic qualification fixture',
        evidence: 'User authorized synthetic businesses first. These newly authored records and independent literal controls contain no real vendor or personal data.',
        permittedUses: ['qualification'], personalData: 'none',
        permissions: { acquisition: 'allowed', reuse: 'allowed', redistribution: 'unknown', training: 'unknown' },
      },
      artifacts,
      limitations: ['Public synthetic fixture only; no named vendor, real company, sealed holdout, live access or write-back qualification.'],
    });
    const prefix = `engine-synthetic/${item.batch.datasetId}`;
    const manifest = metadata(item.batch.datasetId, 'synthetic-cases', [
      artifact(`${prefix}/rows.json`, 'source-rows', canonicalJson(item.batch.rows)),
      artifact(`${prefix}/source-report.json`, 'source-report', canonicalJson(reportPayload(item.report))),
      artifact(`${prefix}/golden.json`, 'golden-cases', canonicalJson(item.goldenCase)),
    ]);
    const provenance = [metadata(item.compiled.pack.provenanceIds[0], 'reference-schema', [
      artifact(`${prefix}/authored-fixture.ts`, 'schema-reference', fixtureBytes),
      artifact(`${prefix}/mapping-pack.json`, 'schema-reference', canonicalJson(item.compiled.pack)),
      artifact(`${prefix}/company-rules.json`, 'authorization', canonicalJson(item.compiled.rules)),
    ])];
    const splitPlan: SplitPlan = {
      contractVersion: 1, id: 'engine-whole-company-template-split-v1', mappingFingerprint: item.compiled.productFingerprint,
      reviewer: 'Authored fixture lane; literal source controls and per-row assertions are independent of mapper outputs',
      tuning: [splitEntry(tuning)], holdout: [splitEntry(holdout)], disclosure: 'public-synthetic',
      evidence: 'Whole businesses, datasets, row bytes, renamed-field templates and source configurations are disjoint. Each case is compiled for its own explicit product pack. This public split does not claim learned-mapper generalization or a sealed vendor holdout.',
    };
    return { ...item, manifest, provenance, artifactBytes, splitPlan, at };
  };
  const current = qualifyInput(tuning);
  const holdoutInput = qualifyInput(holdout);
  return {
    rows: structuredClone(rows), recipe: structuredClone(recipe), sourceSchema: structuredClone(sourceSchema),
    product: structuredClone(product), totals: structuredClone(sourceImportTotals),
    sourceReport: structuredClone(current.report), fixtureDictionaryDraft: structuredClone(fixtureDictionaryDraft),
    dossier(runtimeOntologyHash: string, decoderDefinitionHash: string): EngineSemanticDossier {
      return structuredClone({
        profileId: 'synthetic-sales', sourceId: 'fixture-source', recipeHash: digest(recipe),
        runtimeOntologyHash, decoderDefinitionHash, current, goldenCases: [current], holdoutCases: [holdoutInput],
      });
    },
  };
}
