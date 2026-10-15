/**
 * Activity (TD-04): everything that happened, in order, newest first, as a time line down
 * the page. One sentence per step, built by format/sentences.ts from the typed event in
 * this language; the engine sends no prose. Each line has its square and its state in
 * words (the five activity states), its time, who acted, and its cost in rupees where it
 * had one. A request to the AI model shows its route and its cost. A run that read
 * outside text carries the mark "read outside text".
 *
 * Filters: state, person, day, job and record (a customer, an invoice, a source, an action);
 * each asks the engine again. The job and record choices list what the pages read so far named. "Show more" reads the next
 * page with the engine's cursor. Any line opens its proof: a receipt opens the receipt
 * sheet; an action or a model request goes to its address when the event names one, and
 * otherwise shows its record id in a sheet. Nothing here changes anything, so a viewer
 * seat sees the same page.
 *
 * The engine is reached only through `rpc`, and every reply is checked with
 * `isActivityReply` before it is drawn. A method that does not exist yet shows "not built
 * yet"; a reply that fails its check shows Failed, never a part of it.
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { Figure, Language, Mark, TimeEvent } from '../../app/presentation.ts';
import type { PlaceRenderProps } from '../../places/types.ts';
import { ACTIVITY_STATES, isActivityReply, notBuilt, type ActivityEvent, type ActivityState } from '../../bridge/todayx-contract.ts';
import { parseAddress } from '../../app/routes.ts';
import { validateUiContext } from '../../host/contracts.ts';
import { useT } from '../../app/text';
import { PageHeader } from '../../app/PageHeader';
import { TimeLine } from '../../parts/TimeLine';
import { Choice } from '../../parts/Choice';
import { Button } from '../../parts/Button';
import { Sheet } from '../../parts/Sheet';
import { MissingWords } from '../../parts/Figure';
import { State } from '../../patterns/States';
import { activitySentence } from '../../format/sentences.ts';
import { money } from '../../format/money.ts';
import { count } from '../../format/counts.ts';
import { date, time } from '../../format/dates.ts';
import s from './Today.module.css';

export const ACTIVITY_METHOD = 'todayx.activity';
/** Activity times are drawn in the business's time zone, which `ui.context` carries when the
 *  workspace records one. When it is not known, times are drawn in UTC and say "UTC", so no
 *  zone is guessed and the computer's own zone is never used. */
export const ACTIVITY_FALLBACK_ZONE = 'UTC';
/** A cost opens the line's proof: its target is the proof's id, or the event's own id. */
const costTarget = (event: ActivityEvent) => event.proof.id ?? event.id;

/** The square for each of the five activity states. Its words are always beside it. */
export const ACTIVITY_MARK: Readonly<Record<ActivityState, Mark>> = {
  done: 'cha',
  'waiting-for-you': 'you',
  'waiting-for-network': 'busy',
  unsure: 'unsure',
  'stopped-by-rule': 'off',
};

interface Filters {
  readonly state: ActivityState | null;
  readonly actor: string | null;
  readonly day: string | null;
  readonly job: string | null;
  readonly record: string | null;
}
/** The event values that name a record, as the engine's record filter reads them. */
export const ACTIVITY_RECORD_VALUES = ['customer', 'invoice', 'record', 'source', 'action', 'receipt', 'import', 'lesson'] as const;
const FILTER_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
const FILTER_CHOICES = 6;

type Load =
  | { readonly phase: 'loading' }
  | { readonly phase: 'not-built' }
  | { readonly phase: 'failed'; readonly code: string }
  | { readonly phase: 'ready'; readonly events: ReadonlyArray<ActivityEvent>; readonly nextCursor: string | null; readonly total: string | null; readonly more: boolean };

/** The filter value for who acted: a named person or job by name, otherwise the kind. */
export function actorKey(event: ActivityEvent): string {
  return (event.actor.kind === 'person' || event.actor.kind === 'job') && event.actor.name !== null ? event.actor.name : event.actor.kind;
}

function codeOf(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code : 'REQUEST_FAILED';
}

/** The calendar day of an instant in a named zone, as YYYY-MM-DD. */
function dayIn(at: string, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}

export function whenOf(at: string, language: Language, t: (key: string, values?: Record<string, string>) => string, zone: string | null): string {
  if (at.length <= 10) return date(at, 'short', language);
  const shown = zone ?? ACTIVITY_FALLBACK_ZONE;
  const day = date(dayIn(at, shown), 'short', language);
  return t(zone === null ? 'TD-04.whenUtc' : 'TD-04.when', { date: day, time: time(at, shown) });
}

