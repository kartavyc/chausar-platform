import { useId, useState, type ReactNode } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import type { NeedIdLite, NeedLite } from '../../engine/types';
import { Button } from '../../parts/Button';
import { ConnectorLabel } from '../../parts/ConnectorLabel';
import { Tile } from '../../parts/Tile';
import { goTo, openSheet } from '../../shell/navigation';
import { Guide } from '../connections/Guide';
import { McpConnect } from '../connections/McpConnect';
import f from './FirstRun.module.css';

/**
 * "Connect what your business needs" (W6 6C7, DECISIONS D50; simplified on the founder's word, 14 Nov 2026). After
 * the plan is kept, venture.needs.list answers what that plan needs from outside: a short list grouped by need in the
 * owner's words ("To find customers"), each row with its honest label, one line and one action. Set up shows only
 * where a real connect flow exists, and it opens in place, under its row, so setup never moves: a server's own form
 * for a tool the owner connects with their own account (McpConnect), a connector card's setup guide. A row that works
 * already says "Nothing to set up"; a planned one says what it waits on and the manual path, and offers nothing to
 * press. With no need kept (templates only, or an older business) the same rows list what the field would use.
 * Everything is optional: Go to Today is always there and is the one click that skips it all. The same list is what
 * Connections shows first (`place="connections"`), where a card opens its own sheet. ask (one-shot A5): what the
 * first run asks on this step (start at login), above the list.
 *
 * "Change what you need" (15 Nov 2026): the needs were the AI's pick alone. The owner now ticks or unticks them from
 * the engine's fixed list, here and on Connections; each tick is saved through venture.owner.set { needs } and the
 * list is read again. A newly ticked need goes after the ones kept, and every one may be ticked.
 */
