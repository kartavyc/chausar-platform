import { messageOf } from '../../../../../platform/shared/errors.ts';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import type { OwnerView as Owner } from '../../engine/types';
import { TileSection } from './shared';
import { DraftRecover, DraftWord, useSettingsDraft } from './settingsDraft';
import { SizeSetting } from './SizeSetting';
import { ProfessionSetting } from './ProfessionSetting';
import { ResultLine } from '../../parts/ResultLine';
import b from './Business.module.css';
import s from './OwnerView.module.css';

/** What venture.owner.set takes from this form, exactly, so the engine can clear the matching draft once it is saved. */
interface OwnerValues { firstName: string | null; excludedServices: string[] }

const valuesOf = (name: string, services: string): OwnerValues => ({
  firstName: name.trim() || null,
  excludedServices: services.split('\n').map((line) => line.trim()).filter(Boolean),
});
const sameValues = (a: OwnerValues, b: OwnerValues) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Business > About you (W4 4J21, from 4J9's core/owner.ts; spec C21): the owner's first name, used only for Today's
 * greeting, and the services the business does not sell, which drafts to clients never offer (4E2 reads them). Save
 * sends both, as typed, to venture.owner.set; the engine checks the name (any script) and says its rule when it refuses.
 * "Take my name back" removes it and shows Forget's line about backups. Unsent edits are kept in the vault as they are
 * typed ("Saved"), and a draft left behind is offered back when the page opens. W6 (3 November 2026): below it, the
 * business's size (SizeSetting), shown only when a rule of the business's profession counts size. One-shot A5: between
 * them, the profession the business's rules follow (ProfessionSetting), changeable here; a change reads the size again.
 */
export function OwnerView() {
  const t = useT();
  const client = useEngine();
  const owner = useResource('venture.owner.get', {});
  const [name, setName] = useState('');
  const [services, setServices] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string[] | null>(null);
  /** A5: bumped when the profession changes, so the size setting reads the new profession's question. */
  const [round, setRound] = useState(0);
  const values = useMemo(() => valuesOf(name, services), [name, services]);
  const draft = useSettingsDraft<OwnerValues>('owner', values, touched);

  // The stored profile fills the form once, until the owner types.
  useEffect(() => {
    if (!owner.data || touched) return;
    setName(owner.data.firstName ?? '');
    setServices(owner.data.excludedServices.join('\n'));
  }, [owner.data, touched]);

  function edit(next: () => void) {
    next();
    setTouched(true);
    setSaid(null);
    setProblem(null);
  }

  async function send(payload: Partial<OwnerValues>) {
    setBusy(true);
    setProblem(null);
    setSaid(null);
    try {
      const answer: Owner = await client.request('venture.owner.set', payload);
      setName(answer.firstName ?? '');
      setServices(answer.excludedServices.join('\n'));
      setTouched(false);
      setSaid(answer.kept && answer.kept.length > 0 ? answer.kept : [t('business.owner.saved')]);
      owner.reload();
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!busy) void send(values);
  }

  const stored = owner.data ? valuesOf(owner.data.firstName ?? '', owner.data.excludedServices.join('\n')) : null;
  const offer = draft.offer && stored && !sameValues(draft.offer.values, stored) && !touched ? draft.offer : null;

  return (
    <div className={b.page}>
      <form className={s.form} onSubmit={save} noValidate>
        <TileSection title={t('business.owner.title')}>
        {offer && (
          <DraftRecover
            offer={offer}
            onRecover={(values) => { setName(values.firstName ?? ''); setServices(values.excludedServices.join('\n')); setTouched(true); draft.taken(); }}
            onDecline={draft.decline}
          />
        )}
        {owner.error && <p className={b.problem} role="alert">{messageOf(owner.error)}</p>}
          <Field label={t('business.owner.name')} hint={t('business.owner.nameHint')} value={name} maxLength={80} autoComplete="given-name" onChange={(event) => { const next = event.currentTarget.value; edit(() => setName(next)); }} />
        </TileSection>
        <TileSection title={t('business.owner.services')}>
          <Field multiline label={t('business.owner.services')} hint={t('business.owner.servicesHint')} rows={4} value={services} onChange={(event) => { const next = event.currentTarget.value; edit(() => setServices(next)); }} />
        </TileSection>
          <ResultLine tone={problem ? 'problem' : 'done'}>{problem ?? said?.map((line) => <span key={line}>{line} </span>)}</ResultLine>
          <div className={s.end}>
            <span className={b.buttons}>
              <Button variant="primary" type="submit" disabled={busy || (!touched && said !== null)} disabledReason={!busy && !touched && said === null ? t('business.owner.changeFirst') : undefined} aria-busy={busy || undefined}>{t('business.owner.save')}</Button>
              {owner.data?.firstName && <Button variant="quiet" disabled={busy} onClick={() => void send({ firstName: null })}>{t('business.owner.takeBack')}</Button>}
            </span>
            <DraftWord saved={draft.saved} refused={draft.refused} shown={touched} />
          </div>
      </form>
      <ProfessionSetting onChanged={() => setRound((was) => was + 1)} />
      {/* W6 (3 November 2026): the business's size, only when a rule of its profession counts it. */}
      <SizeSetting key={round} />
    </div>
  );
}
