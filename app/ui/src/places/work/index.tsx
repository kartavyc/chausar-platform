/**
 * Work, in the direction D look (docs/superpowers/designs/ink-v2-direction-d/D-Work.dc.html): what the team is doing
 * and has done, and every order. Filter chips under the title, held in the address (#/work?state=waiting|active|
 * failed|done, plus orders for every order, and business=<id> when runs come from more than one business). Running now
 * as tiles with rings, the failed run with what went wrong and Run again beside Finished, then orders grouped by
 * client. #/work?order=<id> shows one order with its runs and receipts (the Clients place links there). A run the
 * engine failed is "Failed"; "Stopped" is kept for the owner's own Stop (W4 4F).
 *
 * W4 4F3: Stop on every running tile, and the stopped runs (the owner's stop, or Chausar's: a breaker, a crash) on
 * their own tiles beside the failed ones, with Resume; they wait on the owner, so Needs you shows them too.
 */

import { useId, type ReactNode } from 'react';
import { useT, type T } from '../../text';
import { useResource } from '../../engine/context';
import { formatHash, type Route } from '../../shell/routes';
import { navigate, openSheet, useRoute } from '../../shell/navigation';
import { StorageNotice } from '../../shell/StorageNotice';
import { PausedNote } from '../../shell/PausedNote';
import { Button } from '../../parts/Button';
import { EmptyState } from '../../parts/EmptyState';
import { FilterChips, type FilterOption } from '../../parts/FilterChips';
import { Icon } from '../../parts/Icon';
import { PageTitle } from '../../parts/PageTitle';
import { SectionHead } from '../../parts/Tile';
import type { SheetComponent } from '../../shell/sheets';
import type { QueueRow, RunSummary, VentureRunEvent } from '../../engine/types';
import { NewOrderSheet } from './NewOrderSheet';
import { OrderFocus } from './OrderFocus';
import { OrderList, waitsOnYou } from './OrderList';
import { orderView, type OrderView } from './orders';
import { Finished, superseded } from './PreviousRuns';
import { RunTiles } from './RunTiles';
import { StoppedRuns, isStopped } from './StoppedRun';
import { useWorkChanged } from './refresh';
import s from './Work.module.css';

/** The filters the address can hold. `orders` (every order, paid and cancelled too) has no chip; the order focus's
 *  "All orders" link leads there. */
export const FILTERS = ['waiting', 'active', 'failed', 'done', 'orders'] as const;
export type WorkFilter = 'all' | (typeof FILTERS)[number];
/** The chips, in D's order: All, Needs you, Running, Failed, Done. */
const CHIPS = ['all', 'waiting', 'active', 'failed', 'done'] as const;

export function readFilter(value: string | undefined): WorkFilter {
  return (FILTERS as readonly string[]).includes(value ?? '') ? (value as WorkFilter) : 'all';
}

/** The route of a filter and a business, keeping the open sheet and any other query; a focused order is left. */
function routeFor(route: Route, filter: WorkFilter, business: string | undefined): Route {
  const { state: _state, order: _order, business: _business, ...rest } = route.query;
  const next: Route = { place: 'work', query: { ...rest, ...(filter === 'all' ? {} : { state: filter }), ...(business ? { business } : {}) } };
  if (route.sub) next.sub = route.sub;
  if (route.sheet) next.sheet = route.sheet;
  return next;
}

const everyEvent = () => true;
const never = () => false;
const queueEvent = (event: VentureRunEvent) => event.type === 'queue.changed';

/** Business names as the engine sends them with Today's rows, by business id. */
function businessNames(rows: readonly QueueRow[] | undefined): Map<string, string> {
  const names = new Map<string, string>();
  for (const row of rows ?? []) if (row.businessName && !names.has(row.businessId)) names.set(row.businessId, row.businessName);
  return names;
}

/** The line under the title: runs going and failed, then orders open and for how many clients. Counted, never summed. */
function headerLine(t: T, going: number, failed: number, orders: number, clients: number, stopped = 0): string {
  const moving = going > 0
    ? t(failed > 0 ? 'work.line.runsFailed' : 'work.line.runs', { count: going, failed })
    : failed > 0 ? t('work.line.failed', { count: failed }) : stopped > 0 ? '' : t('work.line.idle');
  // 4F3: the runs stopped and waiting for Resume, counted after the ones going.
  const runs = stopped > 0 ? [moving, t('work.line.stopped', { count: stopped })].filter(Boolean).join(' ') : moving;
  return orders > 0 ? `${runs} ${t('work.line.orders', { count: orders, clients: t('work.line.clients', { count: clients }) })}` : runs;
}

