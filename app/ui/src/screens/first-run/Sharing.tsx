/**
 * FR-10 The sharing question, asked once after the first receipt (never at install), over
 * learning-ext's registered methods:
 * - `learningx.intakeStatus` says whether intake on Chausar's side is open (closed, intake, or a
 *   demo workspace's test inbox);
 * - "See the exact file" opens `learningx.preview` for the ticked boxes (or both): the exact bytes,
 *   structure only, drawn as text;
 * - with a box ticked, Continue gives consent to exactly that file with `learningx.consent`
 *   ({ previewId, digest }) when intake is open, and only to a file already shown for the ticked
 *   boxes: when none is shown, Continue shows it first and consent needs one more press. Nothing is
 *   sent from here: sending is Trust · Sharing's, under the same consent.
 * Both boxes start empty, and leaving them empty is a plain way on. While intake is closed the
 * ticked boxes say "Sharing is not open yet. Nothing is sent." In a demo workspace a test switch
 * ("Demo test: sends to a test inbox only") must be on before anything is agreed. No feature
 * depends on any box.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../app/text';
import { readIntakeStatus, readSharingConsent, readSharingPreview, SHARE_BOXES, type IntakeStatus, type ShareBox, type SharingPreview } from '../../bridge/r4-contracts.ts';
import { failureOf, type JourneyFailure } from './journey-contracts.ts';
import { Act, Actions, FailureLine, Note } from './JourneyParts';
import type { ComputerPort } from './this-computer.ts';
import s from './Journey.module.css';

type Status = { readonly kind: 'reading' } | { readonly kind: 'known'; readonly value: IntakeStatus } | JourneyFailure;
type File = { readonly kind: 'closed' } | { readonly kind: 'reading' } | { readonly kind: 'shown'; readonly preview: SharingPreview } | { readonly kind: 'nothing' } | JourneyFailure;
type Outcome = null | 'working' | 'review' | 'empty' | 'closed' | 'off' | 'agreed' | JourneyFailure;

export interface SharingQuestionProps {
  readonly rpc: ComputerPort;
  /** Go on, whatever was chosen. */
  readonly onContinue: () => void;
}

