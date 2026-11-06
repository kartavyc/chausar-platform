// B1 fix round 3 (review 3, finding 1): a refusal flagged as the owner's reaches the screen exactly as the engine wrote
// it, so no such refusal anywhere in the engine may say a developer word (owner-flag.ts DEVELOPER_WORDS, through
// bannedIn). This walks every source under platform/runtime and platform/shared and reads each refusal (fixtures/refusal-scan.ts). A refusal
// travels as the owner's unless it is thrown as InternalError (internalCheck, new InternalError, a check imported as
// internalCheck, or a helper of the same file that throws InternalError), or its code is one the app says in its own
// words (refusalTravel). Each hit is said in plain words, thrown as InternalError, or named in KEPT_WORDS (file and
// code, fixtures/refusal-scan.ts) with the reason it stays.
// B1 fix round 4: a code held in a name (check(cond, BAD, 'words'), new ChausarError(BAD, 'words'), a code passed in as
// a parameter) is read too. What this does not read: words held in a name or a constant (SETUP_WORDS.x, closed.line,
// a message variable); only words written out in quotes at the call are checked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bannedIn, refusalTravel } from '../runtime/owner-flag.ts';
import { KEPT_WORDS, callee, code as masked, refusalsIn, sourcesUnder, throwsInternal } from './fixtures/refusal-scan.ts';

const ROOT = new URL('../runtime/', import.meta.url);
const ALLOWED = KEPT_WORDS;

test('B1 fix round 3: no refusal the engine flags as the owner\'s says a developer word', async () => {
  const sources = [...await sourcesUnder(ROOT), ...await sourcesUnder(new URL('../shared/', import.meta.url))];
  const all = refusalsIn(sources);
  assert.ok(all.length > 2000, `read ${all.length} refusals`);
  const used = new Set<string>();
  const hits: string[] = [];
  for (const { file, code, words, internal } of all) {
    if (refusalTravel(code, words, internal ? false : undefined) !== 'owner' || bannedIn(words).length === 0) continue;
    const key = `${file} ${code}`;
    if (ALLOWED[key]) used.add(key);
    else hits.push(`${key} [${bannedIn(words)}]: ${words}`);
  }
  assert.deepEqual(hits, [], `${hits.length} flagged refusals say a developer word`);
  assert.deepEqual(Object.keys(ALLOWED).filter(key => !used.has(key)), [], 'every allowed refusal is still there');
});

test('B1 fix round 3: the scan reads the calls it has to', () => {
  const source = [
    'import {internalCheck as check} from "x";',
    'check(a,\'ONE_CODE\',\'The vault (a) closed.\');',
  ].join('\n');
  assert.equal(callee(masked(source), source.indexOf('\'ONE_CODE\'')), 'check');
  assert.equal(throwsInternal(source, 'check'), true);
  const plain = 'throw new ChausarError(`x${f(1)}` ? \'TWO_CODE\' : \'TWO_CODE\', \'Send the digest.\');';
  assert.equal(callee(masked(plain), plain.indexOf('\'TWO_CODE\', \'Send')), 'ChausarError');
  assert.equal(throwsInternal('function fail(c,m){ throw new InternalError(c,m); }', 'fail'), true);
  assert.equal(throwsInternal('function fail(c,m){ throw new ChausarError(c,m); }', 'fail'), false);
  assert.equal(throwsInternal('import {check} from "x";', 'check'), false);
  // Words first, and a code read after another code in quotes.
  assert.deepEqual(refusalsIn([['a.ts', 'throw refusalError(new Error(\'The vault.\'), { code: \'THREE_CODE\' });\ncheck(x===\'ENVELOPE\',\'FOUR_CODE\',\'No envelope.\');']]),
    [{ file: 'a.ts', code: 'FOUR_CODE', words: 'No envelope.', internal: false }, { file: 'a.ts', code: 'THREE_CODE', words: 'The vault.', internal: false }]);
});

test('B1 fix round 4: the scan reads a code held in a name, by each shape', () => {
  const named = 'const BAD = \'PACK_INVALID\', CODE = \'PACK_CODE_REFUSED\';\n';
  // check(cond, NAME, 'words'): the name's code from the same file.
  assert.deepEqual(refusalsIn([['a.ts', `${named}check(ok(x), BAD, 'No saved credential.');`]]),
    [{ file: 'a.ts', code: 'PACK_INVALID', words: 'No saved credential.', internal: false }]);
  // new ChausarError(NAME, 'words'), the second name of a list, words joined with +.
  assert.deepEqual(refusalsIn([['a.ts', `${named}throw new ChausarError(CODE, 'The vault ' + 'closed.');`]]),
    [{ file: 'a.ts', code: 'PACK_CODE_REFUSED', words: 'The vault closed.', internal: false }]);
  // A code passed in as a parameter reads as the parameter's name, so it travels as the owner's.
  assert.deepEqual(refusalsIn([['a.ts', 'function url(v: string, code: string) { check(v.length > 0, code, `Use a public address.`); }']]),
    [{ file: 'a.ts', code: 'code', words: 'Use a public address.', internal: false }]);
  // Thrown as InternalError, a named code stays internal; a name in another call, or words held in a name, are not read.
  assert.deepEqual(refusalsIn([['a.ts', `${named}internalCheck(x, BAD, 'The vault.');`]]).map(item => item.internal), [true]);
  assert.deepEqual(refusalsIn([['a.ts', `${named}format(x, BAD, 'The vault.'); check(x, BAD, held.line);`]]), []);
});
