import type { OperationEvidence } from './contracts.ts';
import { dataOnly, digest, hashData, requireThat } from './validation.ts';

export function verifyLedger(ledger: OperationEvidence[], expectedHead?: string | null) {
  dataOnly(ledger); requireThat(Array.isArray(ledger),'INVALID_LEDGER','Evidence ledger must be an ordered data array.'); let previous: string | null = null;
  for (const entry of ledger) {
    digest(entry.id); const {id,...payload} = entry;
    requireThat(entry.previousHash === previous && id === hashData(payload),'LEDGER_TAMPERED','A qualification receipt was changed, reordered or removed.');
    requireThat(entry.liveVerified === false && entry.arbitraryCompanyGuarantee === false && entry.writebackQualified === false,'UNSUPPORTED_CLAIM','Qualification evidence cannot certify live installs, arbitrary companies or unselected writes.'); previous = id;
  }
  if (expectedHead !== undefined) requireThat(previous === expectedHead,'LEDGER_HEAD_MISMATCH','The ledger differs from the independently retained head anchor.');
  return {valid:true,entries:ledger.length,head:previous};
}
export function appendEvidence(ledger: OperationEvidence[], evidence: Omit<OperationEvidence,'id'|'previousHash'>): OperationEvidence {
  const verified = verifyLedger(ledger);
  const payload = {...structuredClone(evidence),previousHash:verified.head}, entry = {...payload,id:hashData(payload)};
  ledger.push(entry); return structuredClone(entry);
}
export function checkEvidenceCurrent(evidence: OperationEvidence, current: {mappingFingerprint:string;schemaHash:string;rowsHash:string;snapshotId:string;sourceReportHash:string;manifestHash:string;splitPlanHash:string;goldenCaseHash:string}) {
  dataOnly({evidence,current});
  const {id,...payload} = evidence;
  requireThat(id === hashData(payload) && evidence.liveVerified === false && evidence.arbitraryCompanyGuarantee === false && evidence.writebackQualified === false,'LEDGER_TAMPERED','Verify the qualification receipt hash and scope before using it.');
  const drift = evidence.mappingFingerprint !== current.mappingFingerprint || evidence.schemaHash !== current.schemaHash || evidence.rowsHash !== current.rowsHash || evidence.scope.snapshotId !== current.snapshotId || evidence.sourceReportHash !== current.sourceReportHash || evidence.manifestHash !== current.manifestHash || evidence.splitPlanHash !== current.splitPlanHash || evidence.goldenCaseHash !== current.goldenCaseHash;
  return drift ? {valid:false,decision:'invalidated' as const,reason:'Mapping, schema, source snapshot, report, rights, split or golden evidence changed; qualify again.'} : {valid:evidence.decision === 'qualified',decision:evidence.decision,reason:evidence.decision === 'qualified' ? null:'This operation has no qualified evidence.'};
}
