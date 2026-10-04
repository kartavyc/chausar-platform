import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rmdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { authorize, check, ChausarError, hash, type Context, type State } from './contracts.ts';
import { acquireProcessLock } from './process-lock.ts';
import { assertSourceAccess } from './trust.ts';
import { safeDirectory, Vault, type PrivateArtifactRef } from './vault.ts';
import { WorkspacePostgresCustody } from './workspace-postgres-custody.ts';
import { captureWorkspaceInterchange, interchangeDigest, workspaceStateProfile } from './workspace-interchange.ts';
import type { ArtifactCapture, EmptyTargetInspection, Generation, RetainedArtifact, WorkspaceInventory } from './workspace-interchange-contracts.ts';
import type {
  WorkspaceInterchangeHostPorts, WorkspaceInterchangeCustodyRecord, WorkspaceInterchangeCustodyMeasurement,
  WorkspaceInterchangeSourceLease, WorkspaceInterchangeTargetLease,
} from './workspace-interchange-host.ts';

const MAX_FILES = 4096, MAX_BYTES = 64 * 1024 * 1024;
const plainId = /^[A-Za-z0-9_-]{1,100}$/, slotId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const CONTROL = '.workspace-interchange-control';
const businessDirectories: Record<string, string> = {
  reports: 'report-files', 'plugin-assets': 'plugin-assets', 'research-evidence': 'research-evidence',
  'conversation-files': 'conversation-files', 'sync-evidence': 'sync-evidence',
};
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const same = (a: unknown, b: unknown) => interchangeDigest(a) === interchangeDigest(b);
const controlId = (recordId: string, part: 'archive' | 'pin' | 'commit') => `wic_${sha(recordId)}_${part}`;
const reservationId = (targetId: string) => `wit_${sha(targetId)}_reservation`;
const refIdentity = (ref: PrivateArtifactRef) => ({ id: ref.id, purpose: ref.purpose, valueDigest: ref.valueDigest, diskBytes: ref.diskBytes });

type PhysicalIdentity = { dev: string; ino: string; birthtimeNs: string };
type FileWitness = PhysicalIdentity & { name: string; size: number; mtimeNs: string; ctimeNs: string; sha256: string };
type RetainedFile = { witness: FileWitness; bytes: Buffer; category: string; mediaType: string };
type Reservation = {
  format: 'chausar.interchange-target-reservation.v1'; sourceVaultId: string; sourceWorkspaceId: string;
  targetId: string; workspaceId: string; generation: string; contextDigest: string; physical: PhysicalIdentity;
};
type Binding = {
  format: 'chausar.interchange-local-binding.v1'; recordId: string; instance: string; contextDigest: string;
  pinDigest: string; contentDigest: string; archive: PrivateArtifactRef; pin: PrivateArtifactRef;
  state: 'committed' | 'discarded';
};
type SourceFence = { context: Context; inventory: WorkspaceInventory };
type TargetFence = { context: Context; inspection: EmptyTargetInspection };

export type WorkspaceInterchangeLocalDiagnostics = {
  sourceScope: 'desktop-business-payload-with-control-exclusions';
  fullWorkspacePortabilityQualified: false;
  namespaceDispositions: { namespace: string; disposition: string }[];
  externalKeyCustodyDependencies: string[];
  files: { logicalId: string; category: string; bytes: number; sha256: string }[];
  controlArtifactsExcluded: number;
  measuredCaptureMs: number;
};
/** Constructor-only accounting by the existing control custodian. Inspection runs
 * inside interchange's source snapshot; it must not enqueue another Vault snapshot. */
export type WorkspaceInterchangeLocalControlInventory = {
  artifacts: { ref: PrivateArtifactRef; sha256: string }[];
  namespaceDigest: string;
};
export interface WorkspaceInterchangeLocalControlCustody {
  inspectInterchangeControls(context: Context, source: { vault: Vault; applicationDirectory: string },
    inventory: readonly PrivateArtifactRef[]): Promise<WorkspaceInterchangeLocalControlInventory>;
}
export type WorkspaceInterchangeLocalOptions = {
  vault: Vault;
  /** A trusted root-owned application folder, never an IPC-selected arbitrary path. */
  applicationDirectory: string;
  /** Root must check CURRENT owner, all row/source permissions and managed consumer readiness. */
  assertCompleteOwner(context: Context, historicalState: State): Promise<void>;
  qualification?: WorkspaceInterchangeCustodyMeasurement['qualification'];
  /** Trusted same-source backup owner; never an IPC capability or filename allowlist. */
  backupControlCustody?: WorkspaceInterchangeLocalControlCustody;
};
export type WorkspaceInterchangeLocalMeasurement = {
  recordId: string; state: 'committed' | 'discarded'; archiveCiphertextBytes: number; inventoryPinCiphertextBytes: number;
  bindingCiphertextBytes: number; totalRetainedCiphertextBytes: number; removedCiphertextBytes: number;
  measuredMs: number; operation: 'create' | 'read' | 'discard';
};

function physical(stat: { dev: bigint; ino: bigint; birthtimeNs: bigint }): PhysicalIdentity {
  return { dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) };
}
async function directoryIfPresent(path: string): Promise<string | null> {
  try { return await safeDirectory(path); }
  catch (error: any) { if (error.code === 'ENOENT') return null; throw error; }
}
async function readRegular(path: string, name: string, category: string, mediaType: string, maximumBytes = MAX_BYTES): Promise<RetainedFile> {
  await safeDirectory(dirname(path));
  const before = await lstat(path, { bigint: true });
  check(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n, 'INTERCHANGE_UNSAFE_FILE', 'Retained files must be regular managed files without links.');
  check(before.size <= BigInt(maximumBytes), 'INTERCHANGE_LIMIT', 'A retained file exceeds the remaining bounded archive budget.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await file.stat({ bigint: true });
    check(same(physical(opened), physical(before)) && opened.size === before.size, 'INTERCHANGE_FILE_CHANGED', 'Retained file identity changed before capture.');
    const chunks: Buffer[] = []; let bytes = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, maximumBytes + 1 - bytes));
      const result = await file.read(buffer, 0, buffer.length, null);
      if (result.bytesRead === 0) break;
      bytes += result.bytesRead;
      check(bytes <= maximumBytes, 'INTERCHANGE_LIMIT', 'A retained file grew beyond the remaining archive budget.');
      chunks.push(buffer.subarray(0, result.bytesRead));
    }
    const after = await file.stat({ bigint: true }), current = await lstat(path, { bigint: true });
    check(current.isFile() && !current.isSymbolicLink() && current.nlink === 1n
      && same(physical(current), physical(before)) && same(physical(after), physical(before))
      && after.size === before.size && current.size === before.size && bytes === Number(before.size)
      && after.mtimeNs === before.mtimeNs && after.ctimeNs === before.ctimeNs
      && current.mtimeNs === before.mtimeNs && current.ctimeNs === before.ctimeNs,
    'INTERCHANGE_FILE_CHANGED', 'Retained file changed during capture.');
    const content = Buffer.concat(chunks);
    return { bytes: content, category, mediaType, witness: { ...physical(before), name, size: bytes,
      mtimeNs: String(before.mtimeNs), ctimeNs: String(before.ctimeNs), sha256: sha(content) } };
  } finally { await file.close(); }
}
function artifact(id: string, category: string, mediaType: string, bytes: Uint8Array, generation: Generation): RetainedArtifact {
  return { id, category, mediaType, bytes, generation: structuredClone(generation) };
}

