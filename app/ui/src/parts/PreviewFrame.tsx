import { useId, type ReactNode } from 'react';
import { useT } from '../text';
import type { QueueChange, QueueItemView } from '../engine/types';
import { initialsOf } from './Avatar';
import { Change } from './Change';
import { cx } from './cx';
import { Figure, type FigureProof } from './Figure';
import { Icon } from './Icon';
import { ModelEstimate } from './ModelEstimate';
import { Receipt } from './Receipt';
import s from './PreviewFrame.module.css';

/** A line on a paper preview: words, and the engine's figure for it when it has one. */
export interface PaperLine { label: string; value?: string | undefined }

/** The total at the foot of a paper preview, with its receipt or the "model estimate" label. */
export type PaperTotal = FigureProof & { label?: string | undefined; value: string };

/** The worked figure under a change: boxes with the engine's words and values, and the signs between them. */
export interface Breakdown {
  parts: readonly { label: string; value: string }[];
  /** The signs between the boxes ("×", "="), one fewer than the boxes. */
  ops?: readonly string[] | undefined;
}

/** A video draft: the dark preview ground, its title and a play button that opens it. No frame is drawn in W3. */
interface VideoPreview {
  variant: 'video';
  title: string;
  /** Not opened in this session yet: shows "Not watched yet". */
  unseen?: boolean | undefined;
  /** The engine's length ("11:42"). */
  duration?: string | undefined;
  chapters?: number | undefined;
  /** Watch: opens the draft. This is the only thing that counts as viewing it; drawing the preview does not. */
  onOpen: () => void;
}

/** A document or invoice as a sheet of paper on the desk. */
interface PaperPreview {
  variant: 'paper';
  /** What the picture shows, in words ("Invoice INV-0042"). */
  label: string;
  /** The business it is from: its name and initials at the head of the sheet. */
  business?: string | undefined;
  /** The document's own number, in DM Mono ("INV-0042"). */
  docRef?: string | undefined;
  title?: string | undefined;
  sub?: string | undefined;
  lines: readonly PaperLine[];
  total?: PaperTotal | undefined;
  /** Lay the sheet slightly askew, as a paper on a desk. */
  tilt?: boolean | undefined;
  onReceipt?: ((id: string) => void) | undefined;
}

/** A price or value changing, as the before and after pill. */
interface ChangePreview {
  variant: 'change';
  change: QueueChange;
  breakdown?: Breakdown | undefined;
  onReceipt?: ((id: string) => void) | undefined;
}

/** What a queue row's view holds (`venture.queue.view`), as text. */
interface TextPreview {
  variant: 'text';
  view: Pick<QueueItemView, 'sections'> & { title?: string | undefined; line?: string | undefined };
  /** The receipt (or "model estimate") that proves the amounts in the view's lines, when the caller has one. It is
   *  shown under the sheet and makes the sheet one figure group; without it any amount in the lines is unproved and
   *  the Ink rules flag it. */
  proof?: FigureProof | undefined;
  onReceipt?: ((id: string) => void) | undefined;
  /** Draws each piece of the view's text (its title, its line and every section line); left out, each is plain text.
   *  Today uses it to show the engine's "(model estimate)" marks as the label. */
  renderText?: ((text: string) => ReactNode) | undefined;
}

/** A question with options to pick from. Picking only reports the choice; the card's Answer sends it. */
interface ChoicePreview {
  variant: 'choice';
  /** The group's name ("Title for episode 15"). */
  label: string;
  options: readonly { id: string; label: string }[];
  value?: string | undefined;
  onChange?: ((id: string) => void) | undefined;
}

/** A post as it will read: the account, where it goes and the words. */
interface PostPreview {
  variant: 'post';
  account: string;
  /** The engine's name for where it goes ("LinkedIn"). */
  platform: string;
  text: string;
}

export type PreviewFrameProps = (VideoPreview | PaperPreview | ChangePreview | TextPreview | ChoicePreview | PostPreview) & {
  className?: string | undefined;
};

/**
 * The preview in a Today card (D's `.pv`): a video draft, a paper sheet, a before and after pill, a view's text, a
 * choice or a post, each drawn only from what the engine sends. A preview drawn at rest never counts as viewed: only
 * the video's Watch button (or the card's own Watch, Read or Open) does, through the handler it calls.
 */
export function PreviewFrame(props: PreviewFrameProps) {
  return (
    <div className={cx(s.frame, props.className)} data-preview={props.variant}>
      {body(props)}
    </div>
  );
}

function body(props: PreviewFrameProps) {
  switch (props.variant) {
    case 'video': return <Video {...props} />;
    case 'paper': return <Paper {...props} />;
    case 'change': return <ChangeBody {...props} />;
    case 'text': return <Text {...props} />;
    case 'choice': return <Choice {...props} />;
    case 'post': return <Post {...props} />;
  }
}

function Video({ title, unseen, duration, chapters, onOpen }: VideoPreview) {
  const t = useT();
  return (
    <>
      {unseen && <span className={s.tag}><Icon name="eye-off" size={12} />{t('preview.notWatched')}</span>}
      {/* The card's heading says the title; here it is part of the picture. */}
      <p className={s.videoTitle} aria-hidden="true" data-content="">{title}</p>
      <button type="button" className={s.play} aria-label={t('preview.watch', { title })} onClick={onOpen}>
        <Icon name="play" size={22} filled />
      </button>
      {chapters !== undefined && <span className={s.chapters} data-chapters="">{t('preview.chapters', { count: chapters })}</span>}
      {duration !== undefined && (
        <span className={s.duration} data-duration="">
          <span className="sr-only">{t('preview.length')} </span>
          <span className="mono">{duration}</span>
        </span>
      )}
    </>
  );
}

