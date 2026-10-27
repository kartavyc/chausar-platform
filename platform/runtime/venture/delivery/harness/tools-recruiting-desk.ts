// Chausar delivery harness: the recruiting-desk playbook's own tools (Recruiting desk; Ink v2 wave 5, packages 5H).
// Package 5-0 registered each name with a stub that answers NOT_BUILT_YET; the package replaces each stub with the
// tool. Only this playbook's roles may hold them (5A1's grants from the definition's tools). Written for Chausar;
// nothing here is learned from an outside source.
import type { ToolName } from '../../contracts.ts';
import { notBuiltTool } from './tool-stub.ts';
import type { Spec } from './tools.ts';

type RecruitingDeskToolName = Extract<ToolName, 'recruit.criteria' | 'recruit.ledger' | 'recruit.slots'>;

export const RECRUITING_DESK_TOOLS: Readonly<Record<RecruitingDeskToolName, Spec>> = Object.freeze({
  'recruit.criteria': notBuiltTool('recruit.criteria', 'compute', 'A role turned into clear screening rules.'), // 5H
  'recruit.ledger': notBuiltTool('recruit.ledger', 'compute', 'The candidate ledger, each decision with quoted proof.'), // 5H
  'recruit.slots': notBuiltTool('recruit.slots', 'compute', 'Interview times that fit both calendars.'), // 5H
});
