import { createHash, randomUUID } from 'node:crypto';
import { authorize, ChausarError, type Context, type State } from './contracts.ts';
import type { PrivateArtifactPurpose, PrivateArtifactRef } from './vault.ts';

export const WORKSPACE_BACKUP_V2_FORMAT = 'chausar.backup.v2' as const;
const PIN_FORMAT = 'chausar.backup-source-pin.v2' as const;
const SCOPE = 'authority-and-all-typed-private-artifacts' as const;
const purposes: PrivateArtifactPurpose[] = ['private-trial', 'workspace-interchange'];
const identifier = /^[A-Za-z0-9_-]{1,100}$/;
const artifactIdentifier = /^[A-Za-z0-9_-]{1,180}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const namespacePattern = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

/** Explicit operation budgets supplied by trusted root policy; there are no implicit scope cuts. */
export type WorkspaceBackupV2Budgets = {
  maxArchiveUtf8Bytes: number; maxEntryBytes: number; maxTotalEntryBytes: number;
  maxEntries: number; maxJsonDepth: number; maxJsonNodes: number;
};
export type WorkspaceBackupV2Source = {
  vaultId: string; workspaceId: string; revision: number; captureId: string; enumerationId: string;
};
/** Root must classify EVERY actually enumerated wider namespace, including absent/empty ones. */
export type WorkspaceBackupV2Namespace = {
  namespace: string; disposition: 'included' | 'empty' | 'transient' | 'outside-archive';
  entries: number; bytes: number; requirement: string;
};
export type WorkspaceBackupV2ExternalKeyRequirement = {
  provider: 'keychain' | 'postgres' | 'other'; namespace: string; requirement: string;
};
export type WorkspaceBackupV2ArtifactManifest = {
  id: string; purpose: PrivateArtifactPurpose; valueDigest: string; bytes: number; sha256: string;
};
export type WorkspaceBackupV2SourcePin = {
  format: typeof PIN_FORMAT; scope: typeof SCOPE; fullWorkspacePortable: false;
  source: WorkspaceBackupV2Source;
  authority: { bytes: number; sha256: string };
  artifacts: WorkspaceBackupV2ArtifactManifest[];
  namespaces: WorkspaceBackupV2Namespace[];
  externalKeyRequirements: WorkspaceBackupV2ExternalKeyRequirement[];
};
/** Only independently enumerated, authenticated root bytes belong here. No filesystem walking occurs. */
export type WorkspaceBackupV2Capture = {
  source: WorkspaceBackupV2Source; authority: Uint8Array;
  artifacts: { ref: PrivateArtifactRef; bytes: Uint8Array }[];
  namespaces: WorkspaceBackupV2Namespace[];
  externalKeyRequirements: WorkspaceBackupV2ExternalKeyRequirement[];
};
export type WorkspaceBackupV2Archive = {
  backupFormat: typeof WORKSPACE_BACKUP_V2_FORMAT; pin: WorkspaceBackupV2SourcePin;
  authorityBase64: string;
  artifacts: { id: string; purpose: PrivateArtifactPurpose; dataBase64: string }[];
  digest: string;
};

function requireValue(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new ChausarError(code, message);
}
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const id = (value: unknown): value is string => typeof value === 'string' && identifier.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && digestPattern.test(value);
function exact(value: unknown, keys: string[]): asserts value is Record<string, any> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    && Reflect.ownKeys(value).length === keys.length
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
    && Object.values(Object.getOwnPropertyDescriptors(value)).every(item => item.enumerable && 'value' in item),
  'BACKUP_SHAPE', 'The exact reviewed backup fields are required.');
}
function budgets(value: WorkspaceBackupV2Budgets) {
  exact(value, ['maxArchiveUtf8Bytes', 'maxEntryBytes', 'maxTotalEntryBytes', 'maxEntries', 'maxJsonDepth', 'maxJsonNodes']);
  requireValue(Object.values(value).every(item => count(item) && item > 0)
    && value.maxEntryBytes <= value.maxTotalEntryBytes && value.maxJsonDepth <= 256,
  'BACKUP_BUDGET_REQUIRED', 'Supply explicit positive safe operation budgets and a JSON depth of at most 256.');
}
/** Bounded deterministic OUTER JSON only. Ciphertext envelope bytes are never reserialized. */
function canonical(value: unknown, budget: WorkspaceBackupV2Budgets): string {
  let nodes = 0, bytes = 0; const parts: string[] = [];
  function append(part: string) {
    bytes += Buffer.byteLength(part, 'utf8');
    requireValue(bytes <= budget.maxArchiveUtf8Bytes, 'BACKUP_LIMIT', 'Backup JSON exceeds its explicit wire byte budget.');
    parts.push(part);
  }
  function string(item: string) {
    requireValue(Buffer.byteLength(item, 'utf8') <= budget.maxArchiveUtf8Bytes - bytes, 'BACKUP_LIMIT', 'A backup JSON string exceeds the remaining wire byte budget.');
    append(JSON.stringify(item));
  }
  function encode(item: unknown, depth: number): void {
    requireValue(++nodes <= budget.maxJsonNodes && depth <= budget.maxJsonDepth, 'BACKUP_LIMIT', 'Backup JSON exceeds its operation budget.');
    if (typeof item === 'string') { string(item); return; }
    if (item === null || typeof item === 'boolean') { append(JSON.stringify(item)); return; }
    if (typeof item === 'number') { requireValue(Number.isFinite(item), 'BACKUP_SHAPE', 'Only finite JSON numbers are allowed.'); append(JSON.stringify(item)); return; }
    requireValue(typeof item === 'object', 'BACKUP_SHAPE', 'Only lossless JSON fields are allowed.');
    if (Array.isArray(item)) {
      requireValue(item.length <= budget.maxJsonNodes - nodes, 'BACKUP_LIMIT', 'Backup array exceeds its remaining JSON node budget.');
      requireValue(Object.keys(item).length === item.length && Reflect.ownKeys(item).length === item.length + 1
        && Object.entries(Object.getOwnPropertyDescriptors(item)).every(([key, descriptor]) => key === 'length' || descriptor.enumerable && 'value' in descriptor),
      'BACKUP_SHAPE', 'Sparse, extended or accessor-backed arrays are refused.');
      append('['); item.forEach((child, index) => { if (index) append(','); encode(child, depth + 1); }); append(']'); return;
    }
    const object = item as Record<string, unknown>, keys = Reflect.ownKeys(object);
    requireValue(keys.length <= budget.maxJsonNodes - nodes, 'BACKUP_LIMIT', 'Backup object exceeds its remaining JSON node budget.');
    const fields = Object.getOwnPropertyDescriptors(object);
    requireValue((Object.getPrototypeOf(object) === Object.prototype || Object.getPrototypeOf(object) === null)
      && keys.length === Object.keys(fields).length
      && Object.values(fields).every(field => field.enumerable && 'value' in field), 'BACKUP_SHAPE', 'Accessors and hidden backup fields are refused.');
    append('{'); Object.keys(fields).sort().forEach((key, index) => { if (index) append(','); string(key); append(':'); encode(fields[key].value, depth + 1); }); append('}');
  }
  encode(value, 0); return parts.join('');
}
const equal = (left: unknown, right: unknown, budget: WorkspaceBackupV2Budgets) => canonical(left, budget) === canonical(right, budget);

