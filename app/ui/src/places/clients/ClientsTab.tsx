/**
 * The Clients tab (#/clients): one row per client, with their initials, their name, their last order in one sentence
 * and what they owe as an engine figure with its receipt. Opening a row shows the client sheet beside the list. Rows
 * keep the shell keys (J, K and Enter). Initials are drawn here from the name; a client's own logo waits until the
 * owner can upload one.
 */

import { useT } from '../../text';
import { useEngine, useResource, type Resource } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { Avatar } from '../../parts/Avatar';
import { Button } from '../../parts/Button';
import { EmptyState } from '../../parts/EmptyState';
import { rich } from '../../parts/rich';
import { Row } from '../../parts/Row';
import { Tile } from '../../parts/Tile';
import type { ClientLite, OrderLite, VentureRunEvent } from '../../engine/types';
import { Owed } from './ClientSheet';
import { useClientsChanged } from './signals';
import s from './Clients.module.css';

const refreshOn = (event: VentureRunEvent) => event.type === 'queue.changed';

export function ClientsTab({ clients }: { clients: Resource<ClientLite[]> }) {
  const t = useT();
  const engine = useEngine();
  const orders = useResource('venture.order.list', {}, { refreshOn });
  useClientsChanged(engine, () => orders.reload());

  const list = clients.data ?? [];
  // The engine lists orders newest first, so the first one for a client is their last order.
  const lastOrder = new Map<string, OrderLite>();
  for (const order of orders.data ?? []) if (!lastOrder.has(order.clientId)) lastOrder.set(order.clientId, order);

  if (clients.error) return <p className={s.failed} role="alert">{t('sheet.failed', { message: clients.error.message })}</p>;
  if (clients.data && list.length === 0) {
    return (
      <EmptyState
        title={t('clients.empty')}
        action={<Button variant="primary" data-add-client="" onClick={(event) => openSheet('client', 'new', event.currentTarget)}>{t('clients.add')}</Button>}
      />
    );
  }
  if (list.length === 0) return null;
  // Until the orders arrive (or when they cannot be read) a row says nothing about orders: "No orders yet." is said
  // only when the engine answered with none.
  const ordersKnown = orders.data !== undefined;
  return (
    <>
      {orders.error && <p className={s.failed} role="alert">{t('clients.order.failed', { message: orders.error.message })}</p>}
      <Tile pad="compact">
        <ul className={s.list} aria-label={t('place.clients')}>
          {list.map((client) => <ClientRow key={client.id} client={client} ordersKnown={ordersKnown} last={lastOrder.get(client.id)} />)}
        </ul>
      </Tile>
    </>
  );
}

function ClientRow({ client, ordersKnown, last }: { client: ClientLite; ordersKnown: boolean; last: OrderLite | undefined }) {
  const t = useT();
  return (
    <Row
      id={client.id}
      mark={<Avatar name={client.name} size={32} />}
      title={client.name}
      onOpen={(origin) => openSheet('client', client.id, origin)}
      line={ordersKnown ? (
        <span className={s.lineText}>
          {/* What the client asked for is their words, typed by the owner, so it is marked as quoted. */}
          {last ? rich(t, `clients.order.${last.status}`, {}, { request: <span data-content="">{last.request}</span> }) : t('clients.order.none')}
        </span>
      ) : undefined}
      aside={client.owed ? <Owed owed={client.owed} /> : undefined}
    />
  );
}
