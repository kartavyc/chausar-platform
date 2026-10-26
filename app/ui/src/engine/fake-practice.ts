/**
 * The fake engine's answers for practice, improvement and the judge (Ink v2 wave 2, package 2C2): rehearsals with the
 * practice clients (venture.simulation.*), the improvement loop, using a kept version and going back from it
 * (venture.improve.*), asking the judge about a ready draft (venture.delivery.judge, judgeSend) and the judge's own
 * setting (venture.judge.auto.*). It keeps the engine's rules and words (delivery/simulate.ts, delivery/improve.ts,
 * delivery/judge-run.ts): rehearsing needs an accepted plan; the loop runs only once a draft was rejected or edited or
 * a rehearsal failed; a kept version is used by its run and digest and never overwrites the old one; going back takes
 * the hash of the version in use; the judge reads only a ready, non-practice draft whose code checks passed, on the
 * owner's own AI, once per draft, sent with the digest the owner read. Outcomes are fixed samples: the pushy practice
 * client fails the house style, and the judge passes every draft it reads. Costs are the engine's text, never summed.
 */

import {
  EngineError, type BlueprintViewLite, type CheckLite, type DeliveryLite, type EpisodeLite, type ImprovementReadinessLite,
  type ImprovementRunLite, type ImprovementStatusLite, type JudgeAutoView, type JudgePreview, type ModelStatusLite, type PlaybookLite,
  type ScenarioLite, type ServiceType, type SimulationRunLite, type VentureRunEvent,
} from './types';

export interface PracticeHost {
  current(): string;
  now(): string;
  emit(event: VentureRunEvent): void;
  /** Another desk's answer, for the records this desk reads (the plan, the AI status and delivery runs). */
  ask(method: string, params: Record<string, unknown>): unknown;
  /** The fake's short digest; eight of them make the engine's 64-character digest. */
  digest(value: unknown): string;
  /** Changes one delivery run of the open business where the Work desk keeps it: the judge's call and its verdict. */
  reviseDelivery(runId: string, revise: (run: DeliveryLite) => DeliveryLite): DeliveryLite;
}

const PRACTICE_METHODS = new Set<string>([
  'venture.simulation.scenarios', 'venture.simulation.run', 'venture.improve.status', 'venture.improve.run', 'venture.improve.adopt',
  'venture.improve.rollback', 'venture.delivery.judge', 'venture.delivery.judgeSend', 'venture.judge.auto.get', 'venture.judge.auto.set',
]);

/** The engine's words (delivery/judge-run.ts, delivery/improve.ts, delivery/launch.ts, delivery/runs.ts, delivery/checks.ts). */
export const PRACTICE_WORDS = Object.freeze({
  judgeOn: "The judge reads every draft that goes to a client or the public once it passes the code checks. It runs on your own AI, so your client's words go to your AI with the draft, and each check costs a little.",
  judgeOff: 'The judge reads a draft only when you ask it to, from the draft in Work.',
  failedCheck: 'Fix the failed check first; the judge reads only drafts that pass the code checks.',
  notReady: 'The judge reads a draft once it is ready for your review.',
  outline: 'The judge reads drafts an agent wrote; this is a template outline.',
  practice: 'Practice drafts are not for clients. Move to approve each to use drafts.',
  noAi: 'Connect an AI for quick work first; the judge runs on your own AI.',
  already: 'The judge already read this draft.',
  notWaiting: 'Ask the judge first, then send it.',
  readAgain: 'This changed since you read it. Read it again.',
  changed: 'The draft changed since you asked the judge. Ask again.',
  expired: 'Ask the judge again; the call you read is no longer available.',
  passed: 'Every rule passed its own floor. Each yes cited something code found in the run.',
  due: 'There are enough reviewed drafts to improve the playbook. The improvement loop tries one change and keeps it only if it wins.',
  notDue: 'The improvement loop can run once a draft was rejected or edited, a check failed or a rehearsal failed. It learns more from more reviewed drafts.',
  nothingToImprove: 'There is nothing to improve yet: no draft was rejected or edited, no check failed and no rehearsal failed.',
  acceptPlan: 'Accept your plan first.',
  /** runs.ts JUDGE_EDIT_LINE: on a judged draft the owner edited, the judge's line says its verdict is on the agent's words. */
  edited: "Your edit is your own words, so the judge does not read it. Any verdict here is on the agent's draft.",
});
/** scenarios.ts SOURCE_WORDS: where a signal case came from. */
const SIGNAL_WORDS = { 'owner-edited': 'a draft you edited', 'owner-rejected': 'a draft you rejected', 'check-failed': 'a draft that failed a check' } as const;
/** A signal as the fake derives it: the draft and where the signal came from. */
interface Signal { run: DeliveryLite; source: keyof typeof SIGNAL_WORDS }