/** Detect duplicates without changing persisted object insertion order or whitespace. */
function parseJson(text: string, budget: WorkspaceBackupV2Budgets): any {
  let offset = 0, nodes = 0;
  const space = () => { while (/[\x20\t\r\n]/.test(text[offset] ?? '\0')) offset++; };
  function stringToken(): string {
    const start = offset++;
    while (offset < text.length) {
      const character = text[offset++];
      if (character === '\\') offset++;
      else if (character === '"') return JSON.parse(text.slice(start, offset));
    }
    throw new Error('Unterminated JSON string');
  }
  function scan(depth: number): void {
    requireValue(++nodes <= budget.maxJsonNodes && depth <= budget.maxJsonDepth, 'BACKUP_LIMIT', 'Persisted JSON exceeds its operation budget.');
    space(); const token = text[offset];
    if (token === '{') {
      offset++; space(); const keys = new Set<string>();
      if (text[offset] === '}') { offset++; return; }
      while (true) {
        if (text[offset] !== '"') throw new Error('Invalid object key');
        const key = stringToken();
        requireValue(!keys.has(key), 'BACKUP_DUPLICATE', 'Duplicate persisted JSON fields are refused.'); keys.add(key);
        space(); if (text[offset++] !== ':') throw new Error('Invalid object'); scan(depth + 1); space();
        const separator = text[offset++]; if (separator === '}') return;
        if (separator !== ',') throw new Error('Invalid object separator'); space();
      }
    }
    if (token === '[') {
      offset++; space(); if (text[offset] === ']') { offset++; return; }
      while (true) { scan(depth + 1); space(); const separator = text[offset++]; if (separator === ']') return;
        if (separator !== ',') throw new Error('Invalid array separator'); }
    }
    if (token === '"') { stringToken(); return; }
    const primitive = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(offset));
    if (!primitive) throw new Error('Invalid JSON value'); offset += primitive[0].length;
  }
  try { scan(0); space(); if (offset !== text.length) throw new Error('Trailing JSON'); return JSON.parse(text); }
  catch (error) { if (error instanceof ChausarError) throw error; throw new ChausarError('BACKUP_JSON', 'Backup contains incomplete or invalid JSON.'); }
}
function decode64(value: unknown, maximum: number, url = false, length?: number): Buffer {
  requireValue(typeof value === 'string' && value.length <= Math.ceil(maximum / 3) * 4
    && (url ? /^[A-Za-z0-9_-]*$/ : /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/).test(value),
  'BACKUP_ENCODING', 'Encrypted entries require bounded canonical base64.');
  const bytes = Buffer.from(value, url ? 'base64url' : 'base64');
  requireValue(bytes.length <= maximum && bytes.toString(url ? 'base64url' : 'base64') === value
    && (length === undefined || bytes.length === length), 'BACKUP_ENCODING', 'Ciphertext encoding or byte count differs.');
  return bytes;
}
function ciphertext(value: unknown, budget: WorkspaceBackupV2Budgets, wrappedKey = false) {
  exact(value, ['nonce', 'tag', 'data']);
  decode64(value.nonce, 12, true, 12); decode64(value.tag, 16, true, 16);
  const bytes = decode64(value.data, budget.maxEntryBytes, true);
  requireValue(bytes.length > 0 && (!wrappedKey || bytes.length === 32), 'BACKUP_BINDING', 'Ciphertext has an invalid encrypted payload size.');
}
function persisted(bytes: Uint8Array, budget: WorkspaceBackupV2Budgets): any {
  requireValue(bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= budget.maxEntryBytes, 'BACKUP_LIMIT', 'An encrypted entry exceeds its operation budget.');
  const copy = Buffer.from(bytes), text = copy.toString('utf8');
  requireValue(Buffer.from(text, 'utf8').equals(copy), 'BACKUP_ENCODING', 'Encrypted envelope JSON must retain exact valid UTF-8 bytes.');
  return parseJson(text, budget);
}
function authority(bytes: Uint8Array, source: WorkspaceBackupV2Source, budget: WorkspaceBackupV2Budgets) {
  const envelope = persisted(bytes, budget);
  exact(envelope, ['format', 'id', 'revision', 'passphrase', 'recovery', 'snapshot']);
  requireValue(envelope.format === 'chausar.vault.v1' && envelope.id === source.vaultId && envelope.revision === source.revision,
    'BACKUP_BINDING', 'Authority envelope identity or revision differs from the independently pinned source.');
  for (const wrapper of [envelope.passphrase, envelope.recovery]) {
    exact(wrapper, ['salt', 'kdf', 'ciphertext']);
    requireValue(wrapper.kdf === 'scrypt-32768-8-1', 'BACKUP_BINDING', 'Unsupported authority key wrapper.');
    decode64(wrapper.salt, 16, true, 16); ciphertext(wrapper.ciphertext, budget, true);
  }
  ciphertext(envelope.snapshot, budget);
}
function artifact(bytes: Uint8Array, manifest: WorkspaceBackupV2ArtifactManifest, vaultId: string, budget: WorkspaceBackupV2Budgets) {
  const envelope = persisted(bytes, budget);
  exact(envelope, ['format', 'vaultId', 'id', 'purpose', 'valueDigest', 'ciphertext']);
  requireValue(envelope.format === 'chausar.private-artifact.v1' && envelope.vaultId === vaultId && envelope.id === manifest.id
    && envelope.purpose === manifest.purpose && envelope.valueDigest === manifest.valueDigest,
  'BACKUP_BINDING', 'Encrypted artifact identity, purpose, vault or value digest differs.');
  ciphertext(envelope.ciphertext, budget);
}
function source(value: unknown) {
  exact(value, ['vaultId', 'workspaceId', 'revision', 'captureId', 'enumerationId']);
  requireValue(id(value.vaultId) && id(value.workspaceId) && count(value.revision) && id(value.captureId) && id(value.enumerationId),
    'BACKUP_SOURCE_PIN', 'Use an exact independently enumerated source identity and revision.');
}
function validatePin(pin: WorkspaceBackupV2SourcePin, budget: WorkspaceBackupV2Budgets) {
  exact(pin, ['format', 'scope', 'fullWorkspacePortable', 'source', 'authority', 'artifacts', 'namespaces', 'externalKeyRequirements']);
  requireValue(pin.format === PIN_FORMAT && pin.scope === SCOPE && pin.fullWorkspacePortable === false,
    'BACKUP_SCOPE', 'This profile covers encrypted authority and all typed private artifacts with explicit wider scope requirements.');
  source(pin.source); exact(pin.authority, ['bytes', 'sha256']);
  requireValue(count(pin.authority.bytes) && pin.authority.bytes > 0 && pin.authority.bytes <= budget.maxEntryBytes && digest(pin.authority.sha256), 'BACKUP_MANIFEST', 'Authority byte and digest pins are required.');
  requireValue(Array.isArray(pin.artifacts) && pin.artifacts.length + 1 <= budget.maxEntries
    && Array.isArray(pin.namespaces) && pin.namespaces.length <= budget.maxEntries
    && Array.isArray(pin.externalKeyRequirements) && pin.externalKeyRequirements.length <= budget.maxEntries,
  'BACKUP_LIMIT', 'Backup inventories exceed their explicit operation count budget.');
  let total = pin.authority.bytes, last = ''; const identities = new Set<string>();
  for (const item of pin.artifacts) {
    exact(item, ['id', 'purpose', 'valueDigest', 'bytes', 'sha256']); const key = `${item.purpose}/${item.id}`;
    requireValue(typeof item.id === 'string' && artifactIdentifier.test(item.id) && purposes.includes(item.purpose)
      && digest(item.valueDigest) && count(item.bytes) && item.bytes > 0 && item.bytes <= budget.maxEntryBytes && digest(item.sha256)
      && key > last && !identities.has(key.toLowerCase()), 'BACKUP_MANIFEST', 'Every artifact requires a unique sorted typed identity and exact byte/digest pins without filesystem case aliases.');
    identities.add(key.toLowerCase());
    last = key; total += item.bytes;
    requireValue(Number.isSafeInteger(total) && total <= budget.maxTotalEntryBytes, 'BACKUP_LIMIT', 'Encrypted entries exceed the total operation byte budget.');
  }
  requireValue(total <= budget.maxTotalEntryBytes, 'BACKUP_LIMIT', 'Authority exceeds the total operation byte budget.');
  const included = new Map<string, { entries: number; bytes: number }>([['authority', { entries: 1, bytes: pin.authority.bytes }],
    ...purposes.map(purpose => [`private-artifacts/${purpose}`, {
      entries: pin.artifacts.filter(item => item.purpose === purpose).length,
      bytes: pin.artifacts.filter(item => item.purpose === purpose).reduce((sum, item) => sum + item.bytes, 0),
    }] as const)]);
  last = ''; const namespaceIdentities = new Set<string>();
  for (const item of pin.namespaces) {
    exact(item, ['namespace', 'disposition', 'entries', 'bytes', 'requirement']);
    requireValue(typeof item.namespace === 'string' && item.namespace.length <= 200 && namespacePattern.test(item.namespace)
      && !item.namespace.split('/').some(part => part === '.' || part === '..') && item.namespace > last && !namespaceIdentities.has(item.namespace.toLowerCase())
      && ['included', 'empty', 'transient', 'outside-archive'].includes(item.disposition)
      && count(item.entries) && count(item.bytes) && typeof item.requirement === 'string' && item.requirement.length <= 4096,
    'BACKUP_SCOPE', 'Namespaces require unique sorted reviewed dispositions and measured counts.');
    last = item.namespace; namespaceIdentities.add(item.namespace.toLowerCase());
    const measured = included.get(item.namespace);
    if (measured) {
      requireValue(item.disposition === 'included' && item.requirement === '' && equal(measured, { entries: item.entries, bytes: item.bytes }, budget),
        'BACKUP_SCOPE', 'Included namespaces must account for every exact encrypted byte, including explicitly empty private purposes.');
      included.delete(item.namespace);
    } else {
      requireValue(item.disposition !== 'included' && (item.disposition !== 'empty' || item.entries === 0 && item.bytes === 0)
        && (item.disposition === 'empty' || item.requirement.trim().length > 0), 'BACKUP_SCOPE', 'Wider actual namespaces need an explicit empty, transient or outside-archive requirement.');
    }
  }
  requireValue(included.size === 0, 'BACKUP_SCOPE', 'Authority and both complete private namespaces must be explicitly enumerated.');
  last = ''; const keyIdentities = new Set<string>();
  for (const item of pin.externalKeyRequirements) {
    exact(item, ['provider', 'namespace', 'requirement']); const key = `${item.provider}/${item.namespace}`;
    requireValue(['keychain', 'postgres', 'other'].includes(item.provider) && typeof item.namespace === 'string'
      && item.namespace.length <= 200 && namespacePattern.test(item.namespace) && !item.namespace.split('/').some(part => part === '.' || part === '..')
      && key > last && !keyIdentities.has(key.toLowerCase())
      && typeof item.requirement === 'string' && item.requirement.trim().length > 0 && item.requirement.length <= 4096,
    'BACKUP_SCOPE', 'External key and adapter custody requirements must be explicitly classified without secrets.'); last = key; keyIdentities.add(key.toLowerCase());
  }
}

