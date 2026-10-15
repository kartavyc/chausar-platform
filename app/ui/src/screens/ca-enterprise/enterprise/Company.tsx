/**
 * Company (enterprise part 3): the eighth place, for whoever administers the installation.
 * The bare place shows every sub-place in one "Out of service" table (part 4): its state in
 * words and its facts. Each sub-place shows its own entry; Health shows the whole table too.
 * Everything comes from `company.overview`; nothing here is worked out.
 */
import { useT } from '../../../app/text';
import { Button } from '../../../parts/Button';
import type { PlaceRenderProps } from '../../../places/types.ts';
import { Frame, Group, Note, useWhere } from './Frame';
import { useRead } from './kit.ts';
import { COMPANY_SUBS, type CompanySub } from './routing.ts';
import { validateOverview, type CompanyEntry, type FactValue } from './validate.ts';
import s from './Enterprise.module.css';

/** Fact keys this screen has words for. Any other key is shown as the key itself. */
export const FACT_KEYS = [
  'provider', 'configured', 'method', 'lastCheckAt', 'lastBackupAt', 'restoreTestedAt', 'keysHeld', 'rotatedAt',
  'sessions', 'computers', 'open', 'checksPassed', 'checksFailed', 'version', 'channel', 'licensee', 'seats', 'endsOn', 'reason',
] as const;

export function factLabel(t: (k: string) => string, key: string): string {
  return (FACT_KEYS as readonly string[]).includes(key) ? t(`ENX-fact.${key}`) : key;
}

export function factValue(t: (k: string) => string, value: FactValue): string {
  if (value === null) return t('ENX-value.unknown');
  if (typeof value === 'boolean') return t(value ? 'ENX-value.yes' : 'ENX-value.no');
  return String(value);
}

function Facts({ entry }: { entry: CompanyEntry }) {
  const t = useT();
  if (entry.facts.length === 0) return <span className={s.note}>{t('ENX-company.noFacts')}</span>;
  return (
    <ul className={s.facts}>
      {entry.facts.map((f, i) => (
        <li key={`${f.key}-${i}`}>
          <span className={(FACT_KEYS as readonly string[]).includes(f.key) ? undefined : s.mono}>{factLabel(t, f.key)}</span>
          {': '}
          <span>{factValue(t, f.value)}</span>
        </li>
      ))}
    </ul>
  );
}

function StateWords({ entry }: { entry: CompanyEntry | undefined }) {
  const t = useT();
  if (entry === undefined) return <span className={s.note}>{t('ENX-company.notReported')}</span>;
  return (
    <span className={entry.state === 'out-of-service' ? s.down : undefined} data-state={entry.state}>
      {t(`ENX-company.state.${entry.state}`)}
      {entry.code !== null && <span className={s.mono}> {entry.code}</span>}
    </span>
  );
}

function OutOfService({ p, subs }: { p: PlaceRenderProps; subs: readonly CompanyEntry[] }) {
  const t = useT();
  return (
    <table className={s.table}>
      <caption className={s.caption}>{t('ENX-company.table')}</caption>
      <thead>
        <tr><th scope="col">{t('ENX-company.part')}</th><th scope="col">{t('ENX-company.state')}</th><th scope="col">{t('ENX-company.facts')}</th></tr>
      </thead>
      <tbody>
        {COMPANY_SUBS.map((id) => {
          const entry = subs.find((e) => e.id === id);
          return (
            <tr key={id} data-sub={id}>
              <th scope="row">
                <Button variant="link" onClick={() => p.navigate({ place: 'company', sub: id })}>{t(`SH-01.sub.company.${id}`)}</Button>
              </th>
              <td><StateWords entry={entry} /></td>
              <td>{entry === undefined ? null : <Facts entry={entry} />}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function CompanyScreen({ p, sub }: { p: PlaceRenderProps; sub: CompanySub | null }) {
  const t = useT();
  const where = useWhere();
  const { state } = useRead(p, 'company.overview', validateOverview);
  const title = sub === null ? t('SH-01.place.company') : t(`SH-01.sub.company.${sub}`);
  return (
    <Frame where={sub === null ? t('SH-01.place.company') : where('company', sub)} title={title} loaded={state} forbiddenKey="ENX-company.forbidden">
      {(overview) => {
        if (sub === null) {
          return (
            <>
              <Note>{t('ENX-company.intro')}</Note>
              <OutOfService p={p} subs={overview.subs} />
            </>
          );
        }
        const entry = overview.subs.find((e) => e.id === sub);
        return (
          <>
            <Group title={t('ENX-company.state')}>
              <p className={s.text}><StateWords entry={entry} /></p>
              {entry !== undefined && entry.state !== 'ready' && <Note>{t(`ENX-company.means.${entry.state}`)}</Note>}
            </Group>
            {entry !== undefined && <Group title={t('ENX-company.facts')}><Facts entry={entry} /></Group>}
            {sub === 'health' && <OutOfService p={p} subs={overview.subs} />}
          </>
        );
      }}
    </Frame>
  );
}