export function ActivityPlace({ address, language, rpc, live, openReceipt, navigate }: PlaceRenderProps) {
  const t = useT();
  const titleId = useId();
  const [filters, setFilters] = useState<Filters>({ state: null, actor: null, day: null, job: null, record: null });
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [proof, setProof] = useState<{ event: ActivityEvent; origin: HTMLElement | null } | null>(null);
  /* Every person and day seen so far, so a filter never removes its own choices. */
  const seen = useRef<{ actors: Map<string, string>; days: Set<string>; jobs: Set<string>; records: Set<string> }>({ actors: new Map(), days: new Set(), jobs: new Set(), records: new Set() });
  const generation = useRef(0);
  /* The workspace zone from `ui.context`; null (shown as UTC) until a checked reply names one. */
  const [zone, setZone] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    rpc.request('ui.context', {}).then(
      (reply) => { if (!current) return; try { setZone(validateUiContext(reply).timeZone ?? null); } catch { setZone(null); } },
      () => { if (current) setZone(null); },
    );
    return () => { current = false; };
  }, [rpc]);

  const actorWords = (event: ActivityEvent) => (event.actor.name !== null ? event.actor.name : t(`TD-04.actor.${event.actor.kind}`));

  const read = async (f: Filters, cursor: string | null, prior: ReadonlyArray<ActivityEvent>) => {
    const mine = ++generation.current;
    if (cursor === null) setLoad({ phase: 'loading' });
    else setLoad((l) => (l.phase === 'ready' ? { ...l, more: true } : l));
    const payload: Record<string, unknown> = {};
    if (cursor !== null) payload['cursor'] = cursor;
    if (f.state !== null) payload['state'] = f.state;
    if (f.actor !== null) payload['actor'] = f.actor;
    if (f.day !== null) payload['day'] = f.day;
    if (f.job !== null) payload['job'] = f.job;
    if (f.record !== null) payload['record'] = f.record;
    try {
      const reply = await rpc.request(ACTIVITY_METHOD, payload);
      if (mine !== generation.current || !live(address)) return;
      if (!isActivityReply(reply)) {
        setLoad({ phase: 'failed', code: 'INVALID_REPLY' });
        return;
      }
      for (const event of reply.events) {
        seen.current.actors.set(actorKey(event), actorWords(event));
        seen.current.days.add(event.at.slice(0, 10));
        const job = event.values['job'];
        if (job !== undefined && FILTER_ID.test(job)) seen.current.jobs.add(job);
        for (const key of ACTIVITY_RECORD_VALUES) { const record = event.values[key]; if (record !== undefined && FILTER_ID.test(record)) seen.current.records.add(record); }
      }
      setLoad({ phase: 'ready', events: [...prior, ...reply.events], nextCursor: reply.nextCursor, total: reply.total, more: false });
    } catch (error) {
      if (mine !== generation.current || !live(address)) return;
      setLoad(notBuilt(error) ? { phase: 'not-built' } : { phase: 'failed', code: codeOf(error) });
    }
  };

  useEffect(() => {
    void read(filters, null, []);
    return () => {
      generation.current++;
    };
    // A new read for each filter choice; the rpc and address are fixed for this page.
  }, [filters]);

  const events = load.phase === 'ready' ? load.events : [];

  const openProof = (id: string) => {
    const event = events.find((e) => e.id === id);
    if (!event) return;
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (event.proof.kind === 'receipt' && event.proof.id !== null) {
      openReceipt(event.proof.id);
      return;
    }
    const opens = event.values['opens'];
    if ((event.proof.kind === 'action' || event.proof.kind === 'model-request') && opens !== undefined) {
      const target = parseAddress(opens);
      if (opens.startsWith(`#/${target.place}`)) {
        navigate(target);
        return;
      }
    }
    setProof({ event, origin });
  };

  const onReceipt = (id: string) => {
    const owner = events.find((e) => e.costPaise !== null && costTarget(e) === id);
    if (owner !== undefined) openProof(owner.id);
    else openReceipt(id);
  };

  const lines: TimeEvent[] = events.map((event) => {
    const sentence = activitySentence(event, language);
    const cost: Figure | undefined = event.costPaise !== null
      ? { kind: 'money', exact: event.costPaise, display: money(event.costPaise), receiptId: costTarget(event), labels: [] }
      : undefined;
    return {
      id: event.id,
      mark: ACTIVITY_MARK[event.state],
      state: event.state,
      date: whenOf(event.at, language, t, zone),
      sentence: event.tainted ? t('TD-04.tainted', { sentence }) : sentence,
      ...(cost !== undefined ? { cost } : {}),
      who: actorWords(event),
    };
  });

  const stateOptions = [{ value: 'all', label: t('TD-04.filter.all') }, ...ACTIVITY_STATES.map((st) => ({ value: st, label: t(`STEPSTATE.${st}`) }))];
  const actorOptions = [{ value: 'all', label: t('TD-04.filter.everyone') }, ...[...seen.current.actors].map(([value, label]) => ({ value, label }))];
  const dayOptions = [{ value: 'all', label: t('TD-04.filter.allDays') }, ...[...seen.current.days].sort().reverse().map((day) => ({ value: day, label: date(day, 'short', language) }))];
  /* The newest few named so far (and the chosen one), so the row of words stays short. */
  const recent = (values: Set<string>, chosen: string | null) => { const list = [...values].slice(0, FILTER_CHOICES); return chosen !== null && !list.includes(chosen) ? [...list, chosen] : list; };
  const jobOptions = [{ value: 'all', label: t('FT4.activity.allJobs') }, ...recent(seen.current.jobs, filters.job).map((job) => ({ value: job, label: job }))];
  const recordOptions = [{ value: 'all', label: t('FT4.activity.allRecords') }, ...recent(seen.current.records, filters.record).map((record) => ({ value: record, label: record }))];
  const choose = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className={s.today}>
      <PageHeader where={t('SH-01.place.today')} title={t('TD-04.title')} titleId={titleId} />

      {load.phase !== 'not-built' && (
        <div className={s.filters}>
          <Choice label={t('TD-04.filter.state')} options={stateOptions} value={filters.state ?? 'all'} onChange={(v) => choose({ state: v === 'all' ? null : (v as ActivityState) })} />
          <Choice label={t('TD-04.filter.person')} options={actorOptions} value={filters.actor ?? 'all'} onChange={(v) => choose({ actor: v === 'all' ? null : v })} />
          <Choice label={t('TD-04.filter.day')} options={dayOptions} value={filters.day ?? 'all'} onChange={(v) => choose({ day: v === 'all' ? null : v })} />
          {jobOptions.length > 1 && <Choice label={t('FT4.activity.job')} options={jobOptions} value={filters.job ?? 'all'} onChange={(v) => choose({ job: v === 'all' ? null : v })} />}
          {recordOptions.length > 1 && <Choice label={t('FT4.activity.record')} options={recordOptions} value={filters.record ?? 'all'} onChange={(v) => choose({ record: v === 'all' ? null : v })} />}
        </div>
      )}

      {load.phase === 'loading' && <State state={{ kind: 'loading' }} />}
      {load.phase === 'not-built' && <State state={{ kind: 'not-built' }} />}
      {load.phase === 'failed' && <State state={{ kind: 'failed', code: load.code }} />}
      {load.phase === 'ready' && (
        <>
          <p className={s.missing}>
            {load.total !== null ? t('TD-04.total', { count: count(load.total) }) : <MissingWords missing="not-counted" />}
          </p>
          {lines.length === 0 ? (
            <State state={{ kind: 'empty' }} emptyKey="TD-04.empty" />
          ) : (
            <TimeLine events={lines} onReceipt={onReceipt} onOpen={openProof} labelledBy={titleId} />
          )}
          {load.nextCursor !== null && (
            <Button variant="quiet" disabled={load.more} onClick={() => void read(filters, load.nextCursor, load.events)}>
              {t('TD-04.more')}
            </Button>
          )}
        </>
      )}

      {proof !== null && (
        <Sheet kind={t('TD-04.title')} title={t(`TD-04.proof.kind.${proof.event.proof.kind}`)} origin={proof.origin} onClose={() => setProof(null)}>
          <p>{activitySentence(proof.event, language)}</p>
          <p className="fig">{t('TD-04.proof.type', { type: proof.event.type })}</p>
          <p className="fig">{t('TD-04.proof.id', { id: proof.event.proof.id ?? proof.event.id })}</p>
          {proof.event.route !== null && <p>{t('TD-04.proof.route', { route: proof.event.route })}</p>}
          {proof.event.proof.kind === 'none' && <p>{t('TD-04.proof.none')}</p>}
        </Sheet>
      )}
    </div>
  );
}
