/**
 * Limits (WK-12): how long a yes lasts for each kind of action, the reminder caps, the stop
 * words, and today's counts in write-back's own day and time zone (the gap WK-12 named: the caps
 * line ignored write-back's configured zone). An owner or co-founder can change them; everyone
 * else reads them. The counts are the engine's; nothing here computes a figure.
 */
import { useState, type FormEvent } from 'react';
import { KeyValue } from '../../parts/KeyValue';
import { useAct, useReply } from '../work/kit/reply.ts';
import { day } from '../work/kit/format.ts';
import { pageStyles } from '../work/kit/Page';
import { KINDS, caps, settings, type Caps, type Kind } from './contract.ts';
import { Button, Frame, Note, Refused, Section, say, type WbProps } from './shared.tsx';
import s from './writeback.module.css';

const whole = (text: string, min: number, max: number): number | null => {
  if (!/^\d{1,4}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= min && n <= max ? n : null;
};

function EditCaps({ p, c, onSaved }: { p: WbProps; c: Caps; onSaved: () => void }) {
  const { w } = p;
  const act = useAct(p.rpc);
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState<Readonly<Record<Kind, string>>>(() => ({
    'inside-undoable': String(c.settings.approvalHours['inside-undoable']), 'seen-outside': String(c.settings.approvalHours['seen-outside']),
    money: String(c.settings.approvalHours.money), 'cannot-undo': String(c.settings.approvalHours['cannot-undo']),
  }));
  const [perCustomer, setPerCustomer] = useState(String(c.settings.reminderCapPerCustomer));
  const [perDay, setPerDay] = useState(String(c.settings.reminderCapPerDay));
  const [stop, setStop] = useState(c.settings.stopWords.join('\n'));
  const [local, setLocal] = useState<string | null>(null);
  if (!open) return <div className={pageStyles.actions}><Button variant="quiet" onClick={() => setOpen(true)}>{w['wb4.caps.edit']}</Button></div>;
  const send = async (event: FormEvent) => {
    event.preventDefault();
    setLocal(null);
    const approvalHours: Record<string, number> = {};
    for (const kind of KINDS) {
      const n = whole(hours[kind], 1, 720);
      if (n === null) { setLocal(w['wb4.caps.badHours']); return; }
      approvalHours[kind] = n;
    }
    const customer = whole(perCustomer, 0, 5), daily = whole(perDay, 0, 500);
    if (customer === null) { setLocal(w['wb4.caps.badPerCustomer']); return; }
    if (daily === null) { setLocal(w['wb4.caps.badPerDay']); return; }
    const stopWords = stop.split('\n').map(x => x.trim()).filter(x => x !== '');
    if (stopWords.length > 20 || stopWords.some(x => x.length > 40)) { setLocal(w['wb4.caps.badStop']); return; }
    const out = await act.run('writeback.configure', { approvalHours, reminderCapPerCustomer: customer, reminderCapPerDay: daily, stopWords }, settings);
    if (out.ok) { setOpen(false); onSaved(); }
  };
  return (
    <form className={s.form} onSubmit={e => void send(e)} data-part="caps-edit" aria-label={w['wb4.caps.edit']}>
      <fieldset>
        <legend>{w['wb4.caps.lifetimes']}</legend>
        {KINDS.map(kind => (
          <label key={kind}>{w[`wb4.kind.${kind}`]}
            <input name={kind} type="number" inputMode="numeric" min={1} max={720} step={1} required value={hours[kind]}
              onChange={e => { const v = e.currentTarget.value; setHours(h => ({ ...h, [kind]: v })); }} />
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>{w['wb4.caps.reminders']}</legend>
        <label>{w['wb4.caps.perCustomer']}<input name="perCustomer" type="number" inputMode="numeric" min={0} max={5} step={1} required value={perCustomer} onChange={e => setPerCustomer(e.currentTarget.value)} /></label>
        <label>{w['wb4.caps.perDay']}<input name="perDay" type="number" inputMode="numeric" min={0} max={500} step={1} required value={perDay} onChange={e => setPerDay(e.currentTarget.value)} /></label>
        <label>{w['wb4.caps.stopWords']}<textarea name="stopWords" rows={6} value={stop} onChange={e => setStop(e.currentTarget.value)} /></label>
        <p className={s.meta}>{w['wb4.caps.stopHelp']}</p>
      </fieldset>
      <div className={pageStyles.actions}>
        <Button submit variant="filled" disabled={act.busy}>{w['wb4.caps.save']}</Button>
        <Button variant="link" onClick={() => setOpen(false)}>{w['wb4.cancel']}</Button>
      </div>
      {local !== null && <p className={pageStyles.refusal} role="alert">{local}</p>}
      <Refused w={w} code={act.refusal} />
    </form>
  );
}

export function CapsPage({ p }: { p: WbProps }) {
  const { w, view } = p;
  const { loaded, reload } = useReply(p.host, 'writeback.caps', {}, caps);
  const [saved, setSaved] = useState(false);
  return (
    <Frame p={p} title={w['wb4.caps.title']} loaded={loaded} reload={reload}>
      {c => (
        <div className={s.pane}>
          <KeyValue pairs={[{ name: w['wb4.caps.today'], value: say(w, 'wb4.caps.todayValue', { date: day(c.today, p.language), zone: c.timeZone }) }]} onReceipt={p.openReceipt} />
          {view !== 'simple' && <Note>{say(w, 'wb4.caps.zoneNote', { zone: c.timeZone })}</Note>}
          <Section title={w['wb4.caps.counts']}>
            <KeyValue onReceipt={p.openReceipt} pairs={[
              { name: w['wb4.caps.prepared'], value: String(c.counts.preparedToday), mono: true },
              { name: w['wb4.caps.sent'], value: String(c.counts.sentToday), mono: true },
              ...(view === 'simple' ? [] : [{ name: w['wb4.caps.customers'], value: String(c.counts.customersToday), mono: true }]),
            ]} />
          </Section>
          <Section title={w['wb4.caps.reminders']}>
            <KeyValue onReceipt={p.openReceipt} pairs={[
              { name: w['wb4.caps.perCustomer'], value: String(c.settings.reminderCapPerCustomer), mono: true },
              { name: w['wb4.caps.perDay'], value: String(c.settings.reminderCapPerDay), mono: true },
              { name: w['wb4.caps.stopWords'], value: c.settings.stopWords.length === 0 ? w['wb4.caps.noStopWords'] : c.settings.stopWords.join(', ') },
            ]} />
          </Section>
          <Section title={w['wb4.caps.lifetimes']}>
            <KeyValue onReceipt={p.openReceipt} pairs={KINDS.map(kind => ({ name: w[`wb4.kind.${kind}`], value: say(w, 'wb4.caps.hours', { n: c.settings.approvalHours[kind] }) }))} />
          </Section>
          {saved && <Note>{w['wb4.caps.saved']}</Note>}
          {p.admin && <EditCaps key={JSON.stringify(c.settings)} p={p} c={c} onSaved={() => { setSaved(true); reload(); }} />}
        </div>
      )}
    </Frame>
  );
}
