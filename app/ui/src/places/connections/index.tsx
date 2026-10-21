/**
 * Connections: every connector the engine lists, grouped by category, each with its honest label (handoff, reads,
 * writes or planned) worked out from the engine's modes only, and for a connector that posts, its posting mode, the
 * engine's risk line and, when planned, the engine's reason. Nothing here claims more than the engine says.
 * Actions are only what the engine really does: Open hands the build brief to a builder (venture.build.handoff),
 * Follow a repo leads to Website build (venture.build.link, the one connector the engine links), Visit site opens the
 * engine's vendor link. Your AI lives at the top. A connector opens beside the page with every mode it lists.
 */

import { useId, useMemo, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { useRoute, openSheet } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { ConnectorLabel, connectorLabelOf } from '../../parts/ConnectorLabel';
import { PageTitle } from '../../parts/PageTitle';
import { Row } from '../../parts/Row';
import { Sheet } from '../../parts/Sheet';
import type { SheetComponentProps } from '../../shell/sheets';
import { EngineError, type BuilderId, type ConnectorCardLite, type PostingOptionLite } from '../../engine/types';
import { BUILDERS, BUILDER_NAMES, handOff } from '../business/handoff';
import { ExternalLink, openProblem } from './external';
import { YourAi } from './YourAi';
import s from './Connections.module.css';

/** The engine's refusals that the Website build page resolves: no brief, a brief that failed its checks, no accepted plan. */
const BUILD_FIRST = new Set(['BRIEF_NOT_FOUND', 'BRIEF_LINT_FAILED', 'BLUEPRINT_NOT_ACCEPTED']);

interface Group { category: string; label: string; cards: ConnectorCardLite[] }

/** Groups in the engine's order: its starters come first, so their categories lead. */
function grouped(cards: ConnectorCardLite[]): Group[] {
  const groups: Group[] = [];
  for (const card of cards) {
    let group = groups.find((g) => g.category === card.category);
    if (!group) { group = { category: card.category, label: card.categoryLabel, cards: [] }; groups.push(group); }
    group.cards.push(card);
  }
  return groups;
}

/** A posting mode as a label: available posting writes to the platform; anything else is planned. */
function PostingLabel({ option }: { option: PostingOptionLite }) {
  return <ConnectorLabel label={option.status === 'available' ? 'write' : 'planned'} mode={option.mode} risk={option.risk ?? undefined} />;
}

export function Place() {
  const t = useT();
  const route = useRoute();
  const cards = useResource('venture.connectors.list', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const groups = useMemo(() => grouped(cards.data ?? []), [cards.data]);
  return (
    <>
      <PageTitle title={t('place.connections')} line={t('connections.line')} />
      <YourAi focus={route.sub === 'ai'} />
      {cards.error && <p className={s.problem} role="alert">{t('connections.failed', { message: cards.error.message })}</p>}
      {groups.map((group) => <GroupSection key={group.category} group={group} />)}
    </>
  );
}

function GroupSection({ group }: { group: Group }) {
  const headingId = useId();
  return (
    <section className={s.group} aria-labelledby={headingId}>
      <h2 id={headingId} className={s.heading}>{group.label}</h2>
      <ul className={s.list}>
        {group.cards.map((card) => <ConnectorRow key={card.id} card={card} />)}
      </ul>
    </section>
  );
}

function ConnectorRow({ card }: { card: ConnectorCardLite }) {
  const t = useT();
  const client = useEngine();
  const [said, setSaid] = useState<{ text: string; problem: boolean; toBuild: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const handsOff = card.modes.some((m) => m.mode === 'handoff' && m.status === 'available');
  const builder = handsOff && (BUILDERS as string[]).includes(card.id) ? (card.id as BuilderId) : null;

  async function open(id: BuilderId) {
    setSaid(null);
    const started = handOff(client, id); // first, so the web tab opens inside the click
    setBusy(true);
    try {
      const { plan, done } = await started;
      const name = BUILDER_NAMES[id];
      const text = done === 'opened' ? t('connections.opened', { name }) : done === 'copied' ? t('connections.copied', { name }) : plan.notes.join(' ');
      setSaid({ text, problem: false, toBuild: false });
    } catch (error) {
      const code = error instanceof EngineError ? error.code : '';
      const text = code === 'COPY_FAILED' ? t('connections.copyFailed') : openProblem(error, t);
      setSaid({ text, problem: true, toBuild: BUILD_FIRST.has(code) });
    } finally {
      setBusy(false);
    }
  }

  const actions = (
    <>
      {builder && (
        <Button disabled={busy} onClick={() => void open(builder)}>
          <span aria-hidden="true">{t('connections.open')}</span>
          <span className="sr-only">{t('connections.openName', { name: card.name })}</span>
        </Button>
      )}
      {/* GitHub is the one connector the engine links (venture.build.link, read only); the form is on Website build. */}
      {card.id === 'github' && <a className={s.link} href="#/business/build">{t('connections.follow')}</a>}
      {card.vendorUrl && <ExternalLink href={card.vendorUrl}>{t('connections.visit')}<span className="sr-only">, {card.name}</span></ExternalLink>}
    </>
  );

  return (
    <Row id={`connector-${card.id}`} title={card.name} line={card.note} onOpen={(origin) => openSheet('connector', card.id, origin)} actions={actions}>
      <p className={s.label} data-connector-label=""><ConnectorLabel label={connectorLabelOf(card)} /></p>
      {card.posting && (
        <p className={s.posting} data-posting="">
          <span className={s.postingWord}>{t('connections.posting')}</span>
          <PostingLabel option={card.posting} />
          {card.posting.status === 'planned' && card.posting.reason && <span className={s.reason}>{card.posting.reason}</span>}
        </p>
      )}
      {said && (
        <p className={said.problem ? s.problem : s.said} role="status">
          {said.text}
          {said.toBuild && <> <a className={s.link} href="#/business/build">{t('connections.toBuild')}</a></>}
        </p>
      )}
    </Row>
  );
}

/** One connector beside the page: every mode with what it does and how far it is checked, and every way to post. */
function ConnectorSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const cards = useResource('venture.connectors.list', {});
  const card = cards.data?.find((c) => c.id === id);
  return (
    <Sheet label={t('connections.sheet.label')} title={card?.name ?? id} line={card?.categoryLabel} onClose={onClose} returnFocus={returnFocus}>
      {cards.error && <p className={s.problem}>{t('connections.failed', { message: cards.error.message })}</p>}
      {!cards.data && !cards.error && <p className={s.note}>{t('connections.sheet.loading')}</p>}
      {cards.data && !card && <p className={s.note}>{t('connections.sheet.notFound')}</p>}
      {card && (
        <>
          <p className={s.line}>{card.note}</p>
          {card.regionNote && <p className={s.note}>{card.regionNote}</p>}
          <h3 className={s.subheading}>{t('connections.sheet.modes')}</h3>
          <ul className={s.list}>
            {card.modes.map((mode) => (
              <li key={mode.mode} className={s.mode}>
                <span className={s.modeHead}>{t(`connector.${mode.mode}`)}</span>
                <span className={s.status}>{t(`connections.status.${mode.status}`)}</span>
                <p className={s.line}>{mode.what}</p>
                {mode.status === 'available' && <p className={s.note}>{t(`connections.qualification.${mode.qualification}`)}</p>}
              </li>
            ))}
          </ul>
          {card.postingOptions.length > 0 && (
            <>
              <h3 className={s.subheading}>{t('connections.sheet.posting')}</h3>
              <ul className={s.list}>
                {card.postingOptions.map((option) => (
                  <li key={option.mode} className={s.mode} data-posting-option={option.mode}>
                    <PostingLabel option={option} />
                    <p className={s.line}>{option.what}</p>
                    {option.requires.length > 0 && <p className={s.note}>{t('connections.sheet.requires', { list: option.requires.join('; ') })}</p>}
                    {option.reason && <p className={s.note}>{option.reason}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className={s.note}>{t('connections.sheet.auth', { auth: card.auth })}</p>
          {card.vendorUrl && <p className={s.line}><ExternalLink href={card.vendorUrl}>{t('connections.visit')}</ExternalLink></p>}
        </>
      )}
    </Sheet>
  );
}

export const sheets = { connector: ConnectorSheet };
