/**
 * What Today is given (TD-01, TD-02, TD-03). One typed contract for all three views: a
 * view changes how much is on the screen and how you move, never what is true. The
 * adapter fills what the engine supplied; whatever is absent shows its missing words.
 * Nothing here is sample data. The only sample lives in fixture.ts and is labelled so.
 *
 * The first six fields are what the checked projection (bridge/project-ui.ts) returns
 * for Today, and its result assigns here as it is. The rest (cash, the Books queue, the
 * close, the enterprise additions, setup and update) need their own engine adapters and
 * stay absent until those supply them.
 */

import type { Chart, ColumnsChart, Count, DayEvent, Figure, FigureOrMissing, Lens, Mark, Missing, RowItem, ScreenState, StatTile } from '../../app/presentation.ts';
import type { ClosingReply, WorthReply } from '../../bridge/todayx-contract.ts';
import type { CashVoiceCapability } from './voice-cash.ts';

export interface TodayReview {
  /** The count across the whole app. Not known is its missing word, never zero. */
  readonly count?: Count;
  /** Up to four rows at rest. */
  readonly rows: ReadonlyArray<RowItem>;
  /** When the engine cut the list: the total, for "See all 7". */
  readonly total?: Count;
  /** Exact scoped coverage; none of these counts is a whole-product total. */
  readonly scoped?: { readonly completeness: 'complete' | 'incomplete' | 'unavailable'; readonly count: number | null; readonly knownCount: number | null; readonly hasMore: boolean };
}

/** Books view: one row of the queue table. */
export interface BooksQueueRow {
  readonly id: string;
  readonly mark: Mark;
  readonly markWordsKey?: string;
  readonly what: string;
  readonly party?: string;
  readonly partyMissing?: Missing;
  /** Narration as written in the source, shown unchanged in the number face. */
  readonly asWritten?: string;
  readonly amount?: FigureOrMissing;
  readonly since: string;
  /** Who decides: a text key suffix. */
  readonly then: 'you' | 'owner' | 'waiting';
}

/** The four fixed steps of the month's close (TD-03), in their order. */
export type CloseStepKind = 'bank' | 'gstr2b' | 'tds' | 'trial-balance';
export const CLOSE_STEP_ORDER: ReadonlyArray<CloseStepKind> = ['bank', 'gstr2b', 'tds', 'trial-balance'];
/** A close step's state as a code; the screen gives its words and its square. */
export type CloseStepState = 'done' | 'in-progress' | 'not-started' | 'needs-you' | 'not-applicable' | 'not-loaded-yet' | 'failed';

export interface CloseStep {
  readonly id: string;
  readonly mark: Mark;
  /** Which fixed step this is. With it, the name comes from the text file. */
  readonly step?: CloseStepKind;
  /** The step's state as a code, drawn as words beside its square. */
  readonly state?: CloseStepState;
  /** Why a step does not apply, as a code: "composition" (no GSTR-2B to match). */
  readonly notApplicable?: 'composition';
  /** A name supplied by the adapter, for a step outside the four fixed ones. */
  readonly name?: string;
  /** The state in words or figures, from the engine: "28 of 31 lines", "not loaded yet". */
  readonly status?: string;
  readonly statusMono?: boolean;
  readonly action?: { readonly label: string; readonly onPress: () => void };
  /** A thin progress mark drawn as a chart, when the engine supplied one. */
  readonly chart?: Chart;
}

export interface TodayEnterprise {
  readonly lens: Lens;
  /** "Changed since Monday": one row per material change. */
  readonly changedSince?: { readonly since: string; readonly rows: ReadonlyArray<RowItem> };
  /** The quiet line: "9 other objectives: no material change", from the adapter. */
  readonly quietLines?: ReadonlyArray<string>;
}

