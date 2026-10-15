/**
 * Words and small pieces the core Ask screens share: the fixed sentence for each refusal code,
 * the "what Chausar understood" line, the words for coverage gaps, and a refusal drawn inside a
 * page (a typed question that was refused, a save that did not go through).
 */
import type { Language } from '../../../app/presentation.ts';
import type { Catalogue } from '../../../places/types.ts';
import { words } from '../../../places/types.ts';
import { State } from '../../../patterns/States';
import { Button } from '../../../parts/Button';
import { fill, periodText, refusalState, useAsk, useRead } from './kit';
import { call, type Period } from './client.ts';
import { ruleExplainReply, type Completeness, type Gap, type RuleKind } from './core-replies.ts';
import s from './core.module.css';

type CodeKey = 'ASK_CANNOT_REBUILD' | 'ASK_INVALID' | 'ASK_NOT_FOUND' | 'ASK_REFUSED' | 'ASK_CHANGED' | 'ASK_STALE' | 'ASK_NO_CALCULATION' | 'REQUEST_FAILED' | 'INVALID_REPLY' | 'ASK_STOPPED';
const CODES = {
  en: {
    ASK_CANNOT_REBUILD: 'Something this answer used was deleted, so it cannot be rebuilt.',
    ASK_INVALID: 'Chausar could not read this request. Check the calculation and the period, then try again.',
    ASK_NOT_FOUND: 'This answer is no longer kept. Ask the question again from the menu.',
    ASK_REFUSED: 'Chausar will not work this out. Nothing was changed.',
    ASK_CHANGED: 'The books changed while this was being worked out. Try again to use what is there now.',
    ASK_STALE: 'This answer is out of date. Rebuild it to use what is in the books now.',
    ASK_NO_CALCULATION: 'No calculation covers this yet.',
    REQUEST_FAILED: 'The request did not reach the engine. Nothing was changed.',
    INVALID_REPLY: 'The engine sent a reply this page could not check, so nothing from it is shown.',
    ASK_STOPPED: 'Stopped as you asked. The unfinished answer was not kept.',
  },
  hi: {
    ASK_CANNOT_REBUILD: 'इस जवाब में इस्तेमाल हुई एक चीज़ हटा दी गई, इसलिए इसे फिर से नहीं बनाया जा सकता।',
    ASK_INVALID: 'Chausar यह अनुरोध पढ़ नहीं सका। गणना और अवधि जाँचें, फिर से कोशिश करें।',
    ASK_NOT_FOUND: 'यह जवाब अब रखा नहीं है। मेन्यू से सवाल फिर से पूछें।',
    ASK_REFUSED: 'Chausar यह हिसाब नहीं करेगा। कुछ बदला नहीं गया।',
    ASK_CHANGED: 'हिसाब के दौरान बही बदल गई। अभी जो है उससे फिर से कोशिश करें।',
    ASK_STALE: 'यह जवाब पुराना है। बही में अभी जो है उससे इसे फिर से बनाएँ।',
    ASK_NO_CALCULATION: 'अभी कोई गणना इसे नहीं करती।',
    REQUEST_FAILED: 'अनुरोध इंजन तक नहीं पहुँचा। कुछ बदला नहीं गया।',
    INVALID_REPLY: 'इंजन का जवाब यह पेज जाँच नहीं सका, इसलिए उसमें से कुछ नहीं दिखाया गया।',
    ASK_STOPPED: 'आपके कहने पर रोका गया। अधूरा जवाब रखा नहीं गया।',
  },
} as const satisfies Catalogue<CodeKey>;

/** The fixed words for a refusal code, or undefined for a code this lane has no words for. */
export function useExplain(): (code: string) => string | undefined {
  const w = words(CODES, useAsk().language) as Readonly<Record<string, string>>;
  return code => Object.hasOwn(w, code) ? w[code] : undefined;
}