export function BusinessNeeds({ place, onDone, ask }: { place: 'first-run' | 'connections'; onDone?: () => void; ask?: ReactNode }) {
  const t = useT();
  const headingId = useId();
  const client = useEngine();
  const pickId = useId();
  const list = useResource('venture.needs.list', {});
  /** The row whose connect flow is open in place; one at a time. */
  const [open, setOpen] = useState<string | null>(null);
  /** "Change what you need" is open; saving: one tick is on its way; unsaved: why the last one was not kept. */
  const [changing, setChanging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unsaved, setUnsaved] = useState<string | null>(null);
  const chosen = list.data?.chosen ?? [];

  /** One tick: the kept needs with this one added last, or taken out; saved, then the list is read again. */
  async function tick(id: NeedIdLite, on: boolean) {
    setSaving(true); setUnsaved(null);
    try {
      await client.request('venture.owner.set', { needs: on ? [...chosen.filter((need) => need !== id), id] : chosen.filter((need) => need !== id) });
      await list.reload();
    } catch (error) { setUnsaved(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  }
  const first = place === 'first-run';
  const grouped = (list.data?.groups.length ?? 0) > 0;
  const fieldTitle = list.data?.family ? t('first-run.needs.list', { family: list.data.family.label }) : t('first-run.needs.listPlain');

  /** In place wherever a server form or (in the first run) a guide is the flow; in Connections a card opens its own sheet. */
  function setUp(need: NeedLite, from: Element | null) {
    const inPlace = Boolean(need.connect.mcpServerId) || first;
    if (inPlace) setOpen((was) => (was === need.id ? null : need.id));
    else if (need.connect.connectorId) openSheet('connector', need.connect.connectorId, from);
    else goTo('connections', 'ai');
  }

  const rows = (needs: NeedLite[], label: string) => (
    <ul className={f.needs} aria-label={label}>
      {needs.map((need) => {
        const shown = open === need.id;
        return (
          <Tile key={need.id} as="li" pad="compact" className={f.need}>
            <div className={f.needText}>
              <div className={f.needHead}>
                <span className={f.needName} data-need-name="">{need.name}</span>
                <ConnectorLabel label={need.label} />
              </div>
              <p className={f.needWhy}>{need.why}</p>
              {need.label === 'planned' && need.waitsOn && <p className={f.hint}>{t('first-run.needs.waits', { waits: need.waitsOn, meanwhile: need.meanwhile ?? '' })}</p>}
            </div>
            <div className={f.needActions}>
              {need.action === 'set-up' && <Button size="sm" aria-expanded={need.connect.mcpServerId || first ? shown : undefined} onClick={(event) => setUp(need, event.currentTarget)}>{t('first-run.needs.setUp')}</Button>}
              {need.action === 'none' && <span className={f.needReady}>{t('first-run.needs.ready')}</span>}
            </div>
            {shown && (
              <div className={f.needFlow} role="group" aria-label={t('first-run.needs.flow', { name: need.name })}>
                {need.connect.connectorId ? <CardGuide connectorId={need.connect.connectorId} /> : <McpConnect serverId={need.connect.mcpServerId} onSaved={list.reload} />}
                <Button size="sm" variant="quiet" onClick={() => setOpen(null)}>{t('sheet.close')}</Button>
              </div>
            )}
          </Tile>
        );
      })}
    </ul>
  );

  return (
    <section className={f.wrap} aria-labelledby={headingId}>
      {first && <p className={f.eyebrow}>{t('first-run.stepOf', { n: '3' })}</p>}
      {first ? <h1 id={headingId} className={f.title}>{t('first-run.needs.title')}</h1> : <h2 id={headingId} className={f.title}>{grouped ? t('first-run.needs.title') : fieldTitle}</h2>}
      {first && <p className={f.sub}>{t('first-run.needs.sub')}</p>}
      {first && ask}
      {list.error && <p className={f.problem} role="alert">{t('first-run.needs.failed', { message: list.error.message })}</p>}
      {list.data && (
        <div className={f.needChange}>
          <Button variant="quiet" size="sm" aria-expanded={changing} aria-controls={changing ? pickId : undefined} onClick={() => setChanging((was) => !was)}>{t('first-run.needs.change')}</Button>
          {changing && (
            <fieldset id={pickId} className={f.needPick} disabled={saving}>
              <legend className={f.needPickTitle}>{t('first-run.needs.changeTitle')}</legend>
              {list.data.choices.map((id) => (
                <label key={id} className={f.needPickRow}>
                  <input type="checkbox" checked={chosen.includes(id)} onChange={(event) => void tick(id, event.target.checked)} />
                  <span>{t(`first-run.needs.for.${id}`)}</span>
                </label>
              ))}
            </fieldset>
          )}
          {unsaved && <p className={f.problem} role="alert">{t('first-run.needs.changeFailed', { message: unsaved })}</p>}
        </div>
      )}
      {list.data && grouped && list.data.groups.map((group) => {
        const title = t(`first-run.needs.for.${group.id}`);
        return (
          <div key={group.id} className={f.needGroup}>
            {first ? <h2 className={f.needGroupTitle}>{title}</h2> : <h3 className={f.needGroupTitle}>{title}</h3>}
            {/* The engine's one line for this need, such as the public map listing places only. */}
            {group.note && <p className={f.hint} data-need-note="">{group.note}</p>}
            {rows(group.ways, title)}
          </div>
        );
      })}
      {list.data && !grouped && rows(list.data.needs, fieldTitle)}
      {first && (
        <div className={f.needsFoot}>
          <Button variant="primary" size="lg" onClick={() => { goTo('today'); onDone?.(); }}>{t('first-run.needs.done')}</Button>
        </div>
      )}
    </section>
  );
}

/** A connector card's own setup guide (the engine's build/guides.ts), read in place: the steps its sheet shows. */
function CardGuide({ connectorId }: { connectorId: string }) {
  const t = useT();
  const cards = useResource('venture.connectors.list', {});
  const card = cards.data?.find((item) => item.id === connectorId);
  if (cards.error) return <p className={f.problem} role="alert">{t('connections.failed', { message: cards.error.message })}</p>;
  if (!cards.data) return <p className={f.hint}>{t('connections.sheet.loading')}</p>;
  if (!card?.guide) return <p className={f.hint}>{card?.note ?? t('connections.sheet.notFound')}</p>;
  return <Guide connectorId={card.id} guide={card.guide} />;
}