function Paper({ label, business, docRef, title, sub, lines, total, tilt, onReceipt }: PaperPreview) {
  const t = useT();
  return (
    <div className={s.paper} data-tilt={tilt ? '' : undefined} data-figure-group={total ? '' : undefined}>
      {/* The sheet is a picture of the document; the total's receipt sits under it, outside the picture, so it stays
          a button a screen reader can reach (nothing inside an image is). The total's proof covers the lines too: the
          sheet is one figure group. Without a total nothing proves the lines, so the Ink rules flag any amount. */}
      <div role="img" aria-label={label}>
        {(business !== undefined || docRef !== undefined) && (
          <p className={s.paperHead}>
            {business !== undefined && <span className={s.paperLogo}>{initialsOf(business)}</span>}
            {business !== undefined && <span className={s.paperBusiness}>{business}</span>}
            {docRef !== undefined && <span className={cx(s.paperRef, 'mono')}>{docRef}</span>}
          </p>
        )}
        {title !== undefined && <p className={s.paperTitle}>{title}</p>}
        {sub !== undefined && <p className={s.paperSub}>{sub}</p>}
        {lines.length > 0 && (
          <ul className={s.paperLines}>
            {lines.map((line, index) => (
              <li key={index} className={s.paperLine}>
                <span>{line.label}</span>
                {line.value !== undefined && <span className="mono">{line.value}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {total && (
        <p className={s.paperTotal}>
          <span>{total.label ?? t('preview.total')}</span>
          {total.estimate
            ? <Figure value={total.value} estimate />
            : <Figure value={total.value} receiptId={total.receiptId} onReceipt={onReceipt} />}
        </p>
      )}
    </div>
  );
}

function ChangeBody({ change, breakdown, onReceipt }: ChangePreview) {
  const t = useT();
  // The change's receipt (or estimate) proves the old and new values and the breakdown under them, as one group.
  const proved = Boolean(change.estimate || change.receiptId);
  return (
    <div className={s.changeGroup} data-figure-group={proved ? '' : undefined}>
      <span className={s.pill}><Change {...change} onReceipt={onReceipt} /></span>
      {breakdown && breakdown.parts.length > 0 && (
        <div className={s.breakdown} role="group" aria-label={t('preview.breakdown')}>
          {breakdown.parts.map((part, index) => {
            const op = index > 0 ? breakdown.ops?.[index - 1] : undefined;
            return (
              <span key={index} className={s.step}>
                {op !== undefined && <span className={s.op} data-op="" aria-hidden="true">{op}</span>}
                <span className={s.box}>
                  <span className={s.boxLabel}>{part.label}</span>
                  <span className="mono">{part.value}</span>
                </span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Text({ view, proof, onReceipt, renderText }: TextPreview) {
  const draw = (text: string) => (renderText ? renderText(text) : text);
  return (
    <div className={s.textGroup} data-figure-group={proof ? '' : undefined}>
      <div className={s.paper} data-sheet="text">
        {view.title !== undefined && <p className={s.paperTitle}>{draw(view.title)}</p>}
        {view.line !== undefined && <p className={s.paperSub}>{draw(view.line)}</p>}
        {view.sections.map((section, index) => (
          <div key={index} className={s.section}>
            {section.heading !== undefined && <p className={s.sectionHeading}>{section.heading}</p>}
            {section.lines.map((line, at) => <p key={at} className={s.sectionLine}>{draw(line)}</p>)}
          </div>
        ))}
      </div>
      {proof && (
        <span className={s.proof} data-proof="">
          {proof.estimate ? <ModelEstimate /> : <Receipt id={proof.receiptId} onOpen={onReceipt} />}
        </span>
      )}
    </div>
  );
}

/** "A", "B", "C": the option's letter by its place in the list. */
function letterOf(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}

function Choice({ label, options, value, onChange }: ChoicePreview) {
  const t = useT();
  const name = useId();
  return (
    <div className={s.choices} role="radiogroup" aria-label={label}>
      {options.map((option, index) => (
        <label key={option.id} className={s.option} data-checked={value === option.id ? '' : undefined}>
          <input
            type="radio"
            className="sr-only"
            name={name}
            value={option.id}
            checked={value === option.id}
            onChange={() => onChange?.(option.id)}
          />
          <span className={s.optionHead}>
            <span className={s.radio} aria-hidden="true" />
            <span className={s.optionKey}>{t('preview.option', { letter: letterOf(index) })}</span>
          </span>
          <span className={s.optionLine} data-content="">{option.label}</span>
        </label>
      ))}
    </div>
  );
}

function Post({ account, platform, text }: PostPreview) {
  const t = useT();
  return (
    <div className={s.post}>
      <p className={s.postHead}>
        <span className={s.postAvatar} aria-hidden="true">{initialsOf(account)}</span>
        <span className={s.postWho}>
          <span className={s.postName}>{account}</span>
          <span className={s.postWhere}>{t('preview.postOn', { platform })}</span>
        </span>
      </p>
      <p className={s.postLine} data-content="">{text}</p>
    </div>
  );
}