export function captureWorkspaceBackupV2(input: WorkspaceBackupV2Capture, budget: WorkspaceBackupV2Budgets): WorkspaceBackupV2Archive {
  budgets(budget); exact(input, ['source', 'authority', 'artifacts', 'namespaces', 'externalKeyRequirements']);
  source(input.source);
  requireValue(input.authority instanceof Uint8Array && Array.isArray(input.artifacts)
    && Array.isArray(input.namespaces) && Array.isArray(input.externalKeyRequirements)
    && input.artifacts.length + 1 <= budget.maxEntries && input.namespaces.length <= budget.maxEntries
    && input.externalKeyRequirements.length <= budget.maxEntries, 'BACKUP_LIMIT', 'Capture requires exact encrypted bytes and explicit bounded inventories.');
  requireValue(input.authority.byteLength > 0 && input.authority.byteLength <= budget.maxEntryBytes
    && input.authority.byteLength <= budget.maxTotalEntryBytes, 'BACKUP_LIMIT', 'Authority capture exceeds its encrypted byte budget.');
  let total = input.authority.byteLength;
  for (const item of input.artifacts) {
    exact(item, ['ref', 'bytes']); exact(item.ref, ['id', 'purpose', 'valueDigest', 'diskBytes']);
    requireValue(item.bytes instanceof Uint8Array && item.bytes.byteLength > 0 && item.bytes.byteLength <= budget.maxEntryBytes,
      'BACKUP_LIMIT', 'An encrypted artifact exceeds its byte budget before processing.');
    total += item.bytes.byteLength;
    requireValue(Number.isSafeInteger(total) && total <= budget.maxTotalEntryBytes, 'BACKUP_LIMIT', 'Encrypted capture exceeds its aggregate byte budget before processing.');
  }
  const manifests = input.artifacts.map(item => {
    exact(item, ['ref', 'bytes']); exact(item.ref, ['id', 'purpose', 'valueDigest', 'diskBytes']);
    requireValue(item.bytes instanceof Uint8Array && item.bytes.byteLength === item.ref.diskBytes, 'BACKUP_MANIFEST', 'Independently measured encrypted artifact byte counts differ.');
    return { id: item.ref.id, purpose: item.ref.purpose, valueDigest: item.ref.valueDigest, bytes: item.bytes.byteLength, sha256: sha(item.bytes) };
  });
  // Use lexical byte ordering, independent of locale collation.
  manifests.sort((left, right) => `${left.purpose}/${left.id}` < `${right.purpose}/${right.id}` ? -1 : 1);
  const pin: WorkspaceBackupV2SourcePin = { format: PIN_FORMAT, scope: SCOPE, fullWorkspacePortable: false,
    source: structuredClone(input.source), authority: { bytes: input.authority.byteLength, sha256: sha(input.authority) }, artifacts: manifests,
    namespaces: structuredClone(input.namespaces).sort((left, right) => left.namespace < right.namespace ? -1 : 1),
    externalKeyRequirements: structuredClone(input.externalKeyRequirements).sort((left, right) => `${left.provider}/${left.namespace}` < `${right.provider}/${right.namespace}` ? -1 : 1) };
  validatePin(pin, budget); authority(input.authority, pin.source, budget);
  const bodies = manifests.map(manifest => {
    const item = input.artifacts.find(candidate => candidate.ref.id === manifest.id && candidate.ref.purpose === manifest.purpose)!;
    artifact(item.bytes, manifest, pin.source.vaultId, budget);
    return { id: manifest.id, purpose: manifest.purpose, dataBase64: Buffer.from(item.bytes).toString('base64') };
  });
  const body = { backupFormat: WORKSPACE_BACKUP_V2_FORMAT, pin, authorityBase64: Buffer.from(input.authority).toString('base64'), artifacts: bodies };
  const archive = { ...body, digest: sha(canonical(body, budget)) };
  encodeWorkspaceBackupV2(archive, budget); return archive;
}
/** Structural/hash inspection cannot authenticate ciphertext or confer workspace authority. */
export function inspectWorkspaceBackupV2(text: string, budget: WorkspaceBackupV2Budgets): WorkspaceBackupV2Archive {
  budgets(budget);
  requireValue(typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= budget.maxArchiveUtf8Bytes, 'BACKUP_LIMIT', 'Archive exceeds its explicit wire byte budget.');
  const value = parseJson(text, budget);
  exact(value, ['backupFormat', 'pin', 'authorityBase64', 'artifacts', 'digest']);
  requireValue(value.backupFormat === WORKSPACE_BACKUP_V2_FORMAT && digest(value.digest), 'BACKUP_FORMAT', 'Unsupported complete archive format or digest.');
  validatePin(value.pin, budget);
  requireValue(Array.isArray(value.artifacts) && value.artifacts.length === value.pin.artifacts.length, 'BACKUP_MANIFEST', 'All pinned encrypted entries must appear exactly once.');
  const authorityBytes = decode64(value.authorityBase64, budget.maxEntryBytes);
  requireValue(authorityBytes.length === value.pin.authority.bytes && sha(authorityBytes) === value.pin.authority.sha256, 'BACKUP_DIGEST', 'Authority bytes differ from the exact pinned envelope.');
  authority(authorityBytes, value.pin.source, budget);
  for (let index = 0; index < value.artifacts.length; index++) {
    const entry = value.artifacts[index], manifest = value.pin.artifacts[index]; exact(entry, ['id', 'purpose', 'dataBase64']);
    requireValue(entry.id === manifest.id && entry.purpose === manifest.purpose, 'BACKUP_MANIFEST', 'Encrypted entries differ from their unique sorted pinned identities.');
    const bytes = decode64(entry.dataBase64, budget.maxEntryBytes);
    requireValue(bytes.length === manifest.bytes && sha(bytes) === manifest.sha256, 'BACKUP_DIGEST', 'Encrypted artifact bytes differ from their independent pin.');
    artifact(bytes, manifest, value.pin.source.vaultId, budget);
  }
  const { digest: declared, ...body } = value;
  requireValue(sha(canonical(body, budget)) === declared, 'BACKUP_DIGEST', 'Archive manifest or ciphertext content changed.');
  requireValue(canonical(value, budget) === text, 'BACKUP_CANONICAL', 'Outer archive JSON must use the exact deterministic wire representation.');
  return value as WorkspaceBackupV2Archive;
}
export function encodeWorkspaceBackupV2(value: WorkspaceBackupV2Archive, budget: WorkspaceBackupV2Budgets): string {
  budgets(budget); const text = canonical(value, budget); inspectWorkspaceBackupV2(text, budget); return text;
}
export function validateWorkspaceBackupV2(text: string, expected: WorkspaceBackupV2SourcePin, budget: WorkspaceBackupV2Budgets): WorkspaceBackupV2Archive {
  const archive = inspectWorkspaceBackupV2(text, budget); validatePin(expected, budget);
  requireValue(equal(archive.pin, expected, budget), 'BACKUP_SOURCE_CHANGED', 'The archive differs from the independently authenticated complete source pin.');
  return archive;
}
/** Exact original bytes. Reconstructing or sorting the parsed authority envelope breaks v1 wrapper AAD. */
export function workspaceBackupV2Bytes(archive: WorkspaceBackupV2Archive, budget: WorkspaceBackupV2Budgets): WorkspaceBackupV2Capture {
  const checked = inspectWorkspaceBackupV2(encodeWorkspaceBackupV2(archive, budget), budget);
  return { source: structuredClone(checked.pin.source), authority: Buffer.from(checked.authorityBase64, 'base64'),
    artifacts: checked.artifacts.map((entry, index) => ({ ref: { id: entry.id, purpose: entry.purpose,
      valueDigest: checked.pin.artifacts[index].valueDigest, diskBytes: checked.pin.artifacts[index].bytes }, bytes: Buffer.from(entry.dataBase64, 'base64') })),
    namespaces: structuredClone(checked.pin.namespaces), externalKeyRequirements: structuredClone(checked.pin.externalKeyRequirements) };
}

