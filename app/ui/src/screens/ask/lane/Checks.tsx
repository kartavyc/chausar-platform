/**
 * AS-16 Checks: your own questions with known answers, as a standing test of everything that
 * changes. Rows: the question, the expected value, and the last result (same, moved, or
 * cannot run). Run all now. Checks run again on every change of model route, meaning,
 * recipe or app version; their values stay in the vault and are never shared.
 */
import { useState } from 'react';
import type { RowItem } from '../../../app/presentation.ts';
import { Button } from '../../../parts/Button';
import { RowList } from '../../../parts/RowList';
import { bool, call, date, id, list, minor, obj, oneOf, optMinor, optStr, str } from './client.ts';
import { unitShape, type UnitShape } from './core-replies.ts';
import { AskPage, dayText, figureOf, fill, missingFigure, rowMoneyFigure, useAsk, useRead, useWords, type AskView } from './kit';
import { catalogue, Part, Problem, StopButton, useRefusal, useSend } from './analysis';
import s from './analysis.module.css';

export interface CheckResult { readonly at: string; readonly result: 'same' | 'moved' | 'cannot-run'; readonly minor: string | null; readonly receiptId: string | null; readonly code: string | null; readonly because: readonly string[] }
export function checkResult(value: unknown): CheckResult {
  const x = obj(value);
  return {
    at: date(x.at), result: oneOf(x.result, ['same', 'moved', 'cannot-run'] as const), minor: optMinor(x.minor),
    receiptId: x.receiptId === null || x.receiptId === undefined ? null : id(x.receiptId), code: optStr(x.code, 64), because: list(x.because, b => str(b, 64), 20),
  };
}
/** The expected value, or null for both when its receipt no longer opens for this seat (withheld). */
export function expectedOf(e: Record<string, unknown>): { minor: string | null; receiptId: string | null } {
  if (e.minor === null && e.receiptId === null) return { minor: null, receiptId: null };
  return { minor: minor(e.minor), receiptId: id(e.receiptId) };
}
export interface ChecksValue {
  readonly items: readonly ({ id: string; question: string; operationId: string; figureKey: string; expected: { minor: string | null; receiptId: string | null }; last: CheckResult | null } & UnitShape)[];
  readonly due: boolean; readonly changed: readonly string[]; readonly lastRunAt: string | null;
}
export function checksReply(value: unknown): ChecksValue {
  const v = obj(value);
  return {
    items: list(v.items, i => {
      const x = obj(i), e = obj(x.expected);
      return { id: id(x.id), question: str(x.question, 2000), operationId: id(x.operationId), figureKey: str(x.figureKey, 100), expected: expectedOf(e), last: x.last === null ? null : checkResult(x.last), ...unitShape(x) };
    }, 2000),
    due: bool(v.due), changed: list(v.changed, c => str(c, 64), 20), lastRunAt: v.lastRunAt === null ? null : date(v.lastRunAt),
  };
}

/** What changed, in words, for the fingerprint parts the engine names. */
export const CHANGE_WORDS = catalogue({
  en: { route: 'the model route', dictionaryHash: 'a meaning', meaning: 'a meaning', recipes: 'a recipe', recipe: 'a recipe', app: 'the app version', other: 'something else' },
  hi: { route: 'मॉडल का रास्ता', dictionaryHash: 'कोई अर्थ', meaning: 'कोई अर्थ', recipes: 'कोई तरीका', recipe: 'कोई तरीका', app: 'ऐप का संस्करण', other: 'कुछ और' },
});
export function changeWord(words: Readonly<Record<keyof (typeof CHANGE_WORDS)['en'], string>>, code: string): string {
  return Object.hasOwn(words, code) ? words[code as 'route'] : words.other;
}

