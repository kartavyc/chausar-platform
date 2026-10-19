import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { Vault, ExperimentalFileSnapshotAdapter, safeDirectory } from '../runtime/vault.ts';
import { PostgresSnapshotAdapter } from '../runtime/postgres.ts';

const password = 'a long private test passphrase';
const replacement = 'an entirely different long passphrase';
const options = (directory: string) => ({ directory, storage: 'experimental-file' as const, passphrase: password });
async function fixture(t: any) { const directory = await mkdtemp(join(tmpdir(), 'chausar-vault-test-')); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }
const code = (expected: string) => (error: any) => error.code === expected;
async function crashVaultChild(t:any,program:string) {
  const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',program],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});t.after(()=>child.kill());
  const ready=await new Promise<string>((accept,reject)=>{let output='';child.stdout.on('data',chunk=>{output+=chunk;const end=output.indexOf('\n');if(end>=0)accept(output.slice(0,end));});child.once('error',reject);child.once('exit',()=>reject(new Error('Vault child exited before readiness.')));});
  const exited=once(child,'exit');assert.equal(child.kill('SIGKILL'),true);await exited;assert.throws(()=>process.kill(child.pid!,0),(error:any)=>error.code==='ESRCH');return ready;
}

test('snapshots encrypt business data and wrappers; detached reads cannot mutate authority', async t => {
  const directory = await fixture(t), { vault, recoveryCode } = await Vault.create({ ...options(directory), name: 'SECRET BUSINESS NAME' });
  t.after(() => vault.close());
  await vault.update(state => { state.activity.push({ message: 'PRIVATE FACT 982391723' }); });
  const raw = await readFile(join(directory, 'authority.encrypted.json'), 'utf8');
  assert.ok(!raw.includes('SECRET BUSINESS NAME') && !raw.includes('PRIVATE FACT') && !raw.includes(password) && !raw.includes(recoveryCode));
  const envelope = JSON.parse(raw);
  assert.notEqual(envelope.passphrase.ciphertext.data, envelope.recovery.ciphertext.data);
  assert.equal(envelope.snapshot.nonce.length, 16);
  const copy = vault.read(); copy.workspace.name = 'ATTACK'; copy.activity.length = 0;
  assert.equal(vault.read().workspace.name, 'SECRET BUSINESS NAME');
  assert.equal(vault.read().activity.length, 1);
  assert.equal(vault.read().revision, 1);
  assert.equal(Object.keys(vault).some(x => /key|state/i.test(x)), false);
});

test('vault open and recovery preserve committed authority after an abrupt writer crash',{timeout:15000},async t=>{
  const directory=await fixture(t),moduleURL=new URL('../runtime/vault.ts',import.meta.url).href;
  const create=`import {Vault} from ${JSON.stringify(moduleURL)};setInterval(()=>{},1000);const {vault,recoveryCode}=await Vault.create({...${JSON.stringify(options(directory))},name:'Crash authority'});await vault.update(state=>{state.activity.push({message:'committed before crash'});});process.stdout.write(JSON.stringify({recoveryCode})+'\\n');`;
  const {recoveryCode}=JSON.parse(await crashVaultChild(t,create));
  const reopened=await Vault.open(options(directory));assert.equal(reopened.read().activity[0].message,'committed before crash');assert.equal(reopened.read().revision,1);await reopened.close();
  const open=`import {Vault} from ${JSON.stringify(moduleURL)};setInterval(()=>{},1000);await Vault.open(${JSON.stringify(options(directory))});process.stdout.write('READY\\n');`;
  await crashVaultChild(t,open);
  const recovered=await Vault.recover({directory,storage:'experimental-file',recoveryCode,newPassphrase:replacement});assert.equal(recovered.read().activity[0].message,'committed before crash');await recovered.close();
  const final=await Vault.open({...options(directory),passphrase:replacement});assert.equal(final.read().workspace.name,'Crash authority');await final.close();
});

