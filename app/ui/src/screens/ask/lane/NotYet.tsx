/**
 * AS-17 the not-yet list: what was asked for and could not be done. Three lists: wanted
 * calculations, wanted actions, and business words Chausar did not know, each with how often
 * it was asked and when last.
 */
import type { Catalogue } from '../../../places/types.ts';
import { AskPage, countWords, dayText, fill, useAsk, useRead, useWords, type AskView } from './kit';
import { call } from './client.ts';
import { wantedReply, type WantedReply } from './core-replies.ts';
import { useExplain } from './core-words';
import s from './core.module.css';

const WORDS = {
  en: {
    title: 'Not yet', intro: 'What was asked for and could not be done yet. Each is kept so it can be built.',
    calculations: 'Wanted calculations', actions: 'Wanted actions', words: 'Words Chausar did not know',
    count: '{count} in this list', asked: 'asked {count} times', last: 'last on {date}', none: 'Nothing here yet.',
    empty: 'Nothing is on the not-yet list. When a question cannot be answered, it is kept here.',
  },
  hi: {
    title: 'अभी नहीं', intro: 'जो माँगा गया और अभी नहीं हो सका। हर चीज़ रखी जाती है ताकि उसे बनाया जा सके।',
    calculations: 'चाही गई गणनाएँ', actions: 'चाहे गए काम', words: 'शब्द जो Chausar नहीं जानता था',
    count: 'इस सूची में {count}', asked: '{count} बार पूछा गया', last: 'आख़िरी बार {date}', none: 'यहाँ अभी कुछ नहीं।',
    empty: '“अभी नहीं” सूची में कुछ नहीं है। जब किसी सवाल का जवाब नहीं मिलता, वह यहाँ रखा जाता है।',
  },
} as const satisfies Catalogue<'title' | 'intro' | 'calculations' | 'actions' | 'words' | 'count' | 'asked' | 'last' | 'none' | 'empty'>;

export function NotYetScreen(_props: { view: Extract<AskView, { kind: 'notyet' }> }) {
  const ask = useAsk(), w = useWords(WORDS), explain = useExplain();
  const [load, retry] = useRead('wanted', () => call(ask.rpc, 'askx.wanted', {}, wantedReply));
  const n = (value: number) => countWords(String(value));
  return (
    <AskPage title={w.title} load={load} retry={retry} explain={explain}
      empty={r => r.calculations.length + r.actions.length + r.words.length === 0 ? <p className={s.note}>{w.empty}</p> : null}>
      {(r: WantedReply) => {
        const lists = [
          { key: 'calculations', title: w.calculations, items: r.calculations.map(x => ({ text: x.text, count: x.count, lastAt: x.lastAt })) },
          { key: 'actions', title: w.actions, items: r.actions.map(x => ({ text: x.text, count: x.count, lastAt: x.lastAt })) },
          { key: 'words', title: w.words, items: r.words.map(x => ({ text: x.word, count: x.count, lastAt: x.lastAt })) },
        ];
        return (
          <div className={s.page}>
            {ask.view !== 'books' && <p className={s.note}>{w.intro}</p>}
            {lists.map(l => (
              <section key={l.key} className={s.section} aria-labelledby={`notyet-${l.key}`} data-wanted={l.key}>
                <h2 id={`notyet-${l.key}`} className={s.heading}>{l.title} · {fill(w.count, { count: n(l.items.length) })}</h2>
                {l.items.length === 0 ? <p className={s.small}>{w.none}</p> : (
                  <ul className={s.ledger}>
                    {l.items.map((x, i) => (
                      <li key={`${x.text}|${i}`}>
                        <div className={s.ledgerLine}>
                          <span className={s.text}>{x.text}</span>
                          <span className={s.note}>{fill(w.asked, { count: n(x.count) })}</span>
                        </div>
                        {ask.view !== 'simple' && <p className={s.small}>{fill(w.last, { date: dayText(x.lastAt, ask.language) })}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        );
      }}
    </AskPage>
  );
}
