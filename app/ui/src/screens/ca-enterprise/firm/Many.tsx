/**
 * CA-06 The same step for many clients: one request, a chosen list of clients, and a table
 * with one row per client and its own result. The list a batch ran on is named and fixed: it
 * is the batch's own rows, as the engine kept them. Sending waits for a relay; until one
 * exists each ready row is held, and the page says why.
 */
import { useState, type FormEvent } from 'react';
import { useT } from '../../../app/text';
import { Button } from '../../../parts/Button';
import { Choice } from '../../../parts/Choice';
import { Field } from '../../../parts/Field';
import { isMonth, validateBatch, validateBatches, validateClientsList, validateKinds, type Batch, type ManyKind } from './contract.ts';
import { Group, LoadedState, Outcome, Page, dayText, monthText, nText, powers, useRead, useSend, type P } from './kit';
import { KNOWN_CODES } from './words.ts';
import s from './Firm.module.css';

export function ManyScreen({ p }: { p: P }) {
  const t = useT();
  const { change } = powers(p);
  const kinds = useRead(p, 'firm.many.kinds', {}, validateKinds);
  const clients = useRead(p, 'clients.list', { filter: 'all', limit: 200 }, validateClientsList);
  const batches = useRead(p, 'firm.many.list', {}, validateBatches);
  const prepare = useSend(p, validateBatch);
  const sendIt = useSend(p, validateBatch);
  const [kind, setKind] = useState<ManyKind | null>(null);
  const [month, setMonth] = useState('');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);

  return (
    <Page where={t('CAX-where.many')} title={t('CAX-many.title')} loaded={kinds.state} viewer={p.viewer}>
      {({ kinds: offered }) => {
        const needsMonth = offered.find((k) => k.id === kind)?.needsMonth === true;
        const submit = async (e: FormEvent) => {
          e.preventDefault();
          if (kind === null) { setProblem(t('CAX-many.needKind')); return; }
          if (needsMonth && !isMonth(month.trim())) { setProblem(t('CAX-many.needMonth')); return; }
          if (chosen.size === 0) { setProblem(t('CAX-many.needClients')); return; }
          setProblem(null);
          const payload: Record<string, unknown> = { kind, clientIds: [...chosen] };
          if (needsMonth) payload.month = month.trim();
          const done = await prepare.send('firm.many.prepare', payload);
          if (done !== null) { setBatch(done); sendIt.clear(); batches.reload(); }
        };
        const send = async () => {
          if (batch === null) return;
          const done = await sendIt.send('firm.many.send', { batchId: batch.batchId });
          if (done !== null) { setBatch(done); batches.reload(); }
        };
        return (
          <>
            <p className={s.quiet}>{t('CAX-many.lead')}</p>
            {change && (
              <Group title={t('CAX-many.new')}>
                {offered.length === 0 ? <p className={s.text}>{t('CAX-many.noKinds')}</p> : (
                  <form className={s.stack} onSubmit={(e) => void submit(e)}>
                    <Choice<ManyKind> label={t('CAX-many.kind')} options={offered.map((k) => ({ value: k.id, label: t(`CAX-kind.${k.id}`) }))} value={kind} onChange={setKind} />
                    {needsMonth && <Field label={t('CAX-many.month')} value={month} onChange={(e) => setMonth(e.currentTarget.value)} placeholder="2026-09" inputMode="numeric" autoComplete="off" />}
                    <fieldset className={s.fieldset}>
                      <legend className={s.label}>{t('CAX-many.clients')}</legend>
                      {clients.state.kind !== 'ready' ? <LoadedState loaded={clients.state} /> : clients.state.value.rows.length === 0 ? <p className={s.text}>{t('CAX-clients.none')}</p> : (
                        <>
                          <span className={s.actions}>
                            <Button variant="link" onClick={() => setChosen(new Set(clients.state.kind === 'ready' ? clients.state.value.rows.map((r) => r.clientId) : []))}>{t('CAX-many.all')}</Button>
                            <Button variant="link" onClick={() => setChosen(new Set())}>{t('CAX-many.none')}</Button>
                          </span>
                          <ul className={s.plain}>
                            {clients.state.value.rows.map((r) => (
                              <li key={r.clientId}>
                                <label className={s.checkLabel}>
                                  <input type="checkbox" checked={chosen.has(r.clientId)} onChange={(e) => {
                                    const on = e.currentTarget.checked;
                                    setChosen((prev) => { const next = new Set(prev); if (on) next.add(r.clientId); else next.delete(r.clientId); return next; });
                                  }} />
                                  {r.name}{r.state === 'invited' && <span className={s.quiet}> {t('CA-01.invited')}</span>}
                                </label>
                              </li>
                            ))}
                          </ul>
                          {clients.state.value.nextCursor !== null && <p className={s.quiet}>{t('CAX-many.firstOnly')}</p>}
                        </>
                      )}
                    </fieldset>
                    {problem !== null && <p className={s.problem} role="status">{problem}</p>}
                    <span><Button submit disabled={prepare.sent.kind === 'sending'}>{t('CAX-many.prepare')}</Button></span>
                  </form>
                )}
                <Outcome sent={prepare.sent} />
              </Group>
            )}
            {batch !== null && (
              <Group title={t('CAX-many.thisBatch')}>
                <BatchTable p={p} batch={batch} />
                {change && batch.state === 'prepared' && (
                  <span><Button variant="filled" onClick={() => void send()} disabled={sendIt.sent.kind === 'sending'}>{t('CAX-many.send')}</Button></span>
                )}
                <Outcome sent={sendIt.sent} />
              </Group>
            )}
            <Group title={t('CAX-many.earlier')}>
              {batches.state.kind !== 'ready' ? <LoadedState loaded={batches.state} /> : batches.state.value.batches.length === 0 ? <p className={s.text}>{t('CAX-many.noEarlier')}</p> : (
                <ul className={s.plain}>
                  {batches.state.value.batches.map((b) => (
                    <li key={b.batchId}>
                      <details>
                        <summary>{batchName(b, p, t)}</summary>
                        <BatchTable p={p} batch={b} />
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </Group>
          </>
        );
      }}
    </Page>
  );
}

function kindWord(kind: string, t: (k: string) => string): string {
  return kind === 'gst-guide' || kind === 'month-end-reminder' || kind === 'documents-request' ? t(`CAX-kind.${kind}`) : kind;
}

function batchName(b: Batch, p: P, t: (k: string, v?: Record<string, string | number>) => string): string {
  const what = kindWord(b.kind, t);
  const values = { what, clients: nText(b.rows.length, t), date: dayText(b.at, p.language), state: t(`CAX-batch.${b.state}`) };
  return b.month === null ? t('CAX-many.batchName', values) : t('CAX-many.batchNameMonth', { ...values, month: monthText(b.month, p.language) });
}

function BatchTable({ p, batch }: { p: P; batch: Batch }) {
  const t = useT();
  return (
    <div className={s.stack} data-batch={batch.batchId}>
      <p className={s.text}>{batchName(batch, p, t)}</p>
      <p className={s.quiet}>{t('CAX-many.fixed')}</p>
      <table className={s.table}>
        <thead>
          <tr><th scope="col">{t('CAX-col.client')}</th><th scope="col">{t('CAX-col.result')}</th></tr>
        </thead>
        <tbody>
          {batch.rows.map((row) => (
            <tr key={row.clientId} data-client={row.clientId} data-result={row.result}>
              <th scope="row">{row.name}</th>
              <td>
                {t(`CAX-result.${row.result}`)}
                {row.code !== undefined && (KNOWN_CODES.has(row.code)
                  ? <span className={s.quiet}> {t(`CAX-code.${row.code}`)}</span>
                  : <span className={s.mono}> {t('CAX-code', { code: row.code })}</span>)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