const WORDS = catalogue({
  en: {
    title: 'Checks', rule: 'Checks run again on every change of model route, meaning, recipe or app version. Their values stay in the vault and are never shared.',
    empty: 'No checks yet. Save an answer as a check from its page.', runAll: 'Run all now', running: 'Running…',
    due: 'Something changed since the last run, so the checks are due.', changed: 'Changed since the last run: {what}.', lastRun: 'Last run on {date}.', neverRun: 'Not run yet.',
    same: 'same on {date}', moved: 'moved on {date}', 'cannot-run': 'cannot run, {date}', notYet: 'not run yet', expected: 'expected',
  },
  hi: {
    title: 'परख', rule: 'मॉडल का रास्ता, अर्थ, तरीका या ऐप का संस्करण बदलने पर परख फिर से चलती है। उनके मान तिजोरी में रहते हैं और कभी साझा नहीं होते।',
    empty: 'अभी कोई परख नहीं। किसी उत्तर के पन्ने से उसे परख के रूप में सहेजें।', runAll: 'अभी सब चलाएँ', running: 'चल रहा है…',
    due: 'पिछली बार के बाद कुछ बदला है, इसलिए परख चलानी है।', changed: 'पिछली बार के बाद बदला: {what}।', lastRun: 'पिछली बार {date} को चली।', neverRun: 'अभी नहीं चली।',
    same: '{date} को वही', moved: '{date} को बदला', 'cannot-run': 'चल नहीं सकी, {date}', notYet: 'अभी नहीं चली', expected: 'अपेक्षित',
  },
});

export function ChecksScreen(_props: { view: Extract<AskView, { kind: 'checks' }> }) {
  const ask = useAsk(), w = useWords(WORDS), changes = useWords(CHANGE_WORDS), explain = useRefusal();
  const [load, retry] = useRead('checks', () => call(ask.rpc, 'askx.checks.list', {}, checksReply));
  const [ran, setRan] = useState<ChecksValue | null>(null);
  const run = useSend();
  return (
    <AskPage title={w.title} load={load} retry={retry} explain={explain}
      aside={!ask.viewer && load.kind === 'ok' && load.value.items.length > 0 ? <><Button variant="filled" disabled={run.busy} onClick={() => void run.send('askx.checks.run', {}, checksReply, setRan)}>{run.busy ? w.running : w.runAll}</Button>{run.busy && <StopButton />}</> : undefined}>
      {first => {
        const c = ran ?? first, lang = ask.language;
        const rows: RowItem[] = c.items.map(i => ({
          id: i.id, what: i.question, figure: i.expected.minor === null || i.expected.receiptId === null ? missingFigure('withheld') : i.unit === 'money' ? rowMoneyFigure(i.expected.minor, i.expected.receiptId, ask.view, lang) : figureOf(i.unit, i.expected.minor, i.expected.receiptId, [], i.quantityUnit),
          mark: i.last === null ? 'off' : i.last.result === 'same' ? 'cha' : i.last.result === 'moved' ? 'wait' : 'unsure',
          note: i.last === null ? w.notYet : fill(w[i.last.result], { date: dayText(i.last.at, lang) }),
        }));
        return (
          <>
            <Problem code={run.problem} />
            {c.due && <p className={s.lead} data-checks-due="">{w.due}</p>}
            {c.changed.length > 0 && <p className={s.note}>{fill(w.changed, { what: new Intl.ListFormat(lang, { type: 'conjunction' }).format([...new Set(c.changed.map(code => changeWord(changes, code)))]) })}</p>}
            <p className={s.note}>{c.lastRunAt === null ? w.neverRun : fill(w.lastRun, { date: dayText(c.lastRunAt, lang) })}</p>
            <Part title={w.title}>
              {rows.length === 0 ? <p className={s.note}>{w.empty}</p> : <div data-checks=""><RowList rows={rows} onOpen={checkId => ask.go({ kind: 'check', checkId })} onReceipt={rid => ask.go({ kind: 'receipt', receiptId: rid })} /></div>}
            </Part>
            <p className={s.note}>{w.rule}</p>
          </>
        );
      }}
    </AskPage>
  );
}
