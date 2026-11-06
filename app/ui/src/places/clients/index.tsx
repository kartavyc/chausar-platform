/**
 * Clients (spec sections 4.3 and 5.5; the direction D board D-Clients): the people who pay you and the people you may
 * write to, as tabs held in the address. Clients (#/clients) lists each client with their last order and what they
 * owe; Pipeline (#/clients/pipeline, and the old #/clients/leads) shows the leads as a board of the engine's own
 * stages. The Network tab arrives with W4 4D, and the full pipeline (its stages, strength, warm paths, follow-ups and
 * handoffs) with W4 4E: until then nothing stands in for them. The place follows the open business: switching
 * business reloads it.
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
import { LeadSheet } from './Leads';
import { PipelineTab } from './PipelineTab';
import { useClientsChanged } from './signals';
import s from './Clients.module.css';

const refreshOn = (event: VentureRunEvent) => event.type === 'queue.changed';

type Tab = 'clients' | 'pipeline';

export function Place() {
  const { sub } = useRoute();
  return <Clients tab={sub === 'pipeline' || sub === 'leads' ? 'pipeline' : 'clients'} />;
}

function Clients({ tab }: { tab: Tab }) {
  const t = useT();
  const engine = useEngine();
  const clients = useResource('venture.client.list', {}, { refreshOn });
  const leads = useResource('venture.leads.list', {});
  useClientsChanged(engine, () => { clients.reload(); leads.reload(); });

  const clientCount = clients.data?.length;
  const leadCount = leads.data?.leads.length;
  // The header line counts what the tab lists; PageTitle sets that count in bold (D's `.sub b`).
  const count = tab === 'clients' ? clientCount : leadCount;
  const line = !count ? undefined
    : tab === 'clients' ? t('clients.count', { count: String(count) }) : t('clients.pipeline.line', { count: String(count) });

  // The add button sits beside the tabs once there is a list; an empty list offers it as its one way forward instead.
  let tool = null;
  if (tab === 'clients' && clientCount) {
    tool = <Button data-add-client="" onClick={(event) => openSheet('client', 'new', event.currentTarget)}><Icon name="plus" size={16} />{t('clients.add')}</Button>;
  } else if (tab === 'pipeline' && leadCount) {
    tool = <Button data-add-lead="" onClick={(event) => openSheet('lead', 'new', event.currentTarget)}><Icon name="plus" size={16} />{t('clients.leads.add')}</Button>;
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
          ]}
        />
        {tool && <div className={s.tools}>{tool}</div>}
      </div>
      {tab === 'clients' ? <ClientsTab clients={clients} /> : <PipelineTab leads={leads} />}
    </>
  );
}

export const sheets: Readonly<Record<string, SheetComponent>> = { client: ClientSheet, lead: LeadSheet };
