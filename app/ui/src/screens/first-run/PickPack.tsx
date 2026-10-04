/**
 * FR-06 "Pick a starter pack": the kinds of business as plain rows, in the Engine's
 * order, each saying "draft, not yet checked". A row is a real button that picks that
 * pack. Under the rows, when the parent supplies a genuine internal destination, the
 * underlined "Start from a conversation" as a real navigation link: the exact approved
 * phrase is 25 characters, the action-button limit is 22, and a link is not an action
 * button. Leaving through it cancels this screen's reads before the parent's own
 * journey runs. No picture exists for this step; the row vocabulary is the approved one
 * (square, word, grey state, arrow) and nothing else is drawn.
 */

import { useId } from 'react';
import { PageHeader } from '../../app/PageHeader';
import { useT } from '../../app/text';
import { Square } from '../../parts/Square';
import type { DictionaryDraft } from './contracts.ts';
import { Arrow, moveBetweenRows } from './rows';
import s from './FirstRun.module.css';

/** A parent-supplied internal destination for "Start from a conversation". Nothing is invented when it is absent. */
export interface FirstRunConversationLink {
  /** A fragment route of this app, such as `#/ask`. Anything else is not drawn. */
  readonly href: string;
  /** Runs after this screen has cancelled its own reads, before the browser follows the link. */
  readonly onLeave?: (() => void) | undefined;
}

const INTERNAL_DESTINATION = /^#\/[a-z][a-z0-9-]{0,63}(?:\/[a-z][a-z0-9-]{0,63})?$/;

/** Only an in-app fragment route is a destination this screen will draw. No scheme, host, path or query. */
export function internalDestination(href: string): boolean {
  return INTERNAL_DESTINATION.test(href);
}

export interface PickPackProps {
  packs: readonly DictionaryDraft[];
  onChoose: (pack: string) => void;
  conversation: FirstRunConversationLink | undefined;
  /** This screen's own cancellation, run before any parent intent that leaves it. */
  onLeave: () => void;
}

export function PickPack({ packs, onChoose, conversation, onLeave }: PickPackProps) {
  const t = useT();
  const titleId = useId();
  const link = conversation !== undefined && internalDestination(conversation.href) ? conversation : undefined;
  return (
    <>
      <PageHeader where={t('FR.step', { step: '4', of: '6' })} title={t('FR-06.title')} titleId={titleId} />
      <ul className={s.rows} data-first-run-list="packs" aria-labelledby={titleId}>
        {packs.map(pack => (
          <li key={pack.pack} className={s.row} data-first-run-row="" data-row-id={pack.pack}>
            <div className={s.line}>
              <button type="button" className={s.main} data-row-main="" onClick={() => onChoose(pack.pack)} onKeyDown={moveBetweenRows}>
                <Square mark="wait" wordsKey="FR-06.state" />
                <span className={s.word} lang="en">{pack.label}</span>
                <span className={s.state} aria-hidden="true">{t('FR-06.state')}</span>
              </button>
              <span className={s.arrowSlot} aria-hidden="true"><Arrow open={false} /></span>
            </div>
          </li>
        ))}
      </ul>
      {link !== undefined && (
        <p className={s.after}>
          <a className={s.link} href={link.href} data-first-run-leave="conversation" onClick={() => { onLeave(); link.onLeave?.(); }}>{t('FR-06.conversation')}</a>
        </p>
      )}
    </>
  );
}