export function SharingQuestion({ rpc, onContinue }: SharingQuestionProps) {
  const t = useT();
  const titleId = useId(), testId = useId();
  const [status, setStatus] = useState<Status>({ kind: 'reading' });
  const [boxes, setBoxes] = useState<readonly ShareBox[]>([]);
  const [demoTest, setDemoTest] = useState(false);
  const [file, setFile] = useState<File>({ kind: 'closed' });
  const [outcome, setOutcome] = useState<Outcome>(null);
  /** The boxes the shown file was built for. */
  const shownBoxes = useRef<readonly ShareBox[]>([]);
  useEffect(() => {
    let live = true;
    void rpc.request('learningx.intakeStatus', {}).then(reply => {
      if (!live) return;
      const value = readIntakeStatus(reply);
      setStatus(value === null ? { kind: 'refused', code: 'INVALID_REPLY' } : { kind: 'known', value });
    }, (error: unknown) => { if (live) setStatus(failureOf(error)); });
    return () => { live = false; };
  }, [rpc]);

  const preview = async (chosen: readonly ShareBox[]): Promise<File> => {
    try {
      const value = readSharingPreview(await rpc.request('learningx.preview', { boxes: [...chosen] }));
      return value === null ? { kind: 'refused', code: 'INVALID_REPLY' } : { kind: 'shown', preview: value };
    } catch (error) {
      const failure = failureOf(error);
      return failure.kind === 'refused' && failure.code === 'NOTHING_TO_SHARE' ? { kind: 'nothing' } : failure;
    }
  };
  const showFile = async () => {
    const chosen = boxes.length > 0 ? boxes : SHARE_BOXES;
    setFile({ kind: 'reading' });
    const next = await preview(chosen);
    shownBoxes.current = chosen;
    setFile(next);
  };

  const go = async () => {
    if (status.kind !== 'known') { onContinue(); return; }
    if (boxes.length === 0) { setOutcome('empty'); onContinue(); return; }
    const intake = status.value;
    // Closed intake, or a demo test inbox without its test switch: nothing is agreed and nothing is sent.
    if (!intake.open || (intake.mode === 'test-inbox' && !demoTest)) { setOutcome('closed'); return; }
    if (!intake.sharingSwitch) { setOutcome('off'); return; }
    setOutcome('working');
    // Consent names exactly the file the boxes would send now, and only once that file was shown:
    // a file not yet shown for these boxes is shown first, and agreeing takes one more press.
    if (!(file.kind === 'shown' && sameBoxes(boxes, shownBoxes.current))) {
      const chosen = [...boxes];
      const next = await preview(chosen);
      shownBoxes.current = chosen;
      setFile(next);
      setOutcome(next.kind === 'shown' ? (next.preview.blocked > 0 ? { kind: 'refused', code: 'SHARING_BLOCKED' } : 'review')
        : next.kind === 'nothing' ? 'empty' : next.kind === 'closed' || next.kind === 'reading' ? null : next);
      return;
    }
    const shown = file;
    if (shown.preview.blocked > 0) { setFile(shown); setOutcome({ kind: 'refused', code: 'SHARING_BLOCKED' }); return; }
    try {
      const consent = readSharingConsent(await rpc.request('learningx.consent', { previewId: shown.preview.id, digest: shown.preview.digest }));
      setOutcome(consent !== null && consent.digest === shown.preview.digest ? 'agreed' : { kind: 'refused', code: 'INVALID_REPLY' });
    } catch (error) {
      const failure = failureOf(error);
      setOutcome(failure.kind === 'refused' && failure.code === 'SHARING_DISABLED' ? 'off' : failure.kind === 'refused' && failure.code === 'INTAKE_NOT_OPEN' ? 'closed' : failure);
    }
  };

  if (status.kind === 'reading') return null;
  if (status.kind !== 'known') {
    return (
      <section className={s.section} data-first-run-screen="sharing" data-sharing={status.kind}>
        <FailureLine failure={status} notBuilt="FR-10.notBuilt" refused="FR-10.refused" />
        <Actions><Act variant="filled" label="FR-10.continue.btn" onClick={onContinue} /></Actions>
      </section>
    );
  }
  const intake = status.value;
  const toggle = (box: ShareBox, on: boolean) => { setBoxes(current => on ? SHARE_BOXES.filter(item => item === box || current.includes(item)) : current.filter(item => item !== box)); setOutcome(null); };
  return (
    <section className={s.section} aria-labelledby={titleId} data-first-run-screen="sharing" data-sharing={intake.mode}>
      <h2 id={titleId} className={s.sectionTitle}>{t('FR-10.title')}</h2>
      <p className={s.note}>{t('FR-10.lede')}</p>
      <ul className={s.rows}>
        {SHARE_BOXES.map(box => (
          <li key={box} className={s.row}>
            <label className={s.radioRow}>
              <input type="checkbox" checked={boxes.includes(box)} onChange={event => toggle(box, event.currentTarget.checked)} data-share-box={box} />
              <span className={s.rowName}>{t(`FR-10.box.${box}`)}</span>
            </label>
            <p className={s.note}>{t(`FR-10.box.${box}.note`)}</p>
          </li>
        ))}
      </ul>
      <p className={s.note} data-sharing-others="">{t('FR-10.others')}</p>
      {intake.mode === 'test-inbox' && (
        <label className={s.radioRow} htmlFor={testId}>
          <input id={testId} type="checkbox" checked={demoTest} onChange={event => { setDemoTest(event.currentTarget.checked); setOutcome(null); }} data-sharing-demo-test="" />
          <span>{t('FR-10.demoTest')}</span>
        </label>
      )}
      <Actions><Act variant="link" label="FR-10.file.btn" disabled={file.kind === 'reading'} onClick={() => { void showFile(); }} /></Actions>
      {file.kind === 'shown' && (
        <div data-sharing-file={file.preview.digest}>
          <h3 className={s.sectionTitle}>{t('FR-10.file.title')}</h3>
          <p className={s.note}>{t('FR-10.file.size', { count: String(file.preview.count), size: String(file.preview.size) })}</p>
          <pre className={s.note} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '16rem', overflow: 'auto' }}>{file.preview.bytes}</pre>
          {file.preview.blocked > 0 && <p className={s.problem} role="alert">{t('FR-10.file.blocked')}</p>}
        </div>
      )}
      {file.kind === 'nothing' && <Note k="FR-10.file.nothing" role="status" />}
      {(file.kind === 'not-built' || file.kind === 'refused') && <FailureLine failure={file} notBuilt="FR-10.notBuilt" refused="FR-10.refused" />}
      {outcome === 'closed' && <p className={s.status} role="status" data-sharing-outcome="closed">{t('FR-10.closed')}</p>}
      {outcome === 'off' && <p className={s.status} role="status" data-sharing-outcome="off">{t('FR-10.off')}</p>}
      {outcome === 'agreed' && <p className={s.status} role="status" data-sharing-outcome="agreed">{t('FR-10.agreed')}</p>}
      {outcome === 'empty' && <p className={s.status} role="status" data-sharing-outcome="empty">{t('FR-10.empty')}</p>}
      {outcome === 'review' && <p className={s.status} role="status" data-sharing-outcome="review">{t('FR-10.reviewFirst')}</p>}
      {outcome !== null && typeof outcome === 'object' && <FailureLine failure={outcome} notBuilt="FR-10.notBuilt" refused="FR-10.refused" />}
      <Actions>
        {outcome === 'closed' || outcome === 'off' || outcome === 'agreed' || (outcome !== null && typeof outcome === 'object')
          ? <Act variant="filled" label="FR-10.continue.btn" onClick={onContinue} />
          : <Act variant="filled" label="FR-10.continue.btn" disabled={outcome === 'working'} onClick={() => { void go(); }} />}
      </Actions>
    </section>
  );
}

const sameBoxes = (a: readonly ShareBox[], b: readonly ShareBox[]) => a.length === b.length && a.every(box => b.includes(box));
