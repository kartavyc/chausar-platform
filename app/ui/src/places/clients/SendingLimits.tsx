import { useEffect, useId, useState, type FormEvent } from 'react';
import { useEngine, useResource } from '../../engine/context';
import type { OutreachLane } from '../../engine/types';
import { useT } from '../../text';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Inner } from '../../parts/Card';
import { HOUSE_CAPS, OUTREACH_LANES, WARMUP_PERCENT } from '../../../../../platform/shared/venture/network/limit-settings.ts';
import s from '../connections/PostingLimits.module.css';

export function SendingLimits() {
  const t = useT(), engine = useEngine(), id = useId();
  const [open, setOpen] = useState(false);
  const settings = useResource('venture.pipeline.settings', {}, { skip: !open });
  const [daily, setDaily] = useState<Partial<Record<OutreachLane, string>>>({});
  const [weekly, setWeekly] = useState<Partial<Record<OutreachLane, string>>>({});
  const [warmup, setWarmup] = useState<string[]>([]);
  const [peopleDay, setPeopleDay] = useState('');
  const [peopleWeek, setPeopleWeek] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ error: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!settings.data) return;
    const caps = settings.data.caps;
    setDaily(Object.fromEntries(OUTREACH_LANES.map(lane => [lane, String(caps.channels?.[lane] ?? HOUSE_CAPS[lane].day)])));
    setWeekly(Object.fromEntries(OUTREACH_LANES.map(lane => [lane, String((caps.channelWeeks?.[lane] === undefined ? HOUSE_CAPS[lane].week : caps.channelWeeks[lane]) ?? '')])));
    setWarmup((caps.warmupPercent ?? WARMUP_PERCENT).map(String));
    setPeopleDay(String(caps.newPerDay)); setPeopleWeek(String(caps.perWeek));
  }, [settings.data]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setSaid(null);
    try {
      await engine.request('venture.pipeline.settings', { caps: {
        newPerDay: Number(peopleDay), perWeek: Number(peopleWeek),
        channels: Object.fromEntries(OUTREACH_LANES.map(lane => [lane, Number(daily[lane])])),
        channelWeeks: Object.fromEntries(OUTREACH_LANES.map(lane => [lane, weekly[lane]?.trim() ? Number(weekly[lane]) : null])),
        warmupPercent: warmup.map(Number),
      } });
      setSaid({ error: false, text: t('clients.limits.saved') });
    } catch (error) { setSaid({ error: true, text: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(false); }
  }
  return <div className={s.form}>
    <Button className={s.toggle} variant="quiet" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{t('clients.limits.title')}</Button>
    {open && <Inner><form id={id} className={s.form} aria-label={t('clients.limits.title')} onSubmit={event => void save(event)}>
      <p>{t('clients.limits.warning')}</p>
      {settings.error && <p role="alert">{settings.error.message}</p>}
      {settings.data && <>
        <div className={s.fields}>
          <Field label={t('clients.limits.peopleDay')} inputMode="numeric" value={peopleDay} disabled={busy} onChange={event => setPeopleDay(event.currentTarget.value)} />
          <Field label={t('clients.limits.peopleWeek')} inputMode="numeric" value={peopleWeek} disabled={busy} onChange={event => setPeopleWeek(event.currentTarget.value)} />
          {OUTREACH_LANES.map(lane => <div className={s.form} key={lane}>
            <Field label={t('clients.limits.daily', { channel: t(`clients.limits.${lane}`) })} inputMode="numeric" value={daily[lane] ?? ''} disabled={busy} onChange={event => setDaily({ ...daily, [lane]: event.currentTarget.value })} />
            <Field label={t('clients.limits.weekly', { channel: t(`clients.limits.${lane}`) })} hint={t('clients.limits.weekHint')} inputMode="numeric" value={weekly[lane] ?? ''} disabled={busy} onChange={event => setWeekly({ ...weekly, [lane]: event.currentTarget.value })} />
          </div>)}
        </div>
        <h3>{t('clients.limits.warmup')}</h3><p>{t('clients.limits.warmupHint')}</p>
        <div className={s.fields}>{warmup.map((value, index) => <Field key={index} label={t('clients.limits.week', { week: String(index + 1) })} inputMode="numeric" value={value} disabled={busy} onChange={event => setWarmup(warmup.map((old, i) => i === index ? event.currentTarget.value : old))} />)}</div>
        <div className={s.actions}><Button type="submit" disabled={busy}>{t(busy ? 'clients.limits.saving' : 'clients.limits.save')}</Button>{said && <span role={said.error ? 'alert' : 'status'}>{said.text}</span>}</div>
      </>}
    </form></Inner>}
  </div>;
}