test('concurrent recovery of a crashed vault admits exactly one writer',{timeout:10000},async t=>{
  const directory=await fixture(t),moduleURL=new URL('../runtime/vault.ts',import.meta.url).href;
  const program=`import {Vault} from ${JSON.stringify(moduleURL)};setInterval(()=>{},1000);await Vault.create({...${JSON.stringify(options(directory))},name:'One recovered writer'});process.stdout.write('READY\\n');`;
  await crashVaultChild(t,program);
  const outcomes=await Promise.allSettled(Array.from({length:8},()=>Vault.open(options(directory))));
  const writers=outcomes.filter((value):value is PromiseFulfilledResult<Vault>=>value.status==='fulfilled');assert.equal(writers.length,1);
  assert.ok(outcomes.filter(value=>value.status==='rejected').every(value=>(value as PromiseRejectedResult).reason.code==='VAULT_BUSY'));await writers[0].value.close();
});

test('wrong credential and ciphertext corruption expose only a generic unlock failure', async t => {
  const directory = await fixture(t), { vault } = await Vault.create({ ...options(directory), name: 'Do not disclose' });
  await vault.close();
  const message = 'Unable to unlock vault. Check your credential or restore a valid backup.';
  await assert.rejects(Vault.open({ ...options(directory), passphrase: 'incorrect secret value' }), (e: any) => e.code === 'UNLOCK_FAILED' && e.message === message && !e.message.includes('Do not disclose'));
  let envelope = JSON.parse(await readFile(join(directory, 'authority.encrypted.json'), 'utf8'));
  envelope.snapshot.tag = 'AAAAAAAAAAAAAAAAAAAAAA';
  await writeFile(join(directory, 'authority.encrypted.json'), JSON.stringify(envelope));
  await assert.rejects(Vault.open(options(directory)), (e: any) => e.code === 'UNLOCK_FAILED' && e.message === message);
  envelope.passphrase.kdf = 'scrypt-1073741824-8-1';
  await writeFile(join(directory, 'authority.encrypted.json'), JSON.stringify(envelope));
  await assert.rejects(Vault.open(options(directory)), code('UNLOCK_FAILED'));
});

test('authenticated envelope detects revision substitution and wrong-vault wrapper substitution', async t => {
  const directory = await fixture(t), { vault } = await Vault.create({ ...options(directory), name: 'A' }); await vault.close();
  const file = join(directory, 'authority.encrypted.json'), envelope = JSON.parse(await readFile(file, 'utf8'));
  envelope.revision = 17; await writeFile(file, JSON.stringify(envelope));
  await assert.rejects(Vault.open(options(directory)), code('UNLOCK_FAILED'));
  envelope.revision = 0; envelope.id = 'substituted-vault-id'; await writeFile(file, JSON.stringify(envelope));
  await assert.rejects(Vault.open(options(directory)), code('UNLOCK_FAILED'));
});

