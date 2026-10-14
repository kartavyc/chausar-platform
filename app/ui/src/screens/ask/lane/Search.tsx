/**
 * AS-18 Search results: rows grouped by kind, the matching words in ink. The engine sends
 * each hit's text with the ranges that matched; the text is drawn as text nodes and each
 * range as a <mark>, never as markup built from the text. The search runs on this computer.
 */
import { useState, type ReactNode } from 'react';
import { Button } from '../../../parts/Button';
import { Field } from '../../../parts/Field';
import { call, fail, id, int, list, obj, oneOf, str } from './client.ts';
import { AskPage, useAsk, useRead, useWords, type AskView } from './kit';
import { catalogue, Part, useRefusal } from './analysis';
import s from './analysis.module.css';

const KINDS = ['saved', 'decision', 'investigation', 'check', 'why'] as const;
type Kind = (typeof KINDS)[number];
export interface SearchValue { readonly query: string; readonly groups: readonly { kind: Kind; hits: readonly { id: string; text: string; marks: readonly [number, number][] }[] }[] }
export function searchReply(value: unknown): SearchValue {
  const v = obj(value);
  return {
    query: str(v.query, 500),
    groups: list(v.groups, g => {
      const x = obj(g);
      return {
        kind: oneOf(x.kind, KINDS),
        hits: list(x.hits, h => {
          const y = obj(h), text = str(y.text, 2000);
          let end = 0;
          const marks = list(y.marks, m => {
            if (!Array.isArray(m) || m.length !== 2) fail();
            const a = int(m[0]), b = int(m[1]);
            if (a < end || b <= a || b > text.length) fail();
            end = b;
            return [a, b] as [number, number];
          }, 100);
          return { id: id(y.id), text, marks };
        }, 500),
      };
    }, 10),
  };
}

const WORDS = catalogue({
  en: {
    title: 'Search', query: 'Find a saved answer, an investigation, a decision or a check by a word', search: 'Search',
    local: 'The search runs on this computer. Nothing is sent.', none: 'Nothing found for this word.', start: 'Type a word to search.',
    saved: 'Saved answers', decision: 'Decisions', investigation: 'Investigations', check: 'Checks', why: 'Why it changed',
  },
  hi: {
    title: 'खोज', query: 'किसी शब्द से सहेजा उत्तर, जाँच, निर्णय या परख खोजें', search: 'खोजें',
    local: 'खोज इसी कंप्यूटर पर चलती है। कुछ भी भेजा नहीं जाता।', none: 'इस शब्द के लिए कुछ नहीं मिला।', start: 'खोजने के लिए कोई शब्द लिखें।',
    saved: 'सहेजे उत्तर', decision: 'निर्णय', investigation: 'जाँचें', check: 'परख', why: 'यह क्यों बदला',
  },
});

/** The hit's text with its matching ranges in ink. Every piece is a text node. */
export function Marked({ text, marks }: { text: string; marks: readonly [number, number][] }) {
  const parts: ReactNode[] = [];
  let at = 0;
  marks.forEach(([a, b], i) => {
    if (a > at) parts.push(text.slice(at, a));
    parts.push(<mark key={i}>{text.slice(a, b)}</mark>);
    at = b;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <span className={s.hit}>{parts}</span>;
}

export function SearchScreen({ view }: { view: Extract<AskView, { kind: 'search' }> }) {
  const w = useWords(WORDS);
  const [typed, setTyped] = useState(view.query ?? '');
  const [query, setQuery] = useState(view.query?.trim() ?? '');
  return (
    <AskPage title={w.title}>
      {() => (
        <>
          <form className={s.formLine} role="search" onSubmit={e => { e.preventDefault(); setQuery(typed.trim()); }}>
            <Field label={w.query} type="search" value={typed} maxLength={200} onChange={e => setTyped(e.target.value)} className={s.grow} />
            <Button submit disabled={typed.trim() === ''}>{w.search}</Button>
          </form>
          <p className={s.note}>{w.local}</p>
          {query === '' ? <p className={s.note}>{w.start}</p> : <Results key={query} query={query} />}
        </>
      )}
    </AskPage>
  );
}

function Results({ query }: { query: string }) {
  const ask = useAsk(), w = useWords(WORDS), explain = useRefusal();
  const [load] = useRead(`search|${query}`, () => call(ask.rpc, 'askx.search', { query }, searchReply));
  if (load.kind === 'loading') return null;
  if (load.kind !== 'ok') return <p className={s.problem} role="alert">{explain(load.kind === 'refused' ? load.code : 'NOT_BUILT')}</p>;
  const groups = load.value.groups.filter(g => g.hits.length > 0);
  if (groups.length === 0) return <p>{w.none}</p>;
  const open = (kind: Kind, hitId: string) => {
    if (kind === 'decision') ask.go({ kind: 'decision', decisionId: hitId });
    else if (kind === 'check') ask.go({ kind: 'check', checkId: hitId });
    else if (kind === 'why' || kind === 'investigation') ask.go({ kind: 'why', whyId: hitId });
    else ask.go({ kind: 'saved' });
  };
  return (
    <div data-search-results="">
      {groups.map(g => (
        <Part key={g.kind} title={w[g.kind]}>
          <ul className={s.list}>
            {g.hits.map(h => (
              <li key={h.id} className={s.item}>
                <Button variant="link" className={s.grow} onClick={() => open(g.kind, h.id)}><Marked text={h.text} marks={h.marks} /></Button>
              </li>
            ))}
          </ul>
        </Part>
      ))}
    </div>
  );
}
