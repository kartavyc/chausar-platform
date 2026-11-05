// B1 fix round 3 (review 3, finding 1, part c): the fake engine flags a refusal by the engine's rule exactly
// (owner-flag.ts refusalTravel), with no rule of its own on top, so a fake-based test sees what the engine would show.
// Its own refusals therefore say no developer word where the engine would flag them: the same scan as the engine's
// (platform/tests/fixtures/refusal-scan.ts), over every fake source, and the same kept outside-tool words.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EngineError } from '../../src/engine/types';
import { fakeFlags } from '../../src/engine/fake';
import { INTERNAL_LINE_CODES, bannedIn, refusalTravel } from '../../../../platform/runtime/owner-flag';
import { KEPT_WORDS, refusalsIn, sourcesUnder } from '../../../../platform/tests/fixtures/refusal-scan';

const KEPT_CODES = new Set(Object.keys(KEPT_WORDS).map(key => key.split(' ')[1]));

describe('B1 fix round 3: the fake follows the engine\'s rule exactly', () => {
  it('flags what the engine flags, developer words or not', () => {
    for (const [code, message] of <[string, string][]>[['PRICE_REQUIRED', 'Set your price first.'], ['PRICE_REQUIRED', 'The vault is closed.'], ['METHOD_NOT_ALLOWED', 'Send the digest.'],
      ['WEAK_PASSPHRASE', 'Use a longer passphrase.'], ['UNLOCK_FAILED', 'Unable to unlock vault.'], ['ACCESS_REVOKED', 'ACCESS_REVOKED']]) {
      const internal = INTERNAL_LINE_CODES.includes(code) ? false : undefined;
      expect(fakeFlags(new EngineError(code, message)), `${code}: ${message}`).toBe(refusalTravel(code, message, internal) === 'owner');
    }
    expect(fakeFlags(new EngineError('PRICE_REQUIRED', 'The vault is closed.'))).toBe(true);
  });

  it('so none of its own flagged refusals says a developer word', async () => {
    const all = refusalsIn(await sourcesUnder(pathToFileURL(join(import.meta.dirname, '../../src/engine/') + '/'), path => /(^|\/)fake[^/]*\.ts$/.test(path)));
    expect(all.length).toBeGreaterThan(1500);
    const hits = all.filter(({ code, words }) => !KEPT_CODES.has(code) && bannedIn(words).length > 0 && fakeFlags(new EngineError(code, words)))
      .map(({ file, code, words }) => `${file} ${code} [${bannedIn(words)}]: ${words}`);
    expect(hits).toEqual([]);
  });
});
