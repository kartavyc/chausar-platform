/**
 * C7 task 16: the fake engine's hiring, with the engine's phases, codes and words (platform/runtime/venture/agents/hire.ts
 * and hire-check.ts, whose checks it runs itself). Its AI writes a role, reads and a voice from the sentence in fixed words.
 */
import { checkHireWith } from '../../../../platform/runtime/venture/agents/hire-check-core';
import { TEAM_DEPARTMENT, checkedTeamAgent, departmentFor, teamCards, type HireChecker, type TeamAgent, type TeamCard } from '../../../../platform/runtime/venture/agents/team-proposal';
import { EngineError, type AgentView, type HireReadLite, type HireViewLite, type HireVoiceLite } from './types';
import type { W4DeskHost } from './fake-w4';
import { ownerVoice } from '../../../../platform/runtime/venture/core/owner-voice';
import { HARD_STOPS } from '../../../../platform/runtime/venture/policy/hard-stops';

export const FAKE_HIRE_METHODS: readonly string[] = ['venture.agents.hire.duties', 'venture.agents.hire.start', 'venture.agents.hire.answer', 'venture.agents.hire.confirm', 'venture.agents.hire.team'];
const READS = ['clients', 'orders', 'runs', 'money', 'plan', 'journal', 'notes', 'trackers'] as const;
const DEPARTMENTS = ['sales', 'marketing', 'production', 'money', 'operations'] as const;
/** The engine's list (agents/hire.ts): its own line first, then every hard stop. */
const NEVER = ['It never sends, pays, posts, deletes or changes a price by itself.', ...HARD_STOPS.map((stop) => stop.line)];
const STALE = 'This changed since you read it. Read it again.';
const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
/** The engine passes its policy words here (policy/effects.ts); these are the ones a sample duty meets. */
const RULES = { departments: DEPARTMENTS, floorWords: ['send', 'post', 'publish', 'email', 'pay', 'refund', 'transfer', 'buy', 'delete', 'remove'] };
const VOICE: HireVoiceLite = { tone: 'Warm and plain', replyLength: 'short', greeting: null, handOffLine: null, blockedTopics: [], signOff: null };
/** The engine's NO_PERSONA (agents/persona.ts): the voice of an agent hired with the setup team. */
const NO_VOICE: HireVoiceLite = { tone: null, replyLength: null, greeting: null, handOffLine: null, blockedTopics: [], signOff: null };
/** The hand hire's check with the fake's rules, as the engine's checkTeamHire has its own (agents/hire-check.ts). */
export const fakeTeamCheck: HireChecker = (role, context) => checkHireWith(RULES, role, context);
/** A refusal from the shared checks, said as the engine says it. */
function refused(error: unknown): never { const known = error as { code: string; message: string }; throw new EngineError(known.code, known.message); }
type Held = HireViewLite;

