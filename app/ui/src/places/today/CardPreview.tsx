import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { useResource } from '../../engine/context';
import type { QueueItemView, QueueRow } from '../../engine/types';
import { ModelEstimate } from '../../parts/ModelEstimate';
import { PreviewFrame } from '../../parts/PreviewFrame';

/** What a big card shows to look at: drawn by the card through ApprovalRow's `preview`, which hands it `view`. */
export type CardPreviewer = (view: () => void) => ReactNode;

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

/**
 * The preview a big card shows, built only from what the engine sends (D-Today `.pv`):
 *   - a draft the owner watches (its action is Watch): the video frame with the view's title, "Not watched yet" until
 *     it was watched in this session, and a play button that opens it exactly as Watch does;
 *   - a draft the owner reads: the view's own text (`venture.queue.view`), quoted as written: a draft is the owner's
 *     or the client's words;
 *   - a plan: its text, which is Chausar's own (the plan a model or a template wrote), so it is an engine line, with
 *     each "(model estimate)" the engine marks shown as the label;
 *   - a file: Chausar's own text too (an invoice, the calculator's working). A card shows its title and line, and for
 *     a business registered for tax its first three lines; a business that is not shows no tax figure on a card. The
 *     sheet shows the whole file either way;
 *   - anything else (a run, a price, a setup step): no preview at all, never an empty frame. A price or quote change
 *     is drawn by the card itself.
 * Drawing a preview never counts as viewed: only Watch, Read, the title or the play button open the thing.
 * Frames, durations, chapters, check counts, invoice lines, post text and title choices wait for the engine's own
 * previews (placeholder until W4 4J queue previews); W4 4J1 gives the plan's and file's figures their receipts and
 * removes the engine-line mark.
 */
export function useCardPreview(row: QueueRow, { unseen, enabled, taxRegistered }: CardPreviewOptions): CardPreviewer | undefined {
  const ref = row.viewRef;
  const wanted = enabled && ref !== undefined && ref.kind !== 'run';
  const view = useResource(
    'venture.queue.view',
    { kind: (ref?.kind ?? 'draft') as QueueItemView['kind'], id: ref?.id ?? '' },
    { skip: !wanted },
  );
  // A view's text changes only with a new version of its row (a new digest): read it again then, not on every change
  // in the queue.
  const digest = useRef(row.digest);
  const { reload } = view;
  useEffect(() => {
    if (digest.current === row.digest) return;
    digest.current = row.digest;
    if (wanted) reload();
  }, [row.digest, wanted, reload]);
  if (!wanted || !ref) return undefined;

  if (ref.kind === 'draft' && row.actions.some((action) => action.id === 'watch')) {
    const title = view.data?.title ?? row.title;
    return (open) => <PreviewFrame variant="video" title={title} unseen={unseen} onOpen={open} />;
  }

  const data = view.data;
  if (!data) return undefined;
  if (ref.kind === 'draft') {
    if (data.sections.length === 0) return undefined;
    return () => (
      <div data-content="">
        <PreviewFrame variant="text" view={{ title: data.title, line: data.line, sections: data.sections }} />
      </div>
    );
  }
  const sections = ref.kind === 'file' ? (taxRegistered ? firstLines(data.sections, FILE_LINES) : []) : data.sections;
  if (ref.kind === 'plan' && sections.length === 0) return undefined;
  return () => (
    <div data-engine-line="">
      <PreviewFrame variant="text" view={{ title: data.title, line: data.line, sections }} renderText={engineText} />
    </div>
  );
}
