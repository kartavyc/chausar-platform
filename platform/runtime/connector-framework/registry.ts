import { check } from '../contracts.ts';
import { canonical, digest } from '../actions.ts';

export type ConnectorOperationKind = 'read' | 'export' | 'guided-export' | 'import' | 'write';
export type ConnectorTransport = 'api' | 'file' | 'guided-ui';
export type ConnectorApplicability = {
  applicationVersion: string;
  edition: string;
  module: string;
  /** An exact reviewed configuration identity or fingerprint, never a wildcard. */
  configuration: string;
  deploymentProfile: string;
  region?: string;
};
export type ConnectorOperationScope = {
  connectorId: string;
  connectorVersion: string;
  operationId: string;
  kind: ConnectorOperationKind;
  transport: ConnectorTransport;
  applicability: ConnectorApplicability;
};

export const CONNECTOR_CAPABILITIES = Object.freeze([
  'authentication-expiry', 'rate-limit-backoff', 'pagination', 'raw-provenance',
  'coverage', 'freshness', 'corrections', 'deletions', 'schema-drift-quarantine',
  'cursor-idempotency', 'duplicate-quarantine', 'source-total-reconciliation',
  'typed-numeric-engine', 'human-reviewed-mapping', 'source-preconditions',
  'native-idempotency', 'queryable-outcome', 'readback', 'reconciliation',
] as const);
export type ConnectorCapability = typeof CONNECTOR_CAPABILITIES[number];
export const WRITE_QUALIFICATION_PHASES = Object.freeze(['prepare', 'approve', 'do', 'readback', 'reconcile'] as const);
export type WriteQualificationPhase = typeof WRITE_QUALIFICATION_PHASES[number];
export type EvidenceAssertion = ConnectorCapability | 'operation' | WriteQualificationPhase;
export type QualifiedLevel = 'synthetic-tested' | 'sandbox-verified' | 'live-verified';
export type QualificationLevel = 'unqualified' | QualifiedLevel;

export type ConnectorOperationRegistration = {
  scope: ConnectorOperationScope;
  implemented: boolean;
  capabilities: ConnectorCapability[];
  evidenceIds: string[];
  limitations: string[];
  /** Binds qualified code/schema/mapping metadata to the exact implementation. */
  implementationDigest?: string;
  /** Optional additional freshness limit; expiresAt is always enforced. */
  maxEvidenceAgeMs?: number;
};
type EvidenceBase = {
  id: string;
  scope: ConnectorOperationScope;
  assertions: EvidenceAssertion[];
  observedAt: string;
  expiresAt: string;
  artifact: { sha256: string; reference: string };
  notes: string[];
  implementationDigest?: string;
};
export type SyntheticConnectorEvidence = EvidenceBase & {
  environment: 'synthetic';
  provenance: { kind: 'synthetic-fixture'; generatorVersion: string };
};
export type ExternalConnectorEvidence = EvidenceBase & {
  environment: 'sandbox' | 'live';
  provenance: {
    kind: 'source-observation';
    sourceIdentity: string;
    observerId: string;
    runId: string;
    independentReviewId: string;
  };
};
export type ConnectorEvidence = SyntheticConnectorEvidence | ExternalConnectorEvidence;
export type ExternalEvidenceAttestation = {
  evidenceDigest: string;
  verifierId: string;
  verifiedAt: string;
};
export type RegistryOptions = {
  /**
   * A trusted host boundary must verify artifact custody and the source/review
   * provenance. A caller-supplied environment label is insufficient. This
   * registry makes no source calls and never fabricates external attestations.
   */
  verifyExternalEvidence?: (evidence: Readonly<ExternalConnectorEvidence>) => ExternalEvidenceAttestation | undefined;
};
export type QualificationReason =
  | 'operation-not-registered' | 'operation-not-implemented' | 'evidence-absent'
  | 'evidence-scope-mismatch' | 'evidence-not-yet-observed' | 'evidence-expired'
  | 'evidence-too-old' | 'evidence-revoked' | 'external-evidence-unverified'
  | 'attestation-not-yet-valid' | 'required-assertions-missing' | 'qualification-level-insufficient'
  | 'evidence-implementation-mismatch';
