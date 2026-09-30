import type { CanonicalFact, CompiledMapping, ControlTotal, MappingResult, OperationId, SourceBatch, SourceRow } from './contracts.ts';
import { OPERATIONS, assertCompiled, validateSchema } from './compiler.ts';
import { calendarDate, dataOnly, exactDecimal, exactKeys, hashData, issue, requireThat, scaledDecimal, SemanticError, text } from './validation.ts';

function rowText(row: SourceRow, field: string, allowEmpty = false) {
  const value = row[field];
  requireThat(typeof value === 'string' && (allowEmpty || value.trim().length > 0), 'MISSING_VALUE', `Clarify the missing or non-text ${field}; a blank cannot mean zero.`);
  return value;
}
function parseDate(value: string, format: CompiledMapping['pack']['semantics']['dateFormat']) {
  let date = value;
  if (format === 'DMY') {
    const match = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(value);
    requireThat(match, 'INVALID_DATE', 'The date needs the explicitly asserted day-first layout.');
    date = `${match[3]}-${match[2]}-${match[1]}`;
  }
  if (format === 'YMD8') {
    requireThat(/^\d{8}$/.test(value), 'INVALID_DATE', 'The date needs YYYYMMDD.');
    date = `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`;
  }
  requireThat(calendarDate(date),'INVALID_DATE','The source date is not a valid Gregorian calendar date.'); return date;
}
export function controlTotals(facts: CanonicalFact[]): ControlTotal[] {
  const groups = new Map<string,{ kind:CanonicalFact['kind']; currency:string; net:bigint; tax:bigint; gross:bigint }>();
  for (const f of facts) {
    const key = `${f.kind}:${f.currency}`, g = groups.get(key) ?? { kind:f.kind,currency:f.currency,net:0n,tax:0n,gross:0n };
    g.net += BigInt(f.netMinor); g.tax += BigInt(f.taxMinor); g.gross += BigInt(f.grossMinor); groups.set(key,g);
  }
  return [...groups.values()].sort((a,b) => `${a.kind}:${a.currency}`.localeCompare(`${b.kind}:${b.currency}`)).map(g => ({kind:g.kind,currency:g.currency,netMinor:String(g.net),taxMinor:String(g.tax),grossMinor:String(g.gross)}));
}
/** Atomic: one unresolved row discards every proposed fact. Source text is never evaluated. */
export function mapBatch(compiled: CompiledMapping, batch: SourceBatch): MappingResult {
  const facts: CanonicalFact[] = [], exclusions: MappingResult['exclusions'] = [];
  let sourceRowCount = 0, rowNumber: number | undefined;
  try {
    dataOnly({compiled,batch}); assertCompiled(compiled);
    exactKeys(batch,['receiptId','datasetId','system','product','company','schema','rows','rowsHash','complete','snapshotId','origins'],'source batch');
    ['receiptId','datasetId','system','company','snapshotId'].forEach(k => text((batch as any)[k],k));
    exactKeys(batch.origins,['business','template','configuration'],'source origins'); Object.entries(batch.origins).forEach(([k,v]) => text(v,k));
    validateSchema(batch.schema);
    requireThat(hashData(batch.schema) === compiled.schemaHash, 'SCHEMA_DRIFT', 'The source schema changed; invalidate qualification and review the new fields and types.');
    requireThat(batch.system === compiled.pack.system && hashData(batch.product) === hashData(compiled.pack.product),'PRODUCT_DRIFT','The source product/version/configuration changed; requalify this mapping.');
    requireThat(batch.complete === true,'INCOMPLETE_SOURCE','The connector must prove bounded complete source acquisition before qualification.');
    requireThat(batch.company === compiled.rules.company,'SOURCE_SCOPE_MISMATCH','The source receipt belongs to a different company.');
    requireThat(Array.isArray(batch.rows) && batch.rows.length <= 2000,'SOURCE_LIMIT','Qualification batches are limited to 2000 source records.'); sourceRowCount = batch.rows.length;
    requireThat(hashData(batch.rows) === batch.rowsHash,'SOURCE_HASH_MISMATCH','Source rows differ from the captured source receipt hash.');
    const { rules,pack } = compiled, b = pack.bindings, s = pack.semantics, identities = new Set<string>();
    for (const [index,row] of batch.rows.entries()) {
      rowNumber = index + 1;
      exactKeys(row,Object.keys(batch.schema.fields),'source row');
      for (const [field,type] of Object.entries(batch.schema.fields)) requireThat(row[field] === null || typeof row[field] === (type === 'text' ? 'string':'boolean'),'SOURCE_TYPE_MISMATCH',`The source field ${field} violates its declared raw type.`);
      const entityId = rowText(row,b.identity);
      requireThat(!identities.has(entityId),'DUPLICATE_IDENTITY','Duplicate document/event identities need explicit revision handling; do not deduplicate by row position.'); identities.add(entityId);
      const kindValue = rowText(row,b.kind), statusValue = rowText(row,b.status);
      requireThat(Object.hasOwn(s.kindValues,kindValue),'UNKNOWN_KIND','Clarify the source event kind before counting it.');
      requireThat(Object.hasOwn(s.statusValues,statusValue),'UNKNOWN_STATE','Clarify the unknown source state before counting it.');
      const kind = s.kindValues[kindValue], state = s.statusValues[statusValue];
      const company = rowText(row,b.company), branch = rowText(row,b.branch), taxRegistration = rowText(row,b.taxRegistration);
      requireThat(company === rules.company && rules.branches.includes(branch) && rules.taxRegistrations.includes(taxRegistration),'SOURCE_SCOPE_MISMATCH','A source row is outside the explicit company/branch/tax-registration scope.');
      const date = parseDate(rowText(row,b.date),s.dateFormat);
      requireThat(date >= rules.period.from && date <= rules.period.to,'PERIOD_SCOPE_MISMATCH','A source row is outside the independently reported period; a date basis is never inferred.');
      const currency = rowText(row,b.currency);
      requireThat(Object.hasOwn(rules.currencies,currency),'CURRENCY_UNCONFIGURED','Clarify the explicit source currency and its decimal scale. Foreign currencies are never summed or converted implicitly.');
      const currencyScale = rules.currencies[currency].scale, moneyScale = s.amountUnit === 'minor' ? 0 : currencyScale;
      let amount = exactDecimal(rowText(row,b.amount),moneyScale), tax = exactDecimal(rowText(row,b.tax),moneyScale);
      if (kind === 'refund') {
        requireThat(s.refundSign === 'positive' ? amount >= 0n && tax >= 0n : amount <= 0n && tax <= 0n,'REFUND_SIGN_MISMATCH','The refund sign does not match the asserted source convention.');
        if (s.refundSign === 'negative') { amount = -amount; tax = -tax; }
      } else requireThat(amount >= 0n && tax >= 0n,'INVALID_EVENT_SIGN','Negative non-refund events require a separate correction/reversal mapping.');
      const net = s.taxInclusion === 'inclusive' ? amount - tax : amount, gross = s.taxInclusion === 'inclusive' ? amount : amount + tax;
      requireThat(net >= 0n && tax >= 0n && net + tax === gross,'INVALID_TAX','Explicit net, tax and gross assertions do not reconcile.');
      const quantitySource = exactDecimal(rowText(row,b.quantity),s.quantityScale), sourceUnit = rowText(row,b.unit);
      requireThat(quantitySource >= 0n,'INVALID_QUANTITY','Quantity signs require an explicit event convention.');
      requireThat(Object.hasOwn(rules.units,sourceUnit),'UNIT_UNCONFIGURED','Clarify the source unit; no unit conversion is inferred.');
      const unit = rules.units[sourceUnit], numerator = quantitySource * BigInt(unit.numerator), denominator = BigInt(unit.denominator);
      requireThat(numerator % denominator === 0n,'INEXACT_UNIT','Unit conversion cannot be represented at the asserted quantity scale; clarify rather than round.');
      const relatedIdentity = rowText(row,b.relatedIdentity,true) || null;
      if (state !== 'include') { exclusions.push({entityId,row:rowNumber,reason:state}); continue; }
      if (kind === 'refund') requireThat(relatedIdentity,'REFUND_LINK_MISSING','Clarify which included sale or invoice this refund reverses.');
      else requireThat(relatedIdentity === null,'UNEXPECTED_LINK','A non-refund link needs an explicit mapping meaning.');
      facts.push({ entityId,kind,date,company,branch,taxRegistration,currency,currencyScale,netMinor:String(net),taxMinor:String(tax),grossMinor:String(gross),quantity:scaledDecimal(numerator/denominator,s.quantityScale),unit:unit.canonical,relatedIdentity,source:{receiptId:batch.receiptId,row:rowNumber,rowsHash:batch.rowsHash,schemaHash:compiled.schemaHash} });
    }
    const documents = new Map(facts.map(f => [f.entityId,f])), refundTotals = new Map<string,{net:bigint;tax:bigint;gross:bigint;quantity:bigint}>();
    for (const refund of facts.filter(f => f.kind === 'refund')) {
      rowNumber = refund.source.row; const original = documents.get(refund.relatedIdentity!);
      requireThat(original && ['sale','invoice'].includes(original.kind),'REFUND_LINK_MISSING','The refund must link to an included source sale or invoice in this qualified snapshot. Cross-period links require additional qualified source evidence.');
      requireThat(original.currency === refund.currency && original.company === refund.company && original.branch === refund.branch && original.taxRegistration === refund.taxRegistration && original.unit === refund.unit,'REFUND_SCOPE_MISMATCH','Refund and original document need the same company, branch, tax registration, currency and canonical unit.');
      requireThat(refund.date >= original.date,'REFUND_DATE_MISMATCH','A refund cannot precede its linked document date.');
      const total = refundTotals.get(original.entityId) ?? {net:0n,tax:0n,gross:0n,quantity:0n};
      total.net += BigInt(refund.netMinor); total.tax += BigInt(refund.taxMinor); total.gross += BigInt(refund.grossMinor); total.quantity += exactDecimal(refund.quantity,compiled.pack.semantics.quantityScale);
      requireThat(total.net <= BigInt(original.netMinor) && total.tax <= BigInt(original.taxMinor) && total.gross <= BigInt(original.grossMinor) && total.quantity <= exactDecimal(original.quantity,compiled.pack.semantics.quantityScale),'REFUND_LIMIT','Cumulative refunds exceed the original document amount, tax, gross or quantity; clarify the business meaning.');
      refundTotals.set(original.entityId,total);
    }
    return {decision:'mapped',facts,exclusions,issues:[],sourceRowCount,controls:controlTotals(facts)};
  } catch (error) {
    const problem = issue(error,rowNumber);
    return {decision:['SCHEMA_DRIFT','PRODUCT_DRIFT','COMPILED_DRIFT'].includes(problem.code) ? 'invalidated':'abstained',facts:[],exclusions:[],issues:[problem],sourceRowCount,controls:[]};
  }
}
const operationKinds = { billed:'invoice',earned:'sale',refunds:'refund',received:'payment',purchases:'purchase',costs:'cost' } as const;
export function evaluateOperation(operation: OperationId, facts: CanonicalFact[]) {
  requireThat((OPERATIONS as readonly string[]).includes(operation),'UNSUPPORTED_OPERATION','Choose an explicitly implemented ontology operation; unknown operations cannot produce zero.');
  dataOnly(facts);
  for (const f of facts) requireThat([f.netMinor,f.taxMinor,f.grossMinor].every(v=>typeof v === 'string' && /^(?:0|[1-9]\d*)$/.test(v)) && typeof f.currency === 'string' && /^[A-Z]{3}$/.test(f.currency),'INVALID_FACT','Operation amounts require exact nonnegative minor-unit strings and explicit currencies.');
  const currencies = [...new Set(facts.map(f => f.currency))].sort();
  const relevant = facts.filter(f => operation === 'net_sales' ? f.kind === 'sale' || (f.kind === 'refund' && facts.some(original => original.entityId === f.relatedIdentity && original.kind === 'sale')) : f.kind === operationKinds[operation]);
  const values = currencies.map(currency => ({ currency,minor:String(relevant.filter(f => f.currency === currency).reduce((sum,f) => sum + BigInt(operation === 'received' ? f.grossMinor:f.netMinor) * (operation === 'net_sales' && f.kind === 'refund' ? -1n : 1n),0n)) }));
  return {values,countedRows:relevant.map(f => f.source.row)};
}
