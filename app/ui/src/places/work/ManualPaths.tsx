/**
 * The order card's manual paths (Ink v2 wave 5, package 5A3; catalogue P5): for a kit order, each stage whose connector
 * is only planned, with the engine's "Until then: ..." line and the outside party it waits on, from venture.order.chain.
 * A flagship order (its offer runs no kit stages) and a kit order whose stages need nothing planned show nothing.
 * Every line is the engine's; nothing is worked out here. Written for Chausar.
 */

import { useId } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { Tile, TileHead } from '../../parts/Tile';
import m from './ManualPaths.module.css';

export function ManualPaths({ orderId }: { orderId: string }) {
  const t = useT();
  const headingId = useId();
  const chain = useResource('venture.order.chain', { orderId }, { refreshOn: (event) => event.type === 'chain.changed' });
  const stages = (chain.data?.stages ?? []).filter((stage) => stage.manualPath !== null);
  if (!stages.length) return null;
  return (
    <Tile as="section" labelledBy={headingId}>
      <TileHead id={headingId} title={t('kit-rules.manual.heading')} />
      <ul className={m.list}>
        {stages.map((stage) => (
          <li key={stage.stepId} className={m.item} data-manual-path={stage.stepId}>
            <span className={m.title}>{stage.title}</span>
            <span className={m.line}>{stage.manualPath!.line}</span>
            <span className={m.waits}>{t('kit-rules.manual.waits', { connector: stage.manualPath!.connector, who: stage.manualPath!.waitsOn })}</span>
          </li>
        ))}
      </ul>
    </Tile>
  );
}
