/**
 * BK-12, round 4, on a record's page: the reminders, actions and notes that name the record,
 * each with where it came from (`records.timelineMore`), and "Ask about this record", which
 * sets the frame's ask-line context when the frame offers it (`setAbout`).
 */
import { useState } from 'react';
import { Section, Note, Refusal, Button } from '../work/kit/Page';
import { useReply } from '../work/kit/reply.ts';
import { timelineMoreReply } from './contract-r4b.ts';
import { Table, fill, styles as s, useWords, valueOf, type BooksProps } from './shared.tsx';
import { useAuditWords } from './words-audit.ts';
import { useR4bWords } from './words-r4b.ts';
import { dayIn, setAboutOf } from './r4b-parts.tsx';

export function AskAbout({ props, id, name }: { props: BooksProps; id: string; name: string }) {
  const a = useAuditWords(props.language), k = useR4bWords(props.language);
  const [set, setSet] = useState(false);
  const setAbout = setAboutOf(props);
  // Without the frame's seam the page says plainly that asking about a record is not built yet.
  if (!setAbout) return <Note>{a.askAboutNotBuilt}</Note>;
  return (
    <div className={s.inline}>
      <Button onClick={() => { setAbout({ kind: 'record', id, name }); setSet(true); }}>{k['ask.about']}</Button>
      {set && <span role="status">{fill(k['ask.set'], { name })}</span>}
    </div>
  );
}

export function TimelineMore({ props, id, zone }: { props: BooksProps; id: string; zone: string | null }) {
  const k = useR4bWords(props.language), w = useWords(props.language);
  const { loaded, reload } = useReply(props, 'records.timelineMore', { id }, timelineMoreReply, id);
  const value = valueOf(loaded);
  return (
    <Section title={k['tl.title']}>
      {loaded.phase === 'refused' && (loaded.state.kind === 'not-built' ? <Note>{k['tl.notBuilt']}</Note>
        : <span className={s.inline}><Refusal code={loaded.code} language={props.language} /><Button variant="link" onClick={reload}>{w.retry}</Button></span>)}
      {value && (value.entries.length === 0 ? <Note>{k['tl.empty']}</Note> : (
        <Table view={props.view} caption={k['tl.title']} columns={[
          { head: k['tl.col.when'], simple: true }, { head: k['tl.col.type'], simple: true }, { head: k['tl.col.what'], simple: true }, { head: k['tl.col.state'] }, { head: k['tl.col.source'] },
        ]} rows={value.entries.map((e, i) => ({ key: `${e.at}-${i}`, cells: [
          dayIn(e.at, props.language, zone),
          <span data-entry={e.type}>{k[`tl.type.${e.type}`]}</span>,
          e.what ?? e.ref ?? '',
          e.status ?? '',
          <span data-source={e.source}>{k[`tl.source.${e.source}`]}</span>,
        ] }))} />
      ))}
      {value && value.omitted > 0 && <Note>{fill(k['tl.omitted'], { n: value.omitted })}</Note>}
      {value && !value.journal.available && props.view !== 'simple' && <Note>{k['tl.journalNotBuilt']}</Note>}
    </Section>
  );
}
