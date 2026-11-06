import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOGUES, format } from '../../src/text';
import { STATE_TONES, STATE_WORDS, stateWord, type StateKind } from '../../src/parts/states';

/*
 * W4 4J22a: every wave 4 verdict, outcome, run state and item state the engine sends has words here, in both
 * languages, read from the engine's exported lists (delivery/verdicts.ts VERDICT_VOCABULARY) and from its contract
 * types where it exports no list (routine runs, guidance lines, contract items). A value the engine adds fails here
 * until the screen words it; an unknown value is "Unknown", never a pass.
 */

const ENGINE_DIR = join(import.meta.dirname, '../../../../platform/runtime/venture');
const CONTRACTS = readFileSync(join(ENGINE_DIR, 'contracts.ts'), 'utf8');
// The engine's own lists (4J14's one vocabulary), read from the file that exports them: a drift test, not a copy. Read
// as text, so the UI's typecheck never takes in the engine's sources.
const VERDICTS = readFileSync(join(ENGINE_DIR, 'delivery/verdicts.ts'), 'utf8');

/** One `export const NAME = frozen([...] as const)` list of verdicts.ts. */
function listOf(name: string): string[] {
  const found = new RegExp(`export const ${name} = frozen\\(\\[([^\\]]+)\\]`).exec(VERDICTS);
  if (!found) throw new Error(`not found in verdicts.ts: ${name}`);
  return [...found[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

/** VERDICT_VOCABULARY names these lists (checks, judgments, drafts, fixes, outcomes, findings) and the Unknown word. */
const VERDICT_VOCABULARY = {
  checks: listOf('CHECK_OUTCOMES'), judgments: listOf('JUDGMENTS'), drafts: listOf('DRAFT_VERDICTS'), fixes: listOf('FIX_STATUSES'),
  outcomes: listOf('RUN_OUTCOMES'), findings: listOf('FINDING_CLASSES'),
  lines: { unknown: /export const UNKNOWN = '([^']+)'/.exec(VERDICTS)![1]! },
};

it('reads the lists the engine names in VERDICT_VOCABULARY', () => {
  expect(VERDICTS).toMatch(/VERDICT_VOCABULARY = Object\.freeze\(\{\s*checks: CHECK_OUTCOMES, judgments: JUDGMENTS, drafts: DRAFT_VERDICTS, fixes: FIX_STATUSES, outcomes: RUN_OUTCOMES, findings: FINDING_CLASSES,/);
});

/** The string literals of one exported union in contracts.ts, or of one field inside a type. */
function unionOf(pattern: RegExp): string[] {
  const found = pattern.exec(CONTRACTS);
  if (!found) throw new Error(`not found in contracts.ts: ${pattern}`);
  return [...found[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

const ENGINE: Partial<Record<StateKind, readonly string[]>> = {
  check: VERDICT_VOCABULARY.checks,
  judgment: VERDICT_VOCABULARY.judgments,
  verdict: VERDICT_VOCABULARY.drafts,
  fix: VERDICT_VOCABULARY.fixes,
  outcome: VERDICT_VOCABULARY.outcomes,
  finding: VERDICT_VOCABULARY.findings,
  routine: unionOf(/export type RoutineRunState = ([^;]+);/),
  guidance: unionOf(/export type GuidanceLineView = \{[^}]*state: ([^;}]+)[;}]/),
  contractItem: unionOf(/export type OrderContractItem = \{[^}]*state: ([^;]+);/),
};

const en = (key: string) => format(CATALOGUES.en, 'en', key);

describe('state words for wave 4 (4J22a): drift against the engine lists', () => {
  it('words every value of every engine list, no more and no fewer', () => {
    for (const [kind, values] of Object.entries(ENGINE)) {
      expect(values.length, kind).toBeGreaterThan(0);
      expect(Object.keys(STATE_WORDS[kind as StateKind]).sort(), kind).toEqual([...values].sort());
    }
  });

  it('gives each a text key in both languages and a tone', () => {
    for (const [kind, values] of Object.entries(ENGINE)) {
      for (const value of values) {
        const word = stateWord(kind as StateKind, value);
        expect(CATALOGUES.en[word.key], word.key).toBeDefined();
        expect(CATALOGUES.hi[word.key], word.key).toBeDefined();
        expect(STATE_TONES).toContain(word.tone);
      }
    }
  });

  it('says the engine words, never a pass for an unknown, and Delivered for a finished routine', () => {
    expect(VERDICT_VOCABULARY.checks.map((v) => en(stateWord('check', v).key))).toEqual(['Passed', 'Failed', 'Not run', 'Not checked']);
    expect(VERDICT_VOCABULARY.outcomes.map((v) => en(stateWord('outcome', v).key))).toEqual(['Success', 'Not checked', 'Failed']);
    expect(VERDICT_VOCABULARY.fixes.map((v) => en(stateWord('fix', v).key))).toEqual(['Fixed', 'Partially fixed', 'Not fixed', 'Unverified']);
    expect(VERDICT_VOCABULARY.drafts.map((v) => en(stateWord('verdict', v).key))).toEqual(['Pass', 'Rewrite', 'Do not send']);
    expect(en(stateWord('check', 'unknown').key)).toBe(VERDICT_VOCABULARY.lines.unknown);
    expect(stateWord('check', 'unknown').tone).toBe('neutral');
    expect(en(stateWord('routine', 'completed').key)).toBe('Delivered');
    expect(en(stateWord('routine', 'failed').key)).toBe('Failed');
    expect(en(stateWord('routine', 'interrupted').key)).toBe('Interrupted');
    // Only a passed check and a success are green; amber only where the owner is waited on.
    expect(stateWord('check', 'pass').tone).toBe('done');
    expect(stateWord('outcome', 'success').tone).toBe('done');
    expect(stateWord('outcome', 'not-checked').tone).toBe('neutral');
    expect(stateWord('check', 'fail').tone).toBe('fail');
    expect(stateWord('routine', 'needs-input').tone).toBe('wait');
    for (const kind of Object.keys(ENGINE) as StateKind[]) {
      for (const value of ENGINE[kind]!) {
        const { key, tone } = stateWord(kind, value);
        if (tone === 'wait') expect(en(key), key).toMatch(/\byour?\b/i);
      }
    }
  });
});
