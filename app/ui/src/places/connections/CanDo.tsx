/**
 * What Chausar can do on this computer, or on the server when hosted (catalogue U10): one row for every way a connector writes or sends today, as
 * the engine lists it: a mode that writes and is available, and a way to post that is available. Each row says the
 * connector and the engine's own words for what it does. Under them, one fixed sentence: stopping a connection does
 * not undo what already happened. Reads and handoffs are left out: a read changes nothing, and a handoff is the owner
 * finishing it themselves. Nothing here is worked out beyond picking rows; the words are the engine's.
 */

import { useId } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import type { ConnectorCardLite } from '../../engine/types';
import { ConnectorLabel } from '../../parts/ConnectorLabel';
import { Icon } from '../../parts/Icon';
import { Row } from '../../parts/Row';
import { Tile, TileHead } from '../../parts/Tile';
import { categoryIcon } from './categories';
import s from './Connections.module.css';

interface Way { id: string; card: ConnectorCardLite; what: string }

/** Every way that writes or sends, in the engine's order of connectors: its write mode first, then its posting. */
export function waysThatAct(cards: ConnectorCardLite[]): Way[] {
  return cards.flatMap((card) => [
    ...card.modes.filter((mode) => mode.mode === 'write' && mode.status === 'available').map((mode) => ({ id: `${card.id}:${mode.mode}`, card, what: mode.what })),
    ...card.postingOptions.filter((option) => option.status === 'available').map((option) => ({ id: `${card.id}:${option.mode}`, card, what: option.what })),
  ]);
}

export function CanDo({ cards }: { cards: ConnectorCardLite[] }) {
  const t = useT();
  const headingId = useId();
  // On hosted, Chausar works from its server, so the title says so rather than "this computer".
  const hosted = useEngine().transport === 'hosted';
  const ways = waysThatAct(cards);
  return (
    <Tile as="section" labelledBy={headingId}>
      <TileHead id={headingId} title={t(hosted ? 'connections.canDo.titleHosted' : 'connections.canDo.title')} meta={t('connections.canDo.meta')} />
      {ways.length === 0 ? (
        <p className={s.note}>{t('connections.canDo.none')}</p>
      ) : (
        <ul className={s.rows}>
          {ways.map((way) => (
            <Row
              key={way.id}
              id={`can-do-${way.id}`}
              mark={<span className={s.mini} aria-hidden="true"><Icon name={categoryIcon(way.card.category)} size={16} /></span>}
              title={<span data-can-do-name="">{way.card.name}</span>}
              line={<span data-can-do-what="">{way.what}</span>}
              aside={<ConnectorLabel label="write" />}
            />
          ))}
        </ul>
      )}
      <p className={s.stopLine}><Icon name="history" size={16} />{t('connections.canDo.stop')}</p>
    </Tile>
  );
}
