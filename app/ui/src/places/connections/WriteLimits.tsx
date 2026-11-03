import { useEffect, useId, useState, type FormEvent } from 'react';
import { useEngine, useResource } from '../../engine/context';
import type { WriteCapKind } from '../../engine/types';
import { useT } from '../../text';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Inner } from '../../parts/Card';
import s from './PostingLimits.module.css';

const KINDS: readonly WriteCapKind[] = ['drafts', 'books-lines', 'messages'];
export function WriteLimits() {
  const t = useT(), engine = useEngine(), id = useId();
  const [open, setOpen] = useState(false);
  const policy = useResource('venture.spend.policy.get', {}, { skip: !open });
  const [typed, setTyped] = useState<Partial<Record<WriteCapKind, string>>>({});
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ error: boolean; text: string } | null>(null);
  useEffect(() => { if (policy.data) setTyped(Object.fromEntries((policy.data.writeCaps ?? []).map(row => [row.kind, String(row.configuredCap)]))); }, [policy.data]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setSaid(null);
    try {
      const view = await engine.request('venture.spend.policy.set', { writeCaps: Object.fromEntries(KINDS.map(kind => [kind, Number(typed[kind])])) });
      setTyped(Object.fromEntries((view.writeCaps ?? []).map(row => [row.kind, String(row.configuredCap)])));
      setSaid({ error: false, text: t('money.writeLimits.saved') });
    } catch (error) { setSaid({ error: true, text: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(false); }
  }
  return <div className={s.form}>
    <Button className={s.toggle} variant="quiet" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{t('money.writeLimits.title')}</Button>
    {open && <Inner><form id={id} className={s.form} aria-label={t('money.writeLimits.title')} onSubmit={event => void save(event)}>
      <p>{t('money.writeLimits.line')}</p>
      {policy.error && <p role="alert">{policy.error.message}</p>}
      {policy.data && <><div className={s.fields}>{KINDS.map(kind => <Field key={kind} label={t(`money.writeLimits.${kind}`)} inputMode="numeric" value={typed[kind] ?? ''} disabled={busy} onChange={event => setTyped({ ...typed, [kind]: event.currentTarget.value })} />)}</div>
        <div className={s.actions}><Button type="submit" disabled={busy}>{t(busy ? 'money.writeLimits.saving' : 'money.writeLimits.save')}</Button>{said && <span role={said.error ? 'alert' : 'status'}>{said.text}</span>}</div></>}
    </form></Inner>}
  </div>;
}