export class FakeHire {
  private host: W4DeskHost;
  private hires = new Map<string, Held[]>();
  private seq = 0;
  constructor(host: W4DeskHost) { this.host = host; }
  private mine(): Held[] { const biz = this.host.current(); let held = this.hires.get(biz); if (!held) { held = []; this.hires.set(biz, held); } return held; }
  private find(id: unknown): Held {
    const held = this.mine().find((item) => item.id === id);
    if (!held) throw new EngineError('HIRE_NOT_FOUND', 'That hire was not found.');
    if (held.status !== 'drafting') throw new EngineError('APPROVAL_STALE', STALE);
    return held;
  }
  /** The hired agents as Team shows them. */
  agents(): AgentView[] {
    return this.mine().filter((held) => held.status === 'hired').map((held) => ({ id: held.id, name: held.role!.name, role: held.role!.job, now: 'Idle', posture: 'approve-each', spend: '', steps: [], department: held.department as AgentView['department'], kind: 'agent', state: 'idle', postureSetBy: 'agent', chat: true,
      hired: { line: 'Hired by you on 6 Nov', duties: [...held.role!.duties], reads: held.reads.map((item) => ({ ...item })) } } as AgentView));
  }
  /** Every name a hired agent may not take: those Team shows and those the plan's own team takes (the engine's teamNames). */
  private names(): string[] {
    return [...(this.host.ask('venture.team.list', {}) as { agents: AgentView[] }).agents.map((agent) => agent.name), ...(this.host.joinNames?.() ?? [])];
  }
  private check(role: HireViewLite['role'], reads: HireReadLite[], department: string) {
    const names = this.names();
    try { return checkHireWith(RULES, { ...role!, reads: reads.map((item) => item.read), department } as never, { agentNames: names }); }
    catch (error) { const known = error as { code: string; message: string }; throw new EngineError(known.code, known.message); }
  }
  request(method: string, p: Record<string, unknown>): unknown {
    if (this.host.hosted()) throw new EngineError('APP_APPROVAL_REQUIRED', 'Do this inside the Chausar app.');
    switch (method) {
      case 'venture.agents.hire.start': {
        // The stand-in for the AI's draft is said to the owner as "you", as agents/hire.ts turns the real one
        // (core/owner-voice.ts); the sentence itself stays as the owner typed it.
        const sentence = typeof p.sentence === 'string' ? p.sentence.trim() : '';
        if (sentence.length < 3 || sentence.length > 400) throw invalid('What you want this agent to do must be between 3 and 400 characters.');
        if (this.mine().filter((held) => held.status === 'hired').length >= 5) throw new EngineError('HIRE_LIMIT', 'A business keeps at most 5 hired agents. Retire one first.');
        const role = { name: 'Mira', job: ownerVoice(sentence.slice(0, 120)), duties: ['Keeps the content calendar up to date', 'Drafts captions for your approval'] };
        // As agents/hire.ts: the department starts where the drafted role's own words put it; the owner chooses.
        const held: Held = { id: `hire-${++this.seq}`, status: 'drafting', phase: 'role', sentence, role, reads: [], voice: null, department: departmentFor({ ...role, reads: [] }), choices: READS, departments: DEPARTMENTS, card: null, digest: '' };
        this.mine().push(held);
        return structuredClone(held);
      }
      case 'venture.agents.hire.answer': {
        const held = this.find(p.hireId);
        if (p.phase !== held.phase) throw new EngineError('APPROVAL_STALE', STALE);
        const edits = (p.edits ?? {}) as Record<string, unknown>;
        if (held.phase === 'role') {
          const role = { ...held.role!, ...edits } as NonNullable<Held['role']>;
          const checked = this.check(role, held.reads, held.department);
          held.role = { name: checked.name, job: checked.job, duties: checked.duties };
          held.reads = [{ read: 'plan', why: 'To know what the business offers.' }, { read: 'trackers', why: 'To keep the calendar.' }];
          held.department = departmentFor({ ...held.role, reads: held.reads.map((item) => item.read) });
          held.phase = 'reads';
        } else if (held.phase === 'reads') {
          if (edits.reads !== undefined) {
            const chosen = edits.reads as HireReadLite[];
            if (!Array.isArray(chosen) || chosen.some((item) => !(READS as readonly string[]).includes(item.read))) throw invalid(`A hired agent reads only from: ${READS.join(', ')}.`);
            held.reads = chosen;
          }
          if (edits.department !== undefined) {
            if (!(DEPARTMENTS as readonly unknown[]).includes(edits.department)) throw invalid('Choose one of the departments.');
            held.department = edits.department as string;
          }
          held.voice = VOICE; held.phase = 'voice';
        } else if (held.phase === 'voice') {
          if (edits.voice !== undefined) held.voice = edits.voice as HireVoiceLite;
          this.check(held.role, held.reads, held.department);
          held.phase = 'review';
          held.card = { does: [...held.role!.duties], reads: held.reads.map((item) => ({ ...item })), never: NEVER, asks: 'It asks you before anything leaves.' };
          held.digest = this.host.digest({ id: held.id, role: held.role, reads: held.reads, voice: held.voice, department: held.department });
        } else throw new EngineError('APPROVAL_STALE', STALE);
        return structuredClone(held);
      }
      case 'venture.agents.hire.confirm': {
        const held = this.find(p.hireId);
        if (held.phase !== 'review' || held.digest !== p.digest) throw new EngineError('APPROVAL_STALE', STALE);
        held.status = 'hired';
        return structuredClone(held);
      }
      case 'venture.agents.hire.duties': {
        const held = this.mine().find((item) => item.status === 'hired' && item.id === p.agent);
        if (!held) throw new EngineError('HIRE_NOT_FOUND', 'That hire was not found.');
        const names = this.names().filter((name) => name !== held.role!.name);
        try { held.role = { ...held.role!, duties: checkHireWith(RULES, { ...held.role!, duties: p.duties as string[], reads: held.reads.map((item) => item.read), department: held.department } as never, { agentNames: names }).duties }; }
        catch (error) { const known = error as { code: string; message: string }; throw new EngineError(known.code, known.message); }
        return structuredClone(held);
      }
      case 'venture.agents.hire.team': return this.team(p);
      default: throw new EngineError('METHOD_NOT_ALLOWED', "The sample business can't do that yet.");
    }
  }

