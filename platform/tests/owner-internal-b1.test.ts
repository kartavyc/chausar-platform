// B1 fix round 2 (quality finding 2, spec finding 4): a refusal is flagged for the owner only when it is written for
// the owner. The vault, sync and storage internals throw in developer words ("Sync requires a valid encrypted
// Vault.backup envelope.", "Fresh bootstrap exceeds its explicit State byte budget."), so they throw InternalError
// (owner: false). On the way out a transport sends such a refusal without the flag when the app has its own line for the
// code (errors.json), and as the general sentence otherwise, so its words never reach a screen. Every code these files
// can throw is listed here, either with the app's line or as a technical code, so a new one has to be placed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChausarError, InternalError, asInternal } from '../runtime/contracts.ts';
import { ownerError, UNEXPECTED_WORDS } from '../runtime/owner-error.ts';
import { DEVELOPER_TEXT_CODES, INTERNAL_LINE_CODES, TABLE_CODES, bannedIn, refusalTravel } from '../runtime/owner-flag.ts';
import { Vault, safeDirectory } from '../runtime/vault.ts';
import { loopbackPostgresUrl } from '../runtime/postgres.ts';

const SOURCES = ['vault.ts', 'sync.ts', 'sync-file-transport.ts', 'sync-writer-admission.ts', 'postgres.ts'] as const;
const read = (name: string) => readFile(new URL(`../runtime/${name}`, import.meta.url), 'utf8');
const errors = JSON.parse(await readFile(new URL('../../app/ui/src/text/en/errors.json', import.meta.url), 'utf8')) as Record<string, string>;

/** Every refusal a source can throw: a code in quotes followed by its words, whatever call carries them. */
const PAIR = /'([A-Z][A-Z0-9_]{2,63})',\s*(?:'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/g;
async function refusals(): Promise<[string, string][]> {
  const pairs: [string, string][] = [];
  for (const name of SOURCES) {
    for (const match of (await read(name)).matchAll(PAIR)) {
      const words = (match[2] ?? match[3]).replace(/\$\{[^}]*\}/g, 'x');
      if (!/^[A-Z_]+$/.test(words)) pairs.push([match[1], words]); // a list of Node codes is not a refusal
    }
  }
  // The writer locks name their codes as options (busyCode, changedCode, unsafeCode).
  pairs.push(['VAULT_BUSY', 'This vault is already open, or its writer cannot be verified.'], ['LOCK_CHANGED', 'The writer lock changed.'],
    ['SYNC_STORE_BUSY', 'Another local process holds or may hold the sync transaction lock.'], ['SYNC_LOCK_CHANGED', 'The process lock changed.'],
    ['SYNC_WRITER_BUSY', 'Another local process holds or may hold writer admission.'], ['SYNC_WRITER_LOCK_CHANGED', 'The process lock changed.'],
    ['UNSAFE_PATH', 'A process lock must use regular files in a real directory.']);
  return pairs;
}

/**
 * The codes the owner never meets in the app: a fresh bootstrap, encrypted custody budgets, device sync set-up and its
 * protocol (sync is off until a transport is configured), and PostgreSQL storage. Through a transport each says the
 * general sentence.
 */
