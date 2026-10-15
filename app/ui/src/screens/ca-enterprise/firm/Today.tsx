/**
 * CA-02 The firm's Today: what awaits the firm across its clients, grouped by client, as
 * counts; and the due dates across clients from the published calendar. Each row opens that
 * client's row in Clients. Counts are the engine's; a count it does not know is "not known".
 */
import { useT } from '../../../app/text';
import { Button } from '../../../parts/Button';
import { validateFirmToday } from './contract.ts';
import { Group, Page, countOf, dayText, dueText, monthText, nText, useRead, type P } from './kit';
import s from './Firm.module.css';

const SHEET_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;

export function FirmTodayScreen({ p }: { p: P }) {
  const t = useT();
  const { state } = useRead(p, 'firm.today', {}, validateFirmToday);
  const toClient = (clientId: string) => p.navigate(SHEET_ID.test(clientId) ? { place: 'clients', sheet: clientId } : { place: 'clients' });
  return (
    <Page where={t('CAX-where.today')} title={t('CAX-today.title')} loaded={state}
      count={state.kind === 'ready' ? countOf(state.value.totals.awaiting, t) : undefined} viewer={p.viewer}>
      {(today) => (
        <>
          <p className={s.quiet}>{t('CAX-today.lead', { month: monthText(today.month, p.language), clients: nText(today.totals.clients, t) })}</p>
          <Group title={t('CAX-today.awaiting')}>
            {today.awaiting.length === 0 ? <p className={s.text}>{t('CAX-today.nothing')}</p> : (
              <table className={s.table}>
                <thead>
                  <tr>
                    <th scope="col">{t('CAX-col.client')}</th>
                    <th scope="col" className={s.num}>{t('CAX-col.cosign')}</th>
                    <th scope="col" className={s.num}>{t('CAX-col.questions')}</th>
                    <th scope="col" className={s.num}>{t('CAX-col.total')}</th>
                    <th scope="col"><span className="sr">{t('CAX-col.open')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {today.awaiting.map((row) => (
                    <tr key={row.clientId} data-client={row.clientId}>
                      <th scope="row">{row.name}</th>
                      <td className={[s.num, 'fig'].join(' ')}>{nText(row.cosign, t)}</td>
                      <td className={[s.num, 'fig'].join(' ')}>{nText(row.questions, t)}</td>
                      <td className={[s.num, 'fig'].join(' ')}>{nText(row.total, t)}</td>
                      <td><Button variant="link" onClick={() => toClient(row.clientId)}>{t('CAX-today.see')}</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Group>
          <Group title={t('CAX-today.due')} note={t('CAX-today.dueNote')}>
            {today.due.length === 0 ? <p className={s.text}>{t('CAX-today.noDue')}</p> : (
              <table className={s.table}>
                <thead>
                  <tr>
                    <th scope="col">{t('CAX-col.client')}</th>
                    <th scope="col">{t('CAX-col.what')}</th>
                    <th scope="col">{t('CAX-col.date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {today.due.map((row, i) => (
                    <tr key={`${row.clientId}-${row.code}-${row.date}-${i}`}>
                      <th scope="row"><Button variant="link" onClick={() => toClient(row.clientId)}>{row.name}</Button></th>
                      <td>{dueText(row.code, t)}</td>
                      <td className="fig">{dayText(row.date, p.language)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Group>
        </>
      )}
    </Page>
  );
}
