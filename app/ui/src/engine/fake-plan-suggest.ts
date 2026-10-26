/**
 * The fake engine's "Add this to {business}" (W4 4J8): venture.blueprint.suggest, answered with the engine's codes,
 * shapes and order (platform/runtime/venture/core/suggest.ts and core/attachment.ts): the payload, the owner's words (10
 * to 2000 characters), the dropped file (at most 200 KB of text; words aimed at the AI or hidden characters leave it out
 * with the engine's line and reason), then the plan (BLUEPRINT_NOT_FOUND), then an AI on the main tier
 * (NO_MODEL_CONNECTED). The suggestion is the fake's own fixed rewording of the summary and customer lines, bound to the
 * plan it read (basedOn); a flagship playbook's offers are never reworded and it never sets a price. It proposes no new
 * offer, though the engine's may (patch.addOffer, which the fake's update takes). Nothing is stored: applying is
 * venture.blueprint.update with basedOn, as on the engine.
 */

import { EngineError, type BlueprintViewLite, type ModelStatusLite, type PlanChangeView, type PlanSuggestionView } from './types';
import type { W4DeskHost } from './fake-w4';

export const FAKE_4J8_METHODS: readonly string[] = ['venture.blueprint.suggest'];

/** The engine's words, word for word. */
const LEFT = 'This can reword your plan and add one offer at a time. It never sets a price: a new offer starts with none, for you to set.';
const NO_AI = 'Connect your AI first. It suggests the change; you apply it.';
const TOO_BIG = 'Chausar reads at most 200 KB of text from a file. Shorten it, or say the rest in your sentence.';
const LEFT_OUT = {
  injection: 'Chausar left out your file: it had words aimed at the AI.',
  hidden: 'Chausar left out your file: it had hidden characters that can hide words.',
} as const;
const MAX_BYTES = 200 * 1024;
/** A few of the engine screen's patterns (policy/untrusted.ts): enough for the fake's own samples. */
const AIMED_AT_AI = /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above)\s+instructions\b|\bmark\s+(?:this|it)\s+as\s+safe\b/i;
const HIDDEN = /[\u200B\u202A-\u202E\u2060-\u2064\u2066-\u2069]/;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);

function fileNote(value: unknown): PlanSuggestionView['attachment'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('Send one request object.');
  const file = value as Record<string, unknown>;
  if (Object.keys(file).some((key) => key !== 'name' && key !== 'text') || !('name' in file) || !('text' in file)) throw invalid('Send the required fields and nothing else.');
  if (typeof file.name !== 'string' || /[\n\r\t]/.test(file.name.trim()) || file.name.trim().length < 1 || file.name.trim().length > 200) throw invalid('The file name must be one line of 1 to 200 characters.');
  if (typeof file.text !== 'string') throw invalid('Send the file as text.');
  if (new TextEncoder().encode(file.text).length > MAX_BYTES) throw new EngineError('UPLOAD_LIMIT', TOO_BIG);
  if (!file.text.trim()) throw invalid('The file has no text in it.');
  if (CONTROL.test(file.text)) throw invalid('The file has characters Chausar cannot read as text.');
  const name = file.name.trim();
  const words = `${name}\n${file.text}`;
  if (AIMED_AT_AI.test(words)) return { name, used: false, line: LEFT_OUT.injection, reason: 'injection' };
  if (HIDDEN.test(words)) return { name, used: false, line: LEFT_OUT.hidden, reason: 'hidden' };
  return { name, used: true, line: null, reason: null };
}

/** venture.blueprint.suggest { text, attachment? }: a suggested change to the open business's plan words. */
export function fakePlanSuggest(host: W4DeskHost, p: Record<string, unknown>): PlanSuggestionView {
  if (Object.keys(p).some((key) => key !== 'text' && key !== 'attachment') || !('text' in p)) throw invalid('Send the required fields and nothing else.');
  if (typeof p.text !== 'string') throw invalid('What you want to add must be text.');
  const text = p.text.replace(/\r\n/g, '\n').trim();
  if (text.length < 10 || text.length > 2000) throw invalid('What you want to add must be between 10 and 2000 characters.');
  const attachment = 'attachment' in p ? fileNote(p.attachment) : undefined;
  const view = host.ask('venture.blueprint.get', {}) as BlueprintViewLite | null;
  if (!view) throw new EngineError('BLUEPRINT_NOT_FOUND', 'Write your plan first.');
  const main = (host.ask('venture.models.status', {}) as ModelStatusLite).tiers.main;
  if (!main || main.presetId === 'built-in-templates' || main.usable === false) throw new EngineError('NO_MODEL_CONNECTED', NO_AI);
  const plan = view.blueprint;
  const oneLiner = `${plan.oneLiner.value.replace(/[.\s]+$/, '')}, with more for clients who ask for it.`;
  const customer = `${plan.customer.value.replace(/[.\s]+$/, '')}, and new clients like them.`;
  const changes: PlanChangeView[] = [
    { field: 'oneLiner', offerId: null, before: plan.oneLiner.value, after: oneLiner, line: `Your one line summary becomes: ${oneLiner}`, estimate: false },
    { field: 'customer', offerId: null, before: plan.customer.value, after: customer, line: `Who it is for becomes: ${customer}`, estimate: false },
  ];
  return {
    basedOn: { blueprintId: plan.id, digest: plan.digest },
    patch: { oneLiner, customer },
    changes,
    ...(attachment ? { attachment } : {}),
    left: LEFT,
    line: `${changes.length} changes to your plan. Nothing changes until you apply them.`,
    callId: null,
  };
}
