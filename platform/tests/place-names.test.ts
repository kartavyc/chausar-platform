// 15 Nov 2026 (the first walk of the built Windows app): words pointed the owner to a place called "Business" that the
// navigation calls "Settings". Some of those words are written by the engine ("Add your GSTIN under Business, Prices
// first."), and the fake engine copies them. The app's own text keys are held by app/ui/tests/place-names.test.ts; this
// holds the engine's lines and the fake's: none names the old place, and the place they do name is the navigation's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const posix = (path: string) => path.split(sep).join('/');

function sources(folder: string, keep: (name: string) => boolean): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return sources(path, keep);
    return keep(entry.name) ? [path] : [];
  });
}

/** "Business" used as a place: after a word that points somewhere and before a comma, a full stop or a page's name. */
const OLD_PLACE = /\b(?:in|under|to|from|on|at|open|see|into)\s+Business\b(?=\s*[,.>:;)'"`]|\s*$)|\bBusiness\s*>\s*[A-Z]|\bBusiness, [A-Z]|\bMoney and Business\b/;
/** A line of code, not of comment: the words here are the ones an owner can read. */
const isCode = (line: string) => !/^\s*(?:\/\/|\*|\/\*)/.test(line);

test('no line the engine or the fake engine writes names the old place "Business"', () => {
  const files = [
    ...sources(join(ROOT, 'platform', 'runtime'), name => name.endsWith('.ts')),
    ...sources(join(ROOT, 'app', 'ui', 'src', 'engine'), name => /^fake.*\.ts$/.test(name) || name === 'fixtures.ts'),
    ...sources(join(ROOT, 'app', 'desktop'), name => name.endsWith('.cjs')),
  ];
  assert.ok(files.length > 500, 'the sources were found');
  const found = files.flatMap(file => readFileSync(file, 'utf8').split('\n').flatMap((line, index) => (isCode(line) && OLD_PLACE.test(line.replace(/\/\/[^'"`]*$/, '')) ? [`${posix(relative(ROOT, file))}:${index + 1}: ${line.trim().slice(0, 200)}`] : [])));
  assert.deepEqual(found, []);
});

test('the place the engine\'s lines name is the navigation\'s own label, with a page Settings has', () => {
  const words = JSON.parse(readFileSync(join(ROOT, 'app', 'ui', 'src', 'text', 'en', 'common.json'), 'utf8')) as Record<string, string>;
  assert.equal(words['place.business'], 'Settings');
  assert.equal(words['business.prices'], 'Prices');
  const text = (path: string) => readFileSync(join(ROOT, ...path.split('/')), 'utf8');
  for (const [path, line] of [
    ['platform/runtime/venture/money/tax-working.ts', 'Add your GSTIN under Settings, Prices to see the GST working.'],
    ['platform/runtime/venture/money/export-formats.ts', 'Add your GSTIN under Settings, Prices first.'],
    ['platform/runtime/venture/agents/questions.ts', 'Read it in Settings, Prices.'],
    ['platform/runtime/venture/delivery/harness/patches.ts', 'set by you in Money and Settings,'],
    // The fake answers in the engine's words.
    ['app/ui/src/engine/fake-country-money.ts', 'Add your GSTIN under Settings, Prices to see the GST working.'],
    ['app/ui/src/engine/fake-agents.ts', 'set by you in Money and Settings,'],
  ] as const) assert.ok(text(path).includes(line), `${path}: ${line}`);
});
