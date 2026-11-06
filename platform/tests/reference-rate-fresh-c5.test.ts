// C5 task 15: the reference rate shipped with a release carries its date and source, and a release never ships a stale
// one silently: this fails when the figure is more than 45 days older than the build date in package.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REFERENCE_RATE } from '../runtime/venture/money/reference-rate.ts';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { chausarBuildDate?: string };
const DAY_MS = 86_400_000;

test('the reference rate is at most 45 days older than the build date in package.json', () => {
  assert.match(pkg.chausarBuildDate ?? '', /^\d{4}-\d{2}-\d{2}$/, 'package.json carries chausarBuildDate');
  const age = (Date.parse(`${pkg.chausarBuildDate}T00:00:00Z`) - Date.parse(`${REFERENCE_RATE.on}T00:00:00Z`)) / DAY_MS;
  assert.ok(age <= 45, `The reference rate of ${REFERENCE_RATE.on} is ${age} days older than the build. Look up the new one and update money/reference-rate.ts.`);
  assert.ok(age >= 0, 'The rate is not from after the build.');
});

test('the rate names its figure, day and source', () => {
  assert.match(REFERENCE_RATE.perUsd, /^\d{1,4}\.\d{1,4}$/);
  assert.match(REFERENCE_RATE.citation.source, /FBIL/);
  assert.match(REFERENCE_RATE.citation.url, /^https:\/\//);
  assert.match(REFERENCE_RATE.citation.checkedOn, /^\d{4}-\d{2}-\d{2}$/);
});
