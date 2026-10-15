/**
 * BK-04 "Bring a file": the same FR-07 screen, reached from a place (Books · Sources). The host
 * binds its engine port and its file chooser (`imports.pickFile` on the desktop, `<input
 * type=file>` in the browser) and hands a place `bringFile(options)` through `PlaceRenderProps`;
 * the place draws what it returns where it wants the flow. Outside first run the meanings are
 * already agreed, so a file is never held: a `DICTIONARY_REQUIRED` refusal is shown as a failure.
 * The words are the first-run catalogue, layered here so any place can draw it.
 */

import { useMemo } from 'react';
import type { Language } from '../../app/presentation.ts';
import { BringFile, type PickedFile } from './BringFile';
import { proposalCache } from './proposals.ts';
import type { JourneyPort } from './journey-contracts.ts';
import { FirstRunText } from './text';

/** What a place may pass to `bringFile`. */
export interface BringFileOptions {
  /** Called once each time a file is taken in, after the person presses Continue. */
  readonly onTaken?: (() => void) | undefined;
}

export interface BringFileFlowProps extends BringFileOptions {
  readonly rpc: JourneyPort;
  readonly language: Language;
  /** The workspace name, the scope of a picked-columns recipe. */
  readonly company: string;
  /** The host's chooser; absent in the browser, where a file input is drawn. */
  readonly pickFile?: (() => Promise<PickedFile | null>) | undefined;
}

const ignore = () => {};

export function BringFileFlow({ rpc, language, company, pickFile, onTaken }: BringFileFlowProps) {
  // One draft of proposed meanings per sheet while this flow is drawn.
  const propose = useMemo(() => proposalCache(rpc), [rpc]);
  return (
    <FirstRunText language={language}>
      <BringFile rpc={rpc} pickFile={pickFile} held={null} onHold={ignore} meaningsAgreed company={company}
        onTaken={onTaken ?? ignore} onWaits={ignore} propose={propose} inPlace />
    </FirstRunText>
  );
}
