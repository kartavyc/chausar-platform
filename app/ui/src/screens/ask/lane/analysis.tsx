/**
 * Shared pieces of the ask lane's analysis screens (why, what if, forecast, plan, GSTR-2B,
 * search, decisions and checks): the fixed words for every refusal code, one-shot engine
 * calls for the controls that change something, exact text-to-whole-hundredths conversion
 * for what a person types, and the checked menu read the forms choose from.
 */
import { useCallback, useState, type ReactNode } from 'react';
import { IntlProvider, useIntl } from 'react-intl';
import type { Language } from '../../../app/presentation.ts';
import type { Catalogue } from '../../../places/types.ts';
import { call, fail, id, list, obj, oneOf, period, str, type Period } from './client.ts';
import { useAsk, useWords } from './kit';
import s from './analysis.module.css';

type Code =
  | 'ASK_INVALID' | 'ASK_NOT_FOUND' | 'ASK_NO_DICTIONARY' | 'ASK_STOPPED_BY_RULE' | 'ASK_REFUSED' | 'ASK_CHANGED' | 'ASK_STALE'
  | 'ASK_NOT_GROUPABLE' | 'ASK_BRIDGE_NOT_EXACT' | 'ASK_NOT_FORECASTABLE' | 'ASK_NO_CALCULATION' | 'ASK_FORECAST_GAPS'
  | 'REQUEST_FAILED' | 'INVALID_REPLY' | 'NOT_BUILT' | 'FORBIDDEN' | 'VAULT_LOCKED' | 'OTHER';
const REFUSALS = {
  en: {
    ASK_INVALID: 'Chausar could not use what was entered. Check the form and try again.',
    ASK_NOT_FOUND: 'This is no longer here. It may have been removed.',
    ASK_NO_DICTIONARY: 'Agree what your words mean in Books before asking for numbers.',
    ASK_STOPPED_BY_RULE: 'A rule in Trust stops this for your seat.',
    ASK_REFUSED: 'Chausar refused this request.',
    ASK_CHANGED: 'Something changed while this was open. Open it again.',
    ASK_STALE: 'This was worked out before the books changed. Work it out again.',
    ASK_NOT_GROUPABLE: 'This calculation cannot be split that way. Choose another split.',
    ASK_BRIDGE_NOT_EXACT: 'The measured causes did not add up exactly, so nothing is shown.',
    ASK_NOT_FORECASTABLE: 'Only a money total can be forecast. Choose another calculation.',
    ASK_NO_CALCULATION: 'No calculation covers this.',
    ASK_FORECAST_GAPS: 'A month of history has rows that are not reconciled, so the forecast cannot be tested.',
    REQUEST_FAILED: 'The request did not finish. Nothing was changed.',
    INVALID_REPLY: 'The reply could not be checked, so it is not shown.',
    NOT_BUILT: 'This part is not built yet.',
    FORBIDDEN: 'This seat can read, not change.',
    VAULT_LOCKED: 'The vault is locked.',
    OTHER: 'This did not work. Nothing was changed.',
  },
  hi: {
    ASK_INVALID: 'जो भरा गया उसे Chausar उपयोग नहीं कर सका। फ़ॉर्म जाँचें और फिर कोशिश करें।',
    ASK_NOT_FOUND: 'यह अब यहाँ नहीं है। शायद इसे हटा दिया गया है।',
    ASK_NO_DICTIONARY: 'संख्याएँ पूछने से पहले Books में तय करें कि आपके शब्दों का क्या अर्थ है।',
    ASK_STOPPED_BY_RULE: 'Trust का एक नियम आपकी सीट के लिए इसे रोकता है।',
    ASK_REFUSED: 'Chausar ने यह अनुरोध मना कर दिया।',
    ASK_CHANGED: 'खुले रहते समय कुछ बदल गया। इसे फिर से खोलें।',
    ASK_STALE: 'यह खाते बदलने से पहले निकाला गया था। इसे फिर से निकालें।',
    ASK_NOT_GROUPABLE: 'इस गणना को इस तरह नहीं बाँटा जा सकता। कोई और बँटवारा चुनें।',
    ASK_BRIDGE_NOT_EXACT: 'मापे गए कारण ठीक-ठीक नहीं जुड़े, इसलिए कुछ नहीं दिखाया गया।',
    ASK_NOT_FORECASTABLE: 'केवल पैसे के कुल का अनुमान लगाया जा सकता है। कोई और गणना चुनें।',
    ASK_NO_CALCULATION: 'इसके लिए कोई गणना नहीं है।',
    ASK_FORECAST_GAPS: 'इतिहास के एक महीने की पंक्तियाँ मिलाई नहीं गई हैं, इसलिए अनुमान को परखा नहीं जा सकता।',
    REQUEST_FAILED: 'अनुरोध पूरा नहीं हुआ। कुछ नहीं बदला।',
    INVALID_REPLY: 'जवाब जाँचा नहीं जा सका, इसलिए दिखाया नहीं गया।',
    NOT_BUILT: 'यह हिस्सा अभी बना नहीं है।',
    FORBIDDEN: 'यह सीट पढ़ सकती है, बदल नहीं सकती।',
    VAULT_LOCKED: 'तिजोरी बंद है।',
    OTHER: 'यह नहीं हुआ। कुछ नहीं बदला।',
  },
} as const satisfies Catalogue<Code>;