export type ConnectorQualification = {
  scope: ConnectorOperationScope;
  level: QualificationLevel;
  permitted: boolean;
  capabilities: ConnectorCapability[];
  evidenceIds: string[];
  requiredAssertions: EvidenceAssertion[];
  reasonCodes: QualificationReason[];
  asOf: string;
  definitionDigest: string;
  evidenceDigest: string;
  /** Stable until the definition, eligible evidence or qualification changes. */
  digest: string;
};
export type QualificationOptions = { at: string; minimum?: QualifiedLevel };
type StoredEvidence = { record: ConnectorEvidence; recordDigest: string; attestation?: ExternalEvidenceAttestation };
type Revocation = { at: string; reason: string };
type DeepReadonly<T> = T extends readonly (infer U)[] ? readonly DeepReadonly<U>[] : T extends object ? { readonly [P in keyof T]: DeepReadonly<T[P]> } : T;

const kinds: readonly string[] = ['read', 'export', 'guided-export', 'import', 'write'];
const transports: readonly string[] = ['api', 'file', 'guided-ui'];
const assertions: readonly string[] = [...new Set(['operation', ...CONNECTOR_CAPABILITIES, ...WRITE_QUALIFICATION_PHASES])];
const levels: readonly QualificationLevel[] = ['unqualified', 'synthetic-tested', 'sandbox-verified', 'live-verified'];
function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001f]/.test(value);
}
function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key));
}
function timestamp(value: unknown): number {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value), 'INVALID_EVIDENCE_TIME', 'Use a canonical UTC ISO timestamp.');
  const time = Date.parse(value);
  check(Number.isFinite(time) && new Date(time).toISOString() === value, 'INVALID_EVIDENCE_TIME', 'Evidence timestamps must represent a real instant.');
  return time;
}
function validateScope(scope: ConnectorOperationScope) {
  check(plain(scope) && exactKeys(scope, ['connectorId', 'connectorVersion', 'operationId', 'kind', 'transport', 'applicability']), 'INVALID_OPERATION_SCOPE', 'Specify the exact connector operation and transport.');
  check(/^[a-z][a-z0-9-]{0,63}$/.test(scope.connectorId) && text(scope.connectorVersion) && text(scope.operationId) && ![scope.connectorVersion, scope.operationId].some(value => value.includes('*')), 'INVALID_OPERATION_SCOPE', 'Connector IDs and operation revisions must be explicit.');
  check(kinds.includes(scope.kind) && transports.includes(scope.transport), 'INVALID_OPERATION_SCOPE', 'Unknown operation kind or transport.');
  check(plain(scope.applicability) && exactKeys(scope.applicability, ['applicationVersion', 'edition', 'module', 'configuration', 'deploymentProfile'], ['region']) && Object.values(scope.applicability).every(value => text(value) && !value.includes('*')), 'INVALID_OPERATION_SCOPE', 'Qualification requires explicit application, edition, module, configuration and deployment profile.');
  check(scope.kind !== 'guided-export' || scope.transport === 'guided-ui', 'INVALID_OPERATION_SCOPE', 'Guided export requires a guided UI transport.');
  check(scope.kind !== 'import' || scope.transport === 'file', 'INVALID_OPERATION_SCOPE', 'Captured artifact import requires a file transport.');
}
function uniqueStrings(value: unknown, allowed?: readonly string[]): value is string[] {
  return Array.isArray(value) && value.every(item => text(item) && (!allowed || allowed.includes(item))) && new Set(value).size === value.length;
}
function validateRegistration(entry: ConnectorOperationRegistration) {
  check(plain(entry), 'INVALID_CONNECTOR_REGISTRATION', 'Operation registrations must be plain records.');
  validateScope(entry.scope);
  check(exactKeys(entry, ['scope', 'implemented', 'capabilities', 'evidenceIds', 'limitations'], ['maxEvidenceAgeMs', 'implementationDigest']) && typeof entry.implemented === 'boolean' && uniqueStrings(entry.capabilities, CONNECTOR_CAPABILITIES) && uniqueStrings(entry.evidenceIds) && uniqueStrings(entry.limitations), 'INVALID_CONNECTOR_REGISTRATION', 'Operation registrations require typed, unique capability and evidence records.');
  check(entry.implementationDigest === undefined || (typeof entry.implementationDigest === 'string' && /^[a-f0-9]{64}$/.test(entry.implementationDigest)), 'INVALID_CONNECTOR_REGISTRATION', 'An implementation binding must be a SHA-256 digest.');
  check(entry.maxEvidenceAgeMs === undefined || (Number.isSafeInteger(entry.maxEvidenceAgeMs) && entry.maxEvidenceAgeMs > 0), 'INVALID_CONNECTOR_REGISTRATION', 'Evidence age limits must be positive safe integer milliseconds.');
}
function validateEvidence(evidence: ConnectorEvidence) {
  check(plain(evidence) && exactKeys(evidence, ['id', 'scope', 'assertions', 'observedAt', 'expiresAt', 'artifact', 'notes', 'environment', 'provenance'], ['implementationDigest']) && text(evidence.id), 'INVALID_CONNECTOR_EVIDENCE', 'Evidence must be an explicit bounded record.');
  check(evidence.implementationDigest === undefined || (typeof evidence.implementationDigest === 'string' && /^[a-f0-9]{64}$/.test(evidence.implementationDigest)), 'INVALID_CONNECTOR_EVIDENCE', 'Evidence implementation bindings must be SHA-256 digests.');
  validateScope(evidence.scope);
  check(uniqueStrings(evidence.assertions, assertions) && evidence.assertions.length > 0 && uniqueStrings(evidence.notes), 'INVALID_CONNECTOR_EVIDENCE', 'Evidence assertions and notes must be unique and supported.');
  check(timestamp(evidence.expiresAt) > timestamp(evidence.observedAt), 'INVALID_CONNECTOR_EVIDENCE', 'Evidence must have a positive validity interval.');
  check(plain(evidence.artifact) && exactKeys(evidence.artifact, ['sha256', 'reference']) && /^[a-f0-9]{64}$/.test(evidence.artifact.sha256) && text(evidence.artifact.reference), 'INVALID_CONNECTOR_EVIDENCE', 'Evidence needs an artifact digest and permitted reference.');
  check(plain(evidence.provenance), 'INVALID_CONNECTOR_EVIDENCE', 'Evidence provenance is required.');
  if (evidence.environment === 'synthetic') {
    check(exactKeys(evidence.provenance, ['kind', 'generatorVersion']) && evidence.provenance.kind === 'synthetic-fixture' && text(evidence.provenance.generatorVersion), 'INVALID_CONNECTOR_EVIDENCE', 'Synthetic evidence must identify its fixture generator.');
  } else {
    check(['sandbox', 'live'].includes(evidence.environment) && exactKeys(evidence.provenance, ['kind', 'sourceIdentity', 'observerId', 'runId', 'independentReviewId']) && evidence.provenance.kind === 'source-observation' && Object.values(evidence.provenance).every(text), 'INVALID_CONNECTOR_EVIDENCE', 'External evidence requires independently verifiable source and review provenance.');
  }
}
function freeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
function clone<T>(value: T): T { return JSON.parse(canonical(value)) as T; }
function sorted<T extends string>(values: Iterable<T>): T[] { return [...new Set(values)].sort(); }
export function connectorOperationKey(scope: ConnectorOperationScope): string { validateScope(scope); return digest(scope); }
export function connectorEvidenceDigest(evidence: ConnectorEvidence): string { validateEvidence(evidence); return digest(evidence); }

