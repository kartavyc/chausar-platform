/**
 * CA-01 Clients: the firm's clients, status only, in the shared FirmTable. The filter goes to
 * the engine; "more" asks for the next page with the engine's cursor. A client that was invited
 * and has not joined can be sent the guide again (a new code, shown once). Opening a client
 * steps into its own workspace with the seat it gave. Status reaches the firm only as a status
 * card the client made; the firm adds it here, or fetches it once a relay exists.
 */
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useT } from '../../../app/text';
import { Button } from '../../../parts/Button';
import type { StripCell, StripState } from '../../../parts/Strip';
import { FirmTable, type FirmClientRow } from '../../../patterns/FirmTable';
import {
  CLOSE_ITEMS, parseObject, validateClientCode, validateClientsList, validateImported,
  type ClientCode, type ClientRow, type CloseStep, type CloseStrip, type FilterWord,
} from './contract.ts';
import { Group, Outcome, Page, Refusal, countOf, dayText, dueText, seatText, useRead, useSend, whenText, powers, type P, type T } from './kit';
import { GuideShown, OpenNotice, useOpenClient } from './open';
import s from './Firm.module.css';

/** The four squares: the Strip has no "in progress" word of its own, so it is drawn as its open square. */
const STRIP_STATE: Readonly<Record<CloseStep, StripState>> = { done: 'done', 'in-progress': 'loading', 'not-done': 'not-done', refused: 'refused' };

export function closeCells(close: CloseStrip, t: T): StripCell[] {
  return CLOSE_ITEMS.map((item) => ({ state: STRIP_STATE[close[item]], label: t(`CAX-close.${item}`) }));
}

export function tableRow(row: ClientRow, p: P, t: T): FirmClientRow {
  if (row.state === 'invited') return { clientId: row.clientId, name: row.name, invited: true };
  const when = whenText(row.booksReadAt, p.language, t);
  return {
    clientId: row.clientId, name: row.name,
    booksRead: row.stale ? t('CAX-clients.stale', { when }) : when,
    close: row.close === null ? undefined : closeCells(row.close, t),
    awaiting: countOf(row.awaiting, t),
    dueNext: row.dueNext === null ? undefined : { what: dueText(row.dueNext.code, t), date: dayText(row.dueNext.date, p.language) },
  };
}

/** `clients.statusFetch` always refuses until a relay exists; an answer only means "read the list again". */
const asSent = (reply: unknown): true => { if (reply === null || typeof reply !== 'object') throw Object.assign(new Error('INVALID_REPLY'), { code: 'INVALID_REPLY' }); return true; };

type More ={ filter: FilterWord; rows: ClientRow[]; nextCursor: string | null };