const MINUTE_MS = 60_000;
/** models/types.ts PREVIEW_TTL_MS: a previewed call waits thirty minutes. */
const PREVIEW_MINUTES = 30;
const DAY_MS = 24 * 60 * MINUTE_MS;
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_.:-]{1,200}$/;
/** What one judge call or rehearsal may cost, as the model port writes it for an unconfirmed price. Sample text. */
const JUDGE_COST = 'USD 0.0031 (estimate, price unconfirmed)';
const MODEL_COST = 'USD 0.0184 (estimate, price unconfirmed)';
const TEMPLATE_COST = 'USD 0.0000';
const CHANGE = 'Adds to "Draft the reply": Keep the plan price from Chausar and offer no free work.';

const KINDS = ['clean', 'messy', 'pushback'] as const;
const TITLES: Readonly<Record<(typeof KINDS)[number], string>> = { clean: 'A clear request', messy: 'A messy request', pushback: 'A pushy client' };
/** The practice clients of delivery/scenarios.ts, by service type, in the order clean, messy, pushy. */
const PERSONAS: Readonly<Record<ServiceType, readonly [string, string, string]>> = {
  agency: ['The owner of a small gym who wants more members and knows what they want.', 'A busy cafe owner who writes in a hurry and leaves out the details.', 'A shop owner who wants a lower price and extra work thrown in.'],
  studio: ['A podcast host who sends a clear brief for episode edits.', 'A founder who wants a logo but cannot say what style they like.', 'A client who wants unlimited changes for the same price.'],
  consulting: ['A shop owner with a clear question about pricing strategy.', 'A worried founder with many problems and no clear question.', 'A client who wants a guaranteed result and a free first session.'],
  bookkeeping: ['The owner of a small cafe who keeps their papers in order.', 'A shop owner with a shoebox of receipts and two bank accounts.', 'A client who wants a discount and tax filing thrown in.'],
  research: ['A startup founder who needs a list of possible partners.', 'A manager with a vague question about the market.', 'A client who wants exact numbers guaranteed and extra reports for free.'],
  content: ['A dentist who wants regular blog posts for the clinic site.', 'A founder who wants content but has no topics or voice in mind.', 'A client who wants more posts for the same price and no edits.'],
  support: ['An online shop owner who wants help answering customer emails.', 'A founder whose inbox is overflowing and who is not sure what help they need.', 'A client who wants refunds promised to every customer and a lower fee.'],
  other: ['A small business owner with a clear request.', 'A busy owner who writes in a hurry and leaves out what they need.', 'A client who wants a discount and extra work for free.'],
};
/** The code checks each sample episode passes, in the engine's words. */
const PASSING: readonly CheckLite[] = [
  { check: 'house-style', passed: true, detail: 'No long dashes and no words on the avoid list.' },
  { check: 'length-bounds', passed: true, detail: 'The draft length is within bounds.' },
  { check: 'turn-limit', passed: true, detail: 'The agent stayed within its turns.' },
];

/** A version of the playbook, as the fake keeps it. blueprintDigest: the accepted plan it was made for. */
interface Version { id: string; version: number; hash: string; origin: 'plan' | 'improvement'; parentId: string | null; blueprintDigest: string }

const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
const clone = <T>(value: T): T => structuredClone(value);

