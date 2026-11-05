// D12 task 2: the migration ladder. One number for all data (CURRENT_SCHEMA); numbered steps, each pure and re-runnable;
// newer data refused with both numbers; a step never loses a record and never touches its input. The real ladder has
// no step yet (step 1 to 2 and its fixtures come after the rebase, D12 tasks 1, 3 and 5), so the behaviour is checked
// with stand-in steps here, and the real list is checked for its shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_SCHEMA, STEPS, ladderProblems, migrate, type LadderStep } from '../runtime/migrations/ladder.ts';
import { initialState } from '../runtime/contracts.ts';

const AT = '2026-11-06T10:00:00.000Z';
const v1 = () => ({ schemaVersion: 1, revision: 4, workspace: { id: 'workspace_x', name: 'Sample' }, conversations: [{ id: 'c1', kind: 'client', name: 'Asha' }, { id: 'c2', kind: 'old-kind' }], unsupported: [] as unknown[] });

/** Stand-in steps: 1 to 2 fills a default; 2 to 3 moves a removed kind to unsupported with the step's name and reason. */
const ONE_TWO: LadderStep = { from: 1, to: 2, name: '0001-to-0002 (stand-in)', run: state => ({ ...state, schemaVersion: 2, conversations: state.conversations.map((record: any) => ({ consent: 'unknown', ...record })) }) };
const TWO_THREE: LadderStep = {
  from: 2, to: 3, name: '0002-to-0003 (stand-in)', run: (state, at) => {
    const moved = state.conversations.filter((record: any) => record.kind === 'old-kind');
    return { ...state, schemaVersion: 3, conversations: state.conversations.filter((record: any) => record.kind !== 'old-kind'),
      unsupported: [...state.unsupported, ...moved.filter((record: any) => !state.unsupported.some((kept: any) => kept.record?.id === record.id)).map((record: any) => ({ step: '0002-to-0003 (stand-in)', reason: 'This kind of record was removed.', at, record }))] };
  },
};
const STAND_IN = [ONE_TWO, TWO_THREE];
const records = (state: any) => Object.values(state).filter(Array.isArray).reduce((sum: number, list: any) => sum + list.length, 0);

test('the real ladder: steps run from 1 to CURRENT_SCHEMA with no gap, and new State starts at CURRENT_SCHEMA', () => {
  assert.ok(Number.isInteger(CURRENT_SCHEMA) && CURRENT_SCHEMA >= 1);
  assert.deepEqual(ladderProblems(STEPS, CURRENT_SCHEMA), []);
  assert.equal(STEPS.length, CURRENT_SCHEMA - 1);
  assert.equal(initialState('Sample').schemaVersion, CURRENT_SCHEMA);
});

test('ladderProblems names a gap, a step that skips a number, a repeated step and a step past the current number', () => {
  assert.deepEqual(ladderProblems(STAND_IN, 3), []);
  assert.deepEqual(ladderProblems([TWO_THREE], 3), ['no step from 1 to 2']);
  assert.deepEqual(ladderProblems([{ ...ONE_TWO, to: 3 }, TWO_THREE], 3), ['0001-to-0002 (stand-in) goes from 1 to 3; a step moves one number', 'no step from 1 to 2']);
  assert.deepEqual(ladderProblems([ONE_TWO, ONE_TWO, TWO_THREE], 3), ['two steps from 1']);
  assert.deepEqual(ladderProblems(STAND_IN, 2), ['0002-to-0003 (stand-in) goes past the current number 2']);
});

test('data at the current number comes back as it is, with no step run', () => {
  const state = v1();
  const result = migrate(state, AT, STAND_IN.slice(0, 0), 1);
  assert.deepEqual(result, { state, from: 1, to: 1, steps: [] });
});

test('older data climbs every step in order, on a copy, keeping every record', () => {
  const input = v1(), before = structuredClone(input);
  const result = migrate(input, AT, STAND_IN, 3);
  assert.deepEqual([result.from, result.to, result.steps], [1, 3, ['0001-to-0002 (stand-in)', '0002-to-0003 (stand-in)']]);
  assert.deepEqual(input, before, 'the input object is never changed');
  assert.equal((result.state as any).schemaVersion, 3);
  assert.equal(records(result.state), records(input), 'a moved record lands in unsupported; none is lost');
  assert.deepEqual((result.state as any).unsupported.map((item: any) => [item.step, item.record.id]), [['0002-to-0003 (stand-in)', 'c2']]);
  assert.equal((result.state as any).conversations[0].consent, 'unknown');
});

test('each step run twice equals once', () => {
  for (const step of STAND_IN) {
    const start = step.from === 1 ? v1() : ONE_TWO.run(v1(), AT);
    const once = step.run(structuredClone(start), AT);
    assert.deepEqual(step.run(structuredClone({ ...once, schemaVersion: step.from }), AT), once, step.name);
  }
});

test('newer data is refused with both numbers, and the data is not touched', () => {
  const newer = { ...v1(), schemaVersion: 4 };
  assert.throws(() => migrate(newer, AT, STAND_IN, 3), (error: any) => {
    assert.equal(error.code, 'DATA_NEWER');
    assert.deepEqual([error.found, error.supported], [4, 3]);
    assert.match(error.message, /saved by a newer version of Chausar/);
    return true;
  });
  assert.equal(newer.schemaVersion, 4);
});

test('a step that throws, loses a record or forgets its number fails as DATA_MIGRATION_FAILED, naming the step only', () => {
  const throws: LadderStep = { ...ONE_TWO, name: 'throws', run: () => { throw new Error('secret detail Asha'); } };
  const loses: LadderStep = { ...ONE_TWO, name: 'loses', run: state => ({ ...state, schemaVersion: 2, conversations: [] }) };
  const forgets: LadderStep = { ...ONE_TWO, name: 'forgets', run: state => ({ ...state }) };
  for (const [step, words] of [[throws, /throws could not bring the data from 1 to 2/], [loses, /loses would drop 2 records/], [forgets, /forgets did not set the data version to 2/]] as const) {
    assert.throws(() => migrate(v1(), AT, [step], 2), (error: any) => {
      assert.equal(error.code, 'DATA_MIGRATION_FAILED');
      assert.match(error.message, words);
      assert.doesNotMatch(error.message, /Asha/, 'no business words in the error');
      return true;
    });
  }
});

test('a version below every step, or not a whole number, is refused', () => {
  assert.throws(() => migrate({ ...v1(), schemaVersion: 0 }, AT, STAND_IN, 3), (error: any) => error.code === 'DATA_MIGRATION_FAILED' && /no step from 0/.test(error.message));
  assert.throws(() => migrate({ ...v1(), schemaVersion: '1' }, AT, STAND_IN, 3), (error: any) => error.code === 'DATA_INVALID');
});

test('a step file is pure: it imports nothing but types (no file, network or clock)', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const folder = new URL('../runtime/migrations/steps/', import.meta.url);
  for (const name of (await readdir(folder)).filter(file => file.endsWith('.ts'))) {
    const text = await readFile(new URL(name, folder), 'utf8');
    const imports = [...text.matchAll(/^import\s+(?!type\b)[^;]*;/gm)].map(match => match[0]);
    assert.deepEqual(imports, [], name);
    assert.doesNotMatch(text, /\bDate\.now\(|new Date\(|Math\.random\(|process\.|fetch\(/, name);
  }
});