export function ClientsScreen({ p }: { p: P }) {
  const t = useT();
  const { change, admin } = powers(p);
  const [filter, setFilter] = useState<FilterWord>('needs-you');
  const { state, reload } = useRead(p, 'clients.list', { filter }, validateClientsList, filter);
  const [more, setMore] = useState<More | null>(null);
  const page = useSend(p, validateClientsList);
  const guide = useSend(p, validateClientCode);
  const [shown, setShown] = useState<{ code: ClientCode; name: string } | null>(null);
  const opening = useOpenClient(p);

  const refresh = () => { setMore(null); reload(); };
  const chooseFilter = (next: FilterWord) => { setMore(null); setFilter(next); };

  return (
    <Page where={t('CAX-where.clients')} title={t('CAX-clients.title')} loaded={state} viewer={p.viewer}
      count={state.kind === 'ready' ? countOf(filter === 'needs-you' ? state.value.counts.needsYou : filter === 'close-not-done' ? state.value.counts.closeNotDone : state.value.counts.all, t) : undefined}
      aside={admin ? <Button onClick={() => p.navigate({ place: 'tools', sub: 'invite' })}>{t('CAX-clients.add')}</Button> : undefined}>
      {(list) => {
        const extra = more !== null && more.filter === filter ? more : null;
        const rows = extra === null ? list.rows : [...list.rows, ...extra.rows];
        const cursor = extra === null ? list.nextCursor : extra.nextCursor;
        const byId = new Map(rows.map((r) => [r.clientId, r]));
        const chosen = p.address.sheet !== undefined ? byId.get(p.address.sheet) : undefined;
        const loadMore = async () => {
          if (cursor === null) return;
          const next = await page.send('clients.list', { filter, cursor });
          if (next !== null) setMore({ filter, rows: [...(extra?.rows ?? []), ...next.rows], nextCursor: next.nextCursor });
        };
        const sendGuide = async (clientId: string) => {
          const done = await guide.send('clients.guide', { clientId });
          if (done !== null) setShown({ code: done, name: byId.get(clientId)?.name ?? clientId });
        };
        return (
          <>
            {chosen !== undefined && (
              <div className={s.notice} data-chosen={chosen.clientId}>
                <p className={s.text}>{t('CAX-clients.chosen', { name: chosen.name })}</p>
                {chosen.state === 'joined' && <span><Button variant="link" onClick={() => opening.open(chosen.clientId, chosen.name)}>{t('CAX-open.inside')}</Button></span>}
              </div>
            )}
            <OpenNotice p={p} state={opening.state} onClose={opening.clear} />
            {rows.length === 0 ? (
              <p className={s.text}>{filter === 'all' ? t('CAX-clients.none') : t('CAX-clients.noneHere')}</p>
            ) : null}
            <FirmTable month={list.month} clients={rows.map((r) => tableRow(r, p, t))} filter={filter} onFilter={chooseFilter}
              onOpenClient={(clientId) => opening.open(clientId, byId.get(clientId)?.name ?? clientId)}
              onSendGuide={admin ? (clientId) => void sendGuide(clientId) : undefined} />
            {cursor !== null && (
              <span><Button onClick={() => void loadMore()} disabled={page.sent.kind === 'sending'}>{t('CAX-clients.more')}</Button></span>
            )}
            <Outcome sent={page.sent} />
            <Outcome sent={guide.sent} />
            {shown !== null && <GuideShown shown={shown.code} name={shown.name} onDone={() => { setShown(null); guide.clear(); }} />}
            {rows.some((r) => r.seat !== null) && p.view === 'books' && (
              <ul className={s.plain}>
                {rows.filter((r) => r.seat !== null).map((r) => <li key={r.clientId}>{t('CAX-clients.seat', { name: r.name, seat: r.seat === null ? '' : seatText(r.seat, p.language, t) })}</li>)}
              </ul>
            )}
            {change && <StatusCards p={p} names={byId} onAdded={refresh} />}
          </>
        );
      }}
    </Page>
  );
}

function StatusCards({ p, names, onAdded }: { p: P; names: ReadonlyMap<string, ClientRow>; onAdded: () => void }) {
  const t = useT();
  const [raw, setRaw] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const imported = useSend(p, validateImported);
  const fetched = useSend(p, asSent);
  const choose = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    if (file === undefined) return;
    if (file.size > 256 * 1024) { setProblem(t('CAX-card.tooBig')); return; }
    setProblem(null);
    setRaw(await file.text());
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const card = parseObject(raw);
    if (card === null) { setProblem(t('CAX-card.notObject')); return; }
    setProblem(null);
    const done = await imported.send('clients.statusImport', { card });
    if (done !== null) { setRaw(''); onAdded(); }
  };
  const fetchNow = async () => {
    const done = await fetched.send('clients.statusFetch', {});
    if (done !== null) onAdded();
  };
  return (
    <Group title={t('CAX-card.title')} note={t('CAX-card.note')}>
      <form className={s.stack} onSubmit={(e) => void submit(e)}>
        <label className={s.label}>
          {t('CAX-card.file')}
          <input type="file" accept="application/json,.json" onChange={(e) => void choose(e)} />
        </label>
        <label className={s.label}>
          {t('CAX-card.paste')}
          <textarea className={s.textarea} value={raw} onChange={(e) => setRaw(e.currentTarget.value)} spellCheck={false} />
        </label>
        {problem !== null && <p className={s.problem} role="status">{problem}</p>}
        <span><Button submit disabled={imported.sent.kind === 'sending' || raw.trim().length === 0}>{t('CAX-card.add')}</Button></span>
      </form>
      {imported.sent.kind === 'done' && (
        <p className={s.text} role="status">
          {t('CAX-card.added', { name: names.get(imported.sent.value.clientId)?.name ?? imported.sent.value.clientId, date: dayText(imported.sent.value.cardAt, p.language) })}
        </p>
      )}
      <Outcome sent={imported.sent} />
      <div className={s.actions}>
        <Button onClick={() => void fetchNow()} disabled={fetched.sent.kind === 'sending'}>{t('CAX-card.fetch')}</Button>
      </div>
      {fetched.sent.kind === 'refused' && <Refusal code={fetched.sent.code} />}
    </Group>
  );
}
