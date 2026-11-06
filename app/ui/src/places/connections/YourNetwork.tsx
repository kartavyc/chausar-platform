/**
 * Connections, "Your network" (Ink v2 wave 4, package 4D4): the owner's own network files as cards, from
 * venture.network.sources. Each says what it honestly is: Reads, from a file the owner imports on this computer
 * (nothing is fetched or scraped), with the engine's line (how many people it gave, the day it came in) and the
 * engine's old-file line, folded one step away so the page stays short. The import lives on the Network tab of Clients.
 */

import { useId } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { ConnectorLabel } from '../../parts/ConnectorLabel';
import { Icon } from '../../parts/Icon';
import { Tile, TileHead } from '../../parts/Tile';
import { KIND_ICONS } from '../clients/NetworkSources';
import s from './Connections.module.css';

export function YourNetwork() {
  const t = useT();
  const titleId = useId();
  const sources = useResource('venture.network.sources', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  if (!sources.data && !sources.error) return null;
  return (
    <Tile as="section" labelledBy={titleId} className={s.network}>
      <TileHead id={titleId} title={t('connections.network.title')} more={{ href: '#/clients/network', label: t('connections.network.open') }} />
      {sources.error && <p className={s.problem} role="alert">{t('connections.network.failed', { message: sources.error.message })}</p>}
      {sources.data && sources.data.sources.length === 0 && <p className={s.note}>{t('connections.network.none')}</p>}
      {sources.data && sources.data.sources.length > 0 && (
        // One fold, so the page at rest stays short: the files open one step away.
        <details className={s.networkFold}>
          <summary className={s.networkSummary}><Icon name="chevron-right" size={14} />{t('connections.network.files', { count: sources.data.sources.length })}</summary>
          <p className={s.note}>{t('connections.network.line')}</p>
          <ul className={s.networkList}>
            {sources.data.sources.map((source) => (
              <li key={source.kind} className={s.networkSource} data-network-source={source.kind}>
                <span className={s.catIcon} aria-hidden="true"><Icon name={KIND_ICONS[source.kind]} size={18} /></span>
                <div className={s.networkBody}>
                  <p className={s.networkHead}>
                    <span className={s.networkName}>{t(`connections.network.kind.${source.kind}`)}</span>
                    <ConnectorLabel label="read" />
                  </p>
                  <p className={s.note}>{source.line}</p>
                  {source.stale && <p className={s.note}>{source.stale}</p>}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Tile>
  );
}
