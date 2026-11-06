/**
 * The Network tab's side tiles (D-Network's `.imp`, `.dist` and `.priv`): where the network comes from (one row per
 * kind of file, from venture.network.sources: the file, the engine's line with its count and day, how much it left
 * out, the engine's line when the file is old, and Import a newer file), how well the owner
 * knows them (the five bands, counted by the engine's code, with the count receipt), and what stays private.
 *
 * The bands are a ranked BarChart: each bar is the engine's own share per mille (it floors the division), the value
 * its count, with "View chart data" and the count receipt.
 */

import { useId } from 'react';
import { useT } from '../../text';
import { openSheet } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { Inner } from '../../parts/Card';
import { Icon } from '../../parts/Icon';
import type { IconName } from '../../parts/icons';
import { Receipt } from '../../parts/Receipt';
import type { StrengthLevel } from '../../parts/StrengthDots';
import { BarChart } from '../../parts/charts/BarChart';
import { Tile, TileHead } from '../../parts/Tile';
import type { NetworkImportKind, NetworkSourcesView } from '../../engine/types';
import s from './Network.module.css';

/** Each kind of file with its mark. */
export const KIND_ICONS: Readonly<Record<NetworkImportKind, IconName>> = {
  'linkedin-connections': 'users',
  'linkedin-messages': 'message-square',
  'contacts-csv': 'contact',
  vcard: 'contact',
  'calendar-ics': 'calendar',
  'mail-headers': 'send',
};

/** The bands strongest first, with their dots, as the engine counts them. */
const BANDS: readonly { key: 'close' | 'knowWell' | 'know' | 'metOnce' | 'cold'; level: StrengthLevel }[] = [
  { key: 'close', level: 5 }, { key: 'knowWell', level: 4 }, { key: 'know', level: 3 }, { key: 'metOnce', level: 2 }, { key: 'cold', level: 1 },
];

export function NetworkSources({ view }: { view: NetworkSourcesView }) {
  const t = useT();
  const sourcesId = useId();
  const bandsId = useId();
  const privateId = useId();
  return (
    <>
      {view.sources.length > 0 && (
        <Tile as="section" labelledBy={sourcesId} className={s.sources}>
          <TileHead id={sourcesId} title={t('clients.network.sources.title')} />
          <ul className={s.sourceList}>
            {view.sources.map((source) => (
              <li key={source.kind} className={s.source} data-source={source.kind}>
                <span className={s.kindMark} aria-hidden="true"><Icon name={KIND_ICONS[source.kind]} size={18} /></span>
                <div className={s.sourceBody}>
                  <p className={s.sourceName}>{t(`clients.network.kind.${source.kind}`)}</p>
                  <p className={`${s.file} mono`}>{source.fileName}</p>
                  <p className={s.sourceLine}>{source.line}</p>
                  {/* 4Z2: the engine's line already says how many it kept; what it left out is said once here. */}
                  {source.dropped > 0 && (
                    <p className={s.kept}>
                      <span>{t('clients.network.sources.dropped', { count: source.dropped })}</span>
                    </p>
                  )}
                  {source.stale && <p className={s.stale}>{source.stale}</p>}
                  <Button
                    variant="quiet"
                    size="sm"
                    aria-label={t('clients.network.sources.newerName', { kind: t(`clients.network.kind.${source.kind}`) })}
                    onClick={(event) => openSheet('network-import', source.kind, event.currentTarget)}
                  >
                    {t('clients.network.sources.newer')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Tile>
      )}

      {view.bands && (
        <Tile as="section" labelledBy={bandsId} className={s.bands}>
          <TileHead id={bandsId} title={t('clients.network.bands.title')} end={<Receipt id={view.bands.receiptId} />} />
          <p className={s.sub}>{t('clients.network.bands.line')}</p>
          <BarChart
            kind="count"
            layout="ranked"
            label={t('clients.network.bands.list')}
            series={[{
              label: t('clients.network.bands.people'),
              points: BANDS.map((band) => ({
                key: band.key, label: t(`strength.level.${band.level}`), value: String(view.bands![band.key]),
                valuePermille: view.bands!.permille[band.key],
              })),
            }]}
          />
        </Tile>
      )}

      <Tile as="section" labelledBy={privateId} className={s.private}>
        <div className={s.privateHead}>
          <span className={s.kindMark} aria-hidden="true"><Icon name="shield-check" size={18} /></span>
          <h2 id={privateId} className={s.privateTitle}>{t('clients.network.private.title')}</h2>
        </div>
        {/* What stays private, and what is kept, one step away: the page at rest stays short. */}
        <details className={s.keeps}>
          <summary className={s.checksSummary}><Icon name="chevron-right" size={14} />{t('clients.network.private.keeps')}</summary>
          <Inner card={false} className={s.keepsBody}>
            <p>{t('clients.network.private.line')}</p>
            <p>{t('clients.network.private.kept')}</p>
            <p>{t('clients.network.private.dropped')}</p>
          </Inner>
        </details>
      </Tile>
    </>
  );
}