/** A screen's words: the English keys decide, and Hindi must have every one of them. */
export function catalogue<K extends string>(c: { readonly en: Readonly<Record<K, string>>; readonly hi: Readonly<Record<NoInfer<K>, string>> }): Catalogue<K> { return c; }

/** The fixed words for a refusal code. An unknown code gets the plain words; its code shows in small type. */
export function useRefusal(): (code: string) => string {
  const w = useWords(REFUSALS);
  return useCallback((code: string) => (Object.hasOwn(w, code) ? w[code as Code] : w.OTHER), [w]);
}

/** A refusal from a control, in words, with its code in small type. */
export function Problem({ code }: { code: string | null }) {
  const explain = useRefusal();
  if (code === null) return null;
  return <p className={s.problem} role="alert">{explain(code)} <span className={s.code}>{code}</span></p>;
}

/**
 * One engine call from a control that changes something. A viewer seat never sends. The
 * reply is checked like any other; a refusal is kept as its code for `Problem`.
 */
export function useSend() {
  const ask = useAsk();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const send = useCallback(async <T,>(method: string, payload: Record<string, unknown>, validate: (value: unknown) => T, done: (value: T) => void) => {
    if (ask.viewer) return;
    setBusy(true); setProblem(null);
    const reply = await call(ask.rpc, method, payload, validate);
    if (!ask.live()) return;
    setBusy(false);
    if (reply.kind === 'ok') done(reply.value);
    else setProblem(reply.kind === 'not-built' ? 'NOT_BUILT' : reply.code);
  }, [ask]);
  return { busy, problem, send, clear: () => setProblem(null) };
}

/**
 * What a person typed as rupees (or a percent), as whole hundredths (paise, or basis points),
 * by string arithmetic only. Commas and spaces are ignored; anything else gives null.
 */
export function hundredths(text: string, allowNegative = false): string | null {
  const m = /^(-?)(\d{1,16})(?:\.(\d{1,2}))?$/.exec(text.replace(/[,\s₹%]/g, ''));
  if (m === null || (m[1] === '-' && !allowNegative)) return null;
  const digits = `${m[2]}${(m[3] ?? '').padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  return digits === '0' ? '0' : `${m[1]}${digits}`;
}

/** A month ("2026-09") as words. Calendar formatting only. */
export function monthText(month: string, language: Language): string {
  const instant = new Date(`${month.slice(0, 7)}-01T00:00:00.000Z`);
  return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(instant);
}
export function month(value: unknown): string { const v = str(value, 10); if (!/^\d{4}-\d{2}(-\d{2})?$/.test(v)) fail(); return v; }

/** The reply of a removal: `{ removed: true }` and nothing less. */
export function removed(value: unknown): true { if (obj(value).removed !== true) fail(); return true; }

export const PERIOD_IDS = ['this-month', 'last-month', 'this-quarter', 'last-quarter', 'this-year', 'last-year'] as const;
export type PeriodId = (typeof PERIOD_IDS)[number];
export const PERIOD_WORDS = {
  en: { 'this-month': 'This month', 'last-month': 'Last month', 'this-quarter': 'This quarter', 'last-quarter': 'Last quarter', 'this-year': 'This year', 'last-year': 'Last year' },
  hi: { 'this-month': 'इस महीने', 'last-month': 'पिछले महीने', 'this-quarter': 'इस तिमाही', 'last-quarter': 'पिछली तिमाही', 'this-year': 'इस वर्ष', 'last-year': 'पिछले वर्ष' },
} as const satisfies Catalogue<PeriodId>;

/** The parts of askx.menu the analysis forms choose from: money totals and the period choices. */
export interface MenuChoices {
  readonly sums: readonly { operationId: string; label: string }[];
  readonly periods: readonly { id: PeriodId; period: Period }[];
}
export function menuChoices(value: unknown): MenuChoices {
  const v = obj(value);
  oneOf(v.state, ['ready', 'no-dictionary'] as const);
  const topics = list(v.topics, t => list(obj(t).items, item => {
    const i = obj(item);
    return { operationId: id(i.operationId), label: str(i.label, 300), type: str(i.type, 60) };
  }), 20);
  return {
    sums: topics.flat().filter(i => i.type === 'sum').map(({ operationId, label }) => ({ operationId, label })),
    periods: list(v.periods, p => { const c = obj(p); return { id: oneOf(c.id, PERIOD_IDS), period: period(c.period) }; }, 20),
  };
}

/**
 * Puts this screen's words under text keys for a shared part that reads its words by key
 * (Steps). The words are the screen's own catalogue; nothing outside the catalogue enters.
 */
export function WithWords({ words, children }: { words: Readonly<Record<string, string>>; children: ReactNode }) {
  const intl = useIntl();
  return <IntlProvider locale={intl.locale} defaultLocale="en" messages={{ ...(intl.messages as Record<string, string>), ...words }}>{children}</IntlProvider>;
}

/** A small titled block of a page. */
export function Part({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={s.part} aria-label={title}>
      <h2 className={s.heading}>{title}{aside}</h2>
      {children}
    </section>
  );
}
