import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import type { PreviewFigure, PreviewWords, QueueItemView, QueuePreview, QueueRow } from '../../engine/types';
import type { PreviewExtra } from '../../parts/ApprovalRow';
import { Icon } from '../../parts/Icon';
import { ModelEstimate } from '../../parts/ModelEstimate';
import { PreviewFrame } from '../../parts/PreviewFrame';
import { QuestionCardView } from '../../parts/QuestionCard';
import { useTodayDrafts } from './drafts';
import s from './CardPreview.module.css';

/** What a big card shows to look at: drawn by the card through ApprovalRow's `preview`, which hands it `view`. */
export type CardPreviewer = (view: () => void, extra?: PreviewExtra) => ReactNode;

/** How the engine marks words a model wrote in a plan's or a file's view: right after them (views/queue-view.ts). */
const MODEL_ESTIMATE = ' (model estimate)';

/** The most lines of a file a card shows, for a business registered for tax; the sheet shows them all. */
const FILE_LINES = 3;

/**
 * A piece of a plan's or a file's view, as the engine wrote it, with each "(model estimate)" it marks shown as the
 * "model estimate" label after the words it covers. Only the engine's own mark is looked for; nothing else is read.
 */
export function EngineViewText({ text }: { text: string }): ReactNode {
  const parts = text.split(MODEL_ESTIMATE);
  if (parts.length === 1) return text;
  return parts.map((part, index) => (
    <Fragment key={index}>
      {part}
      {index < parts.length - 1 && <>{' '}<ModelEstimate /></>}
    </Fragment>
  ));
}

const engineText = (text: string) => <EngineViewText text={text} />;

/** The first lines of a view, across its sections, each section keeping its heading. */
function firstLines(sections: QueueItemView['sections'], max: number): QueueItemView['sections'] {
  const kept: QueueItemView['sections'] = [];
  let left = max;
  for (const section of sections) {
    if (left <= 0) break;
    const lines = section.lines.slice(0, left);
    if (lines.length === 0) continue;
    kept.push({ ...section, lines });
    left -= lines.length;
  }
  return kept;
}

export interface CardPreviewOptions {
  /** The thing was not opened in this session yet ("Not watched yet" on a video). */
  unseen: boolean;
  /** Only a big card shows a preview. */
  enabled: boolean;
  /** The open business's plan says it charges tax. Every card but a locked one is of the open business. */
  taxRegistered: boolean;
}

/** Words a model wrote in a preview, quoted, with the label when a number in them has no receipt. */
function Words({ words }: { words: PreviewWords }) {
  return <>{words.text}{words.estimate && <>{' '}<ModelEstimate /></>}</>;
}

/** The receipt source a preview figure names: a CA engine's opens through venture.ca.receipt, the work tools' through
 *  venture.work.get; a price or sum receipt through venture.receipt.get. */
const sourceOf = (figure: PreviewFigure): 'ca' | 'work' | undefined => (figure.receiptKind === 'ca' || figure.receiptKind === 'work' ? figure.receiptKind : undefined);

/** "3 checks passed", "2 of 3 checks passed", and the ones that could not run: the run's own counts. */
function ChecksLine({ checks }: { checks: { passed: number; run: number; notRun: number } }) {
  const t = useT();
  if (checks.run === 0 && checks.notRun === 0) return null;
  const all = checks.passed === checks.run;
  return (
    <p className={s.checks} data-checks="" data-tone={all ? 'done' : 'wait'}>
      <Icon name={all ? 'check' : 'triangle-alert'} size={14} />
      {all ? t('today.preview.checksPassed', { count: String(checks.passed) }) : t('today.preview.checksSome', { passed: String(checks.passed), run: String(checks.run) })}
      {checks.notRun > 0 && <> · {t('today.preview.checksNotRun', { count: String(checks.notRun) })}</>}
    </p>
  );
}

