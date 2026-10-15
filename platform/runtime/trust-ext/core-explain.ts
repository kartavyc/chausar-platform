/**
 * trustx.explain: the rule that stopped a step, in plain words, and who can change it. Ask's AS-09 sends the
 * rule kind it was refused with; the reply is fixed words built from this workspace's own settings, never outside text.
 */
import { check } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { sourceAllowed } from '../trust.ts';
import { closed, language, type Language } from '../reports-ext/common.ts';
import { knownSources, markKinds, seatOf } from './core-state.ts';
import type { MarkKind, Seat } from './core-state.ts';
import { seatSees } from './core-markings.ts';

export const ruleKinds = ['branch', 'source', 'seat', 'access', 'marking'] as const;
export type RuleKind = typeof ruleKinds[number];
/** The five checks every step passes: what may be read, what may leave, how long it is kept, what may run, and who. */
export type CheckName = 'see' | 'send' | 'keep' | 'do' | 'people';

const seatWords: Record<Language, Record<Seat, string>> = {
  en: { owner: 'owner', cofounder: 'cofounder', accountant: 'accountant', ca: 'CA', staff: 'staff', viewer: 'viewer', assistant: 'assistant' },
  hi: { owner: 'मालिक', cofounder: 'सह-संस्थापक', accountant: 'अकाउंटेंट', ca: 'सीए', staff: 'स्टाफ़', viewer: 'दर्शक', assistant: 'सहायक' },
};
const markWords: Record<Language, Record<MarkKind, string>> = {
  en: { personal: 'personal', financial: 'financial', confidential: 'confidential' },
  hi: { personal: 'निजी', financial: 'वित्तीय', confidential: 'गोपनीय' },
};
const or = (lang: Language, items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ${lang === 'hi' ? 'या' : 'or'} ${items[items.length - 1]}`;

function ruleSentence(lang: Language, rule: RuleKind, seat: Seat, hidden: MarkKind[], source: { known: boolean; allowed: boolean } | null): string {
  const s = seatWords[lang][seat];
  if (lang === 'hi') switch (rule) {
    case 'marking': return hidden.length ? `${or(lang, hidden.map(k => markWords.hi[k]))} चिह्नित कोई भी चीज़ ${s} सीट से छिपी है।` : `इस जवाब में ऐसा चिह्नित डेटा है जो ${s} सीट नहीं देखती।`;
    case 'source': return source && !source.known ? 'यह स्रोत अब इस वर्कस्पेस में नहीं है।' : 'यह जवाब ऐसे स्रोत पर टिका है जिसे यह वर्कस्पेस पढ़ता नहीं है।';
    case 'branch': return `${s} सीट केवल कुछ शाखाएँ पढ़ती है; इस जवाब को दूसरी शाखा चाहिए।`;
    case 'access': return 'इस वर्कस्पेस में आपकी पहुँच बदल गई है। फिर से साइन इन करें।';
    case 'seat': return `${s} सीट यह नहीं कर सकती।`;
  }
  switch (rule) {
    case 'marking': return hidden.length ? `Anything marked ${or(lang, hidden.map(k => markWords.en[k]))} is hidden from the ${s} seat.` : `This answer holds marked data the ${s} seat does not see.`;
    case 'source': return source && !source.known ? 'This source is no longer in the workspace.' : 'This answer rests on a source this workspace does not read.';
    case 'branch': return `The ${s} seat reads only some branches; this answer needs another branch.`;
    case 'access': return 'Your access to this workspace has changed. Sign in again.';
    case 'seat': return `The ${s} seat cannot do this.`;
  }
}

function changeSentence(lang: Language, cofounder: boolean, both: boolean): string {
  if (lang === 'hi') return (!cofounder ? 'मालिक इसे बदल सकते हैं।' : both ? 'मालिक और सह-संस्थापक दोनों को मानना होगा।' : 'मालिक या सह-संस्थापक इसे बदल सकते हैं।') + ' बदलाव ऐप में होता है।';
  return (!cofounder ? 'The owner can change it.' : both ? 'The owner and the cofounder both have to agree.' : 'The owner or the cofounder can change it.') + ' The change is made in the app.';
}

const checkOf: Record<RuleKind, CheckName> = { marking: 'see', source: 'see', branch: 'people', access: 'people', seat: 'people' };
const whereOf: Record<RuleKind, { place: 'trust'; sub: string }> = {
  marking: { place: 'trust', sub: 'markings' }, source: { place: 'trust', sub: 'rules' },
  branch: { place: 'trust', sub: 'people' }, access: { place: 'trust', sub: 'people' }, seat: { place: 'trust', sub: 'people' },
};

export function explainRule(state: State, ctx: Context, payload: unknown) {
  const input = closed(payload ?? {}, ['rule', 'sourceId', 'language'], 'INVALID_EXPLAIN_REQUEST');
  check(ruleKinds.includes(input.rule), 'INVALID_EXPLAIN_REQUEST', 'Name the kind of rule: branch, source, seat, access or marking.');
  check(input.sourceId === undefined || (typeof input.sourceId === 'string' && input.sourceId.length > 0 && input.sourceId.length <= 200), 'INVALID_EXPLAIN_REQUEST', 'Name the source by its id.');
  const lang = language(input.language); const rule = input.rule as RuleKind;
  const member = state.members.find(m => m.id === ctx.memberId);
  check(member !== undefined, 'ACCESS_REVOKED', 'Your workspace access has changed. Sign in again.');
  const seat = seatOf(state, member);
  const sees = seatSees(state, seat); const hidden = rule === 'marking' ? markKinds.filter(k => !sees[k]) : [];
  // Only the caller's own question about a source: known and allowed, never its rows.
  const source = rule === 'source' && typeof input.sourceId === 'string'
    ? { known: knownSources(state).includes(input.sourceId), allowed: sourceAllowed(state, ctx, input.sourceId) } : null;
  const cofounder = state.members.some(m => m.active && m.role === 'cofounder');
  // Allowed sources are one admin's change; seats, branches and what a seat sees widen only under dual control.
  const both = rule !== 'source' && cofounder;
  return {
    rule, check: checkOf[rule], seat, sentence: ruleSentence(lang, rule, seat, hidden, source),
    ...(rule === 'marking' ? { hidden } : {}), ...(source ? { source } : {}),
    whoCanChange: { seats: ['owner', ...(cofounder ? ['cofounder'] : [])] as Seat[], both, sentence: changeSentence(lang, cofounder, both) },
    youCanChange: member.role === 'owner' || member.role === 'cofounder',
    where: whereOf[rule], language: lang,
  };
}

export async function explain(ctx: Context, payload: unknown, host: ModuleHost) { return explainRule(host.store.read(), ctx, payload); }