const SHARED = {
  en: {
    line: '{calc} · {period} · {who}', lineNoPeriod: '{calc} · {who}', everyone: 'all branches', branch: 'branch {branch}',
    rule: 'A rule in Trust stops this answer for your seat.', ruleWho: 'The owner in Trust', openTrust: 'Open Trust',
    noDictionary: 'Agree what your words mean in Books before asking for numbers.', openMeanings: 'Open Meanings', retry: 'Try again',
    unreconciled: 'Some rows are not matched to an import yet.', conflicts: 'Some rows disagree with each other.', 'missing-amounts': 'Some rows have no amount.',
    empty: 'No rows were found for this period.', 'costs-only': 'Only costs were found, no sales.',
    'reconciled-imports': 'Counted from imports that were matched.', 'unreconciled-facts': 'Counted from facts not yet matched to an import.',
    partial: 'Only part of the period is loaded.', none: 'Nothing was found to count.',
  },
  hi: {
    line: '{calc} · {period} · {who}', lineNoPeriod: '{calc} · {who}', everyone: 'सभी शाखाएँ', branch: 'शाखा {branch}',
    rule: 'Trust का एक नियम आपकी सीट के लिए यह जवाब रोकता है।', ruleWho: 'Trust में मालिक', openTrust: 'Trust खोलें',
    noDictionary: 'संख्याएँ पूछने से पहले Books में तय करें कि आपके शब्दों का क्या अर्थ है।', openMeanings: 'अर्थ खोलें', retry: 'फिर से कोशिश करें',
    unreconciled: 'कुछ पंक्तियाँ अभी किसी इम्पोर्ट से मिलाई नहीं गईं।', conflicts: 'कुछ पंक्तियाँ आपस में मेल नहीं खातीं।', 'missing-amounts': 'कुछ पंक्तियों में रकम नहीं है।',
    empty: 'इस अवधि की कोई पंक्ति नहीं मिली।', 'costs-only': 'सिर्फ़ खर्च मिले, कोई बिक्री नहीं।',
    'reconciled-imports': 'मिलाए गए इम्पोर्ट से गिना गया।', 'unreconciled-facts': 'उन तथ्यों से गिना गया जो अभी इम्पोर्ट से मिलाए नहीं गए।',
    partial: 'अवधि का सिर्फ़ एक हिस्सा लोड है।', none: 'गिनने को कुछ नहीं मिला।',
  },
} as const satisfies Catalogue<'line' | 'lineNoPeriod' | 'everyone' | 'branch' | 'rule' | 'ruleWho' | 'openTrust' | 'noDictionary' | 'openMeanings' | 'retry' | Gap | Completeness | 'none'>;
export const useShared = () => words(SHARED, useAsk().language);

/** One fixed sentence per kind of rule (AS-09). The rule's own text is never shown. */
const RULES = {
  en: {
    branch: 'Rows from a branch your seat does not cover are hidden from it.',
    source: 'Rows from a source your seat may not read are hidden from it.',
    seat: 'Your seat is not allowed to ask for this calculation.',
    access: 'Your seat may not open the rows this answer needs.',
    marking: 'Rows marked private are hidden from your seat.',
  },
  hi: {
    branch: 'जिस शाखा को आपकी सीट नहीं देखती, उसकी पंक्तियाँ उससे छिपी हैं।',
    source: 'जिस स्रोत को आपकी सीट नहीं पढ़ सकती, उसकी पंक्तियाँ उससे छिपी हैं।',
    seat: 'आपकी सीट को यह गणना पूछने की अनुमति नहीं है।',
    access: 'आपकी सीट वे पंक्तियाँ नहीं खोल सकती जो इस जवाब के लिए चाहिए।',
    marking: 'निजी चिह्नित पंक्तियाँ आपकी सीट से छिपी हैं।',
  },
} as const satisfies Catalogue<RuleKind>;
export const useRuleWords = () => words(RULES, useAsk().language);

/** Who can change a rule, from Trust's own answer (AS-09). */
const CHANGE = {
  en: { owner: 'The owner', 'owner-or-cofounder': 'The owner or a co-founder', ruleText: 'The rule in Trust: {text}', changeable: '{who} can change it in Trust.' },
  hi: { owner: 'मालिक', 'owner-or-cofounder': 'मालिक या सह-संस्थापक', ruleText: 'Trust का नियम: {text}', changeable: '{who} इसे Trust में बदल सकते हैं।' },
} as const satisfies Catalogue<'owner' | 'owner-or-cofounder' | 'ruleText' | 'changeable'>;

