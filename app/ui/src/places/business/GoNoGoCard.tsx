/**
 * Business > Go or no go (Ink v2 wave 5, package 5A2; catalogue M18): before the owner starts a new offer or product,
 * a card that says Go, Hold or No go, decided by the engine's code over what the owner types (venture.goNoGo.card), never
 * by a model. The owner types amounts in rupees as they would write them, and the engine reads them as it reads a
 * price; this page sends the text as typed and works nothing out. Hold names every answer missing; the most the owner
 * could lose is a figure with the receipt that works it out; every Go card says that Go spends nothing. Each card is
 * kept and listed here, newest first (venture.goNoGo.list).
 */

import { useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Chip, type ChipTone } from '../../parts/Chip';
import { Field } from '../../parts/Field';
import { Figure } from '../../parts/Figure';
import type { GoNoGoCardView, GoNoGoInputName, GoNoGoVerdict } from '../../engine/types';
import { salesWords } from '../clients/Proposal';
import { TileSection } from './shared';
import s from './GoNoGoCard.module.css';

const TONE: Readonly<Record<GoNoGoVerdict, ChipTone>> = { GO: 'done', HOLD: 'wait', 'NO-GO': 'fail' };
type Typed = { subject: string } & Record<GoNoGoInputName, string>;
const EMPTY: Typed = { subject: '', upfront: '', monthly: '', months: '', limit: '' };
/** What the owner typed, as typed; null for a box left empty (an answer the owner does not know yet). */
const typedOrNull = (value: string): string | null => (value.trim() ? value.trim() : null);

export function GoNoGoCard() {
  const t = useT();
  const engine = useEngine();
  const venture = useResource('venture.get', {});
  const cards = useResource('venture.goNoGo.list', {});
  const [typed, setTyped] = useState<Typed>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (key: keyof Typed) => (event: { currentTarget: { value: string } }) => { const value = event.currentTarget.value; setTyped((now) => ({ ...now, [key]: value })); };

  async function decide(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!typed.subject.trim()) { setProblem(t('kit-sales.goNoGo.needSubject')); return; }
    const inputs = { upfront: typedOrNull(typed.upfront), monthly: typedOrNull(typed.monthly), months: typedOrNull(typed.months), limit: typedOrNull(typed.limit) };
    setBusy(true);
    setProblem(null);
    try {
      await engine.request('venture.goNoGo.card', { playbook: venture.data?.playbook?.id ?? 'general', subject: typed.subject.trim(), inputs });
      setTyped(EMPTY);
      cards.reload();
    } catch (error) {
      setProblem(salesWords(error, t));
    } finally {
      setBusy(false);
    }
  }

  const list = cards.data?.cards ?? [];
  return (
    <div className={s.cards}>
      <TileSection title={t('kit-sales.goNoGo.heading')}>
        <form className={s.form} onSubmit={(event) => void decide(event)} noValidate>
          <p className={s.note}>{t('kit-sales.goNoGo.line')}</p>
          <Field label={t('kit-sales.goNoGo.subject')} hint={t('kit-sales.goNoGo.subjectHint')} value={typed.subject} onChange={set('subject')} maxLength={120} autoComplete="off" />
          <div className={s.amounts}>
            <Field label={t('kit-sales.goNoGo.upfront')} inputMode="decimal" value={typed.upfront} onChange={set('upfront')} autoComplete="off" />
            <Field label={t('kit-sales.goNoGo.monthly')} inputMode="decimal" value={typed.monthly} onChange={set('monthly')} autoComplete="off" />
            <Field label={t('kit-sales.goNoGo.months')} inputMode="numeric" value={typed.months} onChange={set('months')} autoComplete="off" />
            <Field label={t('kit-sales.goNoGo.limit')} inputMode="decimal" value={typed.limit} onChange={set('limit')} autoComplete="off" />
          </div>
          {problem && <p className={s.problem} role="alert">{problem}</p>}
          <div className={s.end}><Button variant="primary" type="submit" disabled={busy}>{busy ? t('kit-sales.goNoGo.deciding') : t('kit-sales.goNoGo.decide')}</Button></div>
        </form>
      </TileSection>
      {cards.error && <p className={s.problem} role="alert">{t('kit-sales.goNoGo.failed', { message: salesWords(cards.error, t) })}</p>}
      {cards.data && list.length === 0 && <p className={s.note}>{t('kit-sales.goNoGo.none')}</p>}
      {list.map((card) => <CardTile key={card.id} card={card} />)}
    </div>
  );
}

function CardTile({ card }: { card: GoNoGoCardView }) {
  const t = useT();
  return (
    <TileSection title={card.subject}>
      <p className={s.verdict}>
        <Chip tone={TONE[card.verdict]}>{t(`kit-sales.goNoGo.verdict.${card.verdict}`)}</Chip>
        <span>{t(`kit-sales.goNoGo.says.${card.verdict}`)}</span>
      </p>
      {card.maxLoss && (
        // One receipt proves both: the card's working holds the limit beside the most you could lose.
        <dl className={s.figures} data-figure-group="">
          <div className={s.pair}>
            <dt>{t('kit-sales.goNoGo.maxLoss')}</dt>
            <dd><Figure value={card.maxLoss.display} receiptId={card.maxLoss.receiptId} /></dd>
          </div>
          {card.limit && (
            <div className={s.pair}>
              <dt>{t('kit-sales.goNoGo.limitLabel')}</dt>
              <dd className="mono">{card.limit.display}</dd>
            </div>
          )}
        </dl>
      )}
      {card.spendsNothing && <p className={s.note}>{t('kit-sales.goNoGo.spendsNothing')}</p>}
      {card.unknown.length > 0 && (
        <>
          <p className={s.note}>{t('kit-sales.goNoGo.unknown')}</p>
          <ul className={s.unknown}>{card.unknown.map((item) => <li key={item.input}>{t(`kit-sales.goNoGo.input.${item.input}`)}</li>)}</ul>
        </>
      )}
    </TileSection>
  );
}