/** Actual local custody ports. They cannot activate a historical State or acquire external data. */
export class WorkspaceInterchangeLocalCustody {
  readonly ports: WorkspaceInterchangeHostPorts;
  readonly #options: WorkspaceInterchangeLocalOptions;
  readonly #sourceScope = new AsyncLocalStorage<SourceFence>();
  readonly #targetScope = new AsyncLocalStorage<TargetFence>();
  #postgresSource: WorkspacePostgresCustody | undefined;
  #diagnostics: WorkspaceInterchangeLocalDiagnostics | null = null;
  #measurements = new Map<string, WorkspaceInterchangeLocalMeasurement>();

  constructor(options: WorkspaceInterchangeLocalOptions) {
    check(options?.vault instanceof Vault && typeof options.assertCompleteOwner === 'function'
      && typeof options.applicationDirectory === 'string' && isAbsolute(options.applicationDirectory),
    'INTERCHANGE_HOST_REQUIRED', 'Supply an open Vault, explicit root-owned application directory and current complete-owner guard.');
    const applicationDirectory = resolve(options.applicationDirectory);
    const child = relative(applicationDirectory, options.vault.directory);
    check(child !== '' && !isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`)
      && !child.includes(sep), 'INTERCHANGE_SOURCE_SCOPE', 'The Vault must be one direct managed workspace below the application directory.');
    check(options.qualification === undefined || ['test-fixture', 'encrypted-local-host'].includes(options.qualification),
      'INTERCHANGE_HOST_REQUIRED', 'Use the explicit local or test-fixture custody classification.');
    check(options.backupControlCustody === undefined || typeof options.backupControlCustody.inspectInterchangeControls === 'function',
      'INTERCHANGE_HOST_REQUIRED', 'Backup control accounting requires its trusted typed custody owner.');
    this.#options = { ...options, applicationDirectory };
    this.ports = {
      withSource: (context, expected, work) => this.#withSource(context, expected, work),
      withTarget: (context, input, work) => this.#withTarget(context, input, work),
      custody: {
        create: (context, record) => this.#create(context, record),
        read: (context, recordId) => this.#read(context, recordId),
        remove: (context, input) => this.#remove(context, input),
      },
    };
  }
  diagnostics(): WorkspaceInterchangeLocalDiagnostics | null { return structuredClone(this.#diagnostics); }
  /** Constructor-only native composition. The authority queue precedes native
   * exclusion, which covers initial capture, publication and final local guards. */
  installPostgresSourceCustody(source: WorkspacePostgresCustody): void {
    check(!this.#postgresSource && this.#options.vault.storageKind === 'postgres' && source instanceof WorkspacePostgresCustody,
      'POSTGRES_WORKSPACE_ROOT_REQUIRED', 'Install one actual native source custody on the PostgreSQL interchange host.');
    this.#postgresSource = source;
  }
  /** Measured ciphertext footprint, including the binding omitted by the generic host's archive/pin summary. */
  custodyMeasurement(recordId: string): WorkspaceInterchangeLocalMeasurement | null {
    return structuredClone(this.#measurements.get(recordId) ?? null);
  }
  /** Root-only location. Reservation/activation checks must still hold the target lease. */
  targetPath(targetId: string): string {
    check(typeof targetId === 'string' && slotId.test(targetId) && !Object.hasOwn(businessDirectories, targetId)
      && !['backups', 'exports', 'updates', 'private-artifacts'].includes(targetId), 'INTERCHANGE_TARGET_PROOF', 'Use one short distinct managed workspace slot.');
    const target = join(this.#options.applicationDirectory, targetId);
    check(resolve(target) !== resolve(this.#options.vault.directory), 'INTERCHANGE_TARGET_IDENTITY', 'The target cannot be the source workspace directory.');
    return target;
  }
  async #guard(context: Context, historical: State) {
    const current = this.#options.vault.read();
    check(context.channel === 'desktop' && !context.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Complete portability requires the untainted desktop owner.');
    const member = authorize({ read: () => current, update: async () => { throw new Error('Read-only custody.'); } }, context, 'admin');
    check(member.role === 'owner' && member.branches.includes('*'), 'FORBIDDEN', 'Complete portability requires the unrestricted current owner.');
    assertSourceAccess(current, context, [...new Set([...historical.facts.map(fact => fact.sourceId),
      ...historical.imports.map(item => item.sourceId).filter((id): id is string => typeof id === 'string')])]);
    const result: unknown = await this.#options.assertCompleteOwner(structuredClone(context), structuredClone(historical));
    check(result === undefined, 'INTERCHANGE_HOST_GUARD', 'The current complete-owner guard must finish without a deferred admission value.');
  }
  async #controlDirectory(section: 'records' | 'targets') {
    await safeDirectory(this.#options.applicationDirectory);
    const directory = await safeDirectory(join(this.#options.applicationDirectory, CONTROL, section), true);
    await this.#inspectExternalControl(); return directory;
  }
  async #inspectExternalControl() {
    const directory = await directoryIfPresent(join(this.#options.applicationDirectory, CONTROL));
    if (!directory) return;
    for (const section of await readdir(directory)) {
      check(['records', 'targets'].includes(section), 'INTERCHANGE_CUSTODY_INCOMPLETE', 'An unreviewed external control namespace cannot be excluded as interchange administration.');
      const path = await safeDirectory(join(directory, section)), names = await readdir(path);
      check(names.length <= MAX_FILES, 'INTERCHANGE_LIMIT', 'External process controls exceed the bounded inventory.');
      for (const name of names) {
        check(/^[a-f0-9]{64}\.lock(?:\.[a-f0-9-]{36}\.tmp|\.recovery-[a-f0-9]{64}\.lock(?:\.[a-f0-9-]{36}\.tmp)?)?$/.test(name),
          'INTERCHANGE_CUSTODY_INCOMPLETE', 'Unclassified external control entries require root inspection.');
        const info = await lstat(join(path, name));
        check(info.isFile() && !info.isSymbolicLink(), 'INTERCHANGE_UNSAFE_FILE', 'External process reservations must be regular owned control files.');
      }
    }
  }
  async #inspectPrivateFiles(purpose: 'private-trial' | 'workspace-interchange', maximumBytes = 256 * 1024 * 1024) {
    const directory = await directoryIfPresent(join(this.#options.vault.directory, 'private-artifacts', purpose));
    if (!directory) return;
    const names = await readdir(directory);
    check(names.length <= MAX_FILES, 'INTERCHANGE_LIMIT', 'Private custody exceeds its file inventory bound.');
    let bytes = 0;
    for (const name of names) {
      check(/^[A-Za-z0-9_-]{1,180}\.encrypted\.json$/.test(name), 'INTERCHANGE_CUSTODY_INCOMPLETE', 'Unclassified private custody entries require root inspection.');
      const info = await lstat(join(directory, name));
      check(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, 'INTERCHANGE_UNSAFE_FILE', 'Private custody files cannot be symbolic or hard links.');
      bytes += info.size;
      check(bytes <= maximumBytes, 'INTERCHANGE_LIMIT', 'The actual private ciphertext namespace exceeds its bounded inventory budget.');
    }
  }
  async #locked<T>(section: 'records' | 'targets', identity: string, work: () => Promise<T>): Promise<T> {
    const directory = await this.#controlDirectory(section);
    const lock = await acquireProcessLock(join(directory, `${sha(identity)}.lock`), { busyCode: 'INTERCHANGE_BUSY',
      busyMessage: 'Another local interchange operation owns this record or target.', changedCode: 'INTERCHANGE_LOCK_CHANGED' });
    try { return await work(); } finally { await lock.release(); }
  }
  async #businessFiles(state: State): Promise<RetainedFile[]> {
    const vault = this.#options.vault, root = await safeDirectory(vault.directory);
    check(await realpath(this.#options.applicationDirectory) === this.#options.applicationDirectory,
      'INTERCHANGE_SOURCE_SCOPE', 'Use the canonical managed application directory.');
    await this.#inspectExternalControl();
    const files: RetainedFile[] = []; let totalBytes = 0;
    const retain = async (path: string, name: string, category: string) => {
      check(files.length < MAX_FILES, 'INTERCHANGE_LIMIT', 'Managed retained files exceed the count budget.');
      const retained = await readRegular(path, name, category, 'application/octet-stream', MAX_BYTES - totalBytes);
      totalBytes += retained.bytes.length; files.push(retained);
    };
    const walk = async (directory: string, prefix: string, category: string, depth = 0) => {
      check(depth <= 16, 'INTERCHANGE_LIMIT', 'A managed artifact directory exceeds the depth bound.');
      await safeDirectory(directory);
      for (const name of (await readdir(directory)).sort()) {
        check(files.length < MAX_FILES && !/[\x00-\x1f]/.test(name), 'INTERCHANGE_LIMIT', 'Managed retained file names/count exceed their bound.');
        const path = join(directory, name), info = await lstat(path);
        check(!info.isSymbolicLink(), 'INTERCHANGE_UNSAFE_FILE', 'Managed retained artifacts cannot contain symbolic links.');
        const logicalName = `${prefix}/${name}`;
        if (info.isDirectory()) await walk(path, logicalName, category, depth + 1);
        else {
          check(info.isFile(), 'INTERCHANGE_UNSAFE_FILE', 'Every managed artifact must be a regular file or directory.');
          await retain(path, logicalName, category);
        }
      }
    };
    for (const name of (await readdir(root)).sort()) {
      const path = join(root, name), info = await lstat(path);
      check(!info.isSymbolicLink(), 'INTERCHANGE_UNSAFE_FILE', 'Workspace custody cannot traverse links.');
      if (name === 'authority.encrypted.json' && vault.storageKind === 'experimental-file') {
        check(info.isFile(), 'INTERCHANGE_SOURCE_SCOPE', 'The local authority representation must be regular.');
        continue; // Decoded 26-store State is retained; wrapping keys are not a portable artifact.
      }
      if (name === 'writer.lock') { check(info.isFile(), 'INTERCHANGE_SOURCE_SCOPE', 'The local writer reservation must be regular.'); continue; }
      if (name === 'private-artifacts') {
        check(info.isDirectory(), 'INTERCHANGE_SOURCE_SCOPE', 'Private custody must be a managed directory.');
        for (const purpose of await readdir(path)) {
          check(['private-trial', 'workspace-interchange'].includes(purpose), 'INTERCHANGE_INVENTORY_INCOMPLETE', 'An unreviewed private custody namespace prevents complete business capture.');
          await safeDirectory(join(path, purpose));
        }
        continue;
      }
      check(Object.hasOwn(businessDirectories, name) && info.isDirectory(), 'INTERCHANGE_INVENTORY_INCOMPLETE', 'An unclassified workspace entry prevents complete business-artifact capture.');
      await walk(path, `workspace/${name}`, businessDirectories[name]);
    }
    const prefix = `chausar-${state.workspace.id}-`;
    for (const name of ['backups', 'exports']) {
      const directory = await directoryIfPresent(join(this.#options.applicationDirectory, name));
      if (!directory) continue;
      for (const entry of (await readdir(directory)).sort()) {
        const info = await lstat(join(directory, entry));
        check(!info.isSymbolicLink() && info.isFile(), 'INTERCHANGE_INVENTORY_INCOMPLETE', 'Managed backup/export directories cannot contain unclassified directories or links.');
        if (!entry.startsWith(prefix)) {
          check(/^chausar-[A-Za-z0-9_-]+-\d+\.(backup|json|vault)$/.test(entry), 'INTERCHANGE_INVENTORY_INCOMPLETE', 'An unclassified managed backup/export entry prevents complete capture.');
          continue; // Another workspace: declared outside this source identity; never open its bytes.
        }
        check(/^\d+\.(backup|json|vault)$/.test(entry.slice(prefix.length)), 'INTERCHANGE_INVENTORY_INCOMPLETE', 'A source backup/export entry has no reviewed managed identity.');
        await retain(join(directory, entry), `${name}/${entry}`, 'other-retained');
      }
    }
    check(files.length <= MAX_FILES && files.reduce((n, item) => n + item.bytes.length, 0) <= MAX_BYTES,
      'INTERCHANGE_LIMIT', 'The actual managed file inventory exceeds its bounded byte/count budget.');
    return files;
  }
  #importBodies(state: State, maximumBytes: number): { id: string; category: string; mediaType: string; bytes: Buffer }[] {
    const bodies: { id: string; category: string; mediaType: string; bytes: Buffer }[] = [];
    let retainedBytes = 0;
    const add = (identity: string, category: string, mediaType: string, content: string) => {
      check(bodies.length < MAX_FILES && retainedBytes + Buffer.byteLength(content, 'utf8') <= maximumBytes,
        'INTERCHANGE_LIMIT', 'Retained embedded bodies exceed the remaining count/byte budget.');
      retainedBytes += Buffer.byteLength(content, 'utf8');
      bodies.push({ id: `retained_${sha(identity)}`, category, mediaType, bytes: Buffer.from(content, 'utf8') });
    };
    for (const imported of state.imports) {
      if (typeof imported.format === 'string') {
        const retained = imported.retainedInput;
        check(retained?.version === 1 && Number.isSafeInteger(retained.generation) && retained.generation > 0
          && retained.input && retained.digest === hash(retained.input) && retained.input.sourceId === imported.sourceId
          && retained.input.format === imported.format && typeof retained.input.content === 'string'
          && retained.input.recipe && hash(retained.input.content) === imported.contentHash
          && hash(retained.input.recipe) === imported.recipeHash,
        'INTERCHANGE_IMPORT_MATERIAL', 'A legacy import requires its exact hash-verified retained original and full mapping recipe.');
        add(`import:${imported.id}:original`, 'source-originals', imported.format === 'csv' ? 'text/csv' : imported.format === 'xml' ? 'application/xml' : 'application/json', retained.input.content);
        add(`import:${imported.id}:recipe`, 'mapping-recipes', 'application/json', JSON.stringify(retained.input.recipe));
      } else if (imported.type === 'connector-capture-v1') {
        check(imported.recipe && interchangeDigest(imported.recipe) === imported.recipeHash && Array.isArray(imported.pages),
          'INTERCHANGE_IMPORT_MATERIAL', 'A connector capture requires its exact full recipe and explicit retained page list.');
        add(`capture:${imported.id}:recipe`, 'mapping-recipes', 'application/json', JSON.stringify(imported.recipe));
        const review = state.imports.find(item => item.type === 'connector-mapping-review-v1' && item.id === imported.reviewId);
        check(review && review.sourceId === imported.sourceId && review.operationKey === imported.operationKey
          && same(review.domain, imported.domain) && review.recipeHash === imported.recipeHash
          && review.decoderId === imported.decoderId && review.decoderVersion === imported.decoderVersion
          && review.schemaSha256 === imported.schemaSha256,
        'INTERCHANGE_IMPORT_MATERIAL', 'The retained connector recipe must match its actual mapping review and decoder/domain pins.');
        let totalBytes = 0;
        for (const [index, page] of imported.pages.entries()) {
          check(typeof page.content === 'string' && typeof page.sha256 === 'string' && digestPattern.test(page.sha256)
            && Buffer.byteLength(page.content, 'utf8') === page.bytes && sha(page.content) === page.sha256,
          'INTERCHANGE_IMPORT_MATERIAL', 'Every connector page requires its exact original UTF-8 bytes and pinned byte count/hash.');
          totalBytes += page.bytes;
          add(`capture:${imported.id}:page:${index}`, 'source-originals', 'application/octet-stream', page.content);
        }
        check(totalBytes === imported.totalBytes, 'INTERCHANGE_IMPORT_MATERIAL', 'The retained connector total must account for every actual page byte.');
        const links = state.imports.filter(item => item.type === 'connector-read-import-link-v1' && item.captureId === imported.id);
        check(links.length <= 1, 'INTERCHANGE_IMPORT_MATERIAL', 'A capture cannot have ambiguous acquisition provenance.');
        if (links[0]) {
          const link = links[0], receipt = link.readReceipt;
          check(link.sourceId === imported.sourceId && link.importOperationKey === imported.operationKey
            && link.decoderDefinitionHash === imported.decoderDefinitionHash && link.identityNamespace === imported.identityNamespace
            && Array.isArray(link.pages) && link.pages.length === imported.pages.length
            && receipt?.pages === imported.pages.length && receipt.bytes === totalBytes
            && same(receipt.contentHashes, imported.pages.map((page: any) => page.sha256))
            && receipt.authorityScopeHash === link.authorityScopeHash && receipt.dataScopeHash === link.dataScopeHash,
          'INTERCHANGE_IMPORT_MATERIAL', 'Retained acquisition receipt and every captured byte must match the persisted bridge link.');
          for (const [index, entry] of link.pages.entries()) {
            const page = imported.pages[index], provenance = entry.provenance;
            check(entry.deliveryId === page.deliveryId && provenance?.contentSha256 === page.sha256 && provenance.byteLength === page.bytes
              && provenance.schemaFingerprint === imported.schemaSha256 && provenance.authorityScopeHash === link.authorityScopeHash
              && provenance.dataScopeHash === link.dataScopeHash && provenance.operationKey === receipt.operationKey,
            'INTERCHANGE_IMPORT_MATERIAL', 'Every retained raw-page provenance witness must match the exact captured page and acquisition scope.');
          }
        }
      } else if (imported.type === 'connector-mapping-review-v1') {
        check(state.imports.some(capture => capture.type === 'connector-capture-v1' && capture.reviewId === imported.id
          && capture.sourceId === imported.sourceId && capture.recipeHash === imported.recipeHash && capture.recipe),
        'INTERCHANGE_IMPORT_MATERIAL', 'A mapping review without its retained full recipe body cannot be exported completely.');
      }
    }
    if (state.ontology !== null) add('dictionary:retained', 'dictionary-artifacts', 'application/json', JSON.stringify(state.ontology));
    for (const plugin of state.plugins) {
      check(typeof plugin.moduleBase64 === 'string' && hash(JSON.stringify(plugin.moduleBase64)) === plugin.moduleDigest,
        'INTERCHANGE_PLUGIN_MATERIAL', 'Each installed plugin must retain its exact authenticated module body.');
      check(bodies.length < MAX_FILES && retainedBytes + Math.ceil(plugin.moduleBase64.length * 3 / 4) <= maximumBytes,
        'INTERCHANGE_LIMIT', 'Retained plugin bytes exceed the remaining bounded archive budget.');
      const bytes = Buffer.from(plugin.moduleBase64, 'base64'); retainedBytes += bytes.length;
      check(bytes.toString('base64') === plugin.moduleBase64, 'INTERCHANGE_PLUGIN_MATERIAL', 'Only canonical retained plugin module bytes are accepted.');
      bodies.push({ id: `plugin_${sha(plugin.id)}`, category: 'plugin-assets', mediaType: 'application/wasm', bytes });
    }
    return bodies;
  }
  async #controlInventory(context: Context) {
    await this.#inspectPrivateFiles('workspace-interchange');
    const refs = await this.#options.vault.listArtifacts({ purpose: 'workspace-interchange' });
    const owned = this.#options.backupControlCustody
      ? await this.#options.backupControlCustody.inspectInterchangeControls(structuredClone(context),
        { vault: this.#options.vault, applicationDirectory: this.#options.applicationDirectory }, structuredClone(refs))
      : { artifacts: [], namespaceDigest: interchangeDigest([]) };
    const claimed = new Set<string>();
    check(owned && Array.isArray(owned.artifacts) && digestPattern.test(owned.namespaceDigest),
      'INTERCHANGE_CUSTODY_INCOMPLETE', 'Control custody must return exact measured inventory claims.');
    for (const item of owned.artifacts) {
      const actual = refs.find(ref => ref.id === item.ref?.id);
      check(actual && same(refIdentity(actual), item.ref) && digestPattern.test(item.sha256) && !claimed.has(actual.id),
        'INTERCHANGE_CUSTODY_INCOMPLETE', 'Control custody claims must uniquely match actual authenticated ciphertext refs.');
      claimed.add(actual.id);
    }
    const ownRefs = refs.filter(ref => !claimed.has(ref.id)), entries = new Map(ownRefs.map(ref => [ref.id, ref]));
    for (const ref of ownRefs) {
      check(/^(?:wic_[a-f0-9]{64}_(?:archive|pin|commit)|wit_[a-f0-9]{64}_reservation)$/.test(ref.id),
        'INTERCHANGE_CUSTODY_INCOMPLETE', 'An unclassified interchange administrative artifact requires root inspection.');
      if (ref.id.endsWith('_reservation')) {
        const reservation = (await this.#options.vault.readArtifact(ref)).value as Reservation;
        check(reservation?.format === 'chausar.interchange-target-reservation.v1' && slotId.test(reservation.targetId)
          && ref.id === reservationId(reservation.targetId) && reservation.sourceVaultId === this.#options.vault.vaultId
          && reservation.sourceWorkspaceId === this.#options.vault.read().workspace.id && digestPattern.test(reservation.contextDigest)
          && typeof reservation.workspaceId === 'string' && typeof reservation.generation === 'string' && reservation.physical,
        'INTERCHANGE_CUSTODY_INCOMPLETE', 'An administrative target reservation has no valid current source binding.');
      }
      if (!ref.id.endsWith('_commit')) continue;
      const record = await this.#options.vault.readArtifact(ref), binding = record.value as Binding;
      check(binding?.format === 'chausar.interchange-local-binding.v1' && plainId.test(binding.recordId)
        && ref.id === controlId(binding.recordId, 'commit') && ['committed', 'discarded'].includes(binding.state),
      'INTERCHANGE_CUSTODY_INCOMPLETE', 'An administrative commit marker is malformed.');
      const archive = entries.get(controlId(binding.recordId, 'archive')), pin = entries.get(controlId(binding.recordId, 'pin'));
      if (binding.state === 'committed') check(archive && pin && same(refIdentity(archive), binding.archive) && same(refIdentity(pin), binding.pin),
        'INTERCHANGE_CUSTODY_INCOMPLETE', 'A commit marker has missing or changed bound archive/pin ciphertext.');
      else check(!archive && !pin, 'INTERCHANGE_CUSTODY_CLEANUP_REQUIRED', 'A revoked issuance still has ciphertext pending exact root cleanup.');
    }
    for (const ref of ownRefs.filter(item => item.id.endsWith('_archive') || item.id.endsWith('_pin'))) {
      const prefix = ref.id.slice(0, ref.id.lastIndexOf('_'));
      check(entries.has(`${prefix}_commit`), 'INTERCHANGE_CUSTODY_INCOMPLETE', 'An orphan archive/pin is uncommitted and cannot be adopted automatically.');
    }
    return { refs, owned };
  }
  async #privateBody(context: Context, ref: PrivateArtifactRef, value: any) {
    const current = this.#options.vault.read();
    check(value?.version === 1 && ['private-trial-fork-v1', 'private-trial-evaluation-v1', 'private-trial-issued-binding-v1'].includes(value.type),
      'INTERCHANGE_PRIVATE_TRIAL_MATERIAL', 'Every retained private-trial artifact requires a reviewed inert classification.');
    if (value.type === 'private-trial-issued-binding-v1') {
      check(value.memberId === context.memberId && value.workspaceId === current.workspace.id,
        'INTERCHANGE_PRIVATE_TRIAL_SCOPE', 'Complete copying cannot expose another member or workspace private custody.');
      check(typeof value.trialId === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value.trialId)
        && ref.id === `${value.trialId}-binding` && ['active', 'discarded', 'promoting', 'promoted'].includes(value.status),
      'INTERCHANGE_PRIVATE_TRIAL_MATERIAL', 'Private issuance requires its exact reviewed identity and status.');
      if (value.status !== 'discarded') {
        for (const [part, issued] of [['fork', value.fork], ['evaluation', value.evaluation]] as const) {
          if (part === 'evaluation' && issued === null) continue;
          check(issued?.ref?.id === `${value.trialId}-${part}` && issued.ref.purpose === 'private-trial',
            'INTERCHANGE_PRIVATE_TRIAL_MATERIAL', 'Live private issuance must reference its exact retained payload identities.');
          let stored: PrivateArtifactRef & { value: unknown };
          try { stored = await this.#options.vault.readArtifact(issued.ref); }
          catch { throw new ChausarError('INTERCHANGE_PRIVATE_TRIAL_MATERIAL', 'Live private issuance has missing or unauthenticated retained payloads.'); }
          check(same(refIdentity(stored), issued.ref) && (stored.value as any)?.digest === issued.issuedDigest,
            'INTERCHANGE_PRIVATE_TRIAL_MATERIAL', 'Live private issuance and retained payload bytes differ.');
        }
      } else {
        const files = await readdir(join(this.#options.vault.directory, 'private-artifacts', 'private-trial'));
        check(!files.includes(`${value.trialId}-fork.encrypted.json`) && !files.includes(`${value.trialId}-evaluation.encrypted.json`),
          'INTERCHANGE_PRIVATE_TRIAL_CLEANUP_REQUIRED', 'A discarded private issuance still retains revoked payloads requiring exact root cleanup.');
      }
      return;
    }
    const trialId = value.type === 'private-trial-fork-v1' ? value.id : value.trialId;
    check(typeof trialId === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(trialId), 'INTERCHANGE_PRIVATE_TRIAL_MATERIAL', 'Private custody has no reviewed trial identity.');
    const bindingRead = await this.#options.vault.readArtifact({ id: `${trialId}-binding`, purpose: 'private-trial' });
    const binding = bindingRead.value as any;
    check(binding?.type === 'private-trial-issued-binding-v1' && binding.workspaceId === current.workspace.id
      && binding.memberId === context.memberId && binding.trialId === trialId,
    'INTERCHANGE_PRIVATE_TRIAL_SCOPE', 'Retained private evidence requires its exact owned issuance binding.');
    const issued = value.type === 'private-trial-fork-v1' ? binding.fork : binding.evaluation;
    check(issued && same(issued.ref, ref) && issued.issuedDigest === value.digest,
      'INTERCHANGE_PRIVATE_TRIAL_MATERIAL', 'Private evidence differs from its independently issued retained reference.');
    const fork = value.type === 'private-trial-fork-v1' ? value : (await this.#options.vault.readArtifact({ id: `${trialId}-fork`, purpose: 'private-trial' })).value as any;
    check(fork?.type === 'private-trial-fork-v1' && fork.workspaceId === current.workspace.id && fork.memberId === context.memberId
      && fork.digest === binding.fork.issuedDigest && (value.type !== 'private-trial-evaluation-v1' || value.forkDigest === fork.digest),
    'INTERCHANGE_PRIVATE_TRIAL_MATERIAL', 'Private replay lineage must resolve the exact owned retained fork.');
    for (const side of ['baseline', 'candidate']) {
      const historical = fork[side] as State;
      check(historical?.workspace?.id === current.workspace.id && Array.isArray(historical.facts) && Array.isArray(historical.imports),
        'INTERCHANGE_PRIVATE_TRIAL_MATERIAL', 'Both retained private views must describe the same complete historical workspace.');
      await this.#guard(context, historical);
    }
  }
  async #capture(context: Context, state: State): Promise<{ artifacts: ArtifactCapture; fence: string }> {
    const started = performance.now(), files = await this.#businessFiles(state);
    let retainedBytes = files.reduce((n, item) => n + item.bytes.length, 0);
    const bodies = this.#importBodies(state, MAX_BYTES - retainedBytes);
    retainedBytes += bodies.reduce((n, item) => n + item.bytes.length, 0);
    // Metadata-only regular-file inspection admits the complete encrypted namespace BEFORE Vault.listArtifacts decrypts it.
    await this.#inspectPrivateFiles('private-trial', MAX_BYTES - retainedBytes);
    const trials = await this.#options.vault.listArtifacts({ purpose: 'private-trial' });
    for (const ref of trials) {
      check(bodies.length + files.length < MAX_FILES && retainedBytes + ref.diskBytes <= MAX_BYTES,
        'INTERCHANGE_LIMIT', 'Private encrypted body admission exceeds the remaining conservative archive budget.');
      const retained = await this.#options.vault.readArtifact(ref);
      check(same(refIdentity(retained), ref), 'INTERCHANGE_FILE_CHANGED', 'Private-trial custody changed during enumeration.');
      await this.#privateBody(context, ref, retained.value);
      const text = JSON.stringify(retained.value);
      check(retainedBytes + Buffer.byteLength(text, 'utf8') <= MAX_BYTES, 'INTERCHANGE_LIMIT', 'Private retained body exceeds the remaining archive budget.');
      const bytes = Buffer.from(text); retainedBytes += bytes.length;
      bodies.push({ id: `private_trial_${sha(ref.id)}`, category: 'other-retained', mediaType: 'application/json', bytes });
    }
    const control = await this.#controlInventory(context);
    const witness = { state: interchangeDigest(state), files: files.map(item => item.witness), trials: trials.map(refIdentity),
      bodies: bodies.map(item => ({ id: item.id, bytes: item.bytes.length, sha256: sha(item.bytes) })) };
    const businessFence = interchangeDigest(witness);
    // Account for backup controls during this operation without changing the
    // historical business inventory when administrative custody changes later.
    const fence = control.owned.artifacts.length ? interchangeDigest({ businessFence, backupControls: control.owned }) : businessFence;
    const generation: Generation = {
      workspaceId: state.workspace.id, revision: state.revision, captureId: `capture_${businessFence}`,
    };
    const retained = [
      ...bodies.map(item => artifact(item.id, item.category, item.mediaType, item.bytes, generation)),
      ...files.map(item => artifact(`file_${sha(item.witness.name)}`, item.category, item.mediaType, item.bytes, generation)),
    ];
    check(retained.length <= MAX_FILES && retained.reduce((n, item) => n + item.bytes.byteLength, 0) <= MAX_BYTES,
      'INTERCHANGE_LIMIT', 'The complete retained business inventory exceeds the bounded archive budget.');
    this.#diagnostics = {
      sourceScope: 'desktop-business-payload-with-control-exclusions', fullWorkspacePortabilityQualified: false,
      namespaceDispositions: [
        { namespace: 'authority.encrypted.json or PostgreSQL authority', disposition: 'Decoded complete 26-store State is portable; original wrapping keys and storage representation are excluded.' },
        { namespace: 'writer.lock', disposition: 'Live local process ownership is administrative control and is never imported as authority.' },
        { namespace: 'private-artifacts/private-trial', disposition: 'Every authenticated retained private-trial body is inert other-retained evidence; original local encryption keys are excluded.' },
        { namespace: 'private-artifacts/workspace-interchange', disposition: 'Archive, independent issuance pin, commit/tombstone and target reservations are administrative control outside this business payload. Full archive-inclusive portability remains unqualified.' },
        { namespace: CONTROL, disposition: 'External target/record process locks stay outside empty workspace targets and are not portable business data.' },
        { namespace: 'backups/exports belonging to other workspace IDs', disposition: 'Outside this exact source workspace; filenames are classified and bytes are never read.' },
        { namespace: 'external namespaces and process-only acquisitions', disposition: 'Not enumerated by this local profile; full enterprise, external custody and pending acquisitions are unqualified.' },
      ],
      externalKeyCustodyDependencies: files.filter(item => /\.(backup|vault)$/.test(item.witness.name))
        .map(item => item.witness.name),
      files: retained.map(item => ({ logicalId: item.id, category: item.category, bytes: item.bytes.byteLength, sha256: sha(item.bytes) })),
      controlArtifactsExcluded: control.refs.length, measuredCaptureMs: performance.now() - started,
    };
    return { artifacts: { complete: true, enumerationId: `enumeration_${businessFence}`, generation,
      categories: workspaceStateProfile().artifactCategories, artifacts: retained }, fence };
  }
  async #withSource<T>(context: Context, expected: WorkspaceInventory | null,
    work: (lease: WorkspaceInterchangeSourceLease) => Promise<T>): Promise<T> {
    return this.#options.vault.snapshot(async state => {
      const run = async (assertNative: () => Promise<void>) => {
        await assertNative();
        await this.#guard(context, state);
        const source = await this.#capture(context, state), capture = captureWorkspaceInterchange(state, source.artifacts);
        if (expected) check(same(expected, capture.inventory), 'INTERCHANGE_AUTHORITY_CHANGED', 'The actual current source inventory differs from its independently retained pin.');
        const assertCurrent = async () => {
          await assertNative();
          await this.#guard(context, state);
          check(same(this.#options.vault.read(), state) && (await this.#capture(context, state)).fence === source.fence,
            'INTERCHANGE_AUTHORITY_CHANGED', 'Source authority, access or retained business files changed during the held snapshot.');
          await assertNative();
        };
        const result = await this.#sourceScope.run({ context: structuredClone(context), inventory: capture.inventory }, () => work({
          ready: true, state, artifacts: source.artifacts, assertCompleteOwner: (ctx, historical) => this.#guard(ctx, historical), assertCurrent,
        }));
        await assertCurrent(); return result;
      };
      return this.#postgresSource ? this.#postgresSource.withSource(native => run(async () => {
        check(native.authority.vaultId === this.#options.vault.vaultId && native.authority.revision === state.revision,
          'POSTGRES_WORKSPACE_STORAGE_CHANGED', 'Public semantic export must retain the actual installed source authority.');
        await native.assertCurrent();
      })) : run(async () => {});
    });
  }
  async #targetInspection(context: Context, targetId: string): Promise<EmptyTargetInspection> {
    const retained = await this.#options.vault.readArtifact({ id: reservationId(targetId), purpose: 'workspace-interchange' });
    const reservation = retained.value as Reservation, path = this.targetPath(targetId);
    check(reservation?.format === 'chausar.interchange-target-reservation.v1' && reservation.targetId === targetId
      && reservation.sourceVaultId === this.#options.vault.vaultId && reservation.sourceWorkspaceId === this.#options.vault.read().workspace.id
      && reservation.contextDigest === interchangeDigest(context), 'INTERCHANGE_TARGET_CHANGED', 'Target reservation differs from its source identity or preparing current owner.');
    await safeDirectory(path); const info = await lstat(path, { bigint: true });
    check(same(physical(info), reservation.physical), 'INTERCHANGE_TARGET_CHANGED', 'The reserved empty directory was replaced.');
    const entries = (await readdir(path)).sort(), profile = workspaceStateProfile(), current = this.#options.vault.read();
    return { targetId, workspaceId: reservation.workspaceId, generation: reservation.generation,
      accessDigest: interchangeDigest({ context, members: current.members, policy: current.policy }), ready: true, profile,
      stores: profile.stores.map(store => ({ name: store.name, records: 0 })),
      categoryCounts: profile.artifactCategories.map(category => ({ category, count: 0 })), authorityRecords: entries.length === 0 ? 0 : 1,
      unexpectedEntries: entries };
  }
  async #withTarget<T>(context: Context, input: { targetId: string; mode: 'allocate' | 'existing' },
    work: (lease: WorkspaceInterchangeTargetLease) => Promise<T>): Promise<T> {
    check(this.#sourceScope.getStore() && same(this.#sourceScope.getStore()!.context, context),
      'INTERCHANGE_SOURCE_LEASE_REQUIRED', 'Hold the current source snapshot before allocating or inspecting a target.');
    const path = this.targetPath(input.targetId);
    return this.#locked('targets', path, async () => {
      await this.#guard(context, this.#options.vault.read());
      if (input.mode === 'allocate') {
        const refs = await this.#options.vault.listArtifacts({ purpose: 'workspace-interchange' });
        const existing = refs.find(ref => ref.id === reservationId(input.targetId));
        if (!existing) {
          await safeDirectory(this.#options.applicationDirectory);
          try { await mkdir(path, { mode: 0o700 }); }
          catch (error: any) { if (error.code === 'EEXIST') throw new ChausarError('INTERCHANGE_TARGET_EXISTS', 'Allocate a new managed target; an existing unrelated empty directory cannot be adopted.'); throw error; }
          const info = await lstat(path, { bigint: true });
          const reservation: Reservation = { format: 'chausar.interchange-target-reservation.v1', sourceVaultId: this.#options.vault.vaultId,
            sourceWorkspaceId: this.#options.vault.read().workspace.id, targetId: input.targetId, workspaceId: `workspace_${randomUUID()}`,
            generation: `empty_${randomUUID()}`, contextDigest: interchangeDigest(context), physical: physical(info) };
          try { await this.#options.vault.writeArtifact({ id: reservationId(input.targetId), purpose: 'workspace-interchange', value: reservation, expectedDigest: null }); }
          catch (error) {
            try {
              // An acknowledgement can fail AFTER publication. Resolve and revoke only the exact owned reservation.
              let persisted: PrivateArtifactRef & { value: unknown } | undefined;
              try { persisted = await this.#options.vault.readArtifact({ id: reservationId(input.targetId), purpose: 'workspace-interchange' }); }
              catch (failure: any) { if (failure.code !== 'ARTIFACT_NOT_FOUND') throw failure; }
              if (persisted) {
                check(same(persisted.value, reservation), 'INTERCHANGE_TARGET_CHANGED', 'A failed allocation found another reservation and cannot clean it up.');
                await this.#options.vault.removeArtifact({ ...persisted, expectedDigest: persisted.valueDigest });
              }
              const current = await lstat(path, { bigint: true });
              check(same(physical(current), physical(info)) && (await readdir(path)).length === 0,
                'INTERCHANGE_TARGET_CHANGED', 'A failed allocation target changed and cannot be removed.');
              await rmdir(path);
            } catch { throw new ChausarError('INTERCHANGE_TARGET_CLEANUP_REQUIRED', 'Target allocation failed with unresolved reservation/directory custody; root inspection is required.'); }
            throw error;
          }
        }
      }
      const inspection = await this.#targetInspection(context, input.targetId);
      check(inspection.authorityRecords === 0 && inspection.unexpectedEntries.length === 0, 'INTERCHANGE_TARGET_NOT_EMPTY', 'The actual target directory is not empty.');
      const assertCurrent = async () => {
        await this.#guard(context, this.#options.vault.read());
        check(same(await this.#targetInspection(context, input.targetId), inspection), 'INTERCHANGE_TARGET_CHANGED', 'The actual empty target or access fence changed.');
      };
      const result = await this.#targetScope.run({ context: structuredClone(context), inspection }, () => work({ inspection, assertCurrent }));
      await assertCurrent(); return result;
    });
  }
  #measure(archive: PrivateArtifactRef, pin: PrivateArtifactRef): WorkspaceInterchangeCustodyMeasurement {
    return { encrypted: true, archiveCiphertextBytes: archive.diskBytes, inventoryPinCiphertextBytes: pin.diskBytes,
      qualification: this.#options.qualification ?? 'encrypted-local-host' };
  }
  async #create(context: Context, record: WorkspaceInterchangeCustodyRecord): Promise<WorkspaceInterchangeCustodyMeasurement> {
    const started = performance.now();
    check(record && plainId.test(record.pin?.recordId), 'INTERCHANGE_HOST_RECORD', 'Use one explicit local custody record identity.');
    const source = this.#sourceScope.getStore();
    check(source && same(source.context, context) && same(record.pin.inventory, source.inventory)
      && record.pin.contextDigest === interchangeDigest(context), 'INTERCHANGE_SOURCE_LEASE_REQUIRED', 'Only a held current root capture can issue an independent archive pin.');
    if (record.pin.kind === 'candidate') {
      const target = this.#targetScope.getStore();
      check(target && same(target.context, context) && same(target.inspection, record.pin.target),
        'INTERCHANGE_TARGET_CHANGED', 'Candidate custody requires its held actual target lease.');
    }
    await this.#guard(context, this.#options.vault.read());
    const recordId = record.pin.recordId;
    return this.#locked('records', `${this.#options.vault.vaultId}:${recordId}`, async () => {
      const refs = await this.#options.vault.listArtifacts({ purpose: 'workspace-interchange' });
      check(!refs.some(ref => ['archive', 'pin', 'commit'].some(part => ref.id === controlId(recordId, part as 'archive' | 'pin' | 'commit'))),
        'INTERCHANGE_OUTPUT_EXISTS', 'Archive IDs are durable single-use; committed, discarded or orphaned records cannot be overwritten.');
      let archive: PrivateArtifactRef | undefined, pin: PrivateArtifactRef | undefined, binding: Binding | undefined;
      const archiveValue = { format: 'chausar.interchange-local-archive.v1', recordId, content: record.content };
      const pinValue = { format: 'chausar.interchange-local-pin.v1', recordId, pin: record.pin };
      try {
        archive = await this.#options.vault.writeArtifact({ id: controlId(recordId, 'archive'), purpose: 'workspace-interchange', expectedDigest: null,
          value: archiveValue });
        pin = await this.#options.vault.writeArtifact({ id: controlId(recordId, 'pin'), purpose: 'workspace-interchange', expectedDigest: null,
          value: pinValue });
        binding = { format: 'chausar.interchange-local-binding.v1', recordId, instance: randomUUID(), contextDigest: interchangeDigest(context),
          pinDigest: interchangeDigest(record.pin), contentDigest: interchangeDigest(record.content), archive, pin, state: 'committed' };
        await this.#guard(context, this.#options.vault.read());
        const commit = await this.#options.vault.writeArtifact({ id: controlId(recordId, 'commit'), purpose: 'workspace-interchange', expectedDigest: null, value: binding });
        this.#measurements.set(recordId, { recordId, state: 'committed', archiveCiphertextBytes: archive.diskBytes,
          inventoryPinCiphertextBytes: pin.diskBytes, bindingCiphertextBytes: commit.diskBytes,
          totalRetainedCiphertextBytes: archive.diskBytes + pin.diskBytes + commit.diskBytes,
          removedCiphertextBytes: 0, measuredMs: performance.now() - started, operation: 'create' });
        return this.#measure(archive, pin);
      } catch (error) {
        try {
          const resolvePersisted = async (part: 'archive' | 'pin', expectedValue: unknown, acknowledged?: PrivateArtifactRef) => {
            let persisted: PrivateArtifactRef & { value: unknown } | undefined;
            try { persisted = await this.#options.vault.readArtifact({ id: controlId(recordId, part), purpose: 'workspace-interchange' }); }
            catch (failure: any) { if (failure.code !== 'ARTIFACT_NOT_FOUND') throw failure; }
            if (persisted) check(same(persisted.value, expectedValue) && (!acknowledged || same(refIdentity(persisted), acknowledged)),
              'INTERCHANGE_CUSTODY_CHANGED', 'Failed creation found changed ciphertext and cannot clean it up.');
            return persisted ? refIdentity(persisted) : undefined;
          };
          // Resolve unacknowledged payload publications as well as acknowledged refs.
          pin = await resolvePersisted('pin', pinValue, pin); archive = await resolvePersisted('archive', archiveValue, archive);
          let committed: PrivateArtifactRef & { value: unknown } | undefined;
          try { committed = await this.#options.vault.readArtifact({ id: controlId(recordId, 'commit'), purpose: 'workspace-interchange' }); }
          catch (failure: any) { if (failure.code !== 'ARTIFACT_NOT_FOUND') throw failure; }
          if (committed) {
            check(binding && same(committed.value, binding), 'INTERCHANGE_CUSTODY_CHANGED', 'Failed publication found an unrelated issuance and cannot remove it.');
            await this.#options.vault.writeArtifact({ id: committed.id, purpose: 'workspace-interchange', expectedDigest: committed.valueDigest,
              value: { ...binding, state: 'discarded' } });
          }
          for (const ref of [pin, archive]) if (ref) await this.#options.vault.removeArtifact({ ...ref, expectedDigest: ref.valueDigest });
        } catch { throw new ChausarError('INTERCHANGE_CUSTODY_CLEANUP_REQUIRED', 'Creation failed and its exact uncommitted ciphertext could not be removed; root inspection is required.'); }
        throw error;
      }
    });
  }
  async #readUnlocked(context: Context, recordId: string) {
    const vault = this.#options.vault;
    await this.#inspectPrivateFiles('workspace-interchange');
    const commit = await vault.readArtifact({ id: controlId(recordId, 'commit'), purpose: 'workspace-interchange' });
    const binding = commit.value as Binding;
    check(binding?.format === 'chausar.interchange-local-binding.v1' && binding.recordId === recordId && binding.state === 'committed'
      && typeof binding.instance === 'string' && digestPattern.test(binding.pinDigest) && digestPattern.test(binding.contentDigest)
      && binding.contextDigest === interchangeDigest(context), 'INTERCHANGE_CUSTODY_NOT_COMMITTED', 'No committed issuance binding authenticates this archive for the preparing owner.');
    const archive = await vault.readArtifact({ id: controlId(recordId, 'archive'), purpose: 'workspace-interchange' });
    const pin = await vault.readArtifact({ id: controlId(recordId, 'pin'), purpose: 'workspace-interchange' });
    check(same(refIdentity(archive), binding.archive) && same(refIdentity(pin), binding.pin), 'INTERCHANGE_CUSTODY_CHANGED', 'The independently bound ciphertext references changed.');
    const archiveValue = archive.value as any, pinValue = pin.value as any;
    check(archiveValue?.format === 'chausar.interchange-local-archive.v1' && archiveValue.recordId === recordId && typeof archiveValue.content === 'string'
      && pinValue?.format === 'chausar.interchange-local-pin.v1' && pinValue.recordId === recordId
      && interchangeDigest(archiveValue.content) === binding.contentDigest && interchangeDigest(pinValue.pin) === binding.pinDigest,
    'INTERCHANGE_CUSTODY_CHANGED', 'Archive and independent inventory pin do not match their final authenticated commit binding.');
    return { content: archiveValue.content as string, pin: structuredClone(pinValue.pin) as WorkspaceInterchangeCustodyRecord['pin'],
      measurement: this.#measure(archive, pin), binding, commit: refIdentity(commit) };
  }
  /** Root composition only: caller already owns the actual Vault snapshot. */
  withRecordReader<T>(context: Context, recordId: string,
    work: (read: () => Promise<WorkspaceInterchangeCustodyRecord & {measurement: WorkspaceInterchangeCustodyMeasurement}>) => Promise<T>): Promise<T> {
    check(plainId.test(recordId), 'INTERCHANGE_HOST_RECORD', 'Read one managed record identity.');
    // This operation also refuses a caller outside the real snapshot scope.
    return this.#options.vault.captureEncryptedCustody({maxArtifacts: MAX_FILES, maxEntryBytes: MAX_BYTES, maxTotalEntryBytes: MAX_BYTES}).then(() =>
      this.#locked('records', `${this.#options.vault.vaultId}:${recordId}`, () => work(async () => {
        await this.#guard(context, this.#options.vault.read()); const value = await this.#readUnlocked(context, recordId);
        await this.#guard(context, this.#options.vault.read()); return {content: value.content, pin: value.pin, measurement: value.measurement};
      })));
  }
  async #read(context: Context, recordId: string) {
    const started = performance.now();
    check(plainId.test(recordId), 'INTERCHANGE_HOST_RECORD', 'Use one explicit local custody record identity.');
    const work = () => this.#locked('records', `${this.#options.vault.vaultId}:${recordId}`, async () => {
      await this.#guard(context, this.#options.vault.read());
      const retained = await this.#readUnlocked(context, recordId);
      await this.#guard(context, this.#options.vault.read());
      this.#measurements.set(recordId, { recordId, state: 'committed', archiveCiphertextBytes: retained.binding.archive.diskBytes,
        inventoryPinCiphertextBytes: retained.binding.pin.diskBytes, bindingCiphertextBytes: retained.commit.diskBytes,
        totalRetainedCiphertextBytes: retained.binding.archive.diskBytes + retained.binding.pin.diskBytes + retained.commit.diskBytes,
        removedCiphertextBytes: 0, measuredMs: performance.now() - started, operation: 'read' });
      return { content: retained.content, pin: retained.pin, measurement: retained.measurement };
    });
    // Always take the authority queue before record locks; the reverse order can deadlock an export snapshot.
    return this.#sourceScope.getStore() ? work() : this.#options.vault.snapshot(work);
  }
  async #remove(context: Context, input: { recordId: string; expectedPinDigest: string; expectedContentDigest: string }) {
    const started = performance.now();
    check(plainId.test(input.recordId) && digestPattern.test(input.expectedPinDigest) && digestPattern.test(input.expectedContentDigest),
      'INTERCHANGE_HOST_RECORD', 'Discard requires the exact owned record and both reviewed digests.');
    // Exact private cleanup can revoke only the original issuance, even after source access changed.
    const work = () => this.#locked('records', `${this.#options.vault.vaultId}:${input.recordId}`, async () => {
      const retained = await this.#readUnlocked(context, input.recordId);
      check(retained.binding.pinDigest === input.expectedPinDigest && retained.binding.contentDigest === input.expectedContentDigest,
        'INTERCHANGE_REVIEW_CHANGED', 'Discard compares both actual independently bound ciphertext digests.');
      const vault = this.#options.vault;
      const tombstone = await vault.writeArtifact({ id: retained.commit.id, purpose: 'workspace-interchange', expectedDigest: retained.commit.valueDigest,
        value: { ...retained.binding, state: 'discarded' } });
      try {
        let removedCiphertextBytes = 0;
        for (const ref of [retained.binding.pin, retained.binding.archive]) {
          const removed = await vault.removeArtifact({ ...ref, expectedDigest: ref.valueDigest }); removedCiphertextBytes += removed.diskBytes;
        }
        this.#measurements.set(input.recordId, { recordId: input.recordId, state: 'discarded', archiveCiphertextBytes: 0,
          inventoryPinCiphertextBytes: 0, bindingCiphertextBytes: tombstone.diskBytes, totalRetainedCiphertextBytes: tombstone.diskBytes,
          removedCiphertextBytes, measuredMs: performance.now() - started, operation: 'discard' });
      } catch { throw new ChausarError('INTERCHANGE_CUSTODY_CLEANUP_REQUIRED', 'Issuance is revoked, but exact bound ciphertext cleanup is incomplete; root must inspect the tombstone.'); }
    });
    if (this.#sourceScope.getStore()) await work(); else await this.#options.vault.snapshot(work);
  }
}

export function createWorkspaceInterchangeLocalPorts(options: WorkspaceInterchangeLocalOptions) {
  return new WorkspaceInterchangeLocalCustody(options);
}
