// Chausar playbook kit: a kit playbook's committed judge baseline (Ink v2 wave 5, package 5A1; plan "What every
// playbook ships": a committed judge baseline scored by code with no model, the rate only rises). Each playbook keeps
// playbooks/<id>/baselines/<id>.json: its held-back cases, each a request and a reference draft, and the pass rate they
// reached. runKitBaseline scores every case with the definition's own score function and fails when the rate drops
// below the committed one; rates are compared by cross-multiplying whole counts, as delivery/judge/baseline.ts does.
// Idea from delivery/judge/baseline.ts (Chausar's own, after Countersign's committed baselines, AGPL-3.0, ideas only).
import { readFileSync } from 'node:fs';
import { ChausarError } from '../../../contracts.ts';
import type { KitBaselineCase, PlaybookDefinition } from './define.ts';

export type KitBaselineFile = { version: 1; playbook: string; recordedAt: string; baseline: { passed: number; of: number }; cases: KitBaselineCase[] };
export type KitBaselineResult = {
  playbook: string; passed: number; of: number; baseline: { passed: number; of: number }; ok: boolean;
  cases: { id: string; pass: boolean; why: string }[]; detail: string;
};

const ID = /^[a-z][a-z0-9-]{0,59}$/;

/** A baseline file, checked against its playbook: version 1, its id, unique cases, and a rate that counts exactly them. */
export function validateKitBaseline(definition: Pick<PlaybookDefinition, 'registration'>, raw: unknown): KitBaselineFile {
  const id = definition.registration.id;
  const bad = (why: string): never => { throw new ChausarError('PLAYBOOK_DEFINITION_INVALID', `The ${id} playbook's baseline: ${why}`); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('the file is not an object.');
  const file = raw as Partial<KitBaselineFile>;
  if (file.version !== 1) bad('the file must be version 1.');
  if (file.playbook !== id) bad(`the file is for ${String(file.playbook)}, not ${id}.`);
  if (typeof file.recordedAt !== 'string' || !file.recordedAt) bad('the file must say when it was recorded.');
  if (!Array.isArray(file.cases) || !file.cases.length) bad('the file needs at least one case.');
  const cases = file.cases as KitBaselineCase[];
  for (const item of cases) {
    if (!item || typeof item.id !== 'string' || !ID.test(item.id)) bad('each case needs a short lowercase id.');
    if (typeof item.request !== 'string' || !item.request.trim() || typeof item.draft !== 'string' || !item.draft.trim()) bad(`the case ${item.id} needs its request and draft.`);
  }
  if (new Set(cases.map(item => item.id)).size !== cases.length) bad('two cases share an id.');
  const rate = file.baseline;
  if (!rate || !Number.isInteger(rate.passed) || rate.of !== cases.length || rate.passed < 0 || rate.passed > rate.of) bad('the committed rate must count exactly its cases.');
  return { version: 1, playbook: id, recordedAt: file.recordedAt!, baseline: { passed: rate!.passed, of: rate!.of }, cases: cases.map(item => ({ ...item })) };
}

/** A playbook's committed baseline, read from playbooks/<id>/<folder>/<id>.json and checked. */
export function loadKitBaseline(definition: Pick<PlaybookDefinition, 'registration' | 'baseline'>): KitBaselineFile {
  const id = definition.registration.id;
  const url = new URL(`../${id}/${definition.baseline.folder}/${id}.json`, import.meta.url);
  return validateKitBaseline(definition, JSON.parse(readFileSync(url, 'utf8')));
}

/**
 * Scores every case with the definition's score function (code, no model). draftOf: the draft to score for a case;
 * default its reference draft. ok when the pass rate is at or above the committed one.
 */
export function runKitBaseline(
  definition: Pick<PlaybookDefinition, 'registration' | 'baseline'>,
  file: KitBaselineFile = loadKitBaseline(definition),
  draftOf: (item: KitBaselineCase) => string = item => item.draft,
): KitBaselineResult {
  const checked = validateKitBaseline(definition, file);
  const cases = checked.cases.map(item => {
    const scored = definition.baseline.score(item, draftOf(item), item.meta ?? {});
    return { id: item.id, pass: scored.pass === true, why: scored.why };
  });
  const passed = cases.filter(item => item.pass).length;
  const of = cases.length;
  const { baseline } = checked;
  // passed / of >= baseline.passed / baseline.of, in whole counts.
  const ok = passed * baseline.of >= baseline.passed * of;
  const detail = `${passed} of ${of} cases passed, ${ok ? 'at or above' : 'below'} the committed ${baseline.passed} of ${baseline.of}.`;
  return { playbook: checked.playbook, passed, of, baseline, ok, cases, detail };
}