/** A registry describes support; it neither grants account authority nor dispatches effects. */
export class ConnectorCapabilityRegistry {
  #operations = new Map<string, ConnectorOperationRegistration>();
  #evidence = new Map<string, StoredEvidence>();
  #revocations = new Map<string, Revocation>();

  constructor(operations: readonly ConnectorOperationRegistration[] = [], evidence: readonly ConnectorEvidence[] = [], options: RegistryOptions = {}) {
    check(Array.isArray(operations) && Array.isArray(evidence), 'INVALID_CONNECTOR_REGISTRATION', 'Supply operation and evidence lists.');
    for (const input of operations) {
      const entry = clone(input); validateRegistration(entry);
      const key = connectorOperationKey(entry.scope);
      check(!this.#operations.has(key), 'DUPLICATE_CONNECTOR_OPERATION', 'An exact operation can only have one definition.');
      this.#operations.set(key, entry);
    }
    for (const input of evidence) {
      const record = clone(input); validateEvidence(record);
      check(!this.#evidence.has(record.id), 'DUPLICATE_CONNECTOR_EVIDENCE', 'Evidence IDs must be unique.');
      const recordDigest = connectorEvidenceDigest(record);
      let attestation: ExternalEvidenceAttestation | undefined;
      if (record.environment !== 'synthetic' && options.verifyExternalEvidence) {
        const verified = options.verifyExternalEvidence(freeze(clone(record)) as Readonly<ExternalConnectorEvidence>);
        if (verified !== undefined) {
          attestation = clone(verified);
          check(plain(attestation) && exactKeys(attestation, ['evidenceDigest', 'verifierId', 'verifiedAt']) && attestation.evidenceDigest === recordDigest && text(attestation.verifierId) && timestamp(attestation.verifiedAt) >= timestamp(record.observedAt), 'INVALID_EVIDENCE_ATTESTATION', 'A trusted attestation must bind the exact evidence digest and observation.');
        }
      }
      this.#evidence.set(record.id, { record, recordDigest, ...(attestation ? { attestation } : {}) });
    }
  }

  operation(scope: ConnectorOperationScope): DeepReadonly<ConnectorOperationRegistration> | undefined {
    const entry = this.#operations.get(connectorOperationKey(scope));
    return entry ? freeze(clone(entry)) : undefined;
  }
  /** No mutable object from callers or returned catalogues reaches registry state. */
  catalogue(): readonly DeepReadonly<ConnectorOperationRegistration>[] {
    return freeze([...this.#operations.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, entry]) => clone(entry)));
  }
  revokeEvidence(id: string, at: string, reason: string): void {
    check(this.#evidence.has(id) && text(reason), 'INVALID_EVIDENCE_REVOCATION', 'Revoke a known evidence record with an explicit reason.');
    timestamp(at);
    const previous = this.#revocations.get(id);
    if (!previous || timestamp(at) < timestamp(previous.at)) this.#revocations.set(id, { at, reason });
  }
  qualification(scope: ConnectorOperationScope, at: string, minimum: QualifiedLevel = 'synthetic-tested'): ConnectorQualification {
    const key = connectorOperationKey(scope), time = timestamp(at);
    check(['synthetic-tested', 'sandbox-verified', 'live-verified'].includes(minimum), 'INVALID_QUALIFICATION_LEVEL', 'Choose a synthetic, sandbox or live minimum.');
    const entry = this.#operations.get(key), reasons = new Set<QualificationReason>();
    const requiredAssertions = sorted<EvidenceAssertion>(['operation', ...(entry?.capabilities ?? []), ...(scope.kind === 'write' ? WRITE_QUALIFICATION_PHASES : [])]);
    const eligible: StoredEvidence[] = [];
    if (!entry) reasons.add('operation-not-registered');
    else {
      if (!entry.implemented) reasons.add('operation-not-implemented');
      if (entry.evidenceIds.length === 0) reasons.add('evidence-absent');
      for (const id of entry.evidenceIds) {
        const item = this.#evidence.get(id);
        if (!item) { reasons.add('evidence-absent'); continue; }
        const record = item.record;
        if (connectorOperationKey(record.scope) !== key) { reasons.add('evidence-scope-mismatch'); continue; }
        if (entry.implementationDigest !== undefined && record.implementationDigest !== entry.implementationDigest) { reasons.add('evidence-implementation-mismatch'); continue; }
        if (timestamp(record.observedAt) > time) { reasons.add('evidence-not-yet-observed'); continue; }
        if (timestamp(record.expiresAt) <= time) { reasons.add('evidence-expired'); continue; }
        if (entry.maxEvidenceAgeMs !== undefined && time - timestamp(record.observedAt) >= entry.maxEvidenceAgeMs) { reasons.add('evidence-too-old'); continue; }
        const revoked = this.#revocations.get(id);
        if (revoked && timestamp(revoked.at) <= time) { reasons.add('evidence-revoked'); continue; }
        if (record.environment !== 'synthetic') {
          if (!item.attestation) { reasons.add('external-evidence-unverified'); continue; }
          if (timestamp(item.attestation.verifiedAt) > time) { reasons.add('attestation-not-yet-valid'); continue; }
        }
        eligible.push(item);
      }
    }
    let level: QualificationLevel = 'unqualified';
    // Synthetic + live cannot be combined to manufacture live qualification.
    // Each level needs all assertions witnessed within its own environment.
    for (const [environment, candidate] of [['synthetic', 'synthetic-tested'], ['sandbox', 'sandbox-verified'], ['live', 'live-verified']] as const) {
      const witnessed = new Set(eligible.filter(item => item.record.environment === environment).flatMap(item => item.record.assertions));
      if (requiredAssertions.every(assertion => witnessed.has(assertion))) level = candidate;
    }
    if (level === 'unqualified') reasons.add('required-assertions-missing');
    if (levels.indexOf(level) < levels.indexOf(minimum)) reasons.add('qualification-level-insufficient');
    const permitted = Boolean(entry?.implemented) && levels.indexOf(level) >= levels.indexOf(minimum);
    const evidenceIds = eligible.map(item => item.record.id).sort();
    const definitionDigest = digest(entry ?? { scope, implemented: false });
    const evidenceDigest = digest(eligible.map(item => ({ id: item.record.id, recordDigest: item.recordDigest, attestation: item.attestation ?? null })).sort((a, b) => a.id.localeCompare(b.id)));
    return clone({ scope, level, permitted, capabilities: entry?.capabilities ?? [], evidenceIds, requiredAssertions, reasonCodes: sorted(reasons), asOf: at, definitionDigest, evidenceDigest, digest: digest({ definitionDigest, evidenceDigest, level, minimum }) });
  }
  /** Default minimum supports fixture execution; external callers must request their actual environment. */
  assertCanUse(scope: ConnectorOperationScope, at: string, minimum: QualifiedLevel = 'synthetic-tested'): ConnectorQualification {
    const result = this.qualification(scope, at, minimum);
    check(result.permitted, 'CONNECTOR_NOT_QUALIFIED', `This exact connector operation is not qualified: ${result.reasonCodes.join(', ')}.`);
    return result;
  }
  assertQualified(scope: ConnectorOperationScope, options: QualificationOptions): ConnectorQualification {
    return this.assertCanUse(scope, options.at, options.minimum ?? 'synthetic-tested');
  }
  /** Prevents unchanged operation keys from reusing evidence after implementation drift. */
  assertDefinition(scope: ConnectorOperationScope, implementationDigest: string, at: string, minimum: QualifiedLevel = 'synthetic-tested'): ConnectorQualification {
    check(typeof implementationDigest === 'string' && /^[a-f0-9]{64}$/.test(implementationDigest), 'INVALID_IMPLEMENTATION_DIGEST', 'Supply the exact SHA-256 implementation digest.');
    const entry = this.#operations.get(connectorOperationKey(scope));
    check(entry?.implementationDigest === implementationDigest, 'CONNECTOR_DEFINITION_UNQUALIFIED', 'This exact implementation lacks a matching pinned qualification definition.');
    return this.assertCanUse(scope, at, minimum);
  }
  assertCapability(scope: ConnectorOperationScope, capability: ConnectorCapability, at: string, minimum: QualifiedLevel = 'synthetic-tested'): ConnectorQualification {
    check(CONNECTOR_CAPABILITIES.includes(capability), 'INVALID_CONNECTOR_CAPABILITY', 'Choose a supported typed capability.');
    const result = this.assertCanUse(scope, at, minimum);
    check(result.capabilities.includes(capability), 'CONNECTOR_CAPABILITY_UNSUPPORTED', 'This exact operation does not declare the requested capability.');
    return result;
  }
}
