// One-shot B1 (SCREENS P1, bug 12): an engine refusal reaches a screen in the owner's words. A code in the owner-words
// table says its line from text/en/errors.json; a plain engine message stays as it is; a message that still carries a
// developer word (vault, credential, engine, fixture, digest, an npm command) becomes the general line. Real and fake
// clients do this at the same edge, so no screen shows "Unable to unlock vault. Check your credential...".
import { describe, expect, it } from 'vitest';
import { ownerError } from '../../src/engine/owner-errors';
import { EngineError } from '../../src/engine/types';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { CATALOGUES } from '../../src/text';

const words = CATALOGUES.en;

describe('owner words for engine refusals', () => {
  it('a code in the table says its own line, and keeps the code, the reason and the engine text', () => {
    const error = ownerError(new EngineError('UNLOCK_FAILED', 'Unable to unlock vault. Check your credential or restore a valid backup.', 'why'));
    expect(error).toBeInstanceOf(EngineError);
    expect(error.code).toBe('UNLOCK_FAILED');
    expect(error.reason).toBe('why');
    expect(error.message).toBe("That passphrase or code didn't open it. Check Caps Lock and try again.");
    expect(error.detail).toBe('Unable to unlock vault. Check your credential or restore a valid backup.');
  });

  it('a plain engine message stays as the engine wrote it', () => {
    const error = ownerError(new EngineError('PRICE_REQUIRED', 'Set your price for Monthly visits first.'));
    expect(error.message).toBe('Set your price for Monthly visits first.');
  });

  it('a message with a developer word becomes the general line', () => {
    for (const message of ['Send the digest of the row you saw.', 'The Ink app is not built. Run npm run build:ui, then start the server again.', 'Nested vault operations are not supported.', 'The engine could not complete the request.']) {
      expect(ownerError(new EngineError('SOMETHING_ELSE', message)).message, message).toBe(words['errors.general']);
    }
  });

  it('an error that is not the engine\'s is read the same way', () => {
    expect(ownerError({ code: 'UNLOCK_FAILED', message: 'Unable to unlock backup. Check your credential or use a valid backup.' }).message).toBe(words['errors.UNLOCK_FAILED']);
    expect(ownerError(new Error('plain words')).message).toBe('plain words');
  });

  it('every line in the table is plain English with no developer word in it', () => {
    const lines = Object.entries(words).filter(([key]) => key.startsWith('errors.'));
    expect(lines.length).toBeGreaterThan(5);
    for (const [key, line] of lines) expect(String(line), key).not.toMatch(/\b(?:vault|credential|engine|fixture|digest|npm|transaction|snapshot)\b/i);
  });

  it('through the fake client, a wrong passphrase reads in owner words', async () => {
    const client = createFakeClient(new FakeEngine({ closed: true }));
    const refused = await client.request('workspace.open', { folder: 'sitara', passphrase: 'not the passphrase' }).then(() => null, (error: unknown) => error as EngineError);
    expect(refused).toMatchObject({ code: 'UNLOCK_FAILED', message: "That passphrase or code didn't open it. Check Caps Lock and try again." });
  });
});