/** The engine's exactPayload: one plain object with the required fields and nothing else. */
function exact(p: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  if (!Object.keys(p).every((key) => allowed.includes(key)) || !required.every((key) => Object.hasOwn(p, key))) throw invalid('Send the required fields and nothing else.');
  return p;
}
function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw invalid(`${field} must be a known identifier.`);
  return value;
}
function smallInteger(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw invalid(`${field} must be a whole number from ${min} to ${max}.`);
  return value as number;
}
function flag(value: unknown, field: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw invalid(`${field} must be true or false.`);
  return value;
}
const lite = (v: Version): PlaybookLite => ({ id: v.id, version: v.version, hash: v.hash, origin: v.origin, parentId: v.parentId });

export class FakePracticeDesk {
  private readonly host: PracticeHost;
  /** Playbook versions per business (never overwritten) and the one each business uses. */
  private versions: Record<string, Version[]>;
  private inUse: Record<string, string>;
  private rehearsals: Record<string, SimulationRunLite[]> = {};
  private improvements: Record<string, ImprovementRunLite[]> = {};
  private judgeAuto: Record<string, { auto: boolean; consentAt: string | null }> = {};
  private seq = 0;

  constructor(host: PracticeHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    // Lumen's accepted plan (bp-lumen-2) runs on playbook version 4; Ledgerline's plan is not accepted yet, so it has none.
    const lumen: Version = { id: 'pb-lumen-4', version: 4, hash: this.hex('pb-lumen-4'), origin: 'plan', parentId: null, blueprintDigest: 'bp-lumen-2-digest' };
    this.versions = options.fresh ? {} : { lumen: [lumen] };
    this.inUse = options.fresh ? {} : { lumen: lumen.id };
    // The judge read Ledgerline's September books on its own (fixtures.ts), so its standing consent is on record.
    this.judgeAuto = options.fresh ? {} : { ledgerline: { auto: true, consentAt: '2026-10-05T10:05:00.000Z' } };
  }

  handles(method: string): boolean {
    return PRACTICE_METHODS.has(method);
  }

  request(method: string, p: Record<string, unknown>): unknown {
    const biz = this.host.current();
    switch (method) {
      case 'venture.simulation.scenarios': exact(p, []); return this.scenarios();
      case 'venture.simulation.run': return this.rehearse(biz, p);
      case 'venture.improve.status': exact(p, []); return this.status(biz);
      case 'venture.improve.run': return this.improve(biz, p);
      case 'venture.improve.adopt': return this.adopt(biz, p);
      case 'venture.improve.rollback': return this.rollback(biz, p);
      case 'venture.delivery.judge': return this.judge(p);
      case 'venture.delivery.judgeSend': return this.judgeSend(biz, p);
      case 'venture.judge.auto.get': exact(p, []); return this.autoView(biz);
      case 'venture.judge.auto.set': return this.setAuto(biz, p);
      default: throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
    }
  }

  /** A 64-character digest, the engine's shape, made from the fake's short one. */
  private hex(value: unknown): string {
    return Array.from({ length: 8 }, (_, part) => this.host.digest({ value, part })).join('').slice(0, 64);
  }

  private plan(): BlueprintViewLite | null {
    return this.host.ask('venture.blueprint.get', {}) as BlueprintViewLite | null;
  }

  private deliveries(): DeliveryLite[] {
    return this.host.ask('venture.delivery.list', {}) as DeliveryLite[];
  }

