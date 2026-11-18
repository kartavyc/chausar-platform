import { useEffect, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Sheet } from '../../parts/Sheet';
import { AmountsText } from '../../parts/AmountsText';
import type { SheetComponentProps } from '../../shell/sheets';
import type { QueueItemView } from '../../engine/types';
import { decide, seenKey, useTodaySession } from './session';
import { EngineViewText } from './CardPreview';
import { draftViewWords, fixedWords } from './plan-words';
import s from './Today.module.css';

const KINDS: readonly QueueItemView['kind'][] = ['draft', 'file', 'plan'];

/** `view:<kind>:<id>`, the address of what a row points at. */
export const viewSheetId = (ref: { kind: QueueItemView['kind']; id: string }) => `${ref.kind}:${ref.id}`;

/**
 * The thing a row asks the owner to look at before approving: a draft, a file or a plan, as text. Once its content is
 * on screen the row's Approve unlocks (the session marks that version seen); a sheet that fails to load unlocks
 * nothing. A draft's lines are its own words, quoted; a file's or a plan's are Chausar's own (engine lines until W4 4J1
 * gives their figures receipts), with each "(model estimate)" the engine marks shown as the label.
 */
export function ViewSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const session = useTodaySession();
  const at = id.indexOf(':');
  const kind = id.slice(0, at) as QueueItemView['kind'];
  const ref = id.slice(at + 1);
  const known = at > 0 && KINDS.includes(kind) && ref.length > 0;
  // W4 4J19: the sheet is the owner opening it, so the engine keeps its view mark for a set approval.
  const view = useResource('venture.queue.view', { kind, id: ref, opened: true }, { skip: !known });
  const data = view.data;
  // B3: a row about this thing decided in this session says so at the sheet's top, in the engine's words.
  const decided = known ? session.lines().find((line) => line.row.viewRef?.kind === kind && line.row.viewRef.id === ref) : undefined;

  useEffect(() => {
    if (!data) return;
    session.show(id);
    return () => session.unshow(id);
  }, [data, session, id]);

  // 15 Nov 2026 (the first Windows walk): a plan's sheet ends with its own accept. The owner read the plan to its end
  // and had to close it to find Accept back on Today. It is the waiting row's own action (the engine's label), sent the
  // one way every decision is (session.ts decide), and only once the plan's content is on screen: the read-first rule.
  // Today's card keeps its Accept, and unlocks with the same reading.
  const client = useEngine();
  const queue = useResource('venture.queue.list', { scope: 'all' }, { skip: !known || kind !== 'plan' });
  const asking = kind === 'plan' ? queue.data?.rows.find((row) => row.kind === 'plan' && row.viewRef?.kind === 'plan' && row.viewRef.id === ref) : undefined;
  const accept = asking?.actions.find((action) => action.primary && action.id === 'approve');
  const [accepting, setAccepting] = useState(false);
  const [acceptedHere, setAcceptedHere] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const askingKey = data && asking ? seenKey(asking) : null;
  useEffect(() => { if (askingKey) session.markViewed(askingKey); }, [askingKey, session]);
  async function acceptPlan() {
    if (!asking || !accept || accepting) return;
    setAccepting(true); setRefused(null);
    try {
      const decision = await decide(client, asking, accept.id, { viewed: true }, t);
      if (decision.outcome === 'done') setAcceptedHere(true);
      else setRefused(decision.line);
    } catch (error) { setRefused(error instanceof Error ? error.message : String(error)); }
    finally { setAccepting(false); }
  }

  if (!known) return <Sheet label="" title={t('sheet.unknown')} onClose={onClose} returnFocus={returnFocus} />;
  const label = t(`today.view.${kind}`);
  const quoted = kind === 'draft';
  const words = (text: string) => (quoted ? text : <EngineViewText text={text} />);
  // Round 6: a draft's Chausar-written title, line, Checks and Files in the owner's language; the draft stays as written.
  const planWords = fixedWords(t);
  if (!data) {
    return (
      <Sheet label={label} loading={!view.error} title={view.error ? t('today.view.missing') : t('sheet.loading')} onClose={onClose} returnFocus={returnFocus}>
        {view.error && <p className={s.failed}>{view.error.message}</p>}
      </Sheet>
    );
  }
  const shown = quoted ? draftViewWords(data, planWords) : data;
  return (
    <Sheet
      label={label}
      eyebrow={data.agent ? `${data.businessName} · ${data.agent}` : data.businessName}
      title={words(shown.title)}
      // The line under the title is the engine's own sentence about the thing, whatever it is.
      line={shown.line === undefined ? undefined : <span data-engine-line="">{words(shown.line)}</span>}
      onClose={onClose}
      returnFocus={returnFocus}
      footer={decided ? (acceptedHere ? <p className={s.sheetDecided} data-sheet-accepted="">{decided.line}</p> : undefined)
        : accept ? <Button variant="primary" disabled={accepting} onClick={() => void acceptPlan()}>{accept.label}</Button> : undefined}
    >
      {decided && <p className={s.sheetDecided} role="status" data-sheet-decided="">{decided.line}</p>}
      {shown.sections.map((section, i) => (
        <section key={`${section.heading ?? ''}:${i}`} className={s.part}>
          {section.heading && <h3 className={s.partHeading}>{section.heading}</h3>}
          <ul className={s.lines} data-content={quoted ? '' : undefined} data-engine-line={quoted ? undefined : ''}>
            {section.lines.map((text, j) => <li key={`${j}:${text}`}>{quoted && data.amounts?.length ? <AmountsText text={text} amounts={data.amounts} /> : words(text)}</li>)}
          </ul>
        </section>
      ))}
      {refused && !decided && <p className={s.failed} role="alert">{refused}</p>}
    </Sheet>
  );
}