export interface TodayData {
  readonly state: ScreenState;
  /** "Wednesday, 30 September", from the format module. */
  readonly date: string;
  readonly review: TodayReview;
  /** Up to five rows; review rows and these together never show more than five at rest. */
  readonly worthALook?: ReadonlyArray<RowItem>;
  /** `todayx.worthALook`, checked with `isWorthReply` by the host. When present it is the
   *  worth-a-look section, projected by worth.ts; `worthALook` is then not drawn. */
  readonly worth?: WorthReply;
  /** Guided: "This month", three stat charts. Missing as a whole shows its words. */
  readonly thisMonth?: ReadonlyArray<StatTile>;
  readonly thisMonthMissing?: Missing;
  /** Guided: "Earlier today", up to six marks. */
  readonly earlierToday?: ReadonlyArray<DayEvent>;
  /** An unavailable activity contract cannot imply that nothing happened. */
  readonly earlierTodayMissing?: Missing;
  /** Setup not finished: "Setup: step 5 of 6". Display strings. Continue is shown only
   *  when the engine offered it here and the adapter supplied `onResumeSetup`. */
  readonly setup?: { readonly step: string; readonly of: string; readonly can?: ReadonlyArray<'continue'> };
  /** An update is ready. Update is shown only when offered here and `onUpdate` is supplied. */
  readonly update?: { readonly can?: ReadonlyArray<'update'> };
  /** Simple: today's cash sales and the week's cash as bars. */
  readonly cash?: {
    /** Entered today: the figure the owner said, labelled told by owner. */
    readonly entered?: Figure;
    readonly week: ColumnsChart;
  };
  /** Books: the queue as a table, and the month's close. */
  readonly queue?: ReadonlyArray<BooksQueueRow>;
  readonly close?: { readonly month: string; readonly steps: ReadonlyArray<CloseStep> };
  /** Books: the one quiet line for what waits on someone else ("Waiting for the owner:
   *  3 reminders you prepared"). `holder` and `what` are display strings from the adapter.
   *  These items are not in this seat's count. */
  readonly waiting?: { readonly holder: string; readonly what: string };
  readonly enterprise?: TodayEnterprise;
  /** `todayx.closing`, checked with `isClosingReply` by the host. Drawn only while it is on. */
  readonly closing?: ClosingReply;
  readonly cashMissing?: Missing;
  readonly queueMissing?: Missing;
  readonly closeMissing?: Missing;
  readonly enterpriseMissing?: Missing;
}

export interface TodayIntents {
  /** The Review button on an opened row. The origin is the row, for focus return. */
  onReview: (rowId: string, origin: HTMLElement | null) => void;
  onPrepare?: ((rowId: string) => void) | undefined;
  onPrepareTiles?: ((origin: HTMLElement | null) => void) | undefined;
  readonly preparingTiles?: boolean;
  /** A worth-a-look row opens its receipt or its page. */
  onOpenRow?: ((rowId: string, origin: HTMLElement | null) => void) | undefined;
  /** Required: every figure and every chart mark on Today opens its receipt. */
  onReceipt: (receiptId: string, origin?: HTMLElement | SVGElement | null) => void;
  onOpenTile?: ((tileId: string, origin: HTMLElement | null) => void) | undefined;
  onOpenActivity?: (() => void) | undefined;
  onOpenEvent?: ((eventId: string, origin: HTMLElement | null) => void) | undefined;
  onSeeAll?: (() => void) | undefined;
  onResumeSetup?: (() => void) | undefined;
  onUpdate?: (() => void) | undefined;
  /** Simple: the day's cash, as something the owner said. The text is data. */
  onSaveClosing?: ((text: string) => void) | undefined;
  /** Daily closing on or off (`todayx.closing.set`). Supplied only to a seat that may change it. */
  onSetClosing?: ((on: boolean) => void) | undefined;
  /** Simple: the day's cash by voice (TD-02, SH-05). Off unless supplied with `on: true`. */
  cashVoice?: CashVoiceCapability | undefined;
  /** Books: a queue row opens its sheet. */
  onOpenQueueRow?: ((rowId: string, origin: HTMLElement | null) => void) | undefined;
  onLens?: ((lens: Lens) => void) | undefined;
}

/** Review rows and worth-a-look rows together never show more than five at rest. */
export const TODAY_REVIEW_MAX = 4;
export const TODAY_ATTENTION_MAX = 5;