const TECHNICAL = [
  'ACCESS_REVOKED', 'ALREADY_SENT', 'APP_APPROVAL_REQUIRED', 'ARTIFACT_BACKUP_REQUIRED', 'ARTIFACT_ID_INVALID', 'ARTIFACT_INVENTORY_INCOMPLETE',
  'ARTIFACT_LIMIT', 'ARTIFACT_REVISION_CONFLICT', 'ARTIFACT_REVISION_REQUIRED', 'BACKUP_REQUIRED', 'BOOTSTRAP_CLEANUP_REQUIRED', 'BOOTSTRAP_GUARD',
  'BOOTSTRAP_LIMIT', 'BOOTSTRAP_OWNER_INVALID', 'BOOTSTRAP_PIN_REQUIRED', 'BOOTSTRAP_POLICY_INVALID', 'BOOTSTRAP_READBACK', 'BOOTSTRAP_RUNTIME_AUTHORITY',
  'BOOTSTRAP_STATE_INVALID', 'BOOTSTRAP_TARGET_NOT_EMPTY', 'CORRUPT_VAULT', 'FENCE_REJECTED', 'INVALID_DEVICE_KEY', 'INVALID_POSTGRES_CONFIG',
  'INVALID_REQUEST', 'INVALID_REVISION', 'INVALID_SLOT', 'INVALID_STATE', 'INVALID_SYNC_LEASE', 'INVALID_SYNC_SETTING', 'INVALID_SYNC_WRITER_REVIEW',
  'LIVE_AUTHORITY_OVERWRITE_REFUSED', 'LOCK_CHANGED', 'MULTIWRITER_UNSUPPORTED', 'PREVIEW_NOT_FOUND', 'RESTORE_TARGET_NOT_EMPTY', 'STORAGE_REQUIRED',
  'SYNC_ACCESS_DENIED', 'SYNC_APPROVAL_REQUIRED', 'SYNC_CAS_CONFLICT', 'SYNC_CLOCK_INVALID', 'SYNC_CLOCK_REGRESSED', 'SYNC_DEVICE_CONFIGURATION_REQUIRED',
  'SYNC_DISABLED', 'SYNC_EMPTY', 'SYNC_FENCE_EXHAUSTED', 'SYNC_HEAD_MISMATCH', 'SYNC_LOCK_CHANGED', 'SYNC_LOG_INVALID', 'SYNC_LOG_TRUNCATED',
  'SYNC_PAYLOAD_CHANGED', 'SYNC_PREVIEW_STALE', 'SYNC_RECONCILIATION_UNAVAILABLE', 'SYNC_REPLAY', 'SYNC_REVOKED', 'SYNC_SCOPE_DENIED',
  'SYNC_SIGNATURE_INVALID', 'SYNC_STORE_BUSY', 'SYNC_STORE_CORRUPT', 'SYNC_TOO_LARGE', 'SYNC_UNSAFE_PATH', 'SYNC_WORKSPACE_MISMATCH',
  'SYNC_WRITER_ADMISSION_REQUIRED', 'SYNC_WRITER_BUSY', 'SYNC_WRITER_CAS_CONFLICT', 'SYNC_WRITER_EXPIRED', 'SYNC_WRITER_LOCK_CHANGED',
  'SYNC_WRITER_REVIEW_REQUIRED', 'SYNC_WRITER_STATE_CONFLICT', 'SYNC_WRITER_STORE_CORRUPT', 'UNTRUSTED_DEVICE', 'WRITER_LEASE_DENIED', 'WRITER_LEASE_EXPIRED',
];

