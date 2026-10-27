// Chausar playbook kit: the chain's shapes (Ink v2 wave 5, package 5A1). Package 5-0 named them as placeholders; 5A1
// replaces them here, never in contracts.ts. Types only. Written for Chausar; nothing here is learned from an outside
// source.
import type { IsoTime } from '../../contracts.ts';
import type { ManualPathView } from './manual-path.ts';

/** Where one stage of a chain stands: finished, the one at work now, waiting on the client, not started, or stopped. */
export type ChainStageState = 'done' | 'now' | 'waiting' | 'not-started' | 'stopped';

/**
 * One stage as venture.order.chain shows it: its place, its step, what it makes, where it stands, and (5A3) the manual
 * path a person takes while its connector is only planned, or null.
 */
export type ChainStageView = { n: number; stepId: string; title: string; produces: string; state: ChainStageState; manualPath: ManualPathView | null };

/**
 * venture.order.chain's answer: the order's kit offer, its stages with their states, the stage it is at and the line
 * "Stage 2 of 4", where the chain stands, since when, and a note when it waits on the client or stopped.
 */
export type OrderChainView = {
  orderId: string;
  playbook: string;
  offerKey: string;
  stage: number;
  of: number;
  line: string;
  state: 'running' | 'waiting' | 'stopped' | 'done';
  since: IsoTime | null;
  stages: ChainStageView[];
  note: string | null;
};
