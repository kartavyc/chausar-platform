/**
 * TL-04 Plugins (tools/plugins): each plugin with who made it, its level and its kind;
 * blocked rows with the reason; the blocked list's version and date; Remove (admin), after
 * which what it produced stays, labelled with its name. "Install a plugin" (admin) opens
 * TL-05 in the sheet. The page also holds TL-06 (tools from outside, their two descriptions
 * side by side) and TL-10 (language packs, which are plugins in the design).
 */
import { useState } from 'react';
import { withSheet } from '../../app/routes.ts';
import { count } from '../../format/index.ts';
import type { PlaceRenderProps } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { State } from '../../patterns/States';
import { useEngine, useSend } from '../trust/kit/engine.ts';
import { Group, Note, Screen, screenState } from '../trust/kit/Screen';
import { WRAPPED, wrapped, type WrappedTool } from './adapters/wrapped.ts';
import { INSTALL_SHEET, InstallSheet } from './InstallPlugin';
import { Line, Lines, Quoted, SentLine, Warn, day, isAdmin, toolsWords, type Words } from './shared';
import { anyObject, languagePacks, plugins, removed, type PluginRow } from './validate.ts';
import { fill } from './words.ts';
import s from './Plugins.module.css';

function PluginLine({ p, admin, books, w, onRemove }: { p: PluginRow; admin: boolean; books: boolean; w: Words; onRemove: (id: string) => void }) {
  const [asking, setAsking] = useState(false);
  const notes = [fill(w.byMaker, { maker: p.maker }), w[`level.${p.level}`], w[`kind.${p.kind}`], ...(books ? [fill(w.status, { status: p.status }), p.id] : [])];
  const after = !admin || p.level === 'built-in' ? undefined : asking ? (
    <>
      <Button danger onClick={() => { setAsking(false); onRemove(p.id); }}>{fill(w.removeYes, { name: p.name })}</Button>
      <Button variant="link" onClick={() => setAsking(false)}>{w.keepIt}</Button>
    </>
  ) : <Button onClick={() => setAsking(true)}>{w.remove}</Button>;
  return (
    <Line title={p.name} notes={notes} after={after}>
      {asking && <p className={s.note}>{fill(w.removeAsk, { name: p.name })}</p>}
      {p.level === 'blocked' && p.blockedReason !== null && <><p className={s.note}>{w.blockedBy}</p><Quoted>{p.blockedReason}</Quoted></>}
    </Line>
  );
}

function Outside({ props, w, admin }: { props: PlaceRenderProps; w: Words; admin: boolean }) {
  const { state, reload } = useEngine(props.rpc, WRAPPED.list, {}, wrapped);
  const again = useSend(props.rpc, anyObject);
  const tool = (t: WrappedTool) => (
    <Line key={t.id} title={t.name} after={t.changed && admin ? (
      <Button disabled={again.sent.kind === 'sending'} onClick={async () => { if (await again.send(WRAPPED.reapprove, { id: t.id }) !== null) reload(); }}>{w.approveAgain}</Button>
    ) : undefined}>
      {t.changed && <Warn>{w.setAside}</Warn>}
      <div className={s.pair}>
        <div><h3 className={s.small}>{w.ours}</h3><Quoted>{t.ours}</Quoted></div>
        <div><h3 className={s.small}>{w.theirs}</h3><Quoted>{t.theirs}</Quoted></div>
      </div>
    </Line>
  );
  return (
    <Group title={w.outside} note={w.outsideNote}>
      {state.kind !== 'ready' ? <State state={screenState(state)} /> : state.value.length === 0 ? <Note>{w.outsideEmpty}</Note> : <Lines>{state.value.map(tool)}</Lines>}
      <SentLine sent={again.sent} done={w.approved} w={w} />
    </Group>
  );
}

function Packs({ props, w }: { props: PlaceRenderProps; w: Words }) {
  const { state } = useEngine(props.rpc, 'trustx.languagePacks', {}, languagePacks);
  return (
    <Group title={w.packs}>
      {state.kind !== 'ready' ? <State state={screenState(state)} /> : state.value.length === 0 ? <Note>{w.packsEmpty}</Note> : (
        <Lines>
          {state.value.map((k) => {
            const supported = k.supported && k.total > 0 && k.passed === k.total;
            return <Line key={k.id} title={k.name} notes={[
              fill(w.cases, { passed: count(String(k.passed)), total: count(String(k.total)) }),
              supported ? w.supported : w.notSupported,
              k.reviewed ? null : fill(w.notReviewed, { name: k.name }),
              props.view === 'books' ? k.id : null,
            ]} />;
          })}
        </Lines>
      )}
    </Group>
  );
}

export function PluginsPlace(props: PlaceRenderProps) {
  const { address, language, rpc, navigate, view } = props;
  const w = toolsWords(language);
  const admin = isAdmin(props);
  const { state, reload } = useEngine(rpc, 'trustx.plugins', {}, plugins);
  const removal = useSend(rpc, removed);
  return (
    <div className={s.page}>
      <Screen where={w.where} title={w['title.plugins']} loaded={state}
        count={state.kind === 'ready' ? { exact: String(state.value.plugins.length), display: count(String(state.value.plugins.length)) } : undefined}
        aside={admin ? <Button onClick={() => navigate(withSheet(address, INSTALL_SHEET))}>{w.install}</Button> : undefined}>
        {(value) => (
          <>
            {props.viewer && <Note>{w.readOnly}</Note>}
            {value.plugins.length === 0 ? <Note>{w.pluginsEmpty}</Note> : (
              <Lines label={w['title.plugins']}>
                {value.plugins.map((p) => <PluginLine key={p.id} p={p} admin={admin} books={view === 'books'} w={w}
                  onRemove={async (id) => { if (await removal.send('trustx.removePlugin', { id }) !== null) reload(); }} />)}
              </Lines>
            )}
            <SentLine sent={removal.sent} done={w.removedNote} w={w} />
            {removal.sent.kind === 'done' && view === 'books' && <Note>{fill(w.keptAs, { kept: removal.sent.value.kept })}</Note>}
            <Note>{fill(w.blockedList, { version: value.blockedList.version, date: day(value.blockedList.checkedAt, language) })}</Note>
          </>
        )}
      </Screen>
      <Outside props={props} w={w} admin={admin} />
      <Packs props={props} w={w} />
      {address.sheet === INSTALL_SHEET && <InstallSheet props={props} onInstalled={reload} />}
    </div>
  );
}
