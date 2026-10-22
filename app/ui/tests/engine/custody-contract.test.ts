import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOGUES } from '../../src/text';
import { CUSTODY_ERROR_WORDS } from '../../src/engine/fixtures';
import { TRANSFER_MAX_CHARS } from '../../src/parts/custody';

/**
 * Ink keeps two copies of the custody contract (platform/runtime/workspace-custody-contracts.ts): the move file limit it
 * checks before sending, with the words it says then, and the fake engine's refusal words. Both must equal the
 * contract, as the old renderer's copies had to. Read as text: the UI never imports runtime files.
 */
const contract = readFileSync(join(import.meta.dirname, '../../../../platform/runtime/workspace-custody-contracts.ts'), 'utf8');
const errors = contract.slice(contract.indexOf('errors: Object.freeze({'), contract.indexOf('}),', contract.indexOf('errors: Object.freeze({')));
const wordsOf = (code: string) => {
  const match = new RegExp(`\\b${code}: (['"])((?:(?!\\1).)*)\\1`).exec(errors);
  return match?.[2];
};

describe('the custody contract copies', () => {
  it('the move file limit equals TRANSFER.maxTextChars', () => {
    const limit = /maxTextChars: ([\d_]+)/.exec(contract)?.[1]?.replace(/_/g, '');
    expect(Number(limit)).toBe(TRANSFER_MAX_CHARS);
  });

  it("the words Ink says for a file too large are the engine's TRANSFER_TOO_LARGE words", () => {
    expect(CATALOGUES.en['custody.tooLarge']).toBe(wordsOf('TRANSFER_TOO_LARGE'));
  });

  it("the fake engine's refusal words equal CUSTODY_WORDS.errors", () => {
    for (const [code, words] of Object.entries(CUSTODY_ERROR_WORDS)) expect(words, code).toBe(wordsOf(code));
  });
});
