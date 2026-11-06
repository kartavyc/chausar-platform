/**
 * Start's two tiles from Chausar as chief of staff (W4 4C2; D-Start's fit tile and `.unsure`):
 *   FitTile   "Good fit for you": the one way to earn venture.chief.fit picks for this owner, by its name from
 *             venture.playbooks.list and the AI's own line, labelled a model estimate (it is the AI's judgement).
 *             Start with this puts the way's own starting sentence in the box below and sends nothing. The fit is a
 *             call to the owner's AI, so it is asked only when the owner presses "Which way fits me?" (useFit). No fit
 *             (no AI, or no ways listed yet) is no tile, and the Not sure tile says so; a refusal is said there too.
 *   NotSure   "Not sure which fits? Ask Chausar": two questions that open a new chat with the question in the box,
 *             unsent, "Which way fits me?", and Open Chats.
 * Beside lays a tile next to the one it belongs with, as D does, and stacks them when the page is narrow.
 */

import { useId, useState, type ReactNode } from 'react';
import { useLanguage, useT } from '../../text';
import { useEngine } from '../../engine/context';
import type { ChiefFit, WayView } from '../../engine/types';
import { askChausar } from '../../shell/ask';
import { ChausarAvatar } from '../../parts/Avatar';
import { Button } from '../../parts/Button';
import { Icon } from '../../parts/Icon';
import { ModelEstimate } from '../../parts/ModelEstimate';
import { Tile } from '../../parts/Tile';
import s from './AskChausar.module.css';

const QUESTIONS = ['onboarding.unsure.hours', 'onboarding.unsure.add'] as const;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Where asking for the fit stands: not asked, asking, no fit, refused (the engine's words), or the fit with its way. */
export type FitAsk =
  | { state: 'idle' } | { state: 'busy' } | { state: 'none' } | { state: 'failed'; message: string }
  | { state: 'shown'; fit: ChiefFit; way: WayView };

/** The fit, asked only when the owner presses for it (it is a call to the owner's AI), with its way from the list. */
export function useFit(): { ask: FitAsk; askFit: () => Promise<void> } {
  const engine = useEngine();
  const [ask, setAsk] = useState<FitAsk>({ state: 'idle' });
  async function askFit() {
    setAsk({ state: 'busy' });
    try {
      const fit = await engine.request('venture.chief.fit', {});
      const way = fit ? (await engine.request('venture.playbooks.list', {})).ways.find((item) => item.id === fit.wayId) : undefined;
      setAsk(fit && way ? { state: 'shown', fit, way } : { state: 'none' });
    } catch (error) {
      setAsk({ state: 'failed', message: messageOf(error) });
    }
  }
  return { ask, askFit };
}

export function FitTile({ fit, way, onStart }: { fit: ChiefFit; way: WayView; onStart: (starter: string) => void }) {
  const t = useT();
  const language = useLanguage();
  const chipId = useId();
  const titleId = useId();
  const words = language === 'hi' ? way.hi : way;
  return (
    <Tile as="section" labelledBy={`${chipId} ${titleId}`} className={s.fit}>
      <p id={chipId} className={s.chip}><Icon name="sparkles" size={14} />{t('onboarding.fit.chip')}</p>
      <h2 id={titleId} className={s.title}>{words.label}</h2>
      <p className={s.line}><span>{fit.line}</span> <ModelEstimate /></p>
      <div className={s.actions}>
        <Button variant="primary" size="lg" onClick={() => onStart(words.starter)}>
          {t('onboarding.fit.start')}
          <Icon name="arrow-right" size={16} />
        </Button>
      </div>
    </Tile>
  );
}

export function NotSure({ fit, onFit }: { fit: FitAsk; onFit: () => void }) {
  const t = useT();
  const titleId = useId();
  return (
    <Tile as="section" labelledBy={titleId} className={s.unsure}>
      <div className={s.top}>
        <ChausarAvatar size={32} />
        <h2 id={titleId} className={s.unsureTitle}>{t('onboarding.unsure.title')}</h2>
      </div>
      <p className={s.unsureLine}>{t('onboarding.unsure.line')}</p>
      <div className={s.questions} role="group" aria-label={t('onboarding.unsure.questions')}>
        {QUESTIONS.map((key) => (
          <button key={key} type="button" className={s.question} onClick={() => askChausar(t(key))}>{t(key)}</button>
        ))}
      </div>
      <Button disabled={fit.state === 'busy'} aria-busy={fit.state === 'busy' || undefined} onClick={onFit}>
        <Icon name="sparkles" size={16} />
        {t('onboarding.fit.ask')}
      </Button>
      {fit.state === 'none' && <p className={s.unsureLine} role="status">{t('onboarding.fit.none')}</p>}
      {fit.state === 'failed' && <p className={s.problem} role="alert">{fit.message}</p>}
      <a className={s.open} href="#/chats">{t('onboarding.unsure.open')}</a>
    </Tile>
  );
}

/**
 * A tile with another beside it (two thirds and one third), stacked when the page is narrow; full width when there is
 * none. The wrapper is the same either way, so the tile inside keeps what the owner typed when the other one arrives.
 */
export function Beside({ aside, children }: { aside: ReactNode; children: ReactNode }) {
  const alone = aside === null || aside === undefined || aside === false;
  return (
    <div className={s.beside} data-alone={alone ? '' : undefined}>
      <div className={s.main}>{children}</div>
      {!alone && aside}
    </div>
  );
}