/** A choice preview with no question card: each option, picking one puts its words in the card's answer box. */
function Choices({ preview, extra }: { preview: Extract<QueuePreview, { kind: 'choice' }>; extra: PreviewExtra | undefined }) {
  const t = useT();
  const [value, setValue] = useState<string>();
  const estimates = preview.options.filter((option) => option.estimate);
  return (
    <div className={s.choice}>
      <PreviewFrame
        variant="choice"
        label={preview.question.text}
        options={preview.options.map((option) => ({ id: option.label, label: option.text.text }))}
        value={value}
        onChange={(id) => {
          setValue(id);
          const option = preview.options.find((item) => item.label === id);
          if (option) extra?.answer(option.text.text);
        }}
      />
      {preview.options.some((option) => option.text.estimate) && <p className={s.small}><ModelEstimate /></p>}
      {estimates.map((option) => (
        <p key={option.label} className={s.estimate} data-option-estimate="">
          <Icon name="trending-up" size={14} />
          <span>{t('today.preview.optionEstimate', { label: option.estimate!.label, option: option.label })}</span>
          <ModelEstimate value={option.estimate!.value} />
        </p>
      ))}
    </div>
  );
}

/** The engine's own preview of a row (4J3), drawn as D-Today's `.pv`: video, paper, post or choice. */
function structured(preview: QueuePreview, open: () => void, extra: PreviewExtra | undefined, unseen: boolean, writtenBy: string | null | undefined, t: ReturnType<typeof useT>, line?: string): ReactNode {
  const written = writtenBy ? <p className={s.written} data-written-by="">{writtenBy}</p> : null;
  switch (preview.kind) {
    case 'video':
      return (
        <>
          <PreviewFrame
            variant="video"
            title={preview.title.text}
            unseen={unseen}
            duration={preview.duration?.clock}
            chapters={preview.chapters}
            poster={preview.poster?.src}
            onOpen={open}
          />
          {preview.title.estimate && <p className={s.small}><ModelEstimate /></p>}
          <ChecksLine checks={preview.checks} />
          {written}
        </>
      );
    case 'paper': {
      if (preview.paper === 'invoice') {
        const lines = [...preview.lines, ...(preview.discount ? [preview.discount] : []), ...preview.taxLines].map((line) => ({ label: line.label, value: line.value }));
        return (
          <>
            <PreviewFrame
              variant="paper"
              label={t('today.preview.paperLabel', { title: preview.title, total: preview.total.value })}
              business={preview.from}
              title={preview.title}
              sub={t('today.preview.billedTo', { client: preview.to })}
              lines={lines}
              total={{ label: preview.total.label, value: preview.total.value, receiptId: preview.total.receiptId }}
              tilt
            />
            {written}
          </>
        );
      }
      const proofs = [...new Map(preview.working.map((line) => [line.receiptId, { receiptId: line.receiptId, source: sourceOf(line) }])).values()];
      return (
        <>
          <PreviewFrame
            variant="paper"
            label={preview.title}
            title={preview.title}
            sub={preview.client ?? undefined}
            lines={[...preview.working.map((line) => ({ label: line.label, value: line.value })), ...(preview.more > 0 ? [{ label: t('today.preview.moreLines', { count: String(preview.more) }) }] : [])]}
            proofs={proofs}
          />
          {/* Who signs it, unless the card's line already says so ("until Meera Joshi signs it"). */}
          {preview.signer && !line?.includes(preview.signer.name) && (
            <p className={s.signer} data-signer="">
              <Icon name="stamp" size={14} />
              {t(preview.signer.state === 'with-ca' ? 'today.preview.withCa' : 'today.preview.signs', { name: preview.signer.name })}
            </p>
          )}
          {written}
        </>
      );
    }
    case 'post':
      return (
        <>
          <PreviewFrame variant="post" account={preview.account ?? preview.platform} platform={preview.platform} text={preview.text} />
          {preview.textEstimate && <p className={s.small}><ModelEstimate /></p>}
          {preview.short && (
            <p className={s.short} data-short="">
              <Icon name="play" size={14} />
              <span data-content="">{preview.short.title.text}</span>
              {preview.short.length && <span className="mono">{preview.short.length.clock}</span>}
              {preview.short.title.estimate && <ModelEstimate />}
            </p>
          )}
          {written}
        </>
      );
    case 'choice':
      return (
        <>
          {preview.card
            ? <QuestionCardView card={preview.card} onPick={extra ? (answer) => extra.answer(answer) : undefined} />
            : <Choices preview={preview} extra={extra} />}
          {!preview.card && <p className={s.small} data-content=""><Words words={preview.question} /></p>}
        </>
      );
    default:
      return null;
  }
}