/** Orders under D's section head, which leads to Clients; the All view's head also counts what is open. */
function Orders({ views, meta, children }: { views: OrderView[]; meta?: string | undefined; children: (views: OrderView[]) => ReactNode }) {
  const t = useT();
  const id = useId();
  return (
    <section aria-labelledby={id} className={s.block}>
      <SectionHead id={id} title={t('work.orders')} meta={meta} more={{ href: '#/clients', label: t('work.orders.clients') }} />
      {children(views)}
    </section>
  );
}

export function Place() {
  const t = useT();
  const route = useRoute();
  const filter = readFilter(route.query.state);
  // Runs and orders move on every run event; invoices and clients only when the queue changes.
  const runs = useResource('venture.runs.list', { state: 'all' }, { refreshOn: everyEvent });
  const orders = useResource('venture.order.list', {}, { refreshOn: everyEvent });
  const deliveries = useResource('venture.delivery.list', {}, { refreshOn: everyEvent });
  const queue = useResource('venture.queue.list', { scope: 'all' }, { refreshOn: everyEvent });
  const invoices = useResource('venture.invoice.list', {}, { refreshOn: queueEvent });
  const clients = useResource('venture.client.list', {}, { refreshOn: queueEvent });
  // The open business's name, read only when a business is chosen (to tell whether the orders are that business's).
  const status = useResource('workspace.status', {}, { refreshOn: never, skip: !route.query.business });
  const reload = () => { runs.reload(); orders.reload(); deliveries.reload(); queue.reload(); invoices.reload(); clients.reload(); };
  useWorkChanged(reload);

  const all = runs.data?.runs ?? [];
  const names = businessNames(queue.data?.rows);
  // A chip per business, only when runs come from more than one; the business filter holds only while they are offered.
  const businessIds = [...new Set(all.map((r) => r.businessId))].filter((id) => names.has(id));
  const offerBusinesses = new Set(all.map((r) => r.businessId)).size > 1 && businessIds.length > 1;
  const business = offerBusinesses && route.query.business && businessIds.includes(route.query.business) ? route.query.business : undefined;
  const shown = business ? all.filter((r) => r.businessId === business) : all;
  // 4F3: a stopped run waits for the owner's Resume on its own tile; it is not going.
  // A stopped run a newer run of its order replaced (Run again) is history, like a replaced failed run.
  const stoppedRuns = shown.filter((r) => isStopped(r) && !superseded(r.runId, deliveries.data));
  const going = shown.filter((r) => (r.state === 'active' || r.state === 'waiting') && !isStopped(r));
  const waiting = shown.filter((r) => r.state === 'waiting' && !isStopped(r));
  const failed = shown.filter((r) => r.state === 'failed');
  const done = shown.filter((r) => r.state === 'done');
  // In All, a failed run that a newer run of its order replaced is history: the newer run stands for it.
  const failedOpen = failed.filter((r) => !superseded(r.runId, deliveries.data));
  const runIds = new Set(all.map((r) => r.runId));

  // Orders wait for their runs and invoices, so a row never shows a state it is about to leave.
  const ordersReady = !!orders.data && (!!deliveries.data || !!deliveries.error) && (!!invoices.data || !!invoices.error);
  const views: OrderView[] = ordersReady
    ? orders.data!.map((o) => orderView(o, deliveries.data ?? [], invoices.data ?? [], all)).sort((a, b) => b.order.at.localeCompare(a.order.at))
    : [];
  const current = views.filter((v) => v.state !== 'paid' && v.state !== 'cancelled');
  // Orders are the open business's: shown unless another business is chosen.
  const ordersHere = !business || (status.data?.workspace?.name !== undefined && names.get(business) === status.data.workspace.name);

  const orderList = (list: OrderView[]) => <OrderList views={list} clients={clients.data} runIds={runIds} onChanged={reload} />;
  const running = (list: RunSummary[], meta?: string) => <RunTiles runs={list} names={names} meta={meta} queue={queue.data?.rows} onChanged={reload} />;
  const failedTiles = (list: RunSummary[]) => <StoppedRuns runs={list} names={names} deliveries={deliveries.data} queue={queue.data?.rows} onChanged={reload} />;
  const stoppedTiles = (list: RunSummary[]) => <StoppedRuns kind="stopped" runs={list} names={names} deliveries={deliveries.data} queue={queue.data?.rows} onChanged={reload} />;
  const finished = (list: RunSummary[], atRest: boolean) => <Finished runs={list} moreHref={atRest ? formatHash(routeFor(route, 'done', business)) : undefined} onChanged={reload} />;

  const focus = route.query.order;
  let content: ReactNode;
  if (focus !== undefined) {
    content = ordersReady && (
      <OrderFocus
        view={views.find((v) => v.order.id === focus)} clients={clients.data} deliveries={deliveries.data ?? []} runs={all}
        queue={queue.data?.rows} backHref={formatHash(routeFor(route, 'orders', business))} onChanged={reload}
      />
    );
  } else if (filter === 'active') {
    content = runs.data && (going.length > 0 ? running(going) : <EmptyState title={t('work.none.active')} />);
  } else if (filter === 'waiting') {
    const mine = ordersHere ? current.filter(waitsOnYou) : [];
    content = runs.data && ordersReady && (waiting.length > 0 || mine.length > 0 || stoppedRuns.length > 0 ? (
      <>
        {waiting.length > 0 && running(waiting)}
        {stoppedRuns.length > 0 && stoppedTiles(stoppedRuns)}
        {mine.length > 0 && <Orders views={mine}>{orderList}</Orders>}
      </>
    ) : <EmptyState title={t('work.none.waiting')} />);
  } else if (filter === 'failed') {
    content = runs.data && (failed.length > 0 ? failedTiles(failed) : <EmptyState title={t('work.none.failed')} />);
  } else if (filter === 'done') {
    content = runs.data && (done.length > 0 ? finished(done, false) : <EmptyState title={t('work.none.done')} />);
  } else if (filter === 'orders') {
    content = ordersReady && (views.length > 0 && ordersHere ? <Orders views={views}>{orderList}</Orders> : <EmptyState title={t('work.none.orders')} />);
  } else if (runs.data && orders.data && all.length === 0 && orders.data.length === 0) {
    content = <EmptyState title={t('work.empty')} line={t('work.emptyLine')} />;
  } else {
    const ordersMeta = t('work.orders.meta', { count: current.length, clients: t('work.line.clients', { count: new Set(current.map((v) => v.order.clientId)).size }) });
    content = (
      <>
        {/* 4F3: the counts are the sub line's already, so Running now does not say them again. */}
        {going.length > 0 && running(going)}
        {(failedOpen.length > 0 || stoppedRuns.length > 0 || done.length > 0) && (
          <div className={s.pair}>
            {(failedOpen.length > 0 || stoppedRuns.length > 0) && (
              <div className={s.stack}>
                {stoppedRuns.length > 0 && stoppedTiles(stoppedRuns)}
                {failedOpen.length > 0 && failedTiles(failedOpen)}
              </div>
            )}
            {done.length > 0 && finished(done, true)}
          </div>
        )}
        {ordersHere && current.length > 0 && <Orders views={current} meta={ordersMeta}>{orderList}</Orders>}
      </>
    );
  }

  const empty = runs.data && orders.data && all.length === 0 && orders.data.length === 0;
  const counted = ordersHere ? current : [];
  const line = runs.data && ordersReady && !empty
    ? headerLine(t, going.length, failedOpen.length, counted.length, new Set(counted.map((v) => v.order.clientId)).size, stoppedRuns.length)
    : undefined;

  const chips: FilterOption[] = CHIPS.map((id) => ({ id, label: t(`work.filter.${id}`) }));
  const businessChips: FilterOption[] = offerBusinesses
    ? businessIds.map((id) => ({ id, label: names.get(id)!, business: true }))
    : [];
  const failures = [runs.error, orders.error].flatMap((e) => (e ? [e] : []));

  return (
    <>
      <PageTitle title={t('place.work')} line={line} count={going.length > 0 ? String(going.length) : undefined} />
      <StorageNotice />
      <PausedNote />
      <div className={s.toolbar}>
        <div className={s.chips}>
          <FilterChips
            label={t('work.filter')} options={chips} value={focus === undefined ? filter : ''} className={s.chipGroup}
            onChange={(id) => navigate(routeFor(route, id as WorkFilter, business))}
          />
          {businessChips.length > 0 && (
            <FilterChips
              label={t('work.filter.business')} options={businessChips} value={business ?? ''} className={s.chipGroup}
              onChange={(id) => navigate(routeFor(route, focus === undefined ? filter : 'all', id === business ? undefined : id))}
            />
          )}
        </div>
        <Button onClick={(event) => openSheet('new-order', 'new', event.currentTarget)}>
          <Icon name="plus" size={16} />
          {t('work.new')}
        </Button>
      </div>
      {failures.map((e) => <p key={`${e.code}:${e.message}`} className={s.problem} role="status">{t('work.loadFailed', { message: e.message })}</p>)}
      <div className={s.sections}>{content}</div>
    </>
  );
}

export const sheets: Readonly<Record<string, SheetComponent>> = { 'new-order': NewOrderSheet };
