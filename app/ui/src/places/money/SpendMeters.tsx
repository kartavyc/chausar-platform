/**
 * W6 6G5 (D44): what each agent and each routine spent this month, one step away on Spend: a quiet icon button beside
 * the Paid calls total opens the list under it, so the page at rest says no more than it did. Each row is the
 * engine's: the month's spend as it leads (rupees or dollars) with the sum receipt behind it, runs on the owner's own
 * plan counted with no figure, Sunra's quotes beside it, and the owner's own limit with where it stands ("50% of its
 * limit used", "Paused: ..."). Nothing is worked out here.
 *
 * Set a limit opens one field in the row: a monthly limit in US dollars, as the other spend limits are typed. Saving
 * sends the whole list of that kind (agentCaps or routineCaps) with this row's limit changed, kept or cleared (an empty
 * field clears it); the engine checks it and answers with every row in its own words.
 */

import { useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Icon } from '../../parts/Icon';
import { Tile } from '../../parts/Tile';
import { Receipt } from '../../parts/Receipt';
import { splitFigure } from '../../parts/Figure';
import { Row } from '../../parts/Row';
import type { SpendMeterRowView, SpendMetersView } from '../../engine/types';
import { Amount, Rupees, spendShown } from './parts';
import { messageOf, onRuns } from './words';
import s from './Money.module.css';

/** The way in: an icon button named for what it opens, beside the Paid calls total. */
export function SpendMetersToggle({ open, controls, onToggle }: { open: boolean; controls: string; onToggle: () => void }) {
  const t = useT();
  return (
    <Button variant="quiet" size="sm" aria-expanded={open} aria-controls={controls} aria-label={t('money.meters.fold')} title={t('money.meters.fold')} onClick={onToggle}>
      <Icon name="sliders-horizontal" size={14} />
    </Button>
  );
}

/** The list, hidden until opened. Spend keys it by its own save round, so a saved spend setting reads the rows again. */
export function SpendMeters({ id, open }: { id: string; open: boolean }) {
  const t = useT();
  const policy = useResource('venture.spend.policy.get', {}, { refreshOn: onRuns });
  // The engine's answer to a saved limit, shown until the settings are read again.
  const [saved, setSaved] = useState<SpendMetersView | null>(null);
  const meters = saved ?? policy.data?.meters;
  const rows = meters ? [...meters.agents, ...meters.routines] : [];
  return (
    <section id={id} className={s.section} aria-label={t('money.meters.fold')} data-meters="" hidden={!open}>
      {open && meters && rows.length > 0 && (
        <Tile className={s.sectionTile}>
          <ul className={s.list}>
            {rows.map((row) => (
              <MeterRow key={`${row.scope}:${row.id}`} row={row} all={meters} onSaved={setSaved} />
            ))}
          </ul>
        </Tile>
      )}
    </section>
  );
}

function MeterRow({ row, all, onSaved }: { row: SpendMeterRowView; all: SpendMetersView; onSaved: (meters: SpendMetersView) => void }) {
  const t = useT();
  const engine = useEngine();
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const used = spendShown(row.usedLead, row.used, undefined, true);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setProblem(null);
    // The whole list of this kind, as the engine keeps it, with this row's limit set or left out.
    const others = (row.scope === 'agent' ? all.agents : all.routines).filter((item) => item.id !== row.id && item.capUsd !== null);
    const mine = typed.trim() === '' ? [] : [{ id: row.id, capUsd: typed.trim() }];
    const list = [...others.map((item) => ({ id: item.id, capUsd: item.capUsd! })), ...mine];
    const payload = row.scope === 'agent'
      ? { agentCaps: list.map((item) => ({ agent: item.id, capUsd: item.capUsd })) }
      : { routineCaps: list.map((item) => ({ routine: item.id, capUsd: item.capUsd })) };
    try {
      const reply = await engine.request('venture.spend.policy.set', payload);
      setEditing(false);
      if (reply.meters) onSaved(reply.meters);
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <Row id={`meter:${row.scope}:${row.id}`} eyebrow={t(`money.meters.${row.scope}`)} title={row.name}>
      <p className={s.figures} data-figure-group="">
        <Amount text={used.value} /><Rupees text={used.rupees} />
        <Receipt id={row.receiptId} amount={splitFigure(used.value).amount} />
      </p>
      {row.plan && <p className={s.quietLine} data-engine-line="">{row.plan}</p>}
      {row.media && <p className={s.quietLine} data-engine-line="">{row.media}</p>}
      <p className={s.quietLine} data-engine-line="" data-paused={row.paused ? '' : undefined}>
        {row.cap && <><span>{row.cap}</span><Rupees text={row.capRupees} /><span className={s.dot} aria-hidden="true"> · </span></>}
        <span>{row.line}</span>
      </p>
      {editing ? (
        <form className={s.figures} onSubmit={(event) => void save(event)}>
          <Field label={t('money.meters.limitField')} hint={t('money.meters.limitHint')} inputMode="decimal" value={typed} onChange={(event) => setTyped(event.currentTarget.value)} />
          <Button variant="quiet" onClick={() => { setEditing(false); setProblem(null); }}>{t('money.meters.cancel')}</Button>
          <Button type="submit" locked={sending}>{t(sending ? 'money.meters.saving' : 'money.meters.save')}</Button>
        </form>
      ) : (
        <Button variant="quiet" size="sm" onClick={() => { setTyped(row.capUsd ?? ''); setProblem(null); setEditing(true); }}>
          {t(row.capUsd === null ? 'money.meters.setLimit' : 'money.meters.changeLimit')}
        </Button>
      )}
      {problem && <p className={s.refusal} role="alert">{problem}</p>}
    </Row>
  );
}