  /** Whether an AI serves quick work for the open business, so it can draft, judge and propose changes. */
  private aiServes(): boolean {
    const status = this.host.ask('venture.models.status', {}) as ModelStatusLite;
    return status.tiers.fast.presetId !== 'built-in-templates';
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Rehearsals
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * The owner's signals, as the fake keeps them: real drafts the owner rejected or edited, or that failed a check
   * (the engine records a venture-signal for each).
   */
  private signals(): Signal[] {
    return this.deliveries().flatMap((run): Signal[] => {
      if (run.practice) return [];
      if (run.verdict && run.verdict.choice !== 'accepted') return [{ run, source: run.verdict.choice === 'edited' ? 'owner-edited' : 'owner-rejected' }];
      return (run.checks ?? []).some((c) => !c.passed && !c.notChecked) ? [{ run, source: 'check-failed' }] : [];
    });
  }

  /**
   * listScenarios: the three template practice clients of the plan's service type ('{type}-clean', '-messy',
   * '-pushback'), then a case for each signal (scenarios.ts signalScenario: the messy client, never the client's words).
   */
  private scenarios(): ScenarioLite[] {
    const type = this.plan()?.blueprint.serviceType ?? 'other';
    const templates = KINDS.map((kind, index) => ({ id: `${type}-${kind}`, serviceType: type, title: TITLES[kind], persona: PERSONAS[type][index]!, source: 'template' as const }));
    const cases = this.signals().map(({ run, source }) => ({ id: `signal-sig-${run.id}`, serviceType: type, title: `Practice case from ${SIGNAL_WORDS[source]}`, persona: PERSONAS[type][1], source: 'signal' as const }));
    return [...templates, ...cases];
  }

  /** The version in use, made again from the accepted plan when the plan changed (ensurePlaybook). */
  private ensure(biz: string): Version {
    const view = this.plan();
    if (!view || view.blueprint.status !== 'accepted') throw new EngineError('BLUEPRINT_NOT_ACCEPTED', PRACTICE_WORDS.acceptPlan);
    const list = (this.versions[biz] ??= []);
    const current = list.find((v) => v.id === this.inUse[biz]);
    if (current && current.blueprintDigest === view.blueprint.digest) return current;
    const version = Math.max(0, ...list.map((v) => v.version)) + 1;
    const made: Version = { id: `pb-${biz}-${version}`, version, hash: this.hex({ biz, version, plan: view.blueprint.digest }), origin: 'plan', parentId: null, blueprintDigest: view.blueprint.digest };
    list.push(made);
    this.inUse[biz] = made.id;
    return made;
  }

  /** venture.simulation.run: every template practice client (or the chosen ones, signal cases too), once each unless episodes says. */
  private rehearse(biz: string, p: Record<string, unknown>): SimulationRunLite {
    const body = exact(p, ['scenarioIds', 'episodes', 'useTemplate']);
    let chosen: string[] | null = null;
    if (body.scenarioIds !== undefined) {
      if (!Array.isArray(body.scenarioIds) || body.scenarioIds.length < 1 || body.scenarioIds.length > 12) throw invalid('Choose between one and 12 practice clients.');
      chosen = body.scenarioIds.map((id) => identifier(id, 'Practice client'));
      if (new Set(chosen).size !== chosen.length) throw invalid('Choose each practice client once.');
    }
    const episodes = body.episodes === undefined ? 1 : smallInteger(body.episodes, 'Episodes', 1, 3);
    const byModel = !flag(body.useTemplate, 'useTemplate') && this.aiServes();
    const playbook = this.ensure(biz);
    const available = this.scenarios();
    const selected = chosen
      ? chosen.map((id) => {
        const found = available.find((scenario) => scenario.id === id);
        if (!found) throw new EngineError('SCENARIO_NOT_FOUND', 'That practice client is not in this business.');
        return found;
      })
      : available.filter((scenario) => scenario.source === 'template');
    const results = selected.flatMap((scenario) => Array.from({ length: episodes }, (_, index) => this.episode(scenario, index, byModel)));
    const passed = selected.filter((scenario) => results.filter((e) => e.scenarioId === scenario.id).every((e) => e.passed)).length;
    const at = this.host.now();
    const run: SimulationRunLite = {
      id: `sim-${++this.seq}`, at, playbookId: playbook.id, scenarioIds: selected.map((s) => s.id), episodes: results,
      passed: results.length > 0 && results.every((e) => e.passed), summary: { scenarios: selected.length, passed, failed: selected.length - passed },
      costDisplay: byModel ? MODEL_COST : TEMPLATE_COST, modelMode: byModel ? 'model' : 'template',
    };
    (this.rehearsals[biz] ??= []).unshift(run);
    this.host.emit({ type: 'run.done', businessId: biz, runId: run.id, at });
    return clone(run);
  }

  /**
   * A sample episode: the pushy client's draft uses a word on the avoid list; the others pass. The judge reads a
   * practice draft only with an AI on and every code check passed, as simulate.ts asks it.
   */
  private episode(scenario: ScenarioLite, index: number, byModel: boolean): EpisodeLite {
    if (scenario.id.endsWith('-pushback')) {
      const checks: CheckLite[] = [{ check: 'house-style', passed: false, detail: 'The draft uses a word on the avoid list: free.' }, ...PASSING.slice(1)];
      return { scenarioId: scenario.id, index, passed: false, firstFailure: 'house-style', checks };
    }
    const checks: CheckLite[] = [...PASSING, ...(byModel ? [{ check: 'rules-judge', passed: true, detail: PRACTICE_WORDS.passed }] : [])];
    return { scenarioId: scenario.id, index, passed: true, firstFailure: null, checks };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Improvement
  // ---------------------------------------------------------------------------------------------------------------

  /** launch.ts improvement(): due once ten reviewed drafts hold three rejections or edits, or fourteen days after the first. */
  private readiness(): ImprovementReadinessLite {
    const verdicts = this.deliveries().flatMap((run) => (run.verdict ? [run.verdict] : []));
    const judged = verdicts.length;
    const rejectedOrEdited = verdicts.filter((verdict) => verdict.choice !== 'accepted').length;
    const first = verdicts.map((verdict) => verdict.at).sort()[0];
    const longEnough = first !== undefined && Date.parse(this.host.now()) - Date.parse(first) >= 14 * DAY_MS;
    const due = (judged >= 10 && rejectedOrEdited >= 3) || (judged >= 1 && longEnough);
    return { judged, rejectedOrEdited, due, status: 'available', reason: due ? PRACTICE_WORDS.due : PRACTICE_WORDS.notDue };
  }

  /** Whether a version still fits the plan: the accepted plan it was made for (a newer draft plan changes nothing yet). */
  private fits(version: Version): boolean {
    const view = this.plan();
    return !!view && (view.blueprint.status !== 'accepted' || view.blueprint.digest === version.blueprintDigest);
  }

  private find(biz: string, id: string | null | undefined): Version | undefined {
    return (this.versions[biz] ?? []).find((v) => v.id === id);
  }

  /** Why a kept version can no longer be used, or null (improve.ts staleReason). */
  private staleReason(biz: string, run: ImprovementRunLite): string | null {
    const candidate = this.find(biz, run.candidatePlaybookId);
    if (!candidate) return 'The new version was not found.';
    if (run.rolledBack) return 'You went back from this version. Run the loop again to try another change.';
    const current = this.inUse[biz];
    if (current === candidate.id) return 'This version is already in use.';
    if (current !== run.parentPlaybookId) return 'The playbook changed since this run, so its result no longer applies. Run the loop again.';
    if (!this.fits(candidate)) return 'Your plan changed since this run. Run the loop again.';
    return null;
  }

  private status(biz: string): ImprovementStatusLite {
    const runs = this.improvements[biz] ?? [];
    const waiting = runs.find((run) => run.status === 'kept-candidate' && this.staleReason(biz, run) === null) ?? null;
    const current = this.find(biz, this.inUse[biz]);
    const parent = current?.origin === 'improvement' ? this.find(biz, current.parentId) : undefined;
    const back = parent && this.fits(parent) ? parent : null;
    return clone({
      readiness: this.readiness(), activePlaybookId: current?.id ?? null, latest: runs[0] ?? null,
      candidate: waiting ? { runId: waiting.id, playbookId: waiting.candidatePlaybookId!, digest: waiting.digest, changes: [...waiting.changes] } : null,
      inUse: current ? { playbookId: current.id, version: current.version, hash: current.hash, origin: current.origin, rollback: back ? { playbookId: back.id, version: back.version, digest: current.hash } : null } : null,
    });
  }

  /**
   * venture.improve.run: needs something to learn from (a draft rejected or edited, a failed check, or a failed
   * rehearsal of the version in use); the sample run keeps one change as a new version. The old one stays stored.
   */
  private improve(biz: string, p: Record<string, unknown>): ImprovementRunLite {
    const body = exact(p, ['maxRounds', 'useTemplate']);
    if (body.maxRounds !== undefined) smallInteger(body.maxRounds, 'Rounds', 1, 4);
    const byModel = !flag(body.useTemplate, 'useTemplate') && this.aiServes();
    const parent = this.ensure(biz);
    const signals = this.signals();
    const failedRehearsal = (this.rehearsals[biz] ?? []).some((run) => run.playbookId === parent.id && run.episodes.some((e) => !e.passed));
    if (signals.length === 0 && !failedRehearsal) throw new EngineError('IMPROVEMENT_NOT_READY', PRACTICE_WORDS.nothingToImprove);
    const list = (this.versions[biz] ??= []);
    const version = Math.max(0, ...list.map((v) => v.version)) + 1;
    const candidate: Version = { id: `pb-${biz}-${version}`, version, hash: this.hex({ biz, version, parent: parent.id }), origin: 'improvement', parentId: parent.id, blueprintDigest: parent.blueprintDigest };
    list.push(candidate);
    const id = `imp-${++this.seq}`;
    const at = this.host.now();
    const run: ImprovementRunLite = {
      id, at, status: 'kept-candidate', parentPlaybookId: parent.id, candidatePlaybookId: candidate.id, changes: [CHANGE],
      costDisplay: byModel ? MODEL_COST : TEMPLATE_COST, modelMode: byModel ? 'model' : 'template', incompleteReason: null,
      digest: this.hex({ runId: id, candidatePlaybookId: candidate.id, changes: [CHANGE] }),
      // 4J16 (Q16, via 4J22a): the round as an experiment, with the old version on the same cases as its control.
      rounds: [{ round: 1, experiment: {
        hypothesis: 'Drafts that hold the plan price and offer no free work need fewer changes from you.', change: CHANGE, patchId: `patch-${id}`,
        control: { kind: 'parent-on-same-cases', playbookHash: parent.hash, cases: 3, window: { from: at, to: at } },
        budget: { capMicros: '500000', capDisplay: 'US$0.50', spentMicros: '0', spentDisplay: 'US$0.00' },
        stopRules: ['Stop when the run has spent its budget of US$0.50, between practice episodes.', 'Stop after 1 round.', 'Keep the old version when the change makes any case newly fail or adds a critical error.'],
        rollbackRule: 'A kept change waits for you to adopt it; after that you can go back to the version it was made from with one tap.',
        result: { kind: 'caused', line: 'With the old version as the control on the same 3 practice cases, the change won 2, lost 0 and tied 1.' },
        // 4J22a (4J15): the lift on the same 3 paired cases: too few to tell, as the engine's exact test says.
        lift: { cases: 3, reachable: false, direction: 'none', estimate: true, line: 'Not enough practice cases to tell yet.', digest: this.hex({ lift: id }) },
      } }],
    };
    (this.improvements[biz] ??= []).unshift(run);
    this.host.emit({ type: 'run.done', businessId: biz, runId: id, at });
    return clone(run);
  }

  /** venture.improve.adopt (the owner's, in the app): the kept version by its run and the digest read. */
  private adopt(biz: string, p: Record<string, unknown>): PlaybookLite {
    const body = exact(p, ['runId', 'digest'], ['runId', 'digest']);
    const runId = identifier(body.runId, 'Improvement run');
    if (typeof body.digest !== 'string' || !DIGEST.test(body.digest)) throw invalid('Send the digest of the change you approved.');
    const run = (this.improvements[biz] ?? []).find((r) => r.id === runId);
    if (!run) throw new EngineError('IMPROVEMENT_NOT_FOUND', 'That improvement run was not found.');
    if (run.status !== 'kept-candidate' || !run.candidatePlaybookId) throw invalid('This run kept the old version, so there is nothing to adopt.');
    if (run.digest !== body.digest) throw new EngineError('CANDIDATE_STALE', 'The change you approved is not the one stored. Open it again.');
    const stale = this.staleReason(biz, run);
    if (stale !== null) throw new EngineError('CANDIDATE_STALE', stale);
    const candidate = this.find(biz, run.candidatePlaybookId)!;
    this.inUse[biz] = candidate.id;
    this.host.emit({ type: 'queue.changed', businessId: biz, at: this.host.now() });
    return lite(candidate);
  }

  /** venture.improve.rollback (the owner's, in the app): back from an improved version to the one it was made from. */
  private rollback(biz: string, p: Record<string, unknown>): PlaybookLite {
    const body = exact(p, ['playbookId', 'digest'], ['playbookId', 'digest']);
    const playbookId = identifier(body.playbookId, 'Playbook');
    if (typeof body.digest !== 'string' || !DIGEST.test(body.digest)) throw invalid('Send the digest of the version you saw in use.');
    const current = this.find(biz, this.inUse[biz]);
    const parent = this.find(biz, playbookId);
    if (!current || current.origin !== 'improvement' || current.parentId !== playbookId || !parent) {
      throw new EngineError('ROLLBACK_NOTHING', 'The version in use did not come from an improvement of that version, so there is nothing to go back to.');
    }
    if (current.hash !== body.digest) throw new EngineError('APPROVAL_STALE', 'The version in use changed since you read it. Read it again.');
    if (!this.fits(parent)) throw new EngineError('ROLLBACK_STALE', 'Your plan changed since that version, so it no longer fits. Run the loop again instead.');
    const kept = (this.improvements[biz] ?? []).find((run) => run.candidatePlaybookId === current.id);
    if (kept) kept.rolledBack = { at: this.host.now(), by: 'owner' };
    this.inUse[biz] = parent.id;
    this.host.emit({ type: 'queue.changed', businessId: biz, at: this.host.now() });
    return lite(parent);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The judge
  // ---------------------------------------------------------------------------------------------------------------

  /** The business's judge setting: on by default, with no consent recorded until it first goes or is turned on. */
  private autoView(biz: string): JudgeAutoView {
    const setting = this.judgeAuto[biz] ?? { auto: true, consentAt: null };
    return { auto: setting.auto, consentAt: setting.auto ? setting.consentAt : null, line: setting.auto ? PRACTICE_WORDS.judgeOn : PRACTICE_WORDS.judgeOff };
  }

  /** venture.judge.auto.set (the owner's, in the app): on records the standing consent for the judge's calls. */
  private setAuto(biz: string, p: Record<string, unknown>): JudgeAutoView {
    const body = exact(p, ['auto'], ['auto']);
    if (typeof body.auto !== 'boolean') throw invalid('auto must be true or false.');
    const now = this.judgeAuto[biz] ?? { auto: true, consentAt: null };
    if (now.auto === body.auto && (!body.auto || now.consentAt)) return this.autoView(biz);
    this.judgeAuto[biz] = { auto: body.auto, consentAt: body.auto ? this.host.now() : null };
    return this.autoView(biz);
  }

  private run(runId: string): DeliveryLite {
    const run = this.deliveries().find((d) => d.id === runId);
    if (!run) throw new EngineError('DELIVERY_NOT_FOUND', 'That draft reply was not found.');
    return run;
  }

  /** Why the judge can't read this draft now (judge-run.ts notJudgeable), or null. Its own earlier verdict is left out. */
  private notJudgeable(run: DeliveryLite): EngineError | null {
    if (run.status !== 'ready-for-review') return new EngineError('JUDGE_NOT_READY', PRACTICE_WORDS.notReady);
    if (run.servedBy === 'template' || !run.deliverable) return new EngineError('JUDGE_NOT_READY', PRACTICE_WORDS.outline);
    if (run.practice || run.practiceNow) return new EngineError('PRACTICE_DRAFT', PRACTICE_WORDS.practice);
    const failed = (run.checks ?? []).some((c) => c.check !== 'rules-judge' && !c.passed && !c.notChecked) || (run.playbookChecks ?? []).some((c) => c.outcome === 'fail');
    return failed ? new EngineError('JUDGE_NOT_READY', PRACTICE_WORDS.failedCheck) : null;
  }

  /** The draft the judge reads, as a digest: it reads each draft once. */
  private draftDigest(run: DeliveryLite): string {
    return this.hex({ runId: run.id, title: run.deliverable?.title ?? '' });
  }

  /** venture.delivery.judge: previews the call and keeps it waiting on the run; asking again gives the same call. */
  private judge(p: Record<string, unknown>): JudgePreview {
    const runId = identifier(exact(p, ['runId'], ['runId']).runId, 'Draft reply');
    const run = this.run(runId);
    const refused = this.notJudgeable(run);
    if (refused) throw refused;
    const draftDigest = this.draftDigest(run);
    const held = run.judge;
    if (held?.status === 'done' && held.draftDigest === draftDigest) throw new EngineError('JUDGE_ALREADY_SENT', PRACTICE_WORDS.already);
    if (held?.status === 'waiting' && held.preview && held.draftDigest === draftDigest && Date.parse(held.preview.expiresAt) > Date.parse(this.host.now())) {
      return { runId, ...held.preview, containsClientData: true };
    }
    if (!this.aiServes()) throw new EngineError('NO_MODEL_CONNECTED', PRACTICE_WORDS.noAi);
    const at = this.host.now();
    const preview = { digest: this.hex({ runId, call: ++this.seq }), estimatedMaxCostDisplay: JUDGE_COST, expiresAt: new Date(Date.parse(at) + PREVIEW_MINUTES * MINUTE_MS).toISOString() };
    this.host.reviseDelivery(runId, (current) => ({ ...current, judge: { status: 'waiting', preview, auto: false, estimatedMaxCostDisplay: JUDGE_COST, line: null, draftDigest } }));
    this.host.emit({ type: 'run.step', businessId: this.host.current(), runId, at });
    return { runId, ...preview, containsClientData: true };
  }

  /**
   * venture.delivery.judgeSend (the owner's, in the app): sends the waiting call once; the sample verdict passes. The
   * automatic call that waited for the first consent records it when sent.
   */
  private judgeSend(biz: string, p: Record<string, unknown>): DeliveryLite {
    const body = exact(p, ['runId', 'digest'], ['runId', 'digest']);
    const runId = identifier(body.runId, 'Draft reply');
    if (typeof body.digest !== 'string' || !DIGEST.test(body.digest)) throw invalid('Send the digest of the judge call you read.');
    const run = this.run(runId);
    const held = run.judge;
    if (held?.status === 'done') throw new EngineError('JUDGE_ALREADY_SENT', PRACTICE_WORDS.already);
    if (held?.status !== 'waiting' || !held.preview) throw new EngineError('JUDGE_NOT_WAITING', PRACTICE_WORDS.notWaiting);
    if (held.preview.digest !== body.digest) throw new EngineError('APPROVAL_STALE', PRACTICE_WORDS.readAgain);
    const refused = this.notJudgeable(run);
    if (refused) throw refused;
    if (held.draftDigest !== this.draftDigest(run)) throw new EngineError('APPROVAL_STALE', PRACTICE_WORDS.changed);
    const at = this.host.now();
    if (Date.parse(held.preview.expiresAt) <= Date.parse(at)) {
      this.host.reviseDelivery(runId, (current) => ({ ...current, judge: { ...held, status: 'failed', preview: null, line: `The judge did not finish: ${PRACTICE_WORDS.expired} Ask the judge again.` } }));
      throw new EngineError('APPROVAL_STALE', PRACTICE_WORDS.expired);
    }
    // Sending the automatic call that was shown with the setting's own words is the standing consent, recorded once.
    // A call the owner asked for records nothing.
    const setting = this.judgeAuto[biz] ?? { auto: true, consentAt: null };
    if (held.auto && held.line === PRACTICE_WORDS.judgeOn && setting.auto && !setting.consentAt) this.judgeAuto[biz] = { auto: true, consentAt: at };
    const verdict: CheckLite = { check: 'rules-judge', passed: true, detail: PRACTICE_WORDS.passed };
    const judged = this.host.reviseDelivery(runId, (current) => ({
      ...current, checks: [...(current.checks ?? []).filter((c) => c.check !== 'rules-judge'), verdict],
      judge: { ...held, status: 'done', preview: null, line: null },
    }));
    this.host.emit({ type: 'run.step', businessId: biz, runId, at });
    this.host.emit({ type: 'queue.changed', businessId: biz, at });
    return judged;
  }
}
