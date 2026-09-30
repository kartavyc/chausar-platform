import type { CompanyRules, CompiledMapping, MappingPack, OntologyContract, SourceSchema } from './contracts.ts';
import { readFileSync } from 'node:fs';
import { dataOnly, digest, exactKeys, freezeData, hashData, record, requireThat, sha256Bytes, strings, text, validatePeriod } from './validation.ts';

export const COMPILER_VERSION = 'semantic-qualification/1.0.0';
/** Source distribution identity, independent of a developer remembering a version bump. */
export const COMPILER_BUILD_HASH = hashData(Object.fromEntries(['contracts.ts','validation.ts','compiler.ts','mapping.ts','qualification.ts','ledger.ts','publication-gate.ts','index.ts'].map(name=>[name,sha256Bytes(readFileSync(new URL(name,import.meta.url)))])));
export const KINDS = ['invoice', 'sale', 'refund', 'payment', 'purchase', 'cost'] as const;
export const OPERATIONS = ['billed', 'earned', 'refunds', 'received', 'purchases', 'costs', 'net_sales'] as const;
export function validateSchema(schema: SourceSchema) {
  exactKeys(schema, ['fields'], 'source schema'); record(schema.fields);
  const keys = Object.keys(schema.fields);
  requireThat(keys.length > 0 && keys.length <= 100 && keys.every(k => /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(k)), 'INVALID_SCHEMA', 'Source schema fields must be unique bounded data names.');
  requireThat(Object.values(schema.fields).every(t => t === 'text' || t === 'boolean'), 'INVALID_SCHEMA', 'Raw decimals, dates and identities are text; only explicit boolean fields use booleans.');
}
export function compileMapping(pack: MappingPack, rules: CompanyRules, ontology: OntologyContract): CompiledMapping {
  dataOnly({ pack, rules, ontology });
  exactKeys(pack, ['contractVersion','id','version','system','product','ontologyHash','sourceSchema','bindings','semantics','provenanceIds'], 'mapping pack');
  requireThat(pack.contractVersion === 1, 'UNSUPPORTED_VERSION', 'Only mapping-pack contract version 1 is understood.');
  ['id','version','system'].forEach(k => text((pack as any)[k], k));
  exactKeys(pack.product, ['name','version','edition','configuration'], 'product configuration');
  Object.entries(pack.product).forEach(([k,v]) => text(v,k));
  validateSchema(pack.sourceSchema); digest(pack.ontologyHash); strings(pack.provenanceIds,'pack provenance');
  exactKeys(pack.bindings, ['identity','kind','date','amount','tax','currency','status','company','branch','taxRegistration','quantity','unit','relatedIdentity'], 'bindings');
  const bindingFields = Object.values(pack.bindings);
  requireThat(new Set(bindingFields).size === bindingFields.length && bindingFields.every(f => Object.hasOwn(pack.sourceSchema.fields,f) && pack.sourceSchema.fields[f] === 'text'), 'INVALID_BINDINGS', 'Every semantic binding names its own declared source text field.');
  exactKeys(pack.semantics, ['taxInclusion','amountUnit','dateFormat','dateBasis','calendar','kindValues','statusValues','refundSign','refundsRequireLink','missing','unknownState','onSchemaDrift','quantityScale'], 'semantic assertions');
  const s = pack.semantics;
  requireThat(['inclusive','exclusive'].includes(s.taxInclusion) && ['major','minor'].includes(s.amountUnit) && ['ISO','DMY','YMD8'].includes(s.dateFormat), 'AMBIGUOUS_SEMANTICS', 'Tax inclusion, money unit and date layout must be explicit supported assertions.');
  requireThat(s.calendar === 'gregorian-date' && s.refundsRequireLink === true && ['positive','negative'].includes(s.refundSign) && s.missing === 'abstain' && s.unknownState === 'abstain' && s.onSchemaDrift === 'invalidate', 'AMBIGUOUS_SEMANTICS', 'Missing values, unknown states and schema drift must stop the mapping; refunds need explicit signs and links.');
  text(s.dateBasis,'date basis');
  requireThat(Number.isSafeInteger(s.quantityScale) && s.quantityScale >= 0 && s.quantityScale <= 6, 'INVALID_SCALE', 'Quantity scale must be a bounded integer.');
  for (const values of [s.kindValues,s.statusValues]) { record(values); requireThat(Object.keys(values).length > 0 && Object.keys(values).length <= 100, 'AMBIGUOUS_SEMANTICS', 'Every source kind and state must have an explicit bounded table.'); Object.keys(values).forEach(v => text(v,'source state')); }
  requireThat(Object.values(s.kindValues).every(v => (KINDS as readonly string[]).includes(v)), 'UNKNOWN_KIND', 'A source event kind has no declared ontology meaning.');
  requireThat(Object.values(s.statusValues).every(v => ['include','exclude-cancelled','exclude-draft','exclude-bounced'].includes(v)), 'UNKNOWN_STATE', 'Unsupported source state handling.');
  exactKeys(ontology, ['version','definitions','operations'], 'ontology contract'); text(ontology.version,'ontology version');
  exactKeys(ontology.definitions,[...KINDS],'ontology definitions');
  for (const d of Object.values(ontology.definitions)) {
    exactKeys(d,['amount','dateBasis'],'ontology definition');
    requireThat(d.amount === 'net-excluding-tax' && d.dateBasis === s.dateBasis, 'ONTOLOGY_MISMATCH', 'Every mapped event requires explicit net-of-tax amount and matching event date meaning.');
  }
  strings(ontology.operations,'ontology operations');
  requireThat(ontology.operations.every(o => (OPERATIONS as readonly string[]).includes(o)), 'UNSUPPORTED_OPERATION', 'Only the seven deterministic register operations are implemented in this qualification prototype.');
  const ontologyHash = hashData(ontology); requireThat(pack.ontologyHash === ontologyHash, 'ONTOLOGY_MISMATCH', 'The pack targets a different ontology version or definition hash.');
  exactKeys(rules, ['contractVersion','id','version','packHash','company','branches','taxRegistrations','timezone','currencies','units','period','provenanceIds'], 'company rules');
  requireThat(rules.contractVersion === 1, 'UNSUPPORTED_VERSION', 'Only company-rules contract version 1 is understood.');
  ['id','version','company','timezone'].forEach(k => text((rules as any)[k], k)); strings(rules.branches,'branches'); strings(rules.taxRegistrations,'tax registrations'); strings(rules.provenanceIds,'company provenance');
  try { new Intl.DateTimeFormat('en',{timeZone:rules.timezone}); } catch { requireThat(false,'INVALID_TIMEZONE','Select a valid IANA company timezone.'); }
  validatePeriod(rules.period); digest(rules.packHash);
  const packHash = hashData(pack); requireThat(rules.packHash === packHash, 'PACK_MISMATCH', 'Company rules belong to a different mapping-pack version or configuration.');
  record(rules.currencies); requireThat(Object.keys(rules.currencies).length > 0 && Object.keys(rules.currencies).length <= 20,'INVALID_CURRENCY','Explicit bounded currency scales are required.');
  for (const [code,currency] of Object.entries(rules.currencies)) { exactKeys(currency,['scale'],'currency'); requireThat(/^[A-Z]{3}$/.test(code) && Number.isSafeInteger(currency.scale) && currency.scale >= 0 && currency.scale <= 6,'INVALID_CURRENCY','Each currency needs a three-letter code and exact decimal scale.'); }
  record(rules.units); requireThat(Object.keys(rules.units).length > 0 && Object.keys(rules.units).length <= 100,'INVALID_UNIT','Configure unit conversions explicitly.');
  for (const [name,unit] of Object.entries(rules.units)) {
    text(name,'unit'); exactKeys(unit,['canonical','numerator','denominator'],'unit conversion'); text(unit.canonical,'canonical unit');
    requireThat(/^[1-9]\d{0,19}$/.test(unit.numerator) && /^[1-9]\d{0,19}$/.test(unit.denominator),'INVALID_UNIT','Unit conversion ratios require positive exact integer strings.');
  }
  const rulesHash = hashData(rules), schemaHash = hashData(pack.sourceSchema);
  const productFingerprint = hashData({ compilerVersion:COMPILER_VERSION,compilerBuildHash:COMPILER_BUILD_HASH,packHash,ontologyHash,schemaHash });
  const fingerprint = hashData({ productFingerprint,rulesHash });
  return freezeData({ compilerVersion:COMPILER_VERSION,compilerBuildHash:COMPILER_BUILD_HASH,pack,rules,ontology,packHash,rulesHash,ontologyHash,schemaHash,productFingerprint,fingerprint });
}
export function assertCompiled(compiled: CompiledMapping) {
  exactKeys(compiled,['compilerVersion','compilerBuildHash','pack','rules','ontology','packHash','rulesHash','ontologyHash','schemaHash','productFingerprint','fingerprint'],'compiled mapping');
  const rebuilt = compileMapping(compiled.pack,compiled.rules,compiled.ontology);
  requireThat(hashData(rebuilt) === hashData(compiled),'COMPILED_DRIFT','Compiled bindings or compiler version changed; recompile and requalify.');
}
