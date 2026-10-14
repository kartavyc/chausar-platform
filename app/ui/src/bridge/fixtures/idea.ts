/**
 * The fake engine's FR-11 idea: the same reply shape as `platform/runtime/frame-today/idea.ts`,
 * from memory only. The owner's words are kept as typed; nothing reads a number from them.
 * No range is served: the fake has no checked source either. Only `bridge/fake.ts` and tests import this.
 */
import type { IdeaLabel, IdeaLine, IdeaReply, IdeaSection, IdeaTold, IdeaUnknown } from '../todayx-contract.ts';
import { IDEA_SECTIONS, IDEA_UNKNOWNS } from '../todayx-contract.ts';

const UNKNOWN_SECTION: Readonly<Record<IdeaUnknown, IdeaSection>> = { price: 'sale', 'sale-cost': 'sale', 'first-customers': 'plan', licences: 'plan' };
type Refuse = (code: string, message?: string) => Error;
interface Held { startedAt: string; claims: IdeaTold[]; next: number }

export interface FakeIdea {
  start(at: string): IdeaReply;
  get(): IdeaReply;
  tell(payload: Readonly<Record<string, unknown>>, at: string): IdeaReply;
  correct(payload: Readonly<Record<string, unknown>>, at: string): IdeaReply;
}

export function createFakeIdea(refuse: Refuse): FakeIdea {
  let idea: Held | null = null;
  const text = (value: unknown): string => {
    const typed = typeof value === 'string' ? value.trim() : '';
    if (typed.length === 0 || typed.length > 500) throw refuse('INVALID_TODAYX_REQUEST', 'Tell one thing at a time.');
    return typed;
  };
  const line = (claim: IdeaTold): IdeaLine => ({ claimId: claim.claimId, text: claim.text, label: claim.label });
  const reply = (): IdeaReply => {
    if (idea === null) return { state: 'not-started' };
    const active = idea.claims.filter(claim => claim.status === 'active');
    const section = (name: IdeaSection) => active.filter(claim => claim.section === name && claim.answers === null).map(line);
    return {
      state: 'drafting', startedAt: idea.startedAt, conversation: idea.claims.map(claim => ({ ...claim })),
      business: section('business'), sale: section('sale'), plan: section('plan'), unknownsTold: section('unknown'),
      unknowns: IDEA_UNKNOWNS.map(id => {
        const lines = active.filter(claim => claim.answers === id).map(line);
        return { id, section: UNKNOWN_SECTION[id], state: lines.length > 0 ? 'told' as const : 'blank' as const, lines, range: null };
      }),
      writtenBy: 'owner-only',
    };
  };
  const held = (): Held => { if (idea === null) throw refuse('IDEA_NOT_STARTED', 'Start the idea first.'); return idea; };
  const add = (current: Held, at: string, claim: Omit<IdeaTold, 'claimId' | 'at' | 'status' | 'correctedBy'>): IdeaTold => {
    const told: IdeaTold = { ...claim, claimId: `idea_claim_fake_${String(current.next++).padStart(4, '0')}`, at, status: 'active', correctedBy: null };
    current.claims.push(told);
    return told;
  };
  return {
    start(at) { if (idea === null) idea = { startedAt: at, claims: [], next: 1 }; return reply(); },
    get: reply,
    tell(payload, at) {
      const current = held(), typed = text(payload['text']);
      const answers = (IDEA_UNKNOWNS as readonly unknown[]).includes(payload['answers']) ? payload['answers'] as IdeaUnknown : null;
      const section = answers !== null ? UNKNOWN_SECTION[answers] : payload['section'];
      if (!(IDEA_SECTIONS as readonly unknown[]).includes(section)) throw refuse('INVALID_TODAYX_REQUEST', 'Pick where this goes.');
      const label: IdeaLabel = payload['guess'] === true ? 'assumption' : 'told-by-owner';
      add(current, at, { text: typed, section: section as IdeaSection, answers, label, replaces: null });
      return reply();
    },
    correct(payload, at) {
      const current = held();
      const index = current.claims.findIndex(claim => claim.claimId === payload['claimId']);
      const claim = current.claims[index];
      if (claim === undefined) throw refuse('IDEA_CLAIM_NOT_FOUND', 'That statement is not in this idea.');
      if (claim.status !== 'active') throw refuse('IDEA_CLAIM_DECIDED', 'That statement was already decided.');
      if (payload['withdraw'] === true) { current.claims[index] = { ...claim, status: 'withdrawn' }; return reply(); }
      const typed = text(payload['text']);
      const label: IdeaLabel = payload['guess'] === undefined ? claim.label : payload['guess'] === true ? 'assumption' : 'told-by-owner';
      const replacement = add(current, at, { text: typed, section: claim.section, answers: claim.answers, label, replaces: claim.claimId });
      current.claims[index] = { ...claim, status: 'corrected', correctedBy: replacement.claimId };
      return reply();
    },
  };
}