export type WorkspaceBackupV2CustodyPin = {
  format: 'chausar.backup-custody-pin.v2'; recordId: string; creationId: string; contextDigest: string;
  archiveDigest: string; sourcePin: WorkspaceBackupV2SourcePin;
};
export type WorkspaceBackupV2CustodyRecord = { content: string; pin: WorkspaceBackupV2CustodyPin };
export type WorkspaceBackupV2Measurement = {
  encrypted: true; archiveCiphertextBytes: number; pinCiphertextBytes: number;
  qualification: 'test-fixture' | 'encrypted-local-host';
};
export type WorkspaceBackupV2SourceLease = {
  independentlyEnumerated: true; state: State; capture: WorkspaceBackupV2Capture;
  assertCurrent(): Promise<void>;
  assertCompleteOwner(context: Context, historicalState: State): Promise<void>;
  /** Authenticate authority workspace/revision AND every artifact, with no raw-key export. */
  authenticateCapture(capture: WorkspaceBackupV2Capture): Promise<void>;
};
export type WorkspaceBackupV2EmptyTarget = {
  targetId: string; locationId: string; generation: string; ready: true;
  authorityRecords: 0; artifactRecords: 0; unexpectedEntries: string[];
};
export type WorkspaceBackupV2TargetLease = {
  inspection: WorkspaceBackupV2EmptyTarget;
  /** Assert exclusive physical identity/ownership. Remains meaningful AFTER inert commit. */
  assertCurrent(): Promise<void>;
  /** Re-enumerate actual empty authority, private namespaces and wider target entries. */
  assertEmpty(): Promise<void>;
};
export type WorkspaceBackupV2RestoreReceipt = {
  targetId: string; creationId: string; archiveDigest: string; sourcePin: WorkspaceBackupV2SourcePin;
  entries: number; bytes: number; inert: true; activation: 'root-only';
};
/**
 * Root constructor capabilities only; never accept these through IPC or caller payloads.
 * create/read authenticate the archive AND separate encrypted source/record pin.
 * create and restoreAtomic are no-overwrite all-or-nothing operations. Rejected operations
 * leave no partial record/target. restoreAtomic stages, authenticates, reads back every
 * exact byte, then calls assertEmptyCurrent immediately before atomic publication.
 * It retains ciphertext as INERT evidence; publishing runnable authority is a separate
 * root admission operation that this host neither implements nor authorizes.
 * withTarget/restoreAtomic must also hold current owner/epoch admission through the
 * actual publication. After lease exit, remove/rollback reacquire exclusion and
 * compare exact creation/digests plus inert/not-admitted state before deletion.
 */
