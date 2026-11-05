// B1 fix round 1 (the founder's naming answers, 5 Nov): a single agent task is a "job" everywhere the owner reads it
// (Work stays the place, client orders stay "orders"); Today's "Questions" filter is "From your agents"; "Settled chats"
// are "Old chats", and the Settle action's word follows; one spelling, "Practice". Code names are unchanged.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOGUES } from '../src/text';

const words = CATALOGUES.en;
const flat = (value: unknown): string => (typeof value === 'string' ? value : value && typeof value === 'object' ? Object.values(value).map(flat).join(' | ') : '');
const lines = Object.entries(words).map(([key, value]) => [key, flat(value).replace(/\{[^}]+\}/g, '')] as const);

/** "Run" as the name of an agent task. The verb ("Run again", "Run by Editor") and code names are not matched. */
const RUN_NOUN = /\b(?:this|a|the|newer|last|next|previous|no|each|every|its|one) (?:coding |conversation )?runs?\b|\bruns (?:going|failed|stopped|finished|already|stay|that)\b|^Runs$|\bNo runs\b|\bfinished runs\b|\bper run\b|\bruns? (?:failed|stops?|is stopping|are stopping)\b|\bduring this run\b|\bfor this run\b|\bnext run\b|\brun's\b/i;

describe('one name for an agent task: a job', () => {
  it('no line calls one a run', () => {
    // A dry run of the books and a dub's run are not agent tasks, so those packs keep their own word.
    const own = /^(?:pb-books-posting|pb-books-settlement|pb-translation-media)\./;
    expect(lines.filter(([key, text]) => !own.test(key) && RUN_NOUN.test(text)).map(([key, text]) => `${key}: ${text}`)).toEqual([]);
  });

  it('says job where it said run', () => {
    expect([words['team.runs'], words['work.focus.runs'], words['team.runsNone'], words['work.focus.noRuns']]).toEqual(['Jobs', 'Jobs', 'No jobs yet.', 'No jobs yet.']);
    expect(words['work.stop.title']).toBe('Stop this job?');
    expect(words['work.line.runs']).toEqual({ one: '{count} job going.', other: '{count} jobs going.' });
    expect(words['custody.refused.RUN_SUPERSEDED']).toBe('A newer job for this order replaced this one, so it cannot be resumed. Open the newer job instead.');
    expect(words['run.question']).toBe('The job asks');
    expect(words['money.policy.runCap']).toBe('Limit per job');
    expect(words['work.emptyLine']).toBe('New orders and jobs show up here.');
  });
});

/**
 * B1 fix round 2 (spec finding 1): the words the engine and the fake engine put on a screen say job too: Team's health
 * lines, Today's spend asks and their receipts, the start-order idea, the spend cap refusals, a missing job, the code
 * agents' refusal, a stopped job's line, the run controls, and the persona and proposal lines. Every quoted sentence in
 * these sources (it starts with a capital and has a space) is read, so a line added later is checked too.
 */
const ROOT = join(import.meta.dirname, '../../..');
const SCREEN_SOURCES = [
  'platform/runtime/venture/views/health.ts', 'platform/runtime/venture/views/queue.ts', 'platform/runtime/venture/views/row-receipts.ts',
  'platform/runtime/venture/views/runs.ts', 'platform/runtime/venture/views/keeper.ts', 'platform/runtime/venture/agents/ideas.ts',
  'platform/runtime/venture/agents/relay.ts', 'platform/runtime/venture/agents/roles.ts', 'platform/runtime/venture/agents/persona.ts',
  'platform/runtime/venture/agents/proposals.ts', 'platform/runtime/venture/agents/export.ts', 'platform/runtime/venture/delivery/harness/loop.ts',
  'platform/runtime/venture/delivery/harness/recheck.ts', 'platform/runtime/venture/delivery/simulate.ts', 'platform/runtime/venture/delivery/run-controls.ts',
  'platform/runtime/venture/money/spend-meter.ts', 'platform/runtime/venture/notify/digest.ts',
  'app/ui/src/engine/fake-agent-extras.ts', 'app/ui/src/engine/fake-agents.ts', 'app/ui/src/engine/fake-retire.ts',
  'app/ui/src/engine/fake-run-controls.ts', 'app/ui/src/engine/fake-team.ts',
];
const QUOTED = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
function sentences(file: string): string[] {
  const source = readFileSync(join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  return [...source.matchAll(QUOTED)].map((match) => (match[1] ?? match[2] ?? match[3]).replace(/\$\{[^}]*\}/g, 'X')).filter((text) => /^[A-Z]/.test(text) && /\s/.test(text));
}

describe('B1 fix round 2: the engine and the fake engine say job too', () => {
  it('no sentence in their screen words calls an agent task a run', () => {
    const all = SCREEN_SOURCES.flatMap((file) => sentences(file).map((text) => [file, text] as const));
    expect(all.length).toBeGreaterThan(200);
    expect(all.filter(([, text]) => RUN_NOUN.test(text)).map(([file, text]) => `${file}: ${text}`)).toEqual([]);
  });
});

describe('the other names', () => {
  it('Today\'s filter for what agents ask is "From your agents"', () => {
    expect(words['today.filter.questions']).toBe('From your agents');
  });

  it('settled chats are old chats, and settling one is moving it there', () => {
    expect(words['business.chats']).toBe('Old chats');
    expect(words['chats.archive.list']).toBe('Old chats');
    expect(words['chats.thread.settle']).toBe('Move to old chats');
    expect(lines.filter(([, text]) => /\bsettle(?:d|s)? (?:chat|it|quiet)|\bsettled chats?\b|never settles|chat settles/i.test(text)).map(([key]) => key)).toEqual([]);
  });

  it('one spelling: practice', () => {
    expect(lines.filter(([, text]) => /practis/i.test(text)).map(([key]) => key)).toEqual([]);
    expect(words['business.practice.lead']).toBe('Practice, then go live.');
  });
});
