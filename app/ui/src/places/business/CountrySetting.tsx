import { useState, type FormEvent } from 'react';
import { useEngine, useResource } from '../../engine/context';
import { useT } from '../../text';
import { Button } from '../../parts/Button';
import { Fold } from '../../parts/Fold';
import { Select } from '../../parts/Select';
import { ResultLine } from '../../parts/ResultLine';
import { messageOf } from '../../../../../platform/shared/errors.ts';
import { usePlan } from './shared';
import s from './Business.module.css';

/** Country is a business setting. The engine drafts the change for the owner's exact approval. */
export function CountrySetting() {
  const t = useT();
  const client = useEngine();
  const plan = usePlan();
  const business = useResource('venture.get', {});
  const countries = useResource('venture.countries', {});
  const initial = plan.data?.blueprint.country?.code ?? business.data?.venture.country?.code ?? '';
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const selected = choice ?? initial;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!selected || selected === initial || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await client.request('venture.blueprint.update', { patch: { countryCode: selected } });
      window.location.hash = '#/business/plan';
    } catch (error) { setProblem(messageOf(error)); }
    finally { setBusy(false); }
  }
  return <Fold summary={t('business.country')}>
    <form className={s.form} onSubmit={event => void save(event)}>
      <Select label={t('business.country')} value={selected} onChange={event => setChoice(event.currentTarget.value)}>
        {(countries.data ?? []).map(country => <option key={country.code} value={country.code}>{country.name}</option>)}
      </Select>
      {selected !== initial && <p className={s.note}>{t('business.countryChange')}</p>}
      <ResultLine tone="problem">{problem}</ResultLine>
      <Button type="submit" disabled={busy || !selected || selected === initial}>{t('business.countryReview')}</Button>
    </form>
  </Fold>;
}
