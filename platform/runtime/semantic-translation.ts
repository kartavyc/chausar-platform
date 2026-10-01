import { check } from './contracts.ts';
import type { ConnectorCapture } from './connector-framework/index.ts';
import { hashData, sha256Bytes, type SourceRow, type SourceSchema } from '../semantic-qualification/src/index.ts';

/** Trusted host code only. RPC data cannot install or select a translator. */
export type SemanticTranslationProfile = {
  id: string; version: string; implementationDigest: string;
  configuration: Record<string, string>;
  nativeWireSchemaSha256: string; decodedSourceSchema: SourceSchema; compilerSourceSchema: SourceSchema;
  translate(rows: readonly Readonly<SourceRow>[]): SemanticTranslationOutput;
};
/** Global one-based data row indices, independent of page boundaries or CSV headers. */
export type SemanticRowLineage = { compilerRow: number; decodedRow: number };
export type SemanticTranslationOutput = { rows: SourceRow[]; rowLineage: SemanticRowLineage[] };
/** Independently authored dossier pins, never derived from a translation run being admitted. */
export type SemanticTranslationReference = {
  profileId: string; version: string; implementationDigest: string; profileDefinitionHash: string;
  nativeWireSchemaSha256: string; decodedSourceSchemaHash: string; decodedSourceRowsHash: string;
  compilerSourceSchemaHash: string; compilerSourceRowsHash: string; rowLineageHash: string;
};
export type SemanticTranslationBinding = SemanticTranslationReference & {
  contractVersion: 1; captureId: string; generation: number; reviewId: string; recipeHash: string;
  decoderDefinitionHash: string; semanticMappingFingerprint: string;
  sourcePages: { deliveryId: string; sha256: string; decodedRowsHash: string }[];
  rowLineage: (SemanticRowLineage & { deliveryId: string; pageRow: number; pageSha256: string; decodedRowHash: string; compilerRowHash: string })[];
};
export type SemanticTranslationResult = SemanticTranslationOutput & { binding: SemanticTranslationBinding; digest: string };
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function assertSchema(schema: SourceSchema) {
  check(plain(schema) && exactKeys(schema, ['fields']) && plain(schema.fields) && Object.keys(schema.fields).length > 0
    && Object.values(schema.fields).every(kind => kind === 'text' || kind === 'boolean'),
  'SEMANTIC_TRANSLATION_SCHEMA_CHANGED', 'Install an explicit primitive decoded and compiler schema.');
}
function assertRows(rows: unknown, schema: SourceSchema): asserts rows is SourceRow[] {
  const fields = Object.keys(schema.fields);
  check(Array.isArray(rows) && rows.every(row => plain(row) && exactKeys(row, fields)
    && fields.every(field => row[field] === null || typeof row[field] === (schema.fields[field] === 'text' ? 'string' : 'boolean'))),
  'SEMANTIC_TRANSLATION_SCHEMA_CHANGED', 'Every declared source field must be present with its exact primitive type; guessed or omitted fields are refused.');
}
export function semanticTranslationDefinitionHash(profile: SemanticTranslationProfile): string {
  check(plain(profile) && exactKeys(profile, ['id', 'version', 'implementationDigest', 'configuration', 'nativeWireSchemaSha256',
    'decodedSourceSchema', 'compilerSourceSchema', 'translate'])
    && typeof profile.id === 'string' && profile.id.length > 0 && typeof profile.version === 'string' && profile.version.length > 0
    && sha(profile.implementationDigest) && sha(profile.nativeWireSchemaSha256) && typeof profile.translate === 'function'
    && plain(profile.configuration) && Object.values(profile.configuration).every(value => typeof value === 'string'),
  'SEMANTIC_TRANSLATION_PROFILE_INVALID', 'A trusted translation profile needs explicit version, reviewed implementation, wire schema and configuration.');
  assertSchema(profile.decodedSourceSchema); assertSchema(profile.compilerSourceSchema);
  return hashData({ contractVersion: 1, id: profile.id, version: profile.version, implementationDigest: profile.implementationDigest,
    configuration: profile.configuration, nativeWireSchemaSha256: profile.nativeWireSchemaSha256,
    decodedSourceSchema: profile.decodedSourceSchema, compilerSourceSchema: profile.compilerSourceSchema,
    translatorCodeHash: sha256Bytes(Function.prototype.toString.call(profile.translate)) });
}
/** Execute the actual reviewed translator on retained raw-backed decoded rows, at both publication and readiness. */
export function executeSemanticTranslation(input: {
  profiles: readonly SemanticTranslationProfile[]; reference: SemanticTranslationReference;
  capture: ConnectorCapture; decoderDefinitionHash: string; compilerSchema: SourceSchema;
  compilerRows: SourceRow[]; compilerRowsHash: string; semanticMappingFingerprint: string;
}): SemanticTranslationResult {
  const { reference, capture } = input;
  check(plain(reference) && exactKeys(reference, ['profileId', 'version', 'implementationDigest', 'profileDefinitionHash',
    'nativeWireSchemaSha256', 'decodedSourceSchemaHash', 'decodedSourceRowsHash', 'compilerSourceSchemaHash', 'compilerSourceRowsHash', 'rowLineageHash'])
    && typeof reference.profileId === 'string' && typeof reference.version === 'string'
    && Object.entries(reference).filter(([key]) => !['profileId', 'version'].includes(key)).every(([, value]) => sha(value)),
  'SEMANTIC_TRANSLATION_REFERENCE_INVALID', 'Use a complete data-only independently authored translation reference.');
  const matches = input.profiles.filter(profile => profile.id === reference.profileId);
  check(matches.length === 1, 'SEMANTIC_TRANSLATION_PROFILE_REQUIRED', 'Install exactly one trusted profile for the opted-in translation; no direct-schema fallback is permitted.');
  const profile = matches[0], definitionHash = semanticTranslationDefinitionHash(profile);
  check(profile.version === reference.version && profile.implementationDigest === reference.implementationDigest
    && definitionHash === reference.profileDefinitionHash && sha(reference.profileDefinitionHash),
  'SEMANTIC_TRANSLATION_PROFILE_CHANGED', 'The reviewed translator implementation, version and configuration must match the authored dossier.');
  check(profile.nativeWireSchemaSha256 === reference.nativeWireSchemaSha256 && reference.nativeWireSchemaSha256 === capture.schemaSha256
    && hashData(profile.decodedSourceSchema) === reference.decodedSourceSchemaHash
    && hashData(profile.compilerSourceSchema) === reference.compilerSourceSchemaHash
    && hashData(input.compilerSchema) === reference.compilerSourceSchemaHash,
  'SEMANTIC_TRANSLATION_SCHEMA_CHANGED', 'Native wire, decoded source and compiler schemas must retain their separate exact fingerprints.');
  const nativeRows = capture.pages.flatMap(page => page.rows);
  assertRows(nativeRows, profile.decodedSourceSchema);
  check(hashData(nativeRows) === reference.decodedSourceRowsHash,
    'SEMANTIC_TRANSLATION_SOURCE_CHANGED', 'The complete native decoded rows must equal the independently authored dossier source.');
  const argument = structuredClone(nativeRows); argument.forEach(Object.freeze); Object.freeze(argument);
  const output: unknown = profile.translate(argument);
  check(plain(output) && exactKeys(output, ['rows', 'rowLineage']) && Array.isArray(output.rowLineage),
    'SEMANTIC_TRANSLATION_RESULT_INVALID', 'Translation must return a synchronous data-only rows and explicit row-lineage result.');
  assertRows(output.rows, profile.compilerSourceSchema);
  check(output.rows.length === nativeRows.length && output.rowLineage.length === nativeRows.length,
    'SEMANTIC_TRANSLATION_LINEAGE_CHANGED', 'Translation must conserve every source row; expansion, dropping and exclusions need a separately supported contract.');
  const lineage: SemanticRowLineage[] = [];
  for (const item of output.rowLineage) {
    check(plain(item) && exactKeys(item, ['compilerRow', 'decodedRow']) && Number.isSafeInteger(item.compilerRow) && Number.isSafeInteger(item.decodedRow)
      && typeof item.compilerRow === 'number' && typeof item.decodedRow === 'number'
      && item.compilerRow >= 1 && item.compilerRow <= nativeRows.length && item.decodedRow >= 1 && item.decodedRow <= nativeRows.length,
    'SEMANTIC_TRANSLATION_LINEAGE_CHANGED', 'Each compiler row needs a bounded global source row index.');
    lineage.push({ compilerRow: item.compilerRow, decodedRow: item.decodedRow });
  }
  lineage.sort((a, b) => a.compilerRow - b.compilerRow);
  check(new Set(lineage.map(item => item.compilerRow)).size === nativeRows.length && new Set(lineage.map(item => item.decodedRow)).size === nativeRows.length
    && hashData(lineage) === reference.rowLineageHash,
  'SEMANTIC_TRANSLATION_LINEAGE_CHANGED', 'An independently authored bijective row lineage is required; repeated, missing or changed rows are refused.');
  const rows = structuredClone(output.rows);
  check(hashData(rows) === reference.compilerSourceRowsHash && input.compilerRowsHash === reference.compilerSourceRowsHash
    && hashData(input.compilerRows) === reference.compilerSourceRowsHash,
  'SEMANTIC_TRANSLATION_COMPILER_ROWS_CHANGED', 'Actual translator output must equal the authored compiler batch and its separate row hash.');
  const sourceLocations = capture.pages.flatMap(page => page.rows.map((row, index) => ({ deliveryId: page.deliveryId,
    pageRow: index + 1, pageSha256: page.sha256, decodedRowHash: hashData(row) })));
  const binding: SemanticTranslationBinding = { ...structuredClone(reference), contractVersion: 1, captureId: capture.id,
    generation: capture.generation, reviewId: capture.reviewId, recipeHash: capture.recipeHash,
    decoderDefinitionHash: input.decoderDefinitionHash, semanticMappingFingerprint: input.semanticMappingFingerprint,
    sourcePages: capture.pages.map(page => ({ deliveryId: page.deliveryId, sha256: page.sha256, decodedRowsHash: hashData(page.rows) })),
    rowLineage: lineage.map(item => ({ ...item, ...sourceLocations[item.decodedRow - 1], compilerRowHash: hashData(rows[item.compilerRow - 1]) })) };
  return { rows, rowLineage: lineage, binding, digest: hashData(binding) };
}
