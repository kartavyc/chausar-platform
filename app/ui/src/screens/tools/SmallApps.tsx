/**
 * TL-01 Small apps (tools/smallapps): the apps as rows with their state, and "Make one":
 * one line, then the permission list (the calculations it would read and the actions it
 * would propose, each by name) before anything is made. The line is data, sent as typed.
 * A row opens TL-02 in the sheet; the follow-up book (TL-03) has its own sheet id.
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
import { FOLLOW_UP_BOOK, SMALLAPPS, appList, appRow, draft, type AppRow, type AppState } from './adapters/smallapps.ts';
import { FollowUpBookSheet } from './FollowUpBook';
import { SmallAppSheet } from './SmallApp';
import { Quoted, SentLine, UsesList, toolsWords, type Words } from './shared';
import s from './SmallApps.module.css';

const MARK: Readonly<Record<AppState, Mark>> = { making: 'busy', made: 'cha', stale: 'unsure', blocked: 'off', refused: 'off' };

function rowOf(app: AppRow, w: Words): RowItem {
  return { id: app.id, mark: MARK[app.state], what: app.title, note: w[`state.${app.state}`], ...(app.reason !== null ? { asWritten: app.reason } : {}) };
}

function MakeOne({ props, w, onMade }: { props: PlaceRenderProps; w: Words; onMade: () => void }) {
  const [line, setLine] = useState('');
  const ask = useSend(props.rpc, draft);
  const create = useSend(props.rpc, appRow);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (line.trim().length === 0) return;
    create.clear();
    void ask.send(SMALLAPPS.make, { line });
  };
  const shown = ask.sent.kind === 'done' ? ask.sent.value : null;
  return (
    <Group title={w.makeOne} note={w.lineIsData}>
      <form className={s.make} onSubmit={submit}>
        <Field label={w.lineLabel} value={line} maxLength={300} onChange={(e) => { setLine(e.target.value); ask.clear(); }} />
        <Button submit disabled={line.trim().length === 0 || ask.sent.kind === 'sending'}>{w.lineAsk}</Button>
      </form>
      {shown === null ? <SentLine sent={ask.sent} w={w} /> : shown.refused !== null ? (
        <div className={s.draft}><p className={s.small}>{w.draftRefused}</p><Quoted>{shown.refused}</Quoted></div>
      ) : (
        <div className={s.draft} aria-label={shown.title}>
          <h3 className={s.draftTitle}>{shown.title}</h3>
          <p className={s.small}>{w.beforeMade}</p>
          <UsesList uses={shown.uses} w={w} />
          <div className={s.buttons}>
            <Button variant="filled" disabled={create.sent.kind === 'sending'} onClick={async () => {
              const made = await create.send(SMALLAPPS.create, { draftId: shown.draftId });
              if (made !== null) { ask.clear(); setLine(''); onMade(); }
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
  const { address, language, rpc, viewer, navigate, openReceipt } = props;
  const w = toolsWords(language);
  const { state, reload } = useEngine(rpc, SMALLAPPS.list, {}, appList);
  const sheet = address.sheet;
  return (
    <>
      <Screen where={w.where} title={w['title.smallapps']} loaded={state}
        count={state.kind === 'ready' ? { exact: String(state.value.length), display: count(String(state.value.length)) } : undefined}>
        {(apps) => (
          <>
            <Note>{w.neverMore}</Note>
            {apps.length === 0 ? <Note>{w.appsEmpty}</Note> : (
              <RowList rows={apps.map((a) => rowOf(a, w))} selectedId={sheet} onReceipt={openReceipt}
                opens={(row) => apps.find((a) => a.id === row.id)?.state !== 'refused'}
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
