/**
 * Work: what the team is doing and has done, and every order (spec section 4, Work). Active runs on top with
 * per-stage progress (JobList, BridgeClip layout), orders with one state sentence each (CogSend wording), previous
 * runs folded to one line. The filter lives in the address: #/work?state=active|done|failed|orders, and
 * #/work?order=<id> shows one order with its runs and receipts (the Clients place links there).
 */

import { useId, type ReactNode } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { formatHash, type Route } from '../../shell/routes';
import { openSheet, useRoute } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { EmptyState } from '../../parts/EmptyState';
import { JobList } from '../../parts/JobList';
import { PageTitle } from '../../parts/PageTitle';
import type { SheetComponent } from '../../shell/sheets';
import type { RunSummary, VentureRunEvent } from '../../engine/types';
import { NewOrderSheet } from './NewOrderSheet';
import { OrderFocus } from './OrderFocus';
import { OrderList } from './OrderList';
import { orderView, type OrderView } from './orders';
import { PreviousRuns } from './PreviousRuns';
import { useWorkChanged } from './refresh';
import s from './Work.module.css';

export const FILTERS = ['active', 'done', 'failed', 'orders'] as const;
export type WorkFilter = 'all' | (typeof FILTERS)[number];

export function readFilter(value: string | undefined): WorkFilter {
  return (FILTERS as readonly string[]).includes(value ?? '') ? (value as WorkFilter) : 'all';
}

/** The address of a filter, keeping the open sheet and any other query; a focused order is left. */
function hrefFor(route: Route, filter: WorkFilter): string {
  const { state: _state, order: _order, ...rest } = route.query;
  const next: Route = { place: 'work', query: filter === 'all' ? rest : { ...rest, state: filter } };
  if (route.sub) next.sub = route.sub;
  if (route.sheet) next.sheet = route.sheet;
  return formatHash(next);
}

const everyEvent = () => true;
const queueEvent = (event: VentureRunEvent) => event.type === 'queue.changed';

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className={s.heading}>{title}</h2>
      {children}
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
  const reload = () => { runs.reload(); orders.reload(); deliveries.reload(); queue.reload(); invoices.reload(); clients.reload(); };
  useWorkChanged(reload);

  const all = runs.data?.runs ?? [];
  const active = all.filter((r) => r.state === 'active' || r.state === 'waiting');
  const previous = all.filter((r) => r.state === 'done' || r.state === 'failed');
  const done = previous.filter((r) => r.state === 'done');
  const failed = previous.filter((r) => r.state === 'failed');
  const runIds = new Set(all.map((r) => r.runId));

  // Orders wait for their runs and invoices, so a row never shows a state it is about to leave.
  const ordersReady = !!orders.data && (!!deliveries.data || !!deliveries.error) && (!!invoices.data || !!invoices.error);
  const views: OrderView[] = ordersReady
    ? orders.data!.map((o) => orderView(o, deliveries.data ?? [], invoices.data ?? [], all)).sort((a, b) => b.order.at.localeCompare(a.order.at))
    : [];
  const current = views.filter((v) => v.state !== 'paid' && v.state !== 'cancelled');

  const counts: Partial<Record<WorkFilter, number>> = runs.data ? { active: active.length, done: done.length, failed: failed.length } : {};
  if (ordersReady) counts.orders = views.length;

  const orderList = (list: OrderView[]) => <OrderList views={list} clients={clients.data} runIds={runIds} onChanged={reload} />;
  const previousList = (list: RunSummary[]) => <PreviousRuns runs={list} deliveries={deliveries.data} queue={queue.data?.rows} onChanged={reload} />;
  const jobs = () => <JobList runs={active} onOpen={(run, origin) => openSheet('run', run.runId, origin)} />;

  const focus = route.query.order;
  let content: ReactNode;
  if (focus !== undefined) {
    content = ordersReady && (
      <OrderFocus
        view={views.find((v) => v.order.id === focus)} clients={clients.data} deliveries={deliveries.data ?? []} runs={all}
        queue={queue.data?.rows} backHref={hrefFor(route, 'orders')} onChanged={reload}
      />
    );
  } else if (filter === 'active') {
    content = runs.data && jobs();
  } else if (filter === 'done' || filter === 'failed') {
    const list = filter === 'done' ? done : failed;
    content = runs.data && (list.length > 0 ? previousList(list) : <EmptyState title={t(`work.none.${filter}`)} />);
  } else if (filter === 'orders') {
    content = ordersReady && (views.length > 0 ? orderList(views) : <EmptyState title={t('work.none.orders')} />);
  } else if (runs.data && orders.data && all.length === 0 && orders.data.length === 0) {
    content = <EmptyState title={t('work.empty')} line={t('work.emptyLine')} />;
  } else {
    content = (
      <>
        {runs.data && jobs()}
        {current.length > 0 && <Section title={t('work.orders')}>{orderList(current)}</Section>}
        {previous.length > 0 && <Section title={t('jobs.previous')}>{previousList(previous)}</Section>}
      </>
    );
  }

  const failures = [runs.error, orders.error].flatMap((e) => (e ? [e] : []));

  return (
    <>
      <PageTitle title={t('place.work')} />
      <div className={s.bar}>
        <nav aria-label={t('work.filter')}>
          <ul className={s.filters}>
            {(['all', ...FILTERS] as const).map((f) => (
              <li key={f}>
                <a className={s.filter} href={hrefFor(route, f)} aria-current={filter === f && focus === undefined ? 'true' : undefined}>
                  {t(`work.filter.${f}`)}
                  {counts[f] !== undefined && <> <span className={s.count}>{counts[f]}</span></>}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <Button onClick={(event) => openSheet('new-order', 'new', event.currentTarget)}>{t('work.new')}</Button>
      </div>
      {failures.map((e) => <p key={`${e.code}:${e.message}`} className={s.problem} role="status">{t('work.loadFailed', { message: e.message })}</p>)}
      <div className={s.sections}>{content}</div>
    </>
  );
}

export const sheets: Readonly<Record<string, SheetComponent>> = { 'new-order': NewOrderSheet };
