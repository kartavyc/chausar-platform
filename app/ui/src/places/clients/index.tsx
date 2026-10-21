/**
 * Clients (spec section 4): one row per client with their last order in one sentence and what they owe (engine
 * figure, with its receipt). Opening a row shows the client sheet beside the list. Rows keep the shell keys
 * (J/K/Enter). The place follows the open business: switching business reloads it.
 */

import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { EmptyState } from '../../parts/EmptyState';
import { PageTitle } from '../../parts/PageTitle';
import { Row } from '../../parts/Row';
import type { ClientLite, OrderLite, VentureRunEvent } from '../../engine/types';
import type { SheetComponent } from '../../shell/sheets';
import { ClientSheet, Owed } from './ClientSheet';
import { useClientsChanged } from './signals';
import s from './Clients.module.css';

const refreshOn = (event: VentureRunEvent) => event.type === 'queue.changed';

export function Place() {
  const t = useT();
  const engine = useEngine();
  const clients = useResource('venture.client.list', {}, { refreshOn });
  const orders = useResource('venture.order.list', {}, { refreshOn });
  useClientsChanged(engine, () => { clients.reload(); orders.reload(); });

  const list = clients.data ?? [];
  // The engine lists orders newest first, so the first one for a client is their last order.
  const lastOrder = new Map<string, OrderLite>();
  for (const order of orders.data ?? []) if (!lastOrder.has(order.clientId)) lastOrder.set(order.clientId, order);

  return (
    <>
      <div className={s.head}>
        <PageTitle title={t('place.clients')} line={list.length > 0 ? t('clients.count', { count: String(list.length) }) : undefined} />
        {list.length > 0 && (
          <Button data-add-client="" onClick={(event) => openSheet('client', 'new', event.currentTarget)}>{t('clients.add')}</Button>
        )}
      </div>
      {clients.error && <p className={s.failed} role="alert">{t('sheet.failed', { message: clients.error.message })}</p>}
      {clients.data && list.length === 0 && (
        <EmptyState
          title={t('clients.empty')}
          action={<Button variant="primary" data-add-client="" onClick={(event) => openSheet('client', 'new', event.currentTarget)}>{t('clients.add')}</Button>}
        />
      )}
      {list.length > 0 && (
        <ul className={s.list} aria-label={t('place.clients')}>
          {list.map((client) => <ClientRow key={client.id} client={client} last={lastOrder.get(client.id)} />)}
        </ul>
      )}
    </>
  );
}

function ClientRow({ client, last }: { client: ClientLite; last: OrderLite | undefined }) {
  const t = useT();
  return (
    <Row
      id={client.id}
      title={client.name}
      onOpen={(origin) => openSheet('client', client.id, origin)}
      line={<span className={s.lineText}>{last ? t(`clients.order.${last.status}`, { request: last.request }) : t('clients.order.none')}</span>}
      actions={client.owed ? <Owed owed={client.owed} /> : undefined}
    />
  );
}

export const sheets: Readonly<Record<string, SheetComponent>> = { client: ClientSheet };
