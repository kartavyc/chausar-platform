/**
 * C7 task 16: the fake engine's hiring, with the engine's phases, codes and words (platform/runtime/venture/agents/hire.ts
 * and hire-check.ts, whose checks it runs itself). Its AI writes a role, reads and a voice from the sentence in fixed words.
 */
import { checkHire } from '../../../../platform/runtime/venture/agents/hire-check';
import { EngineError, type AgentView, type HireReadLite, type HireViewLite, type HireVoiceLite } from './types';
import type { W4DeskHost } from './fake-w4';

export const FAKE_HIRE_METHODS: readonly string[] = ['venture.agents.hire.duties', 'venture.agents.hire.start', 'venture.agents.hire.answer', 'venture.agents.hire.confirm', 'venture.agents.hire.cancel'];
const READS = ['clients', 'orders', 'runs', 'money', 'plan', 'journal', 'notes', 'trackers'] as const;
const DEPARTMENTS = ['sales', 'marketing', 'production', 'money', 'operations'] as const;
const NEVER = ['No stock tips, target prices or promised returns without a SEBI registration.', 'No fake reviews.', 'It never sends, pays, posts, deletes or changes a price by itself.'];
const STALE = 'This changed since you read it. Read it again.';
const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
const VOICE: HireVoiceLite = { tone: 'Warm and plain', replyLength: 'short', greeting: null, handOffLine: null, blockedTopics: [], signOff: null };
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
  private check(role: HireViewLite['role'], reads: HireReadLite[], department: string) {
    const names = (this.host.ask('venture.team.list', {}) as { agents: AgentView[] }).agents.map((agent) => agent.name);
    try { return checkHire({ ...role!, reads: reads.map((item) => item.read), department } as never, { agentNames: names }); }
    catch (error) { const known = error as { code: string; message: string }; throw new EngineError(known.code, known.message); }
  }
  request(method: string, p: Record<string, unknown>): unknown {
    if (this.host.hosted()) throw new EngineError('APP_APPROVAL_REQUIRED', 'Do this inside the Chausar app.');
    switch (method) {
      case 'venture.agents.hire.start': {
        const sentence = typeof p.sentence === 'string' ? p.sentence.trim() : '';
        if (sentence.length < 3 || sentence.length > 400) throw invalid('What you want this agent to do must be between 3 and 400 characters.');
        if (this.mine().filter((held) => held.status === 'hired').length >= 5) throw new EngineError('HIRE_LIMIT', 'A business keeps at most 5 hired agents. Retire one first.');
        const held: Held = { id: `hire-${++this.seq}`, status: 'drafting', phase: 'role', sentence, role: { name: 'Mira', job: sentence.slice(0, 120), duties: ['Keeps the content calendar up to date', 'Drafts captions for my approval'] }, reads: [], voice: null, department: 'operations', choices: READS, departments: DEPARTMENTS, card: null, digest: '' };
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
        const names = (this.host.ask('venture.team.list', {}) as { agents: AgentView[] }).agents.filter((agent) => agent.id !== held.id).map((agent) => agent.name);
        try { held.role = { ...held.role!, duties: checkHire({ ...held.role!, duties: p.duties as string[], reads: held.reads.map((item) => item.read), department: held.department } as never, { agentNames: names }).duties }; }
        catch (error) { const known = error as { code: string; message: string }; throw new EngineError(known.code, known.message); }
        return structuredClone(held);
      }
      case 'venture.agents.hire.cancel': { this.find(p.hireId).status = 'cancelled'; return { cancelled: true }; }
      default: throw new EngineError('METHOD_NOT_ALLOWED', "The sample business can't do that yet.");
    }
  }
}
