import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ui = fileURLToPath(new URL('../../app/ui/src/', import.meta.url));
async function sources(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  const children = await Promise.all(entries.map(entry => entry.isDirectory() ? sources(join(folder, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(folder, entry.name)] : []));
  return children.flat();
}

test('error words have one browser-safe implementation and preserve every input shape', async () => {
  const { messageOf } = await import('../shared/errors.ts');
  for (const [input, expected] of [[new Error('Plain refusal'), 'Plain refusal'], ['Owner words', 'Owner words'], [null, 'null'], [undefined, 'undefined'], [17, '17']]) {
    assert.equal(messageOf(input), expected);
  }
});

test('UI components import the error formatter instead of redefining it', async () => {
  const duplicates: string[] = [];
  for (const file of await sources(ui)) {
    if (/\b(?:function\s+messageOf\s*\(|(?:const|let|var)\s+messageOf\s*=)/.test(await readFile(file, 'utf8'))) duplicates.push(file);
  }
  assert.deepEqual(duplicates, []);
});
test('digest checks accept only lowercase 64-digit hex strings', async () => {
  const { isDigest } = await import('../shared/digest.ts');
  assert.equal(isDigest('a'.repeat(64)), true);
  for (const value of ['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), 123, null, { toString: () => 'a'.repeat(64) }]) assert.equal(isDigest(value), false);
});

test('whole-value hashing shares the established UTF-8 and byte representation', async () => {
  const { sha256Hex } = await import('../runtime/hash.ts');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex(new Uint8Array([97, 98, 99])), sha256Hex('abc'));
  assert.equal(sha256Hex(Buffer.from('नमस्ते')), sha256Hex('नमस्ते'));
});

test('runtime and UI use the shared lowercase digest pattern', async () => {
  const pattern = '/' + '^[a-f0-9]{64}$' + '/';
  const duplicates: string[] = [];
  for (const file of [...await sources(fileURLToPath(new URL('../runtime/', import.meta.url))), ...await sources(ui)]) {
    if ((await readFile(file, 'utf8')).includes(pattern)) duplicates.push(file);
  }
  assert.deepEqual(duplicates, []);
});