/**
 * TL-04 Plugins (tools/plugins): each plugin with who made it, its level and its kind;
 * blocked rows with the reason; the blocked list's version and date; Remove (admin), after
 * which what it produced stays, labelled with its name. "Install a plugin" (admin) opens
 * TL-05 in the sheet. The page also holds TL-06 (tools from outside, over models-ext: the
 * description Chausar wrote beside the one the tool sent) and TL-10 (language packs).
 * Simple shows only the installed plugins with On or Off and one "Add a plugin" link; Books
 * adds ids, status words and digests.
 */
import { useState } from 'react';
import { withSheet } from '../../app/routes.ts';
import { count } from '../../format/index.ts';
import type { PlaceRenderProps } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { State } from '../../patterns/States';
import { useEngine, useSend } from '../trust/kit/engine.ts';
import { Group, Note, Screen, screenState } from '../trust/kit/Screen';
import { WRAPPED, detail, granted, outsideTools, type Installed, type Tool } from './adapters/wrapped.ts';
import { INSTALL_SHEET, InstallSheet } from './InstallPlugin';
import { Line, Lines, Part, Quoted, SentLine, Warn, day, isAdmin, toolsWords, type Words } from './shared';
import { languagePacks, plugins, removed, type PluginRow } from './validate.ts';
import { fill } from './words.ts';
import s from './Plugins.module.css';

/** Status words the engine uses for a plugin that runs. */
const RUNNING: ReadonlySet<string> = new Set(['enabled', 'on', 'active', 'installed']);

function SimpleLine({ p, w }: { p: PluginRow; w: Words }) {
  return <Line title={p.name} after={<span className={s.note}>{RUNNING.has(p.status) ? w.on : w.off}</span>} />;
}

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

/** What Chausar checked about a tool, in this screen's own words. */
function ours(t: Tool, w: Words): string {
  return [
    t.sites.length === 0 ? w.oursNoSites : fill(w.oursSites, { sites: t.sites.join(', ') }),
    t.code ? w.oursCode : w.oursNoCode,
    t.schema === 'unsupported' ? w.oursSchemaUnsupported : t.takesArguments ? w.oursArgs : w.oursNoArgs,
    ...(t.runnable ? [] : [w.oursNotRunnable]),
  ].join(' ');
}

function OutsideDetail({ p, props, w }: { p: Installed; props: PlaceRenderProps; w: Words }) {
  const { state } = useEngine(props.rpc, WRAPPED.get, { id: p.id }, detail, p.id);
  return (
    <Part loaded={state} w={w}>
      {(d) => (
        <div className={s.stack}>
          {d.tools.map((t) => (
            <div key={t.name} className={s.pair} aria-label={t.name}>
              <div><h3 className={s.small}>{fill(w.oursOf, { name: t.name })}</h3><p className={s.text}>{ours(t, w)}</p></div>
              <div><h3 className={s.small}>{w.theirs}</h3><Quoted>{t.theirs}</Quoted></div>
            </div>
          ))}
          {d.skills.map((k) => (
            <div key={k.name} className={s.pair} aria-label={k.name}>
              <div><h3 className={s.small}>{fill(w.oursOf, { name: k.name })}</h3><p className={s.text}>{w.oursSkill}</p></div>
              <div><h3 className={s.small}>{w.theirs}</h3><Quoted>{k.theirs}</Quoted></div>
            </div>
          ))}
        </div>
      )}
    </Part>
  );
}

function OutsideLine({ p, props, w, onChanged }: { p: Installed; props: PlaceRenderProps; w: Words; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const again = useSend(props.rpc, granted);
  const owner = !props.viewer && props.member.role === 'owner';
  const setAside = p.grant !== null && !p.grant.current;
  const books = props.view === 'books';
  return (
    <Line title={p.name} notes={[
      fill(w.byMaker, { maker: p.publisherId }), p.signature === 'verified' ? w.sigVerified : w.sigUnverified,
      books ? fill(w.versionDigest, { version: p.version, digest: p.digest }) : null,
    ]} after={setAside && owner ? (
      <Button disabled={again.sent.kind === 'sending'} onClick={async () => {
        if (p.grant === null) return;
        if (await again.send(WRAPPED.grant, { id: p.id, digest: p.digest, sites: p.grant.sites, code: p.grant.code }) !== null && props.live(props.address)) onChanged();
      }}>{w.approveAgain}</Button>
    ) : undefined}>
      {setAside && <Warn>{w.setAside}</Warn>}
      <SentLine sent={again.sent} done={w.approved} w={w} />
      <div><Button variant="link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? w.hideBoth : w.showBoth}</Button></div>
      {open && <OutsideDetail p={p} props={props} w={w} />}
    </Line>
  );
}

function Outside({ props, w }: { props: PlaceRenderProps; w: Words }) {
  const { state, reload } = useEngine(props.rpc, WRAPPED.list, {}, outsideTools);
  return (
    <Group title={w.outside} note={w.outsideNote}>
      <Part loaded={state} w={w}>
        {(tools) => tools.length === 0 ? <Note>{w.outsideEmpty}</Note>
          : <Lines>{tools.map((p) => <OutsideLine key={p.id} p={p} props={props} w={w} onChanged={reload} />)}</Lines>}
      </Part>
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
  const simple = view === 'simple';
  const { state, reload } = useEngine(rpc, 'trustx.plugins', {}, plugins);
  const removal = useSend(rpc, removed);
  return (
    <div className={s.page}>
      <Screen where={w.where} title={w['title.plugins']} loaded={state}
        count={state.kind === 'ready' ? { exact: String(state.value.plugins.length), display: count(String(state.value.plugins.length)) } : undefined}
        aside={admin && !simple ? <Button onClick={() => navigate(withSheet(address, INSTALL_SHEET))}>{w.install}</Button> : undefined}>
        {(value) => simple ? (
          <>
            {value.plugins.length === 0 ? <Note>{w.pluginsEmpty}</Note>
              : <Lines label={w['title.plugins']}>{value.plugins.map((p) => <SimpleLine key={p.id} p={p} w={w} />)}</Lines>}
            {admin && <div><Button variant="link" onClick={() => navigate(withSheet(address, INSTALL_SHEET))}>{w.addPlugin}</Button></div>}
          </>
        ) : (
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
      {!simple && <Outside props={props} w={w} />}
      {!simple && <Packs props={props} w={w} />}
      {address.sheet === INSTALL_SHEET && <InstallSheet props={props} onInstalled={reload} />}
    </div>
  );
}