test('single-writer lock excludes another process and releases after close', async t => {
  const directory = await fixture(t), { vault } = await Vault.create({ ...options(directory), name: 'Lock test' });
  await assert.rejects(Vault.open(options(directory)), code('VAULT_BUSY'));
  const moduleURL = new URL('../runtime/vault.ts', import.meta.url).href;
  const program = `import {Vault} from ${JSON.stringify(moduleURL)};try {await Vault.open(${JSON.stringify(options(directory))});process.exitCode=9;}catch(e){if(e.code!=='VAULT_BUSY')process.exitCode=8;}`;
  const child = spawnSync(process.execPath, ['--experimental-strip-types','--input-type=module','-e',program], { windowsHide: true, shell: false, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  await Promise.all([vault.close(), vault.close()]);
  const reopened = await Vault.open(options(directory)); assert.equal(reopened.read().workspace.name, 'Lock test'); await reopened.close();
});

test('serial transactions roll back errors and survive reopen without lost updates', async t => {
  const directory = await fixture(t), { vault } = await Vault.create({ ...options(directory), name: 'Transactions' });
  await assert.rejects(vault.update(state => { state.workspace.name = 'uncommitted'; throw new Error('abort'); }), /abort/);
  assert.equal(vault.read().revision, 0); assert.equal(vault.read().workspace.name, 'Transactions');
  await Promise.all(Array.from({ length: 15 }, (_, index) => vault.update(async state => { await new Promise(done => setTimeout(done, index % 3)); state.activity.push(index); })));
  assert.equal(vault.read().revision, 15); assert.deepEqual(vault.read().activity, Array.from({ length: 15 }, (_, index) => index));
  await assert.rejects(vault.update(async state => { state.activity.push('nested'); await vault.update(() => {}); }), code('REENTRANT_TRANSACTION'));
  assert.equal(vault.read().revision, 15);
  await vault.close();
  const reopened = await Vault.open(options(directory)); assert.equal(reopened.read().activity.length, 15); await reopened.close();
});

test('storage failure cannot publish a failed draft or break the transaction queue', async t => {
  const directory = await fixture(t);
  class FaultAdapter extends ExperimentalFileSnapshotAdapter {
    rejectNext = false;
    async commit(envelope: any, revision: number | null) { if (this.rejectNext) { this.rejectNext = false; throw new Error('injected disk failure'); } return super.commit(envelope, revision); }
  }
  const storage = new FaultAdapter(directory), { vault } = await Vault.create({ ...options(directory), storage, name: 'Rollback' });
  t.after(() => vault.close());
  storage.rejectNext = true;
  await assert.rejects(vault.update(state => { state.activity.push('not committed'); }), /injected disk failure/);
  assert.equal(vault.read().revision, 0); assert.deepEqual(vault.read().activity, []);
  await vault.update(state => { state.activity.push('committed'); });
  assert.deepEqual(vault.read().activity, ['committed']);
});

test('recovery code changes the passphrase without being returned or stored as plaintext again', async t => {
  const directory = await fixture(t), created = await Vault.create({ ...options(directory), name: 'Recovery' });
  await created.vault.update(state => { state.activity.push('history'); }); await created.vault.close();
  await assert.rejects(Vault.recover({ directory, storage: 'experimental-file', recoveryCode: 'wrong-code', newPassphrase: replacement }), code('UNLOCK_FAILED'));
  const recovered = await Vault.recover({ directory, storage: 'experimental-file', recoveryCode: created.recoveryCode, newPassphrase: replacement });
  assert.deepEqual(recovered.read().activity, ['history']); assert.equal(recovered.read().revision, 2); assert.equal((recovered as any).recoveryCode, undefined); await recovered.close();
  await assert.rejects(Vault.open(options(directory)), code('UNLOCK_FAILED'));
  const opened = await Vault.open({ ...options(directory), passphrase: replacement }); await opened.close();
});

test('encrypted backup restores to a different machine path with passphrase or recovery code', async t => {
  const root = await fixture(t), directory = join(root, 'first');
  const { vault, recoveryCode } = await Vault.create({ ...options(directory), name: 'Backup secret' });
  await vault.update(state => { state.activity.push('valuable history'); });
  const backupFile = join(root, 'safe.chausar-backup'); await vault.backup(backupFile); await vault.close();
  const raw = await readFile(backupFile, 'utf8'); assert.ok(!raw.includes('valuable history') && !raw.includes('Backup secret'));
  const restored = await Vault.restore({ ...options(join(root, 'restored')), backupFile });
  assert.deepEqual(restored.read().activity, ['valuable history']); await restored.close();
  const recovered = await Vault.restore({ directory: join(root, 'recovered'), storage: 'experimental-file', recoveryCode, newPassphrase: replacement, backupFile });
  assert.deepEqual(recovered.read().activity, ['valuable history']); await recovered.close();
  await assert.rejects(Vault.restore({ ...options(join(root, 'restored')), backupFile }), code('VAULT_EXISTS'));
  const tampered = JSON.parse(raw); tampered.envelope.snapshot.data = 'AAAA'; await writeFile(backupFile, JSON.stringify(tampered));
  await assert.rejects(Vault.restore({ ...options(join(root, 'bad')), backupFile }), code('UNLOCK_FAILED'));
});

test('export requires explicit plaintext and never clobbers an existing output', async t => {
  const root = await fixture(t), { vault } = await Vault.create({ ...options(join(root, 'vault')), name: 'Exported books' }); t.after(() => vault.close());
  const encrypted = join(root, 'default-export.json'); await vault.export(encrypted);
  assert.ok(!(await readFile(encrypted, 'utf8')).includes('Exported books'));
  const plain = join(root, 'readable.json'); await vault.export(plain, { plaintext: true });
  assert.equal(JSON.parse(await readFile(plain, 'utf8')).workspace.name, 'Exported books');
  await assert.rejects(vault.export(plain, { plaintext: true }), code('OUTPUT_EXISTS'));
  await assert.rejects(vault.backup('../outside.backup'), code('UNSAFE_PATH'));
});

test('path safety rejects roots, relative paths and symlink ancestors', async t => {
  const root = await fixture(t);
  await assert.rejects(safeDirectory('relative-path', true), code('UNSAFE_PATH'));
  await assert.rejects(safeDirectory(resolve('/'), true), code('UNSAFE_PATH'));
  const destination = join(root, 'real'), linked = join(root, 'linked'); await mkdir(destination);
  try { await symlink(destination, linked, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error: any) { if (['EPERM','EACCES'].includes(error.code)) { t.diagnostic('This environment cannot create symbolic links.'); return; } throw error; }
  await assert.rejects(Vault.create({ ...options(join(linked, 'vault')), name: 'Unsafe' }), code('UNSAFE_PATH'));
});

test('delete removes authority and closes the key without deleting unrelated files', async t => {
  const directory = await fixture(t), { vault } = await Vault.create({ ...options(directory), name: 'Delete test' });
  const unrelated = join(directory, 'user-note.txt'); await writeFile(unrelated, 'retain');
  await vault.delete(); assert.throws(() => vault.read(), code('VAULT_CLOSED'));
  await assert.rejects(access(join(directory, 'authority.encrypted.json')));
  await assert.rejects(access(join(directory, 'writer.lock')));
  assert.equal(await readFile(unrelated, 'utf8'), 'retain');
});

test('weak passphrase is refused and file storage requires explicit selection', async t => {
  const directory = await fixture(t);
  await assert.rejects(Vault.create({ ...options(directory), name: 'No', passphrase: 'tiny' }), code('WEAK_PASSPHRASE'));
  await assert.rejects(Vault.create({ directory, name: 'No', passphrase: password, storage: undefined as any }), code('STORAGE_REQUIRED'));
});

test('failed keychain registration rolls back creation and releases the writer lock', async t => {
  const directory = await fixture(t);
  const hook = { async store() { throw new Error('keychain unavailable'); }, async remove() {} };
  await assert.rejects(Vault.create({ ...options(directory), name: 'Never published', keychain: hook }), /keychain unavailable/);
  await assert.rejects(access(join(directory, 'authority.encrypted.json')));
  const created = await Vault.create({ ...options(directory), name: 'Retry' }); await created.vault.close();
});

test('validation failures close transferred adapters and nested backup or close cannot deadlock', async t => {
  const directory = await fixture(t); let closes = 0;
  class OwnedAdapter extends ExperimentalFileSnapshotAdapter { async close() { closes++; } }
  await assert.rejects(Vault.create({ ...options(directory), passphrase: 'short', name: 'Invalid', storage: new OwnedAdapter(directory) }), code('WEAK_PASSPHRASE'));
  assert.equal(closes, 1);
  const { vault } = await Vault.create({ ...options(directory), name: 'Nested ops' }); t.after(() => vault.close());
  await assert.rejects(vault.update(async () => { await vault.backup(join(directory, 'deadlock.backup')); }), code('REENTRANT_TRANSACTION'));
  await assert.rejects(vault.update(async () => { await vault.close(); }), code('REENTRANT_TRANSACTION'));
  assert.equal(vault.read().revision, 0);
});

test('PostgreSQL connection options reject non-loopback and implicit developer configuration before import', async () => {
  await assert.rejects(PostgresSnapshotAdapter.connect({ host: 'example.com', port: 5432, user: 'x', database: 'x', password: 'x', vaultSlot: 'x' } as any), code('INVALID_POSTGRES_CONFIG'));
  await assert.rejects(PostgresSnapshotAdapter.connect({ host: '127.0.0.1', vaultSlot: 'x' } as any), code('INVALID_POSTGRES_CONFIG'));
});

test('PostgreSQL compare-and-swap conflicts roll back without publishing an encrypted snapshot', async () => {
  const statements: Array<{ sql: string; values?: unknown[] }> = []; let released = 0;
  const client = {
    async query(sql: string, values?: unknown[]) { statements.push({ sql, values }); return { rows: sql.startsWith('SELECT revision FROM') ? [{ revision: '9' }] : [] }; },
    release() { released++; },
  };
  const pool = { async query() { return { rows: [] }; }, async connect() { return client; }, async end() {} };
  const adapter = await PostgresSnapshotAdapter.fromPool(pool, 'business.slot');
  await assert.rejects(adapter.commit({ revision: 9 } as any, 8), code('REVISION_CONFLICT'));
  assert.ok(statements.some(statement => statement.sql === 'ROLLBACK'));
  assert.ok(!statements.some(statement => /^(INSERT|UPDATE|COMMIT)/.test(statement.sql)));
  assert.ok(statements.every(statement => !statement.sql.includes('business.slot')));
  assert.equal(released, 1);
});

test('PostgreSQL rejects a storage-slot injection before issuing any schema query', async () => {
  let queries = 0;
  const pool = { async query() { queries++; return { rows: [] }; }, async connect() { throw new Error('not reached'); }, async end() {} };
  await assert.rejects(PostgresSnapshotAdapter.fromPool(pool, "x'; DROP TABLE records;--"), code('INVALID_SLOT'));
  assert.equal(queries, 0);
});

// ---------------------------------------------------------------- custody changes (KEYCHAIN-SPEC 8.1)

async function reopen(directory: string, passphrase: string) { const vault = await Vault.open({ directory, storage: 'experimental-file', passphrase }); await vault.close(); }
test('rewrapPassphrase: the old secret stops opening, the new one opens, the recovery code still opens, revision + 1', async t => {
  const directory = await fixture(t), { vault, recoveryCode } = await Vault.create({ ...options(directory), name: 'Rewrap' });
  const before = vault.read().revision, digest = vault.wrappersDigest;
  await assert.rejects(vault.rewrapPassphrase('short'), code('WEAK_PASSPHRASE'));
  await vault.rewrapPassphrase(replacement);
  assert.equal(vault.read().revision, before + 1);
  assert.notEqual(vault.wrappersDigest, digest);
  assert.equal(await vault.verifyPassphrase(replacement), true);
  assert.equal(await vault.verifyPassphrase(password), false);
  assert.equal(await vault.verifyPassphrase(''), false, 'never throws for a wrong secret');
  await vault.close();
  await assert.rejects(reopen(directory, password), code('UNLOCK_FAILED'));
  await reopen(directory, replacement);
  const recovered = await Vault.recover({ directory, storage: 'experimental-file', recoveryCode, newPassphrase: password });
  await recovered.close();
});

test('rewrapRecovery: a new CHR- code opens, the old one does not; the wrapper digest is public metadata', async t => {
  const directory = await fixture(t), { vault, recoveryCode } = await Vault.create({ ...options(directory), name: 'New code' });
  const fresh = await vault.rewrapRecovery();
  assert.match(fresh, /^CHR-[A-Za-z0-9_-]{43}$/); assert.notEqual(fresh, recoveryCode);
  const envelope = JSON.parse(await readFile(join(directory, 'authority.encrypted.json'), 'utf8'));
  assert.ok(!JSON.stringify(envelope).includes(fresh));
  assert.match(vault.wrappersDigest, /^[a-f0-9]{64}$/);
  await vault.close();
  await assert.rejects(Vault.recover({ directory, storage: 'experimental-file', recoveryCode, newPassphrase: replacement }), code('UNLOCK_FAILED'));
  await (await Vault.recover({ directory, storage: 'experimental-file', recoveryCode: fresh, newPassphrase: replacement })).close();
});

test('transferText opens through Vault.restore with the move code; the live secret does not; the recovery code does', async t => {
  const base = await fixture(t), directory = join(base, 'live');
  const { vault, recoveryCode } = await Vault.create({ ...options(directory), name: 'Move me' });
  await vault.update(state => { state.activity.push({ message: 'moved fact' }); });
  const moveCode = 'CHT-0123456789ABCDEFGHJKMNPQ';
  const text = await vault.transferText(moveCode, { recovery: 'made', madeAt: '2026-10-18T00:00:00.000Z' });
  const parsed = JSON.parse(text);
  assert.equal(parsed.backupFormat, 'chausar.backup.v1');
  assert.deepEqual(parsed.transfer, { format: 'chausar.transfer.v1', madeAt: '2026-10-18T00:00:00.000Z', recovery: 'made' });
  assert.equal(parsed.envelope.id, vault.vaultId); assert.equal(parsed.envelope.revision, vault.read().revision);
  assert.ok(!text.includes('moved fact') && !text.includes(moveCode) && !text.includes('Move me'));
  const file = join(base, 'move.backup'); await writeFile(file, text);
  await assert.rejects(Vault.restore({ directory: join(base, 'a'), storage: 'experimental-file', backupFile: file, passphrase: password }), code('UNLOCK_FAILED'));
  const moved = await Vault.restore({ directory: join(base, 'b'), storage: 'experimental-file', backupFile: file, passphrase: moveCode });
  assert.equal(moved.read().activity.at(-1)?.message, 'moved fact'); await moved.close();
  await (await Vault.restore({ directory: join(base, 'c'), storage: 'experimental-file', backupFile: file, recoveryCode, newPassphrase: replacement })).close();
  await vault.close();
});

test('resealBackups: an old backup opens with the new wrapper and keeps its revision; another vault and a damaged file are skipped', async t => {
  const directory = await fixture(t), other = await fixture(t);
  const { vault } = await Vault.create({ ...options(join(directory, 'live')), name: 'Reseal' });
  const { vault: foreign } = await Vault.create({ ...options(join(other, 'live')), name: 'Other' });
  const old = join(directory, 'old.backup'), alien = join(directory, 'alien.backup'), damaged = join(directory, 'damaged.backup');
  await vault.backup(old); const oldRevision = vault.read().revision;
  await foreign.backup(alien); await foreign.close();
  await vault.backup(damaged);
  const broken = JSON.parse(await readFile(damaged, 'utf8'));
  const tag = Buffer.from(broken.envelope.snapshot.tag, 'base64url'); tag[0] ^= 1; broken.envelope.snapshot.tag = tag.toString('base64url');
  await writeFile(damaged, JSON.stringify(broken));
  await vault.update(state => { state.activity.push({ message: 'after the backup' }); });
  await vault.rewrapPassphrase(replacement);
  const result = await vault.resealBackups([old, alien, damaged, 'relative.backup']);
  assert.deepEqual(result.resealed, [old]);
  assert.deepEqual(result.skipped.map(item => item.reason), ['other-vault', 'not-authentic', 'not-absolute']);
  const again = await vault.resealBackups([old]);
  assert.deepEqual(again.skipped.map(item => item.reason), ['already-current']);
  await vault.close();
  await assert.rejects(Vault.restore({ directory: join(directory, 'r1'), storage: 'experimental-file', backupFile: old, passphrase: password }), code('UNLOCK_FAILED'));
  const restored = await Vault.restore({ directory: join(directory, 'r2'), storage: 'experimental-file', backupFile: old, passphrase: replacement });
  assert.equal(restored.read().revision, oldRevision, 'the backup keeps its own revision');
  assert.equal(restored.read().activity.some(item => item.message === 'after the backup'), false);
  await restored.close();
});

test('replaceFromBackup: the state equals the backup, the revision goes up, another vault is refused, nesting is refused', async t => {
  const directory = await fixture(t), other = await fixture(t);
  const { vault } = await Vault.create({ ...options(join(directory, 'live')), name: 'Replace' });
  await vault.update(state => { state.activity.push({ message: 'kept in the backup' }); });
  const file = join(directory, 'copy.backup'); await vault.backup(file);
  const snapshot = vault.read();
  await vault.update(state => { state.activity.push({ message: 'after the backup' }); state.workspace.name = 'Renamed'; });
  const before = vault.read().revision;
  assert.deepEqual(await vault.replaceFromBackup(file), { revision: before + 1 });
  const state = vault.read();
  assert.equal(state.revision, before + 1); assert.equal(state.workspace.name, 'Replace');
  assert.deepEqual(state.activity, snapshot.activity);
  const { vault: foreign } = await Vault.create({ ...options(join(other, 'live')), name: 'Other' });
  const alien = join(directory, 'alien.backup'); await foreign.backup(alien); await foreign.close();
  await assert.rejects(vault.replaceFromBackup(alien), code('BACKUP_OTHER_BUSINESS'));
  await assert.rejects(vault.update(async () => { await vault.replaceFromBackup(file); }), code('REENTRANT_TRANSACTION'));
  await vault.close();
  const reopened = await Vault.open({ directory: join(directory, 'live'), storage: 'experimental-file', passphrase: password });
  assert.equal(reopened.read().revision, before + 1); await reopened.close();
});
