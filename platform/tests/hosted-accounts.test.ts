// Hosted tier: accounts and sign-in. Email links bound to the asking browser, passkeys from a fresh session,
// hashed session tokens with expiry, and a directory that is sealed on disk. No network, no real email.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountService, FRESH_SESSION_MS, MAGIC_LINK_TTL_MS, SESSION_IDLE_MS, normalizeEmail } from '../runtime/hosted/accounts.ts';
import { HostedCustody } from '../runtime/hosted/custody.ts';
import { FileDirectory, MemoryDirectory } from '../runtime/hosted/directory.ts';
import { DEFAULT_LIMITS } from '../runtime/hosted/limits.ts';
import { DevOutbox, NoMailer } from '../runtime/hosted/mailer.ts';
import { SoftAuthenticator } from './hosted-authenticator.ts';

const rp = { id: 'localhost', name: 'Chausar', origin: 'http://localhost:4320' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const binding = () => randomBytes(32).toString('base64url');

function setup(overrides: Partial<typeof DEFAULT_LIMITS> = {}) {
  let now = Date.parse('2026-10-16T09:00:00.000Z');
  const clock = () => new Date(now);
  const directory = new MemoryDirectory(() => now);
  const outbox = new DevOutbox();
  const accounts = new AccountService({ directory, custody: HostedCustody.ephemeral(), mailer: outbox, rp, limits: { ...DEFAULT_LIMITS, ...overrides }, clock });
  const linkToken = (email: string) => new URL(outbox.latest(email)!.link).hash.replace('#signin=', '');
  return { accounts, directory, outbox, linkToken, advance: (ms: number) => { now += ms; } };
}

test('emails are normalised and checked; nothing else is accepted', () => {
  assert.equal(normalizeEmail('  Owner@Example.COM '), 'owner@example.com');
  for (const bad of ['', 'owner', 'owner@', '@example.com', 'a b@example.com', 'owner@localhost', 'x'.repeat(250) + '@e.com', 42, null]) {
    assert.throws(() => normalizeEmail(bad), code('INVALID_EMAIL'), String(bad));
  }
});

test('an email link signs in once, in the browser that asked, and makes the account on first use', async () => {
  const { accounts, directory, outbox, linkToken } = setup();
  const browser = { binding: binding(), address: '203.0.113.5' };
  const answer = await accounts.requestMagicLink({ email: 'Owner@Example.com' }, browser);
  assert.deepEqual(answer, { sent: true, delivers: false });
  const message = outbox.latest('owner@example.com')!;
  assert.match(message.link, /^http:\/\/localhost:4320\/#signin=[A-Za-z0-9_-]{43}$/);
  assert.equal(JSON.stringify(directory.read()).includes(linkToken('owner@example.com')), false, 'only the hash is stored');

  await assert.rejects(accounts.verifyMagicLink({ token: linkToken('owner@example.com') }, { binding: binding(), address: '198.51.100.9' }), code('MAGIC_LINK_OTHER_BROWSER'));
  const signed = await accounts.verifyMagicLink({ token: linkToken('owner@example.com') }, browser);
  assert.equal(signed.created, true);
  assert.equal(signed.user.email, 'owner@example.com');
  assert.match(signed.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(JSON.stringify(directory.read()).includes(signed.token), false, 'session tokens are stored as hashes');
  await assert.rejects(accounts.verifyMagicLink({ token: linkToken('owner@example.com') }, browser), code('MAGIC_LINK_INVALID'));

  await accounts.requestMagicLink({ email: 'owner@example.com' }, browser);
  const again = await accounts.verifyMagicLink({ token: linkToken('owner@example.com') }, browser);
  assert.equal(again.created, false);
  assert.equal(again.user.id, signed.user.id);
  assert.equal(accounts.authenticate(signed.token).user.id, signed.user.id);
});

test('an email link expires after fifteen minutes and a malformed one is refused plainly', async () => {
  const { accounts, linkToken, advance } = setup();
  const browser = { binding: binding(), address: '203.0.113.5' };
  await accounts.requestMagicLink({ email: 'late@example.com' }, browser);
  advance(MAGIC_LINK_TTL_MS + 1);
  await assert.rejects(accounts.verifyMagicLink({ token: linkToken('late@example.com') }, browser), code('MAGIC_LINK_INVALID'));
  await assert.rejects(accounts.verifyMagicLink({ token: 'short' }, browser), code('MAGIC_LINK_INVALID'));
  await assert.rejects(accounts.verifyMagicLink({ token: 'x'.repeat(43), extra: 1 }, browser), code('INVALID_REQUEST'));
  await assert.rejects(accounts.requestMagicLink({ email: 'a@example.com' }, { binding: 'not-a-binding', address: 'x' }), code('SIGN_IN_RESTART'));
});

test('sign-in emails are rate limited per address and per network, with a wait to show', async () => {
  const { accounts } = setup({ magicLinkPerEmail: { capacity: 2, refillEveryMs: 60_000 }, magicLinkPerAddress: { capacity: 4, refillEveryMs: 60_000 } });
  const browser = { binding: binding(), address: '203.0.113.7' };
  await accounts.requestMagicLink({ email: 'busy@example.com' }, browser);
  await accounts.requestMagicLink({ email: 'busy@example.com' }, browser);
  await assert.rejects(accounts.requestMagicLink({ email: 'busy@example.com' }, browser), (error: any) => error.code === 'RATE_LIMITED' && error.retryAfterSeconds >= 1);
  await accounts.requestMagicLink({ email: 'other@example.com' }, browser);
  await assert.rejects(accounts.requestMagicLink({ email: 'third@example.com' }, browser), code('RATE_LIMITED'));
  await accounts.requestMagicLink({ email: 'third@example.com' }, { ...browser, address: '203.0.113.8' });
});

test('without a mail sender, email sign-in refuses with a plain reason and stores nothing usable', async () => {
  const directory = new MemoryDirectory();
  const accounts = new AccountService({ directory, custody: HostedCustody.ephemeral(), mailer: new NoMailer(), rp, limits: DEFAULT_LIMITS });
  await assert.rejects(accounts.requestMagicLink({ email: 'owner@example.com' }, { binding: binding(), address: 'x' }), code('MAIL_NOT_CONFIGURED'));
});

test('a passkey is added from a fresh session, then signs in alone; a stale session must sign in again first', async () => {
  const { accounts, linkToken, advance } = setup();
  const browser = { binding: binding(), address: '203.0.113.5' };
  await accounts.requestMagicLink({ email: 'keys@example.com' }, browser);
  const signed = await accounts.verifyMagicLink({ token: linkToken('keys@example.com') }, browser);
  const auth = accounts.authenticate(signed.token);

  const authenticator = new SoftAuthenticator('p256', { startCounter: 1 });
  const options = await accounts.passkeyRegisterOptions(auth);
  assert.equal(options.user.name, 'keys@example.com');
  const view = await accounts.passkeyRegisterVerify(auth, { credential: authenticator.create(options, { origin: rp.origin }), name: 'Laptop' });
  assert.deepEqual(view.passkeys.map(p => p.name), ['Laptop']);
  await assert.rejects(accounts.passkeyRegisterVerify(auth, { credential: authenticator.create(options, { origin: rp.origin }) }), code('PASSKEY_CHALLENGE_MISMATCH'), 'a challenge is spent once');

  const elsewhere = { binding: binding(), address: '198.51.100.20' };
  const login = await accounts.passkeyLoginOptions(elsewhere);
  const passkeySession = await accounts.passkeyLoginVerify(authenticator.get(login, { origin: rp.origin }), elsewhere);
  assert.equal(passkeySession.user.id, signed.user.id);
  assert.equal(passkeySession.session.method, 'passkey');

  const replay = authenticator.get(login, { origin: rp.origin });
  await assert.rejects(accounts.passkeyLoginVerify(replay, elsewhere), code('PASSKEY_CHALLENGE_MISMATCH'), 'the login challenge was spent');
  const stranger = new SoftAuthenticator('p256');
  const strangerLogin = await accounts.passkeyLoginOptions(elsewhere);
  await assert.rejects(accounts.passkeyLoginVerify(stranger.get(strangerLogin, { origin: rp.origin, userHandle: null }), elsewhere), code('PASSKEY_UNKNOWN'));

  advance(FRESH_SESSION_MS + 1);
  await assert.rejects(accounts.passkeyRegisterOptions(accounts.authenticate(signed.token)), code('REAUTHENTICATE'));
});

test('sessions end when idle, when signed out, and everywhere at once; the oldest goes past the per-account limit', async () => {
  const { accounts, linkToken, advance } = setup({ sessionsPerAccount: 2 });
  const browser = { binding: binding(), address: '203.0.113.5' };
  const signIn = async () => { await accounts.requestMagicLink({ email: 'many@example.com' }, browser); return accounts.verifyMagicLink({ token: linkToken('many@example.com') }, browser); };
  const first = await signIn(), second = await signIn(), third = await signIn();
  assert.throws(() => accounts.authenticate(first.token), code('UNAUTHENTICATED'), 'the oldest session made room');
  accounts.authenticate(second.token);
  await accounts.signOut(accounts.authenticate(second.token));
  assert.throws(() => accounts.authenticate(second.token), code('UNAUTHENTICATED'));
  accounts.authenticate(third.token);
  advance(SESSION_IDLE_MS + 1);
  assert.throws(() => accounts.authenticate(third.token), code('UNAUTHENTICATED'), 'idle too long');

  const fourth = await signIn(), fifth = await signIn();
  assert.equal((await accounts.signOut(accounts.authenticate(fourth.token), true)).signedOut, 2);
  assert.throws(() => accounts.authenticate(fifth.token), code('UNAUTHENTICATED'));
  assert.throws(() => accounts.authenticate('not a token'), code('UNAUTHENTICATED'));
});

test('a session can point only at its own businesses, and an account is deleted only once it has none', async () => {
  const { accounts, directory, linkToken } = setup();
  const browser = { binding: binding(), address: '203.0.113.5' };
  await accounts.requestMagicLink({ email: 'gone@example.com' }, browser);
  const signed = await accounts.verifyMagicLink({ token: linkToken('gone@example.com') }, browser);
  const auth = accounts.authenticate(signed.token);
  await assert.rejects(accounts.selectBusiness(auth, 'b_' + 'a'.repeat(24)), code('BUSINESS_NOT_FOUND'));
  await assert.rejects(accounts.deleteAccount(auth, { email: 'other@example.com' }), code('CONFIRMATION_REQUIRED'));
  await directory.update(state => { state.users[0].businesses.push({ id: 'b_' + 'c'.repeat(24), name: 'Still Here', createdAt: '2026-10-16T09:00:00.000Z', sealedPassphrase: { v: 1, key: 'k', nonce: 'n', tag: 't', data: 'd' }, workspaceId: null }); });
  await assert.rejects(accounts.deleteAccount(accounts.authenticate(signed.token), { email: 'gone@example.com' }), code('BUSINESSES_REMAIN'));
  await directory.update(state => { state.users[0].businesses = []; });
  assert.deepEqual(await accounts.deleteAccount(accounts.authenticate(signed.token), { email: 'gone@example.com' }), { deleted: true });
  assert.equal(directory.read().users.length, 0);
  assert.throws(() => accounts.authenticate(signed.token), code('UNAUTHENTICATED'));
});

test('the file directory is sealed on disk, survives a reopen, refuses a second server and a wrong key', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'chausar-hosted-directory-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const key = randomBytes(32).toString('base64url');
  const directory = await FileDirectory.open(folder, HostedCustody.fromKey(key));
  await directory.update(state => { state.users.push({ id: 'huser_1', tenantId: 't_' + 'a'.repeat(24), email: 'sealed@example.com', userHandle: 'h', createdAt: 'x', verifiedAt: 'x', status: 'active', passkeys: [], businesses: [] }); });
  const raw = await readFile(join(folder, 'directory.sealed.json'), 'utf8');
  assert.equal(raw.includes('sealed@example.com'), false, 'emails never sit on disk in the clear');
  await assert.rejects(FileDirectory.open(folder, HostedCustody.fromKey(key)), code('HOSTED_DIRECTORY_BUSY'));
  await assert.rejects(directory.update(() => { throw new Error('discarded'); }));
  assert.equal(directory.read().users.length, 1, 'a failed change changed nothing');
  await directory.close();

  const reopened = await FileDirectory.open(folder, HostedCustody.fromKey(key));
  assert.equal(reopened.read().users[0].email, 'sealed@example.com');
  assert.equal(reopened.read().revision, 1);
  await reopened.close();
  await assert.rejects(FileDirectory.open(folder, HostedCustody.fromKey(randomBytes(32).toString('base64url'))), code('CUSTODY_KEY_MISMATCH'));
  await writeFile(join(folder, 'directory.sealed.json'), '{not json');
  await assert.rejects(FileDirectory.open(folder, HostedCustody.fromKey(key)), code('HOSTED_DIRECTORY_INVALID'));
});
