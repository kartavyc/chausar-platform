import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { InvalidReply, run } from '../src/screens/jobs-ext/check.ts';
import { budget, failureLimit, laneJobList, missedList, missedSeen, procedure, procedureDetail, procedureList, proposalList, readyMadeList, skillFile, stopRules } from '../src/screens/jobs-ext/contract.ts';
import { subPlaces } from '../src/places/subplaces/jobs-ext.ts';
import { words } from '../src/text/lanes/jobs-ext.ts';

// Synthetic replies shaped by platform/runtime/procedures/methods.ts and platform/runtime/jobs-ext/methods.ts.
const DIGEST = 'a'.repeat(64);
const steps = [
  { kind: 'calculate', title: 'Work out what each customer owes', operation: 'aging' },
  { kind: 'question', title: 'Remind, wait or ask', id: 'decide', options: ['remind', 'wait'], rule: { feature: 'days_overdue', threshold: 0.8, minSupport: 2,
    buckets: [{ when: { min: 1, max: 29 }, option: 'wait', confidence: 1, support: 3 }, { when: { equals: 'gold' }, option: 'remind', confidence: 0.75, support: 4 }] } },
  { kind: 'action', title: 'Prepare a reminder', connector: 'local', operation: 'reminder-draft', when: 'remind' },
  { kind: 'lookup', title: 'Look up a missing detail', tool: 'lookup.contact', routeId: 'route-1', units: 2 },
];
const stats = { agentRuns: 3, agentCostMinor: '300', agentLatencyMs: 10, routedCases: 2, fallbackCases: 1, routedCostMinor: '0', fallbackCostMinor: '150', routedShare: { routed: 2, total: 6 } };
const proc = { id: 'procedure_1', template: 'receivables-week', version: 1, createdAt: '2026-10-01T09:00:00Z', ownerId: 'm1', status: 'proposed', steps, match: { days_overdue: 'number' },
  derivedFrom: ['procrun_1'], digest: DIGEST, sourceIds: ['s1'] };

test('procedure replies are checked field by field', () => {
  assert.equal(run(procedureList, { procedures: [{ ...proc, stats }] }).procedures[0]!.stats.routedShare.total, 6);
  const detail = run(procedureDetail, { procedure: proc, stats, runs: [{ id: 'procrun_1', at: '2026-10-01T09:00:00Z', jobId: 'j', template: 'receivables-week', caseId: 'case-1', route: 'agent',
    featureShape: {}, steps: [], costMinor: '100', latencyMs: 5, outcome: 'ok', sourceIds: [], note: 'Reminded because it is late.' }] });
  assert.equal(detail.procedure.digest, DIGEST);
  assert.equal(detail.procedure.steps[1]!.kind, 'question');
  assert.throws(() => run(procedure, { ...proc, digest: 'short' }), InvalidReply);
  assert.throws(() => run(procedure, { ...proc, status: 'live' }), InvalidReply);
  assert.throws(() => run(procedure, { ...proc, steps: [{ kind: 'person', title: 'x' }] }), InvalidReply);
  assert.throws(() => run(procedure, { ...proc, steps: [{ ...steps[1], rule: { ...steps[1]!.rule, threshold: 1.5 } }] }), InvalidReply);
  assert.throws(() => run(procedureList, { procedures: [{ ...proc, stats: { ...stats, routedCostMinor: 12.5 } }] }), InvalidReply);
  assert.throws(() => run(procedureList, { procedures: [proc] }), InvalidReply);
  assert.throws(() => run(procedureList, null), InvalidReply);
});

