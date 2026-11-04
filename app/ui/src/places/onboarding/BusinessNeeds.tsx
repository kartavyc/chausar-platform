import { useId, useState, type ReactNode } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import type { NeedLite } from '../../engine/types';
import { Button } from '../../parts/Button';
import { ConnectorLabel } from '../../parts/ConnectorLabel';
import { Tile } from '../../parts/Tile';
import { goTo, openSheet } from '../../shell/navigation';
import f from './FirstRun.module.css';

/**
 * "Connect what your business needs" (W6 6C7, DECISIONS D50): after the plan is kept, the outside services this
 * business would use (venture.needs.list), each with one line on why and its honest label. A service that works today
 * opens its own connector sheet in Connections (the service's own sign-in, or a key into this computer's keychain); a
 * planned one says what it waits on and what to do meanwhile, and offers nothing to press. Every one can be skipped,
 * and skipping all of them still leaves a working business. The same list is Connections' "Services your business
 * needs" page (`place="connections"`). foot (one-shot A5): what the first run asks above Go to Today (start at login).
 */
export function BusinessNeeds({ place, onDone, foot }: { place: 'first-run' | 'connections'; onDone?: () => void; foot?: ReactNode }) {
  const t = useT();
  const headingId = useId();
  const list = useResource('venture.needs.list', {});
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const first = place === 'first-run';

  /** The service's own connect: its connector sheet in Connections (from the first run, the app opens there). */
  function setUp(need: NeedLite, from: Element | null) {
    const sub = need.connect.place === 'connections/ai' ? 'ai' : 'needs';
    if (first) {
      if (need.connect.connectorId && sub === 'needs') window.location.hash = `#/connections/needs?sheet=connector:${need.connect.connectorId}`;
      else goTo('connections', sub);
      onDone?.();
      return;
    }
    if (sub === 'ai') goTo('connections', 'ai');
    else if (need.connect.connectorId) openSheet('connector', need.connect.connectorId, from);
  }

  const title = list.data?.family ? t('first-run.needs.list', { family: list.data.family.label }) : t('first-run.needs.listPlain');
  return (
    <section className={f.wrap} aria-labelledby={headingId}>
      {first && <p className={f.eyebrow}>{t('first-run.stepOf', { n: '3' })}</p>}
      {first ? <h1 id={headingId} className={f.title}>{t('first-run.needs.title')}</h1> : <h2 id={headingId} className={f.title}>{title}</h2>}
      <p className={f.sub}>{t('first-run.needs.sub')}</p>
      {list.error && <p className={f.problem} role="alert">{t('first-run.needs.failed', { message: list.error.message })}</p>}
      {list.data && (
        <ul className={f.needs} aria-label={title}>
          {list.data.needs.map((need) => {
            const live = need.label !== 'planned' && (need.connect.connectorId !== null || need.connect.place !== null);
            return (
              <Tile key={need.id} as="li" pad="compact" className={f.need}>
                <div className={f.needText}>
                  <div className={f.needHead}>
                    <span className={f.needName}>{need.name}</span>
                    <ConnectorLabel label={need.label} />
                  </div>
                  <p className={f.needWhy}>{need.why}</p>
                  {need.label === 'planned' && need.waitsOn && <p className={f.hint}>{t('first-run.needs.waits', { waits: need.waitsOn, meanwhile: need.meanwhile ?? '' })}</p>}
                  {skipped.has(need.id) && <p className={f.hint} role="status">{t('first-run.needs.skipped')}</p>}
                </div>
                <div className={f.needActions}>
                  {live && <Button size="sm" onClick={(event) => setUp(need, event.currentTarget)}>{t('first-run.needs.setUp')}</Button>}
                  {first && !skipped.has(need.id) && <Button size="sm" variant="quiet" onClick={() => setSkipped((was) => new Set([...was, need.id]))}>{t('first-run.needs.skip')}</Button>}
                </div>
              </Tile>
            );
          })}
        </ul>
      )}
      {first && foot}
      {first && (
        <div className={f.needsFoot}>
          <Button variant="primary" size="lg" onClick={() => { goTo('today'); onDone?.(); }}>{t('first-run.needs.done')}</Button>
        </div>
      )}
    </section>
  );
}
