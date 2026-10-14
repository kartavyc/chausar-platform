/**
 * TL-05 Install a plugin (tools/plugins?sheet=install). A package file is read with the File
 * API, size-limited and parsed as data, then inspected by the engine. The sheet shows who
 * made it, its level, version, licence and signature, the locked box with its doors, each
 * thing it asks for with No and Yes (every answer starts No), flagged text as data with its
 * label, and a refused package's reason with no install control. Install sends the package,
 * the answers as shown and the inspected digest, once.
 */
import { useState, type ChangeEvent } from 'react';
import { withoutSheet } from '../../app/routes.ts';
import type { PlaceRenderProps } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { YesNo } from '../../parts/Choice';
import { KeyValue } from '../../parts/KeyValue';
import { Sheet } from '../../parts/Sheet';
import { useSend } from '../trust/kit/engine.ts';
import { LockedBox } from './LockedBox';
import { Line, Lines, Quoted, SentLine, Warn, isAdmin, toolsWords, type Words } from './shared';
import { PACKAGE_MAX_BYTES, inspection, pluginPackage, pluginRow, type Inspection, type PluginPackage, type PluginRow } from './validate.ts';
import { fill } from './words.ts';
import s from './InstallPlugin.module.css';

export const INSTALL_SHEET = 'install';
const RUNNING: ReadonlySet<string> = new Set(['enabled', 'on', 'active', 'installed']);

async function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('unreadable'));
    reader.readAsText(file);
  });
}

function Inspected({ pkg, value, props, w, onInstalled }: { pkg: PluginPackage; value: Inspection; props: PlaceRenderProps; w: Words; onInstalled: () => void }) {
  const [answers, setAnswers] = useState<Record<string, boolean>>(() => Object.fromEntries(value.asks.map((a) => [a.id, false])));
  const install = useSend(props.rpc, pluginRow);
  const [row, setRow] = useState<PluginRow | null>(null);
  const books = props.view === 'books';
  const missing = value.asks.filter((a) => answers[a.id] !== true).map((a) => a.name);
  return (
    <div className={s.body}>
      <KeyValue onReceipt={props.openReceipt} pairs={[
        { name: w.maker, value: value.maker }, { name: w.level, value: w[`level.${value.level}`] },
        { name: w.version, value: value.version, mono: true }, { name: w.licence, value: value.licence },
        { name: w.signature, value: w[`sig.${value.signature}`] },
        ...(books ? [{ name: w.digest, value: value.digest, mono: true }] : []),
      ]} />
      {value.signature === 'key-changed' && <Warn>{w.keyChanged}</Warn>}
      <LockedBox doors={value.doors} w={w} />
      {value.flagged.length > 0 && (
        <section className={s.section} aria-label={w.flagged}>
          <h3 className={s.small}>{w.flagged}</h3>
          <Lines>
            {value.flagged.map((f, i) => (
              <Line key={i} title={<span className={s.flagLabel}>{w.flaggedLabel}</span>} notes={[fill(w.inField, { field: f.field })]}>
                <Quoted>{f.text}</Quoted>
              </Line>
            ))}
          </Lines>
        </section>
      )}
      {value.refused !== null ? (
        <div className={s.section}><p className={s.p}>{w.pkgRefused}</p><Quoted>{value.refused}</Quoted></div>
      ) : (
        <section className={s.section} aria-label={w.asksFor}>
          <h3 className={s.small}>{w.asksFor}</h3>
          {value.level === 'community' && <p className={s.note}>{w.allNo}</p>}
          {value.asks.length === 0 ? <p className={s.note}>{w.asksNothing}</p> : (
            <Lines>
              {value.asks.map((a) => (
                <Line key={a.id} title={a.name} notes={[w[`ask.${a.kind}`]]}
                  after={<YesNo label={a.name} value={answers[a.id] === true} disabled={row !== null} onChange={(yes) => setAnswers({ ...answers, [a.id]: yes })} />} />
              ))}
            </Lines>
          )}
          {row === null && (
            <div><Button variant="filled" disabled={install.sent.kind === 'sending'} onClick={async () => {
              const done = await install.send('trustx.installPlugin', { ...pkg, answers, digest: value.digest });
              if (done !== null && props.live(props.address)) { setRow(done); onInstalled(); }
            }}>{w.installIt}</Button></div>
          )}
          {row === null ? <SentLine sent={install.sent} w={w} />
            : RUNNING.has(row.status) ? <p className={s.p} role="status">{w.installed}</p>
            : missing.length > 0 ? <div role="status"><p className={s.p}>{w.staysOff}</p><ul className={s.list}>{missing.map((m, i) => <li key={i}>{m}</li>)}</ul></div>
            : <p className={s.p} role="status">{w.staysOffPlain}</p>}
        </section>
      )}
    </div>
  );
}

export function InstallSheet({ props, onInstalled }: { props: PlaceRenderProps; onInstalled: () => void }) {
  const w = toolsWords(props.language);
  const [pkg, setPkg] = useState<PluginPackage | null>(null);
  const [problem, setProblem] = useState<'tooLarge' | 'notPackage' | null>(null);
  const inspect = useSend(props.rpc, inspection);
  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setPkg(null); setProblem(null); inspect.clear();
    if (file === undefined) return;
    if (file.size > PACKAGE_MAX_BYTES) { setProblem('tooLarge'); return; }
    let parsed: PluginPackage;
    try { parsed = pluginPackage(await readText(file)); } catch { setProblem('notPackage'); return; }
    setPkg(parsed);
    await inspect.send('trustx.inspectPlugin', { ...parsed });
  };
  return (
    <Sheet kind={w.pluginKind} title={w.install} origin={null} onClose={() => props.navigate(withoutSheet(props.address))}>
      {!isAdmin(props) ? <p className={s.note}>{props.viewer ? w.readOnly : w.adminOnly}</p> : (
        <div className={s.body}>
          <label className={s.file}>
            <span className={s.small}>{w.pickFile}</span>
            <input type="file" accept="application/json,.json" onChange={(e) => { void pick(e); }} />
          </label>
          {problem !== null && <p className={s.refused} role="status">{w[problem]}</p>}
          {pkg !== null && inspect.sent.kind === 'done'
            ? <Inspected key={inspect.sent.value.digest} pkg={pkg} value={inspect.sent.value} props={props} w={w} onInstalled={onInstalled} />
            : <SentLine sent={inspect.sent} w={w} />}
          <p className={s.note}>{w.noKey}</p>
        </div>
      )}
    </Sheet>
  );
}