/**
 * The rule's own words from Trust (askx.explainRule), drawn as text. While it is read, or when
 * Trust cannot explain it yet, `fallback` is drawn: the fixed sentence for the kind of rule.
 */
export function useRuleExplain(rule: RuleKind, receiptId?: string) {
  const ask = useAsk();
  const [load] = useRead(`rule|${rule}|${receiptId ?? ''}|${ask.language}`, () => call(ask.rpc, 'askx.explainRule', { rule, language: ask.language, ...(receiptId === undefined ? {} : { receiptId }) }, ruleExplainReply));
  return load.kind === 'ok' && load.value.state === 'ready' ? load.value : null;
}
export function RuleLine({ rule, receiptId }: { rule: RuleKind; receiptId?: string | undefined }) {
  const ask = useAsk(), explained = useRuleExplain(rule, receiptId), c = words(CHANGE, ask.language);
  if (explained === null) return null;
  return (
    <p className={s.note} data-rule-text={explained.ruleId}>
      <span>{fill(c.ruleText, { text: explained.text })}</span> <span>{fill(c.changeable, { who: c[explained.changeableBy] })}</span>
    </p>
  );
}

function RuleRefusal({ code, rule, receiptId }: { code: string; rule: RuleKind; receiptId?: string | undefined }) {
  const ask = useAsk(), w = useShared(), rules = useRuleWords(), c = words(CHANGE, ask.language);
  const explained = useRuleExplain(rule, receiptId);
  return (
    <div className={s.block} data-refusal={code} data-rule={rule}>
      {explained === null
        ? <State state={{ kind: 'stopped-by-rule', rule: rules[rule], who: w.ruleWho }} />
        : <span data-rule-text={explained.ruleId}><State state={{ kind: 'stopped-by-rule', rule: explained.text, who: c[explained.changeableBy] }} /></span>}
      <Button variant="link" onClick={() => ask.leave({ place: 'trust' })}>{w.openTrust}</Button>
    </div>
  );
}

/** "Invoiced by customer · Aug 2026 · all branches": the calculation, the period and who is counted. */
export function understoodText(calc: string, period: Period | null, branch: string | null, language: Language): string {
  const w = words(SHARED, language), who = branch === null ? w.everyone : fill(w.branch, { branch });
  return period === null ? fill(w.lineNoPeriod, { calc, who }) : fill(w.line, { calc, period: periodText(period, language), who });
}

/** A month as "July 2026": calendar words, never a figure. */
export function monthText(month: string, language: Language): string {
  return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00.000Z`));
}

/** A refusal drawn inside a page that is otherwise shown. */
export function Refusal({ code, rule, retry, receiptId }: { code: string; rule?: RuleKind | undefined; retry?: (() => void) | undefined; receiptId?: string | undefined }) {
  const ask = useAsk(), w = useShared(), explain = useExplain();
  if (code === 'ASK_STOPPED_BY_RULE' && rule !== undefined) return <RuleRefusal code={code} rule={rule} receiptId={receiptId} />;
  if (code === 'ASK_STOPPED_BY_RULE') {
    return (
      <div className={s.block} data-refusal={code} data-rule={rule ?? ''}>
        <State state={{ kind: 'stopped-by-rule', rule: w.rule, who: w.ruleWho }} />
        <Button variant="link" onClick={() => ask.leave({ place: 'trust' })}>{w.openTrust}</Button>
      </div>
    );
  }
  if (code === 'ASK_NO_DICTIONARY') {
    return <p className={s.note} data-refusal={code}>{w.noDictionary} <Button variant="link" onClick={() => ask.leave({ place: 'books', sub: 'meanings' })}>{w.openMeanings}</Button></p>;
  }
  return (
    <div data-refusal={code}>
      <State state={refusalState(code, w.rule, explain(code))} action={retry ? { label: w.retry, onPress: retry } : undefined} />
    </div>
  );
}