/**
 * The preview a big card shows, built only from what the engine sends (D-Today `.pv`):
 *   - the engine's own preview (W4 4J3, `row.preview`): a video frame with its duration, chapters, the run's check
 *     counts and the still from the cut only when the engine took one; an invoice's paper lines with the total and its
 *     receipt; a CA working paper with its calculator receipt and who signs it; a post's exact text with its short;
 *     a question's options with each model estimate labelled, or an agent's question card with what each answer gains
 *     and costs. A draft's preview names the engine that wrote it ("Written by ...").
 *   - without one, as wave 3 drew it: a draft to watch, a draft's own text (quoted), a plan's text, or a file's first
 *     lines for a business registered for tax (engine lines, since their figures carry no receipts).
 *   - anything else: no preview at all, never an empty frame.
 * Drawing a preview never counts as viewed: only Watch, Read, the title or the play button open the thing.
 */
export function useCardPreview(row: QueueRow, { unseen, enabled, taxRegistered }: CardPreviewOptions): CardPreviewer | undefined {
  const t = useT();
  const ref = row.viewRef;
  const hasOwn = enabled && row.preview !== undefined;
  // Drawing a preview reads the view without `opened`, so the engine keeps no view mark: it is not the owner opening it.
  const watch = ref?.kind === 'draft' && row.actions.some((action) => action.id === 'watch');
  const wanted = enabled && !hasOwn && ref !== undefined && ref.kind !== 'run';
  const view = useResource(
    'venture.queue.view',
    { kind: (ref?.kind ?? 'draft') as QueueItemView['kind'], id: ref?.id ?? '' },
    { skip: !wanted },
  );
  // W4 4J19: who wrote a draft the owner reviews (DeliveryRunView.writtenBy), read with the drafts.
  const isDraft = enabled && row.kind === 'draft' && ref?.kind === 'draft';
  // Today reads the drafts once for every card (drafts.tsx); the approval page's card reads them itself.
  const drafts = useTodayDrafts(isDraft);
  const writtenBy = isDraft ? drafts.runs?.find((run) => run.id === ref?.id)?.writtenBy : undefined;
  // A view's text changes only with a new version of its row (a new digest): read it again then, not on every change
  // in the queue.
  const digest = useRef(row.digest);
  const { reload } = view;
  useEffect(() => {
    if (digest.current === row.digest) return;
    digest.current = row.digest;
    if (wanted) reload();
  }, [row.digest, wanted, reload]);

  if (hasOwn) {
    const preview = row.preview!;
    return (open, extra) => structured(preview, open, extra, unseen, writtenBy, t, row.line);
  }
  const written = writtenBy ? <p className={s.written} data-written-by="">{writtenBy}</p> : null;
  if (!wanted || !ref) return undefined;
  if (watch) {
    const title = view.data?.title ?? row.title;
    return (open) => <><PreviewFrame variant="video" title={title} unseen={unseen} onOpen={open} />{written}</>;
  }

  const data = view.data;
  // A draft whose view is not here still names the engine that wrote it.
  if (!data) return written ? () => written : undefined;
  if (ref.kind === 'draft') {
    if (data.sections.length === 0) return undefined;
    return () => (
      <>
        <div data-content="">
          <PreviewFrame variant="text" view={{ title: data.title, line: data.line, sections: data.sections }} />
        </div>
        {written}
      </>
    );
  }
  // 4Z2: a plan shows its first section only: a second one's heading fell under the fade, cut off and faded. Read opens all.
  const sections = ref.kind === 'file' ? (taxRegistered ? firstLines(data.sections, FILE_LINES) : []) : ref.kind === 'plan' ? data.sections.slice(0, 1) : data.sections;
  if (ref.kind === 'plan' && sections.length === 0) return undefined;
  return () => (
    <div data-engine-line="">
      <PreviewFrame variant="text" view={{ title: data.title, line: data.line, sections }} renderText={engineText} />
    </div>
  );
}
