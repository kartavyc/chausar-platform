// Chausar venture launcher, recorded flows (wave 6, package 6H2; DECISIONS D41): the two records and their views. A
// venture-flow is one version of one recorded flow: draft (recorded or repaired, not yet tested and approved),
// approved (the one version that runs), or replaced (an older approved version). A venture-flow-run is one dry run or
// one run of a version. The words the owner typed while recording stay only as a draft's samples, for its dry run, and
// go at approval; a run's values live in memory beside its open window, and the vault keeps only the review the owner
// approves at a stop (each blank's label and value), until the run ends.
import type { IsoTime, RecordBase } from '../contracts.ts';
import type { FlowBlank, FlowControlOption, FlowDryRun, FlowHeld, FlowRunState, FlowRunView, FlowState, FlowStep, FlowVersionView } from './flow-types.ts';
export type { FlowDryRun, FlowHeld, FlowRunState, FlowRunView, FlowState, FlowVersionView, FlowsActPayload, FlowsActView, FlowsListView } from './flow-types.ts';

export type FlowRecord = RecordBase<'venture-flow'> & {
  flowId: string;
  version: number;
  name: string;
  origin: string;
  steps: FlowStep[];
  blanks: FlowBlank[];
  /** recipeDigest: what the owner approves. */
  digest: string;
  state: FlowState;
  /** 'ai' when the owner's AI tool proposed this version (a repair); it is approved like any other. */
  proposedBy: 'owner' | 'ai';
  repairOf: { version: number; step: number } | null;
  /** The recorded words for the dry run, by blank. null once approved, and for a repair. */
  samples: Record<string, string> | null;
  dryRun: FlowDryRun | null;
  approvedAt: IsoTime | null;
  approvedBy: string | null;
};

export type FlowRunRecord = RecordBase<'venture-flow-run'> & {
  flowId: string;
  version: number;
  recipeDigest: string;
  mode: 'dry' | 'run';
  state: FlowRunState;
  /** The step it stopped or waits at (0 based). */
  step: number;
  line: string;
  held: FlowHeld | null;
  /** After a changed page: the controls on the page then, for a repair. Never a value. */
  repairOptions: FlowControlOption[] | null;
  journalEntryId: string | null;
  endedAt: IsoTime | null;
};


export function flowView(record: FlowRecord): FlowVersionView {
  const { kind: _k, ventureId: _v, memberId: _m, epoch: _e, samples, ...rest } = record;
  return structuredClone({ ...rest, hasSamples: !!samples && Object.keys(samples).length > 0 });
}
export function runView(record: FlowRunRecord): FlowRunView {
  const { kind: _k, ventureId: _v, memberId: _m, epoch: _e, ...rest } = record;
  return structuredClone(rest);
}