test('job control replies are checked, money stays an exact paise string', () => {
  const b = run(budget, { jobId: 'j1', budgetMinor: '123456789012345678901', spentMinor: '5', reservedMinor: '0', remainingMinor: '-5', budget: '₹1',
    meters: { model: [{ routeId: 'r', costMinor: '10', cost: '₹0.10', steps: 1, minutes: 0, basis: 'estimate' }], clockMs: 0, exposureMinor: '0', exposure: 'none' } });
  assert.equal(b.budgetMinor, '123456789012345678901');
  assert.throws(() => run(budget, { ...b, spentMinor: 5 }), InvalidReply);
  assert.throws(() => run(budget, { ...b, meters: { ...b.meters, model: [{ ...b.meters.model[0], basis: 'guess' }] } }), InvalidReply);
  const rules = run(stopRules, { jobId: 'j1', stoppedBy: null, setAside: null, rules: [{ rule: 'runs', limit: 1, used: 0, met: false }, { rule: 'failures', limit: 3, count: 0, met: false }] });
  assert.equal(failureLimit(rules), 3);
  assert.throws(() => run(stopRules, { jobId: 'j1', rules: [] }), InvalidReply);
  assert.equal(run(laneJobList, { jobs: [{ id: 'j1', title: 'Chase', template: 'receivables-week', state: 'scheduled', laneRun: true, spentMinor: '0', budgetMinor: '5000' }], proposals: [] }).jobs.length, 1);
  assert.throws(() => run(laneJobList, { jobs: [{ id: 'j1', title: 'Chase', template: null, state: 'scheduled', laneRun: 'yes', spentMinor: '0', budgetMinor: '5000' }] }), InvalidReply);
  assert.equal(run(skillFile, { path: 'receivables-week/SKILL.md', content: '---\nname: x\n---\n' }).path, 'receivables-week/SKILL.md');
  assert.throws(() => run(skillFile, { path: 'x', content: 'bad\u0000' }), InvalidReply);
  assert.equal(run(proposalList, [{ id: 'p1', origin: 'detector', card: { title: 'Cash' }, evidence: ['Asked three weeks.'], digest: 'd' }]).length, 1);
  assert.throws(() => run(proposalList, { items: [] }), InvalidReply);
  assert.equal(run(missedList, [{ id: 'n1', jobId: 'j1', at: '2026-10-01T09:00:00Z', missed: 2, ran: 1, rule: 'once', text: 'x', seen: false }]).length, 1);
  assert.equal(run(missedSeen, { seen: 2 }).seen, 2);
  assert.equal(run(readyMadeList, { templates: [{ id: 'cash-position', title: 'Cash', available: false, code: 'DICTIONARY_REQUIRED' }] }).templates[0]!.available, false);
});

test('the two Work sub-places are named in both languages, and every word has a Hindi twin', () => {
  assert.deepEqual(subPlaces.map(sp => `${sp.place}/${sp.id}`), ['work/procedures', 'work/job-controls']);
  assert.equal(words.en['SH-01.sub.work.procedures'], 'Procedures');
  assert.equal(words.en['SH-01.sub.work.job-controls'], 'Job controls');
  assert.ok(/[ऀ-ॿ]/.test(words.hi['SH-01.sub.work.procedures']!));
  assert.deepEqual(Object.keys(words.hi).sort(), Object.keys(words.en).sort());
  const shared = JSON.parse(readFileSync(new URL('../src/text/en.json', import.meta.url), 'utf8')) as Record<string, string>;
  for (const key of Object.keys(words.en)) {
    assert.ok(key.startsWith('jobsx.') || key.startsWith('SH-01.sub.work.'), key);
    assert.equal(key in shared, false, key);
    for (const language of ['en', 'hi'] as const) {
      const message = words[language][key]!;
      assert.ok(message.trim().length > 0, `${language} ${key}`);
      assert.equal(/[—!]/.test(message), false, `${language} ${key}: no em dash or exclamation mark`);
      if (language === 'hi' && key.startsWith('jobsx.')) assert.ok(/[ऀ-ॿ]/.test(message), `${key}: Hindi in Devanagari`);
    }
    const placeholders = (m: string) => [...m.matchAll(/\{(\w+)[,}]/g)].map(x => x[1]).sort();
    assert.deepEqual(placeholders(words.hi[key]!), placeholders(words.en[key]!), `${key}: same values in both languages`);
  }
});