  /**
   * venture.agents.hire.team, as agents/hire.ts hireTeamHandler: the cards exactly, each digest its own card's
   * (APPROVAL_STALE), a card already hired answered and not hired twice, the limit, then every agent checked again; one
   * that fails stops the whole card, so nothing is kept until all have passed.
   */
  private team(p: Record<string, unknown>): { hired: HireViewLite[] } {
    if (p === null || typeof p !== 'object' || Array.isArray(p)) throw invalid('Send one request object.');
    if (Object.keys(p).some((key) => key !== 'agents') || !Object.hasOwn(p, 'agents')) throw invalid('Send the required fields and nothing else.');
    let cards: TeamCard[];
    try { cards = teamCards(p.agents); } catch (error) { refused(error); }
    if (new Set(cards.map((item) => item.digest)).size !== cards.length) throw invalid('Each agent is on the card once.');
    const before = this.mine().filter((held) => held.status === 'hired');
    const fresh = cards.filter((item) => !before.some((held) => held.digest === item.digest));
    if (before.length + fresh.length > 5) throw new EngineError('HIRE_LIMIT', 'A business keeps at most 5 hired agents. Retire one first.');
    const names = this.names();
    const made = new Map<string, Held>();
    for (const item of fresh) {
      let agent: TeamAgent;
      // As agents/hire.ts: the department is the card's own; a card made before departments has none and starts in Operations.
      try { agent = checkedTeamAgent(fakeTeamCheck, { name: item.name, job: item.job, duties: item.duties, reads: item.reads, ...(item.department ? { department: item.department } : {}) }, names); } catch (error) { refused(error); }
      names.push(agent.name);
      const reads = agent.reads.map((read) => ({ read, why: '' }));
      made.set(item.digest, { id: `hire-${++this.seq}`, status: 'hired', phase: 'review', sentence: agent.job, role: { name: agent.name, job: agent.job, duties: agent.duties }, reads, voice: { ...NO_VOICE, blockedTopics: [] }, department: agent.department ?? TEAM_DEPARTMENT,
        choices: READS, departments: DEPARTMENTS, card: { does: [...agent.duties], reads: reads.map((read) => ({ ...read })), never: NEVER, asks: 'It asks you before anything leaves.' }, digest: item.digest });
    }
    this.mine().push(...made.values());
    return { hired: cards.map((item) => structuredClone(made.get(item.digest) ?? before.find((held) => held.digest === item.digest)!)) };
  }
}
