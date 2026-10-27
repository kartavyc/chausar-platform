/**
 * Connections in the D look (w3 3G1; spec 4.3): Your AI first, "What Chausar can do on this computer", then every
 * connector the engine lists as a tile under its category's heading, each with its category icon, its name (which
 * opens it beside the page), its honest label (handoff, reads, writes or planned) by one rule shared with the tile's
 * look (tileLabelOf), the engine's note, and for a connector that posts, its posting mode, the engine's risk line and,
 * when planned, the engine's reason. Only a connector whose label is Planned is drawn open and dashed, and it offers
 * nothing to press but its name.
 * Actions are only what the engine really does: Open hands the build brief to a builder (venture.build.handoff),
 * Follow a repo leads to Website build (venture.build.link, the one connector the engine links), Visit site opens the
 * engine's vendor link, Import a statement opens the bank account sheet (venture.bank.*).
 */

import { useId, useMemo, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { useRoute, openSheet } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { Inner } from '../../parts/Card';
import { ConnectorLabel, connectorLabelOf, type ConnectorLabelName } from '../../parts/ConnectorLabel';
import { cx } from '../../parts/cx';
import { Icon } from '../../parts/Icon';
import { PageTitle } from '../../parts/PageTitle';
import { Sheet } from '../../parts/Sheet';
import { Tile } from '../../parts/Tile';
import type { SheetComponentProps } from '../../shell/sheets';
import { EngineError, type BuilderId, type ConnectorCardLite, type PostingOptionLite } from '../../engine/types';
import { BUILDERS, BUILDER_NAMES, handOff } from '../business/handoff';
import { BankImportSheet } from './BankImport';
import { BankSheet } from './BankSheet';
import { CanDo } from './CanDo';
import { CliStatus } from './CliStatus';
import { categoryIcon } from './categories';
import { ExternalLink, openProblem } from './external';
import { Posting, signInOffered } from './Posting';
import { TranscriptionSetup } from './TranscriptionSetup';
import { YourAi } from './YourAi';
import { YourNetwork } from './YourNetwork';
import { Mailbox } from './Mailbox';
import { CalendarFeed } from './CalendarFeed';
// W5 5A6: pages you watch, mail files, apps on this computer, your n8n or Make, speech from text.
import { KitConnect } from './KitConnect';
// W4 4J21: the setup guides, the truth ladder's words and Check connections (from 4J7).
import { ChecksTile } from './ChecksTile';
import { Guide, LadderWord } from './Guide';
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

/** A connector that posts, or can be signed in to, takes a wider tile for its posting lines. */
const isWide = (card: ConnectorCardLite) => Boolean(card.posting) || signInOffered(card);

/** The bank card: its statement import works today, though reading the bank itself waits for a provider. */
const BANK = 'bank-account';

/**
 * The one honest rule for a tile's head chip and its look: the most the connector's modes do today; else Writes when a
 * way to post works (LinkedIn through your own browser); else Reads for the bank card, whose statement import reads
 * the files you give it; else Planned. Only Planned is drawn open and dashed, so the chip and the tile never disagree.
 */
function tileLabelOf(card: ConnectorCardLite): ConnectorLabelName {
  const own = connectorLabelOf(card);
  if (own !== 'planned') return own;
  if (card.postingOptions.some((option) => option.status === 'available')) return 'write';
  return card.id === BANK ? 'read' : 'planned';
}

/** Whether anything about the connector works today, by the same rule as its chip. */
const anyLive = (card: ConnectorCardLite) => tileLabelOf(card) !== 'planned';

/** A posting mode as a label: available posting writes to the platform; anything else is planned. */
function PostingLabel({ option }: { option: PostingOptionLite }) {
  return <ConnectorLabel label={option.status === 'available' ? 'write' : 'planned'} mode={option.mode} risk={option.risk ?? undefined} />;
}

export function Place() {
  const t = useT();
  const route = useRoute();
  const client = useEngine();
  const cards = useResource('venture.connectors.list', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const venture = useResource('venture.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const groups = useMemo(() => grouped(cards.data ?? []), [cards.data]);
  // Transcription reads files on this computer: only the desktop app, inside a business, offers it.
  const local = Boolean(venture.data) && client.transport !== 'hosted';
  return (
    <>
      <PageTitle title={t('place.connections')} line={t('connections.line')} />
      <div className={s.place}>
        <YourAi focus={route.sub === 'ai'} />
        <CliStatus />
        {venture.data && <ChecksTile />}
        {(cards.data || local) && (
          <div className={s.second} data-side={local ? undefined : 'none'}>
            {cards.data && <CanDo cards={cards.data} />}
            {local && <TranscriptionSetup />}
          </div>
        )}
        {cards.error && <p className={s.problem} role="alert">{t('connections.failed', { message: cards.error.message })}</p>}
        {groups.length > 0 && <div className={s.groups}>{groups.map((group) => <GroupSection key={group.category} group={group} />)}</div>}
        {venture.data && <YourNetwork />}
        {venture.data && <Mailbox />}
        {venture.data && <CalendarFeed />}
        {venture.data && <KitConnect />}
      </div>
    </>
  );
}

function GroupSection({ group }: { group: Group }) {
  const t = useT();
  const headingId = useId();
  const live = group.cards.filter(anyLive).length;
  // Small categories sit side by side, a third of the page per tile; three or more, or any wide tile, take the row.
  const wide = group.cards.some(isWide);
  const cols = wide ? 2 : Math.min(group.cards.length, 3);
  return (
    <section className={s.group} aria-labelledby={headingId} data-cols={wide ? 3 : cols}>
      <div className={s.groupHead}>
        <h2 id={headingId} className={s.groupTitle}>{group.label}</h2>
        <span className={s.meta}>{t('connections.groupMeta', { count: live, live, total: group.cards.length })}</span>
      </div>
      <ul className={s.cards} data-cols={cols}>
        {group.cards.map((card) => <ConnectorTile key={card.id} card={card} />)}
      </ul>
    </section>
  );
}

function ConnectorTile({ card }: { card: ConnectorCardLite }) {
  const t = useT();
  const client = useEngine();
  const nameId = useId();
  const [said, setSaid] = useState<{ text: string; problem: boolean; toBuild: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const handsOff = card.modes.some((m) => m.mode === 'handoff' && m.status === 'available');
  const builder = handsOff && (BUILDERS as string[]).includes(card.id) ? (card.id as BuilderId) : null;
  const label = tileLabelOf(card);
  const live = label !== 'planned';
  // A way to post works, so the planned API is said on a line of its own, apart from the chip.
  const plannedApi = card.posting?.status === 'available' ? card.postingOptions.find((option) => option.mode === 'api' && option.status === 'planned') : undefined;

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

  return (
    <Tile as="li" card labelledBy={nameId} className={cx(s.connector, !live && s.planned)}>
      <div className={s.tileTop} data-tile-state={live ? 'live' : 'planned'}>
        <span className={s.catIcon} data-category-icon={card.category} aria-hidden="true"><Icon name={categoryIcon(card.category)} size={18} /></span>
        <div className={s.who}>
          <button type="button" id={nameId} className={s.name} data-connector-name="" onClick={(event) => openSheet('connector', card.id, event.currentTarget)}>{card.name}</button>
          <span className={s.labelSlot} data-connector-label=""><ConnectorLabel label={label} /></span>
        </div>
      </div>
      <p className={s.note}>{card.note}</p>
      {/* A statement file is read today (the chip says Reads); reading the bank itself waits for a provider, and only
          that line says Planned. */}
      {card.id === BANK && (
        <>
          <p className={s.works}><Icon name="check" size={14} />{t('connections.bank.works')}</p>
          <p className={s.posting} data-bank-direct=""><span className={s.postingWord}>{t('connections.bank.direct')}</span><ConnectorLabel label="planned" /></p>
        </>
      )}
      {card.posting && (
        <p className={s.posting} data-posting="">
          <span className={s.postingWord}>{t('connections.posting')}</span>
          <PostingLabel option={card.posting} />
          {card.posting.status === 'planned' && card.posting.reason && <span className={s.reason}>{card.posting.reason}</span>}
        </p>
      )}
      {plannedApi && (
        <p className={s.posting} data-posting-planned="api">
          <span className={s.postingWord}>{t('connections.posting.api')}</span>
          <ConnectorLabel label="planned" />
        </p>
      )}
      <Posting card={card} />
      {said && (
        <p className={said.problem ? s.problem : s.said} role="status">
          {said.text}
          {said.toBuild && <> <a className={s.link} href="#/business/build">{t('connections.toBuild')}</a></>}
        </p>
      )}
      <div className={s.foot}>
        {builder && (
          <Button size="sm" disabled={busy} onClick={() => void open(builder)}>
            <span aria-hidden="true">{t('connections.open')}</span>
            <span className="sr-only">{t('connections.openName', { name: card.name })}</span>
          </Button>
        )}
        {/* GitHub is the one connector the engine links (venture.build.link, read only); the form is on Website build. */}
        {card.id === 'github' && <a className={s.link} href="#/business/build">{t('connections.follow')}</a>}
        {/* One import path: the bank account sheet holds the import, the ledger, consent and alerts (BankSheet.tsx). */}
        {card.id === BANK && <Button size="sm" onClick={(event) => openSheet('bank', card.id, event.currentTarget)}>{t('connections.bank.open')}</Button>}
        {card.vendorUrl && <ExternalLink href={card.vendorUrl}>{t('connections.visit')}<span className="sr-only">, {card.name}</span></ExternalLink>}
      </div>
    </Tile>
  );
}

/**
 * One connector beside the page: every mode with what it does and how far it is checked, every way to post with the
 * engine's `requires` lines as numbered setup steps (catalogue K11), how it signs in, and its vendor link.
 */
function ConnectorSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const cards = useResource('venture.connectors.list', {});
  const card = cards.data?.find((c) => c.id === id);
  const icon = card && <span className={s.sheetIcon} aria-hidden="true"><Icon name={categoryIcon(card.category)} size={20} /></span>;
  return (
    <Sheet label={t('connections.sheet.label')} title={card?.name ?? id} name={card?.name} line={card?.categoryLabel} avatar={icon} onClose={onClose} returnFocus={returnFocus}>
      {cards.error && <p className={s.problem}>{t('connections.failed', { message: cards.error.message })}</p>}
      {!cards.data && !cards.error && <p className={s.note}>{t('connections.sheet.loading')}</p>}
      {cards.data && !card && <p className={s.note}>{t('connections.sheet.notFound')}</p>}
      {card && <SheetBody card={card} />}
    </Sheet>
  );
}

function SheetBody({ card }: { card: ConnectorCardLite }) {
  const t = useT();
  return (
    <>
      <div className={s.sheetSection}>
        <p className={s.line}>{card.note}</p>
        {card.regionNote && <p className={s.note}>{card.regionNote}</p>}
      </div>
      <section className={s.sheetSection}>
        <h3 className={s.sheetHeading}>{t('connections.sheet.modes')}</h3>
        <ul className={s.modes}>
          {card.modes.map((mode) => (
            <li key={mode.mode} data-mode={mode.mode}>
              <Inner card={false}>
                <p className={s.modeHead}>
                  <ConnectorLabel label={mode.status === 'available' ? mode.mode : 'planned'} />
                  {mode.status === 'available' && <span className={s.status}>{t('connections.status.available')}</span>}
                </p>
                <p className={s.line}>{mode.what}</p>
                {mode.status === 'available' && <p className={s.fact}>{t(`connections.qualification.${mode.qualification}`)}</p>}
                <LadderWord ladder={mode.ladder} />
              </Inner>
            </li>
          ))}
        </ul>
      </section>
      {card.guide && <Guide guide={card.guide} />}
      {card.postingOptions.length > 0 && (
        <section className={s.sheetSection}>
          <h3 className={s.sheetHeading}>{t('connections.sheet.posting')}</h3>
          <ul className={s.modes}>
            {card.postingOptions.map((option) => <PostingOption key={option.mode} option={option} />)}
          </ul>
        </section>
      )}
      <div className={s.sheetSection}>
        <p className={s.note}>{t('connections.sheet.auth', { auth: card.auth })}</p>
        {card.vendorUrl && <p className={s.line}><ExternalLink href={card.vendorUrl}>{t('connections.visit')}</ExternalLink></p>}
      </div>
    </>
  );
}

/** One way to post: its title and label, what it does, what it needs in the engine's order, and why it is planned. */
function PostingOption({ option }: { option: PostingOptionLite }) {
  const t = useT();
  const stepsId = useId();
  return (
    <li data-posting-option={option.mode}>
      <Inner card={false}>
        <p className={s.modeHead}>
          <span>{t(`connector.mode.${option.mode}`)}</span>
          {/* The title already names the way of posting, so the label says only what it does and its risk. */}
          <ConnectorLabel label={option.status === 'available' ? 'write' : 'planned'} risk={option.risk ?? undefined} />
        </p>
        <p className={s.line}>{option.what}</p>
        {option.requires.length > 0 && (
          <>
            {/* A way that works lists its setup steps; a planned way lists what it needs before it can work. */}
            <p id={stepsId} className={s.setupHead}>{t(option.status === 'available' ? 'connections.sheet.setup' : 'connections.sheet.needsFirst')}</p>
            <ol className={s.setup} aria-labelledby={stepsId}>
              {option.requires.map((line) => <li key={line}>{line}</li>)}
            </ol>
          </>
        )}
        {option.reason && <p className={s.fact}>{option.reason}</p>}
        <LadderWord ladder={option.ladder} />
      </Inner>
    </li>
  );
}


export const sheets = { connector: ConnectorSheet, 'bank-import': BankImportSheet, bank: BankSheet };
