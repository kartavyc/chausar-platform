// B1 fix round 1 (the founder's naming answers, 5 Nov): a single agent task is a "job" everywhere the owner reads it
// (Work stays the place, client orders stay "orders"); Today's "Questions" filter is "From your agents"; "Settled chats"
// are "Old chats", and the Settle action's word follows; one spelling, "Practice". Code names are unchanged.
import { describe, expect, it } from 'vitest';
import { CATALOGUES } from '../src/text';

const words = CATALOGUES.en;
const flat = (value: unknown): string => (typeof value === 'string' ? value : value && typeof value === 'object' ? Object.values(value).map(flat).join(' | ') : '');
const lines = Object.entries(words).map(([key, value]) => [key, flat(value).replace(/\{[^}]+\}/g, '')] as const);

describe('one name for an agent task: a job', () => {
  it('no line calls one a run', () => {
    // A dry run of the books and a dub's run are not agent tasks, so those packs keep their own word.
    const own = /^(?:pb-books-posting|pb-books-settlement|pb-translation-media)\./;
    const noun = /\b(?:this|a|the|newer|last|next|previous) (?:coding |conversation )?run\b|\bruns (?:going|failed|stopped|finished|already|stay)\b|^Runs$|\bNo runs\b|\bfinished runs\b|\bper run\b|\bruns? (?:failed|stops?|is stopping|are stopping)\b|\bduring this run\b|\bfor this run\b|\bnext run\b/i;
    expect(lines.filter(([key, text]) => !own.test(key) && noun.test(text)).map(([key, text]) => `${key}: ${text}`)).toEqual([]);
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
