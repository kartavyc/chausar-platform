/**
 * Clients (spec sections 4.3 and 5.5; the direction D board D-Clients): the people who pay you and the people you may
 * write to, as tabs held in the address. Clients (#/clients) lists each client with their last order and what they
 * owe; Pipeline (#/clients/pipeline, and the old #/clients/leads; W4 4E4) shows the pipeline as a board, Found to Not
 * now, with its tiles, follow-ups and handoffs, and the card and draft sheets; Network (#/clients/network, W4 4D4)
 * searches the owner's own network in plain words, with the person and import sheets. The place follows the open
 * business: switching business reloads it.
 */

import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { openSheet, useRoute } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { Icon } from '../../parts/Icon';
import { PageTitle } from '../../parts/PageTitle';
import { Segmented } from '../../parts/Segmented';
import type { VentureRunEvent } from '../../engine/types';
import type { SheetComponent } from '../../shell/sheets';
import { ClientSheet } from './ClientSheet';
import { ClientsTab } from './ClientsTab';
import { ImportSheet } from './ImportSheet';
import { LeadSheet } from './Leads';
import { CardSheet } from './CardSheet';
import { OutreachSheet } from './OutreachSheet';
import { pipelineRefresh } from './pipeline';
import { networkRefresh } from './network';
import { NetworkTab } from './NetworkTab';
import { PersonSheet } from './PersonSheet';
import { PipelineTab } from './PipelineTab';
import { useClientsChanged } from './signals';
import s from './Clients.module.css';

const refreshOn = (event: VentureRunEvent) => event.type === 'queue.changed';

type Tab = 'clients' | 'pipeline' | 'network';

export function Place() {
  const { sub } = useRoute();
  return <Clients tab={sub === 'pipeline' || sub === 'leads' ? 'pipeline' : sub === 'network' ? 'network' : 'clients'} />;
}

function Clients({ tab }: { tab: Tab }) {
  const t = useT();
  const engine = useEngine();
  const clients = useResource('venture.client.list', {}, { refreshOn });
  const leads = useResource('venture.leads.list', {});
  // The count alone (limit 0): the Network tab's number, never a list.
  const people = useResource('venture.network.people', { limit: 0 }, { refreshOn: networkRefresh });
  // 4E4: the pipeline board, whose cards (and their count, the tab's number) the engine keeps.
  const board = useResource('venture.pipeline.list', {}, { refreshOn: pipelineRefresh });
  useClientsChanged(engine, () => { clients.reload(); leads.reload(); people.reload(); board.reload(); });

  const clientCount = clients.data?.length;
  const leadCount = board.data?.columns.reduce((sum, column) => sum + column.count, 0);
  const peopleCount = people.data?.total;
  // The header line counts what the tab lists; PageTitle sets that count in bold (D's `.sub b`).
  const count = tab === 'clients' ? clientCount : tab === 'pipeline' ? leadCount : peopleCount;
  const line = !count ? undefined
    : tab === 'clients' ? t('clients.count', { count: String(count) })
      : tab === 'pipeline' ? t('clients.pipeline.line', { count: String(count) }) : t('clients.network.line', { count: String(count) });

  // The add button sits beside the tabs once there is a list; an empty list offers it as its one way forward instead.
  let tool = null;
  if (tab === 'clients' && clientCount) {
    tool = <Button data-add-client="" onClick={(event) => openSheet('client', 'new', event.currentTarget)}><Icon name="plus" size={16} />{t('clients.add')}</Button>;
  } else if (tab === 'pipeline' && leadCount) {
    tool = (
      <>
        <Button data-import-network="" onClick={(event) => openSheet('network-import', 'new', event.currentTarget)}><Icon name="upload" size={16} />{t('clients.pipeline.import')}</Button>
        <Button data-add-lead="" onClick={(event) => openSheet('lead', 'new', event.currentTarget)}><Icon name="plus" size={16} />{t('clients.leads.add')}</Button>
      </>
    );
  } else if (tab === 'network' && peopleCount) {
    tool = <Button data-import-network="" onClick={(event) => openSheet('network-import', 'new', event.currentTarget)}><Icon name="upload" size={16} />{t('clients.network.import')}</Button>;
  }

  return (
    <>
      <PageTitle title={t('place.clients')} line={line} count={count ? String(count) : undefined} />
      <div className={s.toolbar}>
        <Segmented
          mode="links"
          label={t('clients.nav')}
          value={tab}
          options={[
            { id: 'clients', label: t('clients.sub.clients'), icon: 'contact', href: '#/clients', count: clientCount },
            { id: 'pipeline', label: t('clients.sub.pipeline'), icon: 'layout-grid', href: '#/clients/pipeline', count: leadCount },
            { id: 'network', label: t('clients.sub.network'), icon: 'users', href: '#/clients/network', count: peopleCount },
          ]}
        />
        {tool && <div className={s.tools}>{tool}</div>}
      </div>
      {tab === 'clients' ? <ClientsTab clients={clients} /> : tab === 'pipeline' ? <PipelineTab board={board} leads={leads.data?.leads ?? []} /> : <NetworkTab count={people} />}
    </>
  );
}

export const sheets: Readonly<Record<string, SheetComponent>> = { client: ClientSheet, lead: LeadSheet, person: PersonSheet, 'network-import': ImportSheet, card: CardSheet, outreach: OutreachSheet };
