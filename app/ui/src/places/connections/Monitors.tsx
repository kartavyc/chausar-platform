/**
 * Connections, "Pages you watch" (Ink v2 wave 5, 5A6; the engine's build/monitors.ts, catalogue K16): a public page
 * Chausar looks at once an hour, as itself, telling the owner on Today when it changes, when words appear, or when a
 * price falls below their figure. Adding one is a standing check, approved here inside the app; the form is one step
 * away. The figure is typed in whole rupees and sent as paise by appending two zeros: no arithmetic on money here. The
 * engine refuses addresses inside the network, sites whose terms bar automated reading and pages robots.txt keeps
 * robots from; the hosted app says page watching runs in the desktop app.
 */

import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import type { MonitorKind, MonitorView } from '../../engine/types';
import { codeWords } from './KitConnect';
import s from './Mailbox.module.css';
import k from './KitConnect.module.css';

const KINDS: readonly MonitorKind[] = ['change', 'contains', 'price-below'];

export function Monitors() {
  const t = useT();
  const engine = useEngine();
  const list = useResource('venture.monitors.list', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const [opened, setOpened] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const hosted = list.data?.hosted ?? engine.transport === 'hosted';

  async function stop(monitor: MonitorView) {
    setProblem(null);
    try {
      await engine.request('venture.monitors.remove', { id: monitor.id });
      list.reload();
    } catch (error) {
      setProblem(codeWords(error, t));
    }
  }

  return (
    <div role="region" aria-label={t('kit-connect.monitors.title')} className={s.card} data-monitors="">
      <p className={s.quiet}>{t('kit-connect.monitors.line')}</p>
      {list.data && <p className={s.said} data-monitors-line="">{list.data.line}</p>}
      {list.data && list.data.monitors.length > 0 && (
        <ul className={k.list}>
          {list.data.monitors.map((monitor) => (
            <li key={monitor.id} className={k.item} data-monitor={monitor.id}>
              <div className={k.itemHead}>
                <span className={k.name}>{monitor.host}</span>
                <span className={k.small}>{t(`kit-connect.monitors.kind.${monitor.kind}`)}</span>
              </div>
              <p className={monitor.failing ? s.problem : k.small}>{monitor.alert?.line ?? monitor.line}</p>
              {!hosted && <div className={s.actions}><Button size="sm" variant="quiet" onClick={() => void stop(monitor)}>{t('kit-connect.monitors.stop')}</Button></div>}
            </li>
          ))}
        </ul>
      )}
      {!hosted && !opened && <div className={s.actions}><Button size="sm" onClick={() => setOpened(true)}>{t('kit-connect.monitors.add')}</Button></div>}
      {!hosted && opened && <AddForm onDone={() => { setOpened(false); list.reload(); }} onCancel={() => setOpened(false)} />}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </div>
  );
}

/** The page, what to watch for, and for a price the part of the page and the owner's figure. */
function AddForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const engine = useEngine();
  const name = useId();
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<MonitorKind>('change');
  const [text, setText] = useState('');
  const [selector, setSelector] = useState('');
  const [rupees, setRupees] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const wholeRupees = /^[1-9]\d{0,12}$/.test(rupees.trim());
  const ready = Boolean(url.trim()) && (kind !== 'contains' || Boolean(text.trim())) && (kind !== 'price-below' || (Boolean(selector.trim()) && wholeRupees));

  async function save() {
    if (busy || !ready) return;
    setBusy(true);
    setProblem(null);
    try {
      await engine.request('venture.monitors.add', {
        url: url.trim(), kind,
        ...(kind === 'contains' ? { text: text.trim() } : {}),
        ...(kind === 'price-below' ? { selector: selector.trim(), belowMinor: `${rupees.trim()}00` } : {}),
      });
      onDone();
    } catch (error) {
      setProblem(codeWords(error, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.form} data-monitor-form="">
      <Field label={t('kit-connect.monitors.url')} hint={t('kit-connect.monitors.urlHint')} type="url" value={url} autoComplete="off" spellCheck={false} onChange={(event) => setUrl(event.currentTarget.value)} />
      <fieldset className={k.kinds}>
        <legend>{t('kit-connect.monitors.kind')}</legend>
        {KINDS.map((item) => (
          <label key={item}>
            <input type="radio" name={name} value={item} checked={kind === item} onChange={() => setKind(item)} />
            {t(`kit-connect.monitors.kind.${item}`)}
          </label>
        ))}
      </fieldset>
      {kind === 'contains' && <Field label={t('kit-connect.monitors.text')} value={text} onChange={(event) => setText(event.currentTarget.value)} />}
      {kind === 'price-below' && (
        <div className={s.row}>
          <Field label={t('kit-connect.monitors.selector')} hint={t('kit-connect.monitors.selectorHint')} value={selector} spellCheck={false} onChange={(event) => setSelector(event.currentTarget.value)} />
          <Field label={t('kit-connect.monitors.rupees')} hint={t('kit-connect.monitors.rupeesHint')} inputMode="numeric" value={rupees} onChange={(event) => setRupees(event.currentTarget.value)} />
        </div>
      )}
      <div className={s.actions}>
        <Button variant="primary" disabled={busy || !ready} onClick={() => void save()}>{t('kit-connect.monitors.save')}</Button>
        <Button variant="quiet" onClick={onCancel}>{t('kit-connect.monitors.cancel')}</Button>
      </div>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </div>
  );
}
