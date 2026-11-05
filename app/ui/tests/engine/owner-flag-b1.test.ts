// B1 fix round 1 (quality findings 1 and 2): a refusal the engine marks as the owner's (owner: true) reaches the page
// exactly as sent, over every transport: the desktop bridge, the local web page, the hosted page and the fake engine.
// The owner-words table speaks only for an unflagged error whose code's engine text is developer text, and words this
// page makes itself (offline, not connected, session ended) are written for the owner where they are thrown.
import { describe, expect, it, vi } from 'vitest';
import { createEngineClient, type ChausarBridge } from '../../src/engine/client';
import { DEVELOPER_WORDS, ownerError } from '../../src/engine/owner-errors';
import { EngineError } from '../../src/engine/types';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { CATALOGUES } from '../../src/text';
import { DEVELOPER_TEXT_CODES } from '../../../../platform/runtime/owner-flag';

const words = CATALOGUES.en;
const TOKEN = 'a'.repeat(64);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Each message the review named, with the code the engine sends it under. */
const NAMED: readonly [string, string][] = [
  ['CONFIRMATION_REQUIRED', 'Confirm the exact reviewed archive and separate closed copy.'],
  ['CONFIRMATION_REQUIRED', 'Confirm a new empty managed activation target.'],
  ['CONFIRMATION_REQUIRED', 'Confirm the export in the app.'],
  ['CONFIRMATION_REQUIRED', 'Type the business name to start a new never-contact list.'],
  ['CONFIRMATION_REQUIRED', 'Confirm the restore in the app.'],
  ['CONFIRMATION_REQUIRED', 'Type your email address to delete your account.'],
  ['NOT_BUILT_YET', 'This part of Chausar is not built yet.'],
  ['NOT_BUILT_YET', 'This tool is not built yet.'],
  ['NOT_BUILT_YET', 'The model recording could not be read, so model calls are off.'],
  ['UNAUTHENTICATED', 'Your session ended. Sign in again.'],
  ['UNAUTHENTICATED', 'This temporary business has ended. Start again.'],
  ['VAULT_LOCKED', 'Choose one of your businesses first.'],
  ['VAULT_LOCKED', 'The temporary business did not open.'],
  ['INVALID_VENTURE_REQUEST', 'Use HTTPS, or local HTTP, without credentials or query parameters.'],
  ['INVALID_VENTURE_REQUEST', 'Send the digest of the consent you read.'],
  ['PRICE_REQUIRED', 'Set your price for Digest Ltd first.'],
  ['INVALID_VENTURE_REQUEST', 'This report has nothing from Vault Studios in it yet.'],
];

const refusedBy = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error as EngineError);

describe('B1 fix round 1: flagged refusals reach the owner unchanged', () => {
  it.each(NAMED)('%s "%s" over the desktop bridge', async (code, message) => {
    const bridge: ChausarBridge = { request: vi.fn(async () => { throw Object.assign(new Error(message), { code, owner: true }); }) };
    const refused = await refusedBy(createEngineClient({ bridge }).request('venture.get', {}));
    expect(refused).toBeInstanceOf(EngineError);
    expect([refused!.code, refused!.message, refused!.owner]).toEqual([code, message, true]);
  });

  it.each(NAMED)('%s "%s" over the local web page', async (code, message) => {
    const fetch = vi.fn(async () => json(code === 'UNAUTHENTICATED' ? 401 : 400, { error: { code, message, owner: true } }));
    const client = createEngineClient({ fetch, location: { hash: `#token=${TOKEN}`, pathname: '/', search: '' }, replaceUrl: vi.fn() });
    expect(await refusedBy(client.request('venture.get', {}))).toMatchObject({ code, message });
  });

  it.each(NAMED)('%s "%s" over the hosted page', async (code, message) => {
    const fetch = vi.fn(async (url: string) => (url === '/api/hosted/session' ? json(200, { token: 'b'.repeat(43) }) : json(code === 'UNAUTHENTICATED' ? 401 : 400, { error: { code, message, owner: true } })));
    const client = createEngineClient({ fetch, hosted: true, location: { hash: '', pathname: '/app/', search: '' }, replaceUrl: vi.fn() });
    expect(await refusedBy(client.request('venture.get', {}))).toMatchObject({ code, message });
  });

  it('a flagged message with a developer word in it is never put in other words', () => {
    for (const [code, message] of NAMED) expect(ownerError({ code, message, owner: true }).message).toBe(message);
  });

  it('through the fake engine, its own refusals are flagged like the engine\'s and kept as written', async () => {
    const client = createFakeClient(new FakeEngine());
    const refused = await refusedBy(client.request('workspace.delete', { confirmation: 'not the name' } as never));
    expect(refused).toMatchObject({ code: 'CONFIRMATION_REQUIRED', message: 'Type the business name to delete it.', owner: true });
  });
});