test('B1 fix round 2: these sources build no refusal the owner could read as theirs', async () => {
  for (const name of SOURCES) {
    const source = await read(name);
    assert.doesNotMatch(source, /new ChausarError\(/, name);
    if (/\bcheck\(/.test(source)) assert.match(source, /internalCheck as check/, `${name} checks with internalCheck`);
  }
});

test('B1 fix round 2: every vault, sync and storage refusal is said in the app\'s words or as the general sentence', async () => {
  const pairs = await refusals();
  assert.ok(pairs.length > 150, String(pairs.length));
  const codes = new Set(pairs.map(([code]) => code));
  assert.deepEqual([...codes].filter(code => !TABLE_CODES.includes(code)).sort(), [...TECHNICAL].sort(), 'each code is placed: an app line or technical');
  for (const [code, words] of pairs) {
    const sent = ownerError(new InternalError(code, words));
    if (TABLE_CODES.includes(code)) {
      assert.deepEqual(sent, { code, message: words }, `${code} travels without the flag`);
      assert.equal(typeof errors[`errors.${code}`], 'string', `errors.${code}`);
      assert.deepEqual(bannedIn(errors[`errors.${code}`]), [], `errors.${code}`);
    } else {
      assert.deepEqual(sent, { code, message: UNEXPECTED_WORDS, owner: true }, `${code}: ${words}`);
    }
    if (sent.owner) assert.deepEqual(bannedIn(sent.message), [], `${code}: a flagged refusal says no developer word`);
  }
  // The app has a line for every code that goes without the flag, and the table says none in developer words.
  for (const code of TABLE_CODES) assert.deepEqual(bannedIn(errors[`errors.${code}`] ?? 'vault'), [], code);
});

test('B1 fix round 2: the vault, storage, a writer lock and the model replay throw InternalError for real', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'chausar-internal-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const internal = (code: string) => (error: unknown) => error instanceof InternalError && error.code === code && error.owner === false;
  await assert.rejects(safeDirectory('relative/place'), internal('UNSAFE_PATH'));
  await assert.rejects(Vault.create({ directory: join(folder, 'a'), storage: 'experimental-file', passphrase: 'short', name: 'Sitara' } as never), internal('WEAK_PASSPHRASE'));
  assert.throws(() => loopbackPostgresUrl('not a url'), internal('INVALID_POSTGRES_CONFIG'));
  const { vault } = await Vault.create({ directory: join(folder, 'b'), storage: 'experimental-file', passphrase: 'a long passphrase here', name: 'Sitara' } as never);
  t.after(() => vault.close());
  await assert.rejects(Vault.open({ directory: join(folder, 'b'), storage: 'experimental-file', passphrase: 'a long passphrase here' } as never), internal('VAULT_BUSY'));
  await assert.rejects(Vault.open({ directory: join(folder, 'c'), storage: 'experimental-file', passphrase: 'a long passphrase here' } as never), (error: unknown) => error instanceof InternalError);
  // Through the transport's edge: the app's own line for one, the general sentence for the other.
  assert.deepEqual(ownerError(new InternalError('VAULT_BUSY', 'This vault is already open, or its writer cannot be verified.')), { code: 'VAULT_BUSY', message: 'This vault is already open, or its writer cannot be verified.' });
  assert.deepEqual(ownerError(new InternalError('BOOTSTRAP_LIMIT', 'Fresh bootstrap exceeds its explicit State byte budget.')), { code: 'BOOTSTRAP_LIMIT', message: UNEXPECTED_WORDS, owner: true });
  // Spec finding 4: a missing model recording is a developer path; its "Record this fixture" never reaches the owner.
  assert.match(await read('venture/models/replay.ts'), /new InternalError\('FIXTURE_MISSING'/);
  assert.deepEqual(ownerError(new InternalError('FIXTURE_MISSING', 'Record this fixture: interview for x.')), { code: 'FIXTURE_MISSING', message: UNEXPECTED_WORDS, owner: true });
});

test('B1 fix round 2: the rule in one place, and a stray owner flags nothing', () => {
  assert.equal(refusalTravel('PRICE_REQUIRED', 'Set your price for Digest Ltd first.'), 'owner');
  assert.equal(refusalTravel('UNLOCK_FAILED', 'Unable to unlock vault.'), 'unflagged');
  assert.equal(refusalTravel('ACCESS_REVOKED', 'ACCESS_REVOKED'), 'unflagged');
  assert.equal(refusalTravel('WEAK_PASSPHRASE', 'Use a passphrase of 12 to 1024 characters.', false), 'unflagged');
  assert.equal(refusalTravel('BOOTSTRAP_LIMIT', 'Fresh bootstrap exceeds its explicit State byte budget.', false), 'internal');
  assert.equal(refusalTravel('REENTRANT_TRANSACTION', 'Nested vault operations are not supported.', true), 'unflagged');
  assert.deepEqual([...TABLE_CODES], [...DEVELOPER_TEXT_CODES, ...INTERNAL_LINE_CODES]);
  // Quality finding 4: an error that is not the owner's stays unflagged whatever it carries.
  const stray = Object.assign(new ChausarError('REENTRANT_TRANSACTION', 'Nested vault operations are not supported.'), { owner: true });
  assert.deepEqual(ownerError(stray), { code: 'REENTRANT_TRANSACTION', message: 'Nested vault operations are not supported.' });
  const wrapped = new Error('Request failed', { cause: new ChausarError('PRICE_REQUIRED', 'Set your price first.') });
  assert.deepEqual(ownerError(wrapped), { code: 'REQUEST_FAILED', message: UNEXPECTED_WORDS, owner: true });
  const plain = Object.assign(new Error('Path C:\\Users\\x is locked'), { code: 'SOMETHING_ODD', owner: true });
  assert.deepEqual(ownerError(plain), { code: 'REQUEST_FAILED', message: UNEXPECTED_WORDS, owner: true });
  // An InternalError is still a ChausarError, by name too; asInternal turns a lock's plain refusal into one.
  const lock = asInternal(new ChausarError('VAULT_BUSY', 'This vault is already open.')) as InternalError;
  assert.ok(lock instanceof InternalError && lock instanceof ChausarError && lock.name === 'ChausarError' && lock.owner === false);
  assert.equal(new ChausarError('X', 'y') instanceof InternalError, false);
});
