import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { laneSubPlaces } from '../src/places/subplaces/index.ts';
import { laneWords } from '../src/text/lanes/index.ts';
import { handlesLearning, LEARNING_ADDRESS } from '../src/screens/learning/address.ts';
import { ACCOUNT_CLASSES, CONFIDENCE, EDIT_STATUSES, EVIDENCE_ORIGINS, FIELD_TYPES, PROPOSAL_STATUSES, SEND_LEVELS } from '../src/screens/learning/contract.ts';
import type { PlaceId } from '../src/app/presentation.ts';

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as Record<string, string>;
const shared = read('../src/text/en.json');
const own = laneWords['learning-ext']!;
const screens = new URL('../src/screens/learning/', import.meta.url);
const source = readdirSync(screens).filter(name => name.endsWith('.tsx')).map(name => readFileSync(new URL(name, screens), 'utf8')).join('\n');

test('learning-ext adds exactly one Books sub-place, named in both languages', () => {
  assert.deepEqual(laneSubPlaces['learning-ext'], [{ place: 'books', id: 'learning' }]);
  assert.equal(own.en['SH-01.sub.books.learning'], 'Learning');
  assert.ok(own.hi['SH-01.sub.books.learning']);
  assert.equal('SH-01.sub.books.learning' in shared, false, 'the sub-place is new, not an authored one');
});

test('the words file has the same keys in English and Hindi, all under LX. or the sub-place name, none shared', () => {
  assert.deepEqual(Object.keys(own.hi).sort(), Object.keys(own.en).sort());
  for (const key of Object.keys(own.en)) {
    assert.ok(key === 'SH-01.sub.books.learning' || key.startsWith('LX.'), key);
    assert.equal(key in shared, false, `${key} repeats text/en.json`);
    for (const [lane, words] of Object.entries(laneWords)) if (lane !== 'learning-ext') assert.equal(key in words.en, false, `${key} repeats ${lane}`);
    assert.ok(own.en[key]!.trim() && own.hi[key]!.trim(), key);
    // Both languages fill the same slots, so no value is lost in Hindi.
    const slots = (text: string) => [...text.matchAll(/\{([a-zA-Z]+)\}/g)].map(m => m[1]).sort();
    assert.deepEqual(slots(own.hi[key]!), slots(own.en[key]!), `${key}: slots differ`);
  }
});

test('every word the screens name is in the catalogue', () => {
  const fixed = [...source.matchAll(/lx\('([^']+)'/g)].map(m => m[1]!);
  const ternary = [...source.matchAll(/'((?:edits|key|first|edit)\.[A-Za-z.-]+)'/g)].map(m => m[1]!);
  const families: Record<string, readonly string[]> = {
    'status.': EDIT_STATUSES, 'proposal.': PROPOSAL_STATUSES, 'confidence.': CONFIDENCE, 'type.': FIELD_TYPES, 'evidence.': EVIDENCE_ORIGINS,
    'send.': SEND_LEVELS, 'sendWord.': SEND_LEVELS, 'class.': ACCOUNT_CLASSES, 'section.': ['edits', 'first', 'key', 'model'],
    'edits.filter.': ['awaiting-review', 'failed-answer-key', 'all'], 'nulls.': ['reject', 'exclude'],
    'op.': ['billed', 'received', 'earned', 'refunds', 'costs', 'net_sales', 'margin', 'aging'],
    'pack.': ['ecommerce', 'services', 'saas', 'manufacturing', 'retail', 'distributor'],
  };
  const dynamic = Object.entries(families).flatMap(([prefix, values]) => values.map(v => `${prefix}${v}`));
  for (const key of [...fixed, ...ternary.filter(k => !k.endsWith('.')), ...dynamic]) assert.ok(`LX.${key}` in own.en, `LX.${key} is missing`);
});

test('the module draws exactly Books, Learning', () => {
  assert.deepEqual(LEARNING_ADDRESS, { place: 'books', sub: 'learning' });
  assert.equal(handlesLearning({ place: 'books', sub: 'learning' }), true);
  assert.equal(handlesLearning({ place: 'books', sub: 'learning', sheet: 'x' }), true);
  for (const other of [{ place: 'books' }, { place: 'books', sub: 'sources' }, { place: 'books', sub: 'accounts' }, { place: 'work', sub: 'learning' }, { place: 'trust', sub: 'sharing' }] as { place: PlaceId; sub?: string }[])
    assert.equal(handlesLearning(other), false, JSON.stringify(other));
});