describe('B1 fix round 1: the table speaks only for unflagged developer text', () => {
  it('an unflagged code whose engine text is developer text says the table\'s line', () => {
    for (const code of DEVELOPER_TEXT_CODES) {
      const shown = ownerError(new EngineError(code, 'Nested vault operations are not supported.'));
      expect(shown.message, code).toBe(words[`errors.${code}`]);
      expect(shown.code).toBe(code);
    }
    expect(ownerError(new EngineError('UNLOCK_FAILED', 'Unable to unlock vault. Check your credential or restore a valid backup.', 'why'))).toMatchObject({
      code: 'UNLOCK_FAILED', reason: 'why', message: "That passphrase didn't open it. Check Caps Lock and try again, or use your recovery code.",
    });
  });

  it('a flagged refusal keeps its words even under a code in the table', () => {
    expect(ownerError({ code: 'CREDENTIAL_UNAVAILABLE', message: 'Protected key storage is unavailable on this computer.', owner: true }).message).toBe('Protected key storage is unavailable on this computer.');
  });

  it('an unflagged message with a developer word says the general line; any other stays as it is', () => {
    for (const message of ['The engine did not start before its deadline.', 'The Ink app is not built. Run npm run build:ui.']) expect(ownerError(new EngineError('ENGINE_START_TIMEOUT', message)).message).toBe(words['errors.general']);
    expect(ownerError(new EngineError('EXPORT_NOT_SAVED', 'The saved folder could not be opened.')).message).toBe('The saved folder could not be opened.');
    expect(DEVELOPER_WORDS).toContain('digest');
    // A bare code in place of words (the phone protocol's refusals) is not words either.
    expect(ownerError(new EngineError('ACCESS_REVOKED', 'ACCESS_REVOKED')).message).toBe(words['errors.general']);
  });

  it('through the fake engine, a wrong passphrase reads in the table\'s words', async () => {
    const client = createFakeClient(new FakeEngine({ closed: true }));
    const refused = await refusedBy(client.request('workspace.open', { folder: 'sitara', passphrase: 'not the passphrase' }));
    expect(refused).toMatchObject({ code: 'UNLOCK_FAILED', message: words['errors.UNLOCK_FAILED'] });
  });
});

describe('B1 fix round 1: words the page makes itself are the owner\'s', () => {
  it('offline: the local page and a phone that cannot reach the computer', async () => {
    const client = createEngineClient({ fetch: vi.fn(async () => { throw new TypeError('Failed to fetch'); }), location: { hash: `#token=${TOKEN}`, pathname: '/', search: '' }, replaceUrl: vi.fn() });
    expect(await refusedBy(client.request('venture.get', {}))).toMatchObject({ code: 'OFFLINE', message: words['errors.client.offline'], owner: true });
    const phone = createEngineClient({ fetch: vi.fn(async () => { throw new TypeError('Failed to fetch'); }), location: { hash: `#pair=${'c'.repeat(43)}`, pathname: '/', search: '' }, replaceUrl: vi.fn() });
    expect(await refusedBy(phone.request('venture.get', {}))).toMatchObject({ code: 'OFFLINE', message: words['errors.client.phoneOffline'], owner: true });
  });

  it('not connected, and a session that ended with no words from the server', async () => {
    const unpaired = createEngineClient({ fetch: vi.fn(), location: { hash: '#/today', pathname: '/', search: '' }, replaceUrl: vi.fn() });
    expect(await refusedBy(unpaired.request('venture.get', {}))).toMatchObject({ code: 'UNAUTHENTICATED', message: words['errors.client.unpaired'], owner: true });
    const ended = createEngineClient({ fetch: vi.fn(async () => new Response('', { status: 401 })), location: { hash: `#token=${TOKEN}`, pathname: '/', search: '' }, replaceUrl: vi.fn() });
    expect(await refusedBy(ended.request('venture.get', {}))).toMatchObject({ code: 'UNAUTHENTICATED', message: words['errors.client.sessionEnded'], owner: true });
  });

  it('none of these lines carries a developer word', () => {
    const lines = Object.entries(words).filter(([key]) => key.startsWith('errors.'));
    for (const [key, line] of lines) for (const word of DEVELOPER_WORDS) expect(String(line), key).not.toMatch(new RegExp(`\\b${word}s?\\b`, 'i'));
  });
});
