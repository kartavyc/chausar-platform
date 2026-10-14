/**
 * TL-01 Small apps (tools/smallapps), over models-ext's `smallapps.*`: the apps as rows with
 * their state, and "Make one": one line, sent as typed and treated as data, then the
 * permission list (the calculations it would read and the actions it would propose, each by
 * name) before anything is made. "Make it" sends back exactly what was planned. A row opens
 * TL-02 in the sheet; the follow-up book (TL-03) has its own sheet id. Books adds ids and
 * versions; Simple keeps the rows and the line.
 */
import { useState, type FormEvent } from 'react';
import type { Mark, RowItem } from '../../app/presentation.ts';
import { withSheet } from '../../app/routes.ts';
import { count } from '../../format/index.ts';
import type { PlaceRenderProps } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { RowList } from '../../parts/RowList';
import { useEngine, useSend } from '../trust/kit/engine.ts';
import { Group, Note, Screen } from '../trust/kit/Screen';
import { FOLLOW_UP_BOOK, SMALLAPPS, app, appList, proposal, type AppRow, type AppState } from './adapters/smallapps.ts';
import { FollowUpBookSheet } from './FollowUpBook';
import { SmallAppSheet } from './SmallApp';
import { Names, Quoted, SentLine, UsesList, toolsWords, type Words } from './shared';
import { fill } from './words.ts';
import s from './SmallApps.module.css';

const MARK: Readonly<Record<AppState, Mark>> = { made: 'cha', stale: 'unsure' };

function rowOf(a: AppRow, w: Words, view: PlaceRenderProps['view']): RowItem {
  const note = view === 'books' ? fill(w.stateVersionId, { state: w[`state.${a.state}`], version: count(String(a.version)), id: a.id }) : w[`state.${a.state}`];
  // Why an app is stale is the engine's own sentence, shown as written; Simple keeps to the plain state.
  return { id: a.id, mark: MARK[a.state], what: a.title, note, ...(view !== 'simple' && a.reasons.length > 0 ? { asWritten: a.reasons.join(' ') } : {}) };
}

function MakeOne({ props, w, onMade }: { props: PlaceRenderProps; w: Words; onMade: () => void }) {
  const [line, setLine] = useState('');
  const ask = useSend(props.rpc, proposal);
  const create = useSend(props.rpc, app);
  const books = props.view === 'books';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (line.trim().length === 0) return;
    create.clear();
    void ask.send(SMALLAPPS.propose, { line });
  };
  const shown = ask.sent.kind === 'done' ? ask.sent.value : null;
  return (
    <Group title={w.makeOne} note={w.lineIsData}>
      <form className={s.make} onSubmit={submit}>
        <Field label={w.lineLabel} value={line} maxLength={500} onChange={(e) => { setLine(e.target.value); ask.clear(); }} />
        <Button submit disabled={line.trim().length === 0 || ask.sent.kind === 'sending'}>{w.lineAsk}</Button>
      </form>
      {shown === null ? <SentLine sent={ask.sent} w={w} /> : !shown.supported ? (
        <div className={s.draft}><p className={s.small}>{w.notYet}</p><Quoted>{shown.message}</Quoted></div>
      ) : (
        <div className={s.draft} aria-label={shown.title}>
          <h3 className={s.draftTitle}>{shown.title}</h3>
          <p className={s.small}>{w.beforeMade}</p>
          <UsesList calculations={shown.calculationNames} actions={shown.actions.map((a) => a.alwaysWaits ? fill(w.alwaysWaitsName, { name: a.label }) : a.label)}
            book={shown.uses.books.length > 0} w={w} />
          {books && <><h3 className={s.small}>{w.references}</h3><Names names={[...shown.uses.calculations, ...shown.uses.actions]} w={w} /></>}
          <div className={s.buttons}>
            <Button variant="filled" disabled={create.sent.kind === 'sending'} onClick={async () => {
              const made = await create.send(SMALLAPPS.create, { descriptor: shown.descriptor, request: line });
              if (made !== null && props.live(props.address)) { ask.clear(); setLine(''); onMade(); }
            }}>{w.makeIt}</Button>
            <Button onClick={() => { ask.clear(); create.clear(); }}>{w.notNow}</Button>
          </div>
        </div>
      )}
      <SentLine sent={create.sent} done={w.made} w={w} />
    </Group>
  );
}

export function SmallAppsPlace(props: PlaceRenderProps) {
  const { address, language, rpc, viewer, navigate, openReceipt, view } = props;
  const w = toolsWords(language);
  const { state, reload } = useEngine(rpc, SMALLAPPS.list, {}, appList);
  const sheet = address.sheet;
  return (
    <>
      <Screen where={w.where} title={w['title.smallapps']} loaded={state}
        count={state.kind === 'ready' ? { exact: String(state.value.length), display: count(String(state.value.length)) } : undefined}>
        {(apps) => (
          <>
            {view !== 'simple' && <Note>{w.neverMore}</Note>}
            {apps.length === 0 ? <Note>{w.appsEmpty}</Note> : (
              <RowList rows={apps.map((a) => rowOf(a, w, view))} selectedId={sheet} onReceipt={openReceipt}
                onOpen={(id) => navigate(withSheet(address, id))} />
            )}
            <div><Button variant="link" onClick={() => navigate(withSheet(address, FOLLOW_UP_BOOK))}>{w.openBook}</Button></div>
            {viewer ? <Note>{w.readOnly}</Note> : <MakeOne props={props} w={w} onMade={reload} />}
          </>
        )}
      </Screen>
      {sheet === FOLLOW_UP_BOOK ? <FollowUpBookSheet key={sheet} props={props} />
        : sheet !== undefined ? <SmallAppSheet key={sheet} id={sheet} props={props} onChanged={reload} /> : null}
    </>
  );
}