export type WorkspaceBackupV2HostPorts = {
  withSource<T>(context: Context, expected: WorkspaceBackupV2SourcePin | null, work: (lease: WorkspaceBackupV2SourceLease) => Promise<T>): Promise<T>;
  withTarget<T>(context: Context, input: { targetId: string }, work: (lease: WorkspaceBackupV2TargetLease) => Promise<T>): Promise<T>;
  authenticateArchive(context: Context, archive: WorkspaceBackupV2Archive): Promise<void>;
  assertRestoreOwner(context: Context, source: WorkspaceBackupV2Source): Promise<void>;
  custody: {
    create(context: Context, record: WorkspaceBackupV2CustodyRecord, assertCurrent: () => Promise<void>): Promise<WorkspaceBackupV2Measurement>;
    read(context: Context, recordId: string): Promise<WorkspaceBackupV2CustodyRecord & { measurement: WorkspaceBackupV2Measurement }>;
    remove(context: Context, input: { recordId: string; creationId: string; expectedArchiveDigest: string; expectedPinDigest: string }): Promise<void>;
  };
  restore: {
    restoreAtomic(context: Context, input: { creationId: string; target: WorkspaceBackupV2EmptyTarget; archive: WorkspaceBackupV2Archive }, assertEmptyCurrent: () => Promise<void>): Promise<WorkspaceBackupV2RestoreReceipt>;
    readRestored(context: Context, input: { targetId: string; creationId: string }): Promise<{ content: string; receipt: WorkspaceBackupV2RestoreReceipt }>;
    rollback(context: Context, input: { targetId: string; creationId: string; expectedArchiveDigest: string }): Promise<void>;
  };
};
export type WorkspaceBackupV2Summary = {
  recordId: string; archiveDigest: string; source: WorkspaceBackupV2Source; entries: number; encryptedEntryBytes: number;
  scope: typeof SCOPE; fullWorkspacePortable: false; inert: true; activation: 'root-only';
  namespaces: WorkspaceBackupV2Namespace[]; externalKeyRequirements: WorkspaceBackupV2ExternalKeyRequirement[];
  measurement: WorkspaceBackupV2Measurement;
};
async function completed(work: () => Promise<void>) {
  const result: unknown = await work();
  requireValue(result === undefined, 'BACKUP_HOST_GUARD', 'Trusted backup guards must complete without deferred admission values.');
}
function owner(context: Context, state: State) {
  requireValue(context.channel === 'desktop' && !context.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Complete encrypted backup requires the untainted desktop owner.');
  const member = authorize({ read: () => state, update: async () => { throw new Error('Read-only backup capture.'); } }, context, 'admin');
  requireValue(member.role === 'owner' && member.branches.includes('*'), 'FORBIDDEN', 'The unrestricted current owner must approve complete encrypted custody.');
}

/** Fenced orchestration with no filesystem paths, activation, scheduler, plugin or provider capability. */
export class WorkspaceBackupV2Host {
  readonly #ports: WorkspaceBackupV2HostPorts;
  readonly #budget: WorkspaceBackupV2Budgets;
  constructor(ports: WorkspaceBackupV2HostPorts, budget: WorkspaceBackupV2Budgets) {
    budgets(budget);
    requireValue(ports && typeof ports.withSource === 'function' && typeof ports.withTarget === 'function'
      && typeof ports.authenticateArchive === 'function' && typeof ports.assertRestoreOwner === 'function'
      && typeof ports.custody?.create === 'function' && typeof ports.custody?.read === 'function' && typeof ports.custody?.remove === 'function'
      && typeof ports.restore?.restoreAtomic === 'function' && typeof ports.restore?.readRestored === 'function' && typeof ports.restore?.rollback === 'function',
    'BACKUP_HOST_REQUIRED', 'Trusted fenced authentication, atomic custody and inert restore ports are required.');
    this.#ports = ports; this.#budget = structuredClone(budget);
  }
  #measurement(value: WorkspaceBackupV2Measurement) {
    exact(value, ['encrypted', 'archiveCiphertextBytes', 'pinCiphertextBytes', 'qualification']);
    requireValue(value.encrypted === true && count(value.archiveCiphertextBytes) && value.archiveCiphertextBytes > 0
      && count(value.pinCiphertextBytes) && value.pinCiphertextBytes > 0 && ['test-fixture', 'encrypted-local-host'].includes(value.qualification),
    'BACKUP_HOST_CUSTODY', 'Archive and independent pin require measured encrypted custody.');
  }
  async #read(context: Context, recordId: string) {
    const retained = await this.#ports.custody.read(structuredClone(context), recordId);
    exact(retained, ['content', 'pin', 'measurement']); this.#measurement(retained.measurement);
    exact(retained.pin, ['format', 'recordId', 'creationId', 'contextDigest', 'archiveDigest', 'sourcePin']);
    requireValue(retained.pin.format === 'chausar.backup-custody-pin.v2' && retained.pin.recordId === recordId && id(recordId)
      && id(retained.pin.creationId) && retained.pin.contextDigest === sha(canonical(context, this.#budget)) && digest(retained.pin.archiveDigest),
    'BACKUP_HOST_CUSTODY', 'Authenticated backup issuance belongs to another identity, context or record.');
    const archive = validateWorkspaceBackupV2(retained.content, retained.pin.sourcePin, this.#budget);
    requireValue(archive.digest === retained.pin.archiveDigest, 'BACKUP_HOST_CUSTODY', 'Archive differs from its separate authenticated custody pin.');
    return { retained: structuredClone(retained), archive };
  }
  #summary(recordId: string, archive: WorkspaceBackupV2Archive, measurement: WorkspaceBackupV2Measurement): WorkspaceBackupV2Summary {
    return { recordId, archiveDigest: archive.digest, source: structuredClone(archive.pin.source), entries: archive.pin.artifacts.length + 1,
      encryptedEntryBytes: archive.pin.authority.bytes + archive.pin.artifacts.reduce((sum, item) => sum + item.bytes, 0),
      scope: SCOPE, fullWorkspacePortable: false, inert: true, activation: 'root-only', namespaces: structuredClone(archive.pin.namespaces),
      externalKeyRequirements: structuredClone(archive.pin.externalKeyRequirements), measurement: structuredClone(measurement) };
  }
  async create(contextInput: Context, input: { destinationId: string; confirmed: true }): Promise<WorkspaceBackupV2Summary> {
    exact(input, ['destinationId', 'confirmed']); const payload = structuredClone(input), context = structuredClone(contextInput);
    requireValue(id(payload.destinationId) && payload.confirmed === true, 'CONFIRMATION_REQUIRED', 'Confirm one explicit managed encrypted backup destination.');
    let calls = 0, created: WorkspaceBackupV2CustodyRecord | undefined;
    try {
      const result = await this.#ports.withSource(structuredClone(context), null, async lease => {
        requireValue(++calls === 1 && lease?.independentlyEnumerated === true && typeof lease.assertCurrent === 'function'
          && typeof lease.assertCompleteOwner === 'function' && typeof lease.authenticateCapture === 'function',
        'BACKUP_HOST_CUSTODY', 'Root must execute exactly one independently enumerated source lease.');
        const state = structuredClone(lease.state), capture = structuredClone(lease.capture); owner(context, state);
        requireValue(capture.source.workspaceId === state.workspace.id && capture.source.revision === state.revision,
          'BACKUP_BINDING', 'Actual source capture and current workspace authority differ.');
        const assertCurrent = async () => { await completed(() => lease.assertCompleteOwner(structuredClone(context), structuredClone(state))); await completed(() => lease.assertCurrent()); };
        await assertCurrent(); await completed(() => lease.authenticateCapture(structuredClone(capture))); await assertCurrent();
        const archive = captureWorkspaceBackupV2(capture, this.#budget);
        const record: WorkspaceBackupV2CustodyRecord = { content: encodeWorkspaceBackupV2(archive, this.#budget),
          pin: { format: 'chausar.backup-custody-pin.v2', recordId: payload.destinationId, creationId: `backup_${randomUUID()}`,
            contextDigest: sha(canonical(context, this.#budget)), archiveDigest: archive.digest, sourcePin: structuredClone(archive.pin) } };
        await assertCurrent(); let publicationChecks = 0;
        const measured = await this.#ports.custody.create(structuredClone(context), structuredClone(record), async () => { await assertCurrent(); publicationChecks++; }); created = record;
        requireValue(publicationChecks > 0, 'BACKUP_HOST_GUARD', 'Atomic custody must check the actual source fence immediately before publication.');
        this.#measurement(measured); await assertCurrent(); const readback = await this.#read(context, payload.destinationId);
        requireValue(equal(readback.retained, { ...record, measurement: measured }, this.#budget), 'BACKUP_HOST_CUSTODY', 'Atomic encrypted custody readback differs from exact archive and pin.');
        await assertCurrent(); return this.#summary(payload.destinationId, archive, measured);
      });
      requireValue(calls === 1, 'BACKUP_HOST_CUSTODY', 'Root did not execute the source transaction.'); return result;
    } catch (error) {
      if (created) {
        const record = created;
        try { await completed(() => this.#ports.custody.remove(structuredClone(context), { recordId: record.pin.recordId,
          creationId: record.pin.creationId, expectedArchiveDigest: record.pin.archiveDigest, expectedPinDigest: sha(canonical(record.pin, this.#budget)) })); }
        catch { throw new ChausarError('BACKUP_CLEANUP_REQUIRED', 'Failed backup custody requires exact root cleanup before any adoption or activation.'); }
      }
      throw error;
    }
  }
  async restoreInert(contextInput: Context, input: { backupId: string; targetId: string; reviewedDigest: string }): Promise<WorkspaceBackupV2RestoreReceipt> {
    exact(input, ['backupId', 'targetId', 'reviewedDigest']); const payload = structuredClone(input), context = structuredClone(contextInput);
    requireValue(id(payload.backupId) && id(payload.targetId) && digest(payload.reviewedDigest), 'BACKUP_REVIEW_REQUIRED', 'Review one exact managed encrypted backup and empty target.');
    requireValue(context.channel === 'desktop' && context.role === 'owner' && !context.sourceTainted, 'APP_APPROVAL_REQUIRED', 'The current untainted desktop owner must approve inert restore.');
    const initial = await this.#read(context, payload.backupId), archive = initial.archive;
    requireValue(archive.digest === payload.reviewedDigest, 'BACKUP_REVIEW_CHANGED', 'The reviewed archive digest changed.');
    const assertArchiveCurrent = async () => {
      await completed(() => this.#ports.assertRestoreOwner(structuredClone(context), structuredClone(archive.pin.source)));
      const current = await this.#read(context, payload.backupId);
      requireValue(equal(current.retained, initial.retained, this.#budget), 'BACKUP_SOURCE_CHANGED', 'Authenticated retained backup issuance changed or was revoked.');
      await completed(() => this.#ports.assertRestoreOwner(structuredClone(context), structuredClone(archive.pin.source)));
    };
    await assertArchiveCurrent(); await completed(() => this.#ports.authenticateArchive(structuredClone(context), structuredClone(archive))); await assertArchiveCurrent();
    const creationId = `restore_${randomUUID()}`; let calls = 0, committed = false;
    try {
      const result = await this.#ports.withTarget(structuredClone(context), { targetId: payload.targetId }, async lease => {
        requireValue(++calls === 1 && lease && typeof lease.assertCurrent === 'function' && typeof lease.assertEmpty === 'function', 'BACKUP_HOST_CUSTODY', 'Root must execute exactly one actual exclusive target lease.');
        const target = structuredClone(lease.inspection); exact(target, ['targetId', 'locationId', 'generation', 'ready', 'authorityRecords', 'artifactRecords', 'unexpectedEntries']);
        requireValue(target.targetId === payload.targetId && id(target.locationId) && id(target.generation) && target.ready === true
          && target.authorityRecords === 0 && target.artifactRecords === 0 && Array.isArray(target.unexpectedEntries) && target.unexpectedEntries.length === 0,
        'BACKUP_TARGET_NOT_EMPTY', 'Restore requires a physically inspected empty managed target without unclassified entries.');
        const assertCurrent = async () => { await assertArchiveCurrent(); await completed(() => lease.assertCurrent()); };
        const assertEmptyCurrent = async () => { await assertCurrent(); await completed(() => lease.assertEmpty()); };
        await assertEmptyCurrent();
        let publicationChecks = 0;
        const receipt = await this.#ports.restore.restoreAtomic(structuredClone(context), { creationId, target, archive: structuredClone(archive) }, async () => { await assertEmptyCurrent(); publicationChecks++; }); committed = true;
        requireValue(publicationChecks > 0, 'BACKUP_HOST_GUARD', 'Atomic inert restore must check actual empty-target and custody fences immediately before publication.');
        const expected: WorkspaceBackupV2RestoreReceipt = { targetId: payload.targetId, creationId, archiveDigest: archive.digest,
          sourcePin: structuredClone(archive.pin), entries: archive.pin.artifacts.length + 1,
          bytes: archive.pin.authority.bytes + archive.pin.artifacts.reduce((sum, item) => sum + item.bytes, 0), inert: true, activation: 'root-only' };
        requireValue(equal(receipt, expected, this.#budget), 'BACKUP_PARTIAL_RESTORE', 'Inert restore did not publish the exact complete encrypted archive.');
        await assertCurrent(); const readback = await this.#ports.restore.readRestored(structuredClone(context), { targetId: payload.targetId, creationId });
        exact(readback, ['content', 'receipt']); const checked = validateWorkspaceBackupV2(readback.content, archive.pin, this.#budget);
        requireValue(checked.digest === archive.digest && readback.content === initial.retained.content && equal(readback.receipt, expected, this.#budget),
          'BACKUP_PARTIAL_RESTORE', 'Inert restored target readback differs from exact original archive and complete receipt.');
        await assertCurrent(); return structuredClone(expected);
      });
      requireValue(calls === 1, 'BACKUP_HOST_CUSTODY', 'Root did not execute the target transaction.'); return result;
    } catch (error) {
      if (committed) {
        try { await completed(() => this.#ports.restore.rollback(structuredClone(context), { targetId: payload.targetId, creationId, expectedArchiveDigest: archive.digest })); }
        catch { throw new ChausarError('BACKUP_RESTORE_CLEANUP_REQUIRED', 'Failed inert restore requires exact root cleanup; it must not be activated or adopted.'); }
      }
      throw error;
    }
  }
}

export function createWorkspaceBackupV2Host(ports: WorkspaceBackupV2HostPorts, budget: WorkspaceBackupV2Budgets): WorkspaceBackupV2Host {
  return new WorkspaceBackupV2Host(ports, budget);
}
