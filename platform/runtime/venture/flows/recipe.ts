// Chausar venture launcher, recorded flows (wave 6, package 6H2; DECISIONS D41): the recipe as data. The owner does a
// website task once in Chausar's browser window (app/desktop/flow-browser.cjs); what they did comes back as recorded
// events and becomes a recipe of plain steps: open the page, fill a box, tick a box, press a button, a stop for the
// owner, a stop before a submit, payment or post. Each step that touches the page names its control by a few ways to
// find it and a fingerprint of what the control is (never its value). Words the owner typed become blanks, filled
// again on each run; the recorded words are kept only as the dry run's samples until the owner approves the recipe.
// A password, a card number or a one-time code is never kept, not even if a page leaked it into the recording: it is a
// stop where the owner types it in the window. Code reads every control; no model decides what a step is.
import { createHash } from 'node:crypto';
import { check } from '../../contracts.ts';
import { sensitiveKind, type ElementFacts } from '../build/browser.ts';
import { originProblem } from './flow-words.ts';

import type { FlowBlank, FlowCandidate, FlowControl, FlowEffect, FlowSecret, FlowStep, FlowTarget } from './flow-types.ts';
export type { FlowBlank, FlowCandidate, FlowControl, FlowEffect, FlowSecret, FlowStep, FlowTarget, FlowValue } from './flow-types.ts';
export type FlowRecipe = { name: string; origin: string; steps: FlowStep[]; blanks: FlowBlank[] };

/** What the recording window says about one control. The window never reads a secret field's value. */
export type RecordedControl = {
  tag: string; type: string | null; name: string | null; id: string | null; testId: string | null; ariaLabel: string | null;
  labelText: string | null; autocomplete: string | null; role: string | null; inForm: boolean; formAction: string | null;
  text: string; href: string | null; candidates: FlowCandidate[]; fingerprint: string;
};
export type RecordedEvent =
  | { kind: 'open'; url: string }
  | { kind: 'input'; control: RecordedControl; value: string | null }
  | { kind: 'click'; control: RecordedControl }
  | { kind: 'submit'; control: RecordedControl };

/** The most steps one recipe has, and the most words a value or a sample may be. */
export const FLOW_MAX_STEPS = 60;
export const FLOW_MAX_VALUE = 2000;
const MAX_CANDIDATES = 6;
const MAX_LABEL = 120;
const KINDS: readonly FlowCandidate['kind'][] = ['id', 'name', 'test-id', 'aria-label', 'label'];
const CAPTCHA = /captcha|recaptcha|hcaptcha|turnstile|cf-chl/i;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const invalid = (ok: unknown, line: string): void => check(ok, 'FLOW_INVALID', line);

const words = (control: Pick<RecordedControl, 'name' | 'id' | 'labelText' | 'ariaLabel'>) => [control.name, control.id, control.labelText, control.ariaLabel].filter(Boolean).join(' ');

/** Whether a control holds a password, a card detail or a one-time code: by its type, its autocomplete and its words. */
export function secretOf(control: Pick<RecordedControl, 'type' | 'autocomplete' | 'name' | 'id' | 'labelText' | 'ariaLabel'>): FlowSecret | null {
  const auto = (control.autocomplete ?? '').toLowerCase().split(/\s+/);
  const said = words(control);
  if ((control.type ?? '').toLowerCase() === 'password' || auto.includes('current-password') || auto.includes('new-password')) return 'password';
  if (auto.includes('one-time-code') || /\botp\b|one[\s_-]?time|verification[\s_-]?code|passcode/i.test(said)) return 'otp';
  if (auto.some(token => token.startsWith('cc-')) || /card[\s_-]?(?:number|no)\b|cardnumber|\bcvv\b|\bcvc\b|security[\s_-]?code|expiry|\bpin\b/i.test(said)) return 'card';
  if (/password|passwd/i.test(said)) return 'password';
  return null;
}

/** What pressing a submit would do, by the words on the control: pay, post, or another submit. */
export function effectOf(control: Pick<RecordedControl, 'text' | 'ariaLabel' | 'name' | 'id'>): FlowEffect {
  const said = [control.text, control.ariaLabel, control.name, control.id].filter(Boolean).join(' ');
  if (/\b(?:pay|payment|buy|purchase|checkout|check out|place order|order now|donate|subscribe)\b/i.test(said)) return 'pay';
  if (/\b(?:post|publish|tweet|share|send|reply|comment)\b/i.test(said)) return 'post';
  return 'submit';
}

/** The control as browser.ts's gate reads it, so recording and replay hold the same clicks as posting does. */
function factsOf(control: RecordedControl): ElementFacts {
  return {
    tag: control.tag.toLowerCase(), type: control.type ? control.type.toLowerCase() : null, role: control.role, autocomplete: control.autocomplete,
    inForm: control.inForm, href: control.href, download: false, formAction: control.formAction, contentEditable: false,
  };
}

function labelOf(control: RecordedControl, fallback: string): string {
  const raw = control.labelText || control.ariaLabel || (control.tag === 'button' || control.tag === 'a' || control.type === 'submit' ? control.text : '') || control.name || control.id || fallback;
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL) || fallback;
}
function targetOf(control: RecordedControl, fallback: string): FlowTarget {
  return { candidates: control.candidates.slice(0, MAX_CANDIDATES).map(item => ({ kind: item.kind, value: item.value })), fingerprint: control.fingerprint, label: labelOf(control, fallback) };
}
const isBox = (control: RecordedControl) => {
  const tag = control.tag.toLowerCase(), type = (control.type ?? 'text').toLowerCase();
  return tag === 'textarea' || tag === 'select' || (tag === 'input' && !['submit', 'button', 'image', 'reset'].includes(type));
};

/**
 * The recipe a recording makes, and the samples for its dry run. The first event opens the page and sets the site. A
 * click on a box (to focus it) is not a step; typing on the same box again keeps the last words; a password, card or
 * code box is a stop for the owner and its value is dropped; a checkbox or a choice is a fixed value; other typed
 * words are blanks. A press that would submit (browser.ts's own rule, or a control code cannot read) and a submit the
 * window stopped are both a stop before the submit, named pay or post by the button's words. A click that would leave
 * the site, download or ask for a file is left out (skipped counts them).
 */
export function recipeFromRecording(events: readonly RecordedEvent[], options: { name: string }): { recipe: FlowRecipe; samples: Record<string, string>; skipped: number } {
  invalid(Array.isArray(events) && events.length > 1 && events[0]?.kind === 'open', 'A recording starts by opening a page and has at least one step.');
  const first = events[0] as { kind: 'open'; url: string };
  const origin = originOf(first.url);
  const steps: FlowStep[] = [{ kind: 'open', url: first.url }];
  const blanks: FlowBlank[] = [];
  const samples: Record<string, string> = {};
  let skipped = 0;
  for (const event of events.slice(1)) {
    const last = steps[steps.length - 1]!;
    if (event.kind === 'open') { skipped += 1; continue; }
    const control = event.control;
    if (event.kind === 'input') {
      const secret = secretOf(control);
      const sameBox = last.kind !== 'open' && last.kind !== 'gate' && last.kind !== 'click' && last.target.fingerprint === control.fingerprint;
      if (secret) {
        if (!(sameBox && last.kind === 'secret')) steps.push({ kind: 'secret', secret, target: targetOf(control, 'Private field') });
        continue;
      }
      const tag = control.tag.toLowerCase(), type = (control.type ?? '').toLowerCase();
      const kind: FlowControl = tag === 'select' ? 'select' : type === 'checkbox' || type === 'radio' ? 'checkbox' : 'text';
      const value = typeof event.value === 'string' ? event.value.slice(0, FLOW_MAX_VALUE) : '';
      if (sameBox && last.kind === 'fill') {
        if (last.value && 'blank' in last.value) samples[last.value.blank] = value; else last.value = { fixed: kind === 'checkbox' ? (value === 'true' ? 'true' : 'false') : value };
        continue;
      }
      if (kind === 'text') {
        const name = `blank-${blanks.length + 1}`;
        const target = targetOf(control, `Field ${blanks.length + 1}`);
        blanks.push({ name, label: target.label });
        samples[name] = value;
        steps.push({ kind: 'fill', control: kind, target, value: { blank: name } });
      } else {
        steps.push({ kind: 'fill', control: kind, target: targetOf(control, 'Choice'), value: { fixed: kind === 'checkbox' ? (value === 'true' ? 'true' : 'false') : value } });
      }
      continue;
    }
    if (event.kind === 'submit') { steps.push({ kind: 'gate', effect: effectOf(control), target: targetOf(control, 'Submit') }); continue; }
    if (isBox(control)) continue;
    const held = sensitiveKind({ kind: 'click' }, factsOf(control), first.url);
    if (held === 'submit' || held === 'unreadable') { steps.push({ kind: 'gate', effect: effectOf(control), target: targetOf(control, 'Submit') }); continue; }
    if (held !== null) { skipped += 1; continue; }
    steps.push({ kind: 'click', target: targetOf(control, 'Button') });
  }
  const recipe = { name: String(options.name ?? '').trim().slice(0, MAX_LABEL), origin, steps, blanks };
  return { recipe: validateRecipe(recipe), samples, skipped };
}

/** The site a recipe works on: https on a public name, or http on this computer's own loopback address only. */
export function originOf(url: string): string {
  const problem = originProblem(url);
  invalid(problem === null, problem ?? '');
  return new URL(url).origin;
}

function plain(value: unknown, max: number): boolean {
  return typeof value === 'string' && value.length <= max && !CONTROL_CHARS.test(value);
}
function checkTarget(target: FlowTarget, at: number): void {
  invalid(target && Array.isArray(target.candidates) && target.candidates.length > 0 && target.candidates.length <= MAX_CANDIDATES, `Step ${at + 1} needs a way to find its control.`);
  for (const item of target.candidates) invalid(KINDS.includes(item.kind) && plain(item.value, 200) && item.value.trim().length > 0, `Step ${at + 1} has a way to find its control Chausar cannot read.`);
  invalid(typeof target.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(target.fingerprint), `Step ${at + 1} needs its control's fingerprint.`);
  invalid(plain(target.label, MAX_LABEL) && target.label.trim().length > 0, `Step ${at + 1} needs a name for its control.`);
  invalid(![target.label, ...target.candidates.map(item => item.value)].some(text => CAPTCHA.test(text)), 'This step is a CAPTCHA. Chausar never fills or solves one; you do it yourself.');
}

/**
 * Refuses (FLOW_INVALID) a recipe with no name, a site it cannot use, no opening step or one on another site, more
 * than FLOW_MAX_STEPS steps, a control it cannot find or a CAPTCHA, a value on a secret step, or a blank that is not
 * listed or not used. Returns the recipe as given.
 */
export function validateRecipe(recipe: FlowRecipe): FlowRecipe {
  invalid(recipe && typeof recipe === 'object' && plain(recipe.name, MAX_LABEL) && recipe.name.trim().length > 0, 'Give the flow a short name.');
  invalid(originOf(recipe.origin) === recipe.origin, 'A recorded flow works on one site.');
  invalid(Array.isArray(recipe.steps) && recipe.steps.length > 1 && recipe.steps.length <= FLOW_MAX_STEPS, `A recorded flow has between 2 and ${FLOW_MAX_STEPS} steps.`);
  invalid(Array.isArray(recipe.blanks) && recipe.blanks.length <= FLOW_MAX_STEPS, 'Too many blanks.');
  const names = new Set<string>();
  for (const blank of recipe.blanks) {
    invalid(typeof blank?.name === 'string' && /^blank-\d{1,3}$/.test(blank.name) && !names.has(blank.name) && plain(blank.label, MAX_LABEL), 'Each blank needs its own name and a label.');
    names.add(blank.name);
  }
  const used = new Set<string>();
  recipe.steps.forEach((step, at) => {
    if (step.kind === 'open') {
      invalid(at === 0 && plain(step.url, 2048) && originOf(step.url) === recipe.origin, 'A recorded flow opens one page of its own site, first.');
      return;
    }
    invalid(at > 0, 'A recorded flow starts by opening a page.');
    checkTarget(step.target, at);
    if (step.kind === 'fill') {
      invalid(['text', 'select', 'checkbox'].includes(step.control), `Step ${at + 1} fills a control Chausar does not know.`);
      if ('blank' in step.value) { invalid(names.has(step.value.blank), `Step ${at + 1} uses a blank that is not listed.`); used.add(step.value.blank); }
      else invalid(plain(step.value.fixed, FLOW_MAX_VALUE) && (step.control !== 'checkbox' || ['true', 'false'].includes(step.value.fixed)), `Step ${at + 1} has a value Chausar cannot use.`);
    } else if (step.kind === 'secret') {
      invalid(['password', 'card', 'otp'].includes(step.secret) && !('value' in step), 'A password, card number or code is never kept in a flow.');
    } else if (step.kind === 'gate') {
      invalid(['submit', 'pay', 'post'].includes(step.effect), `Step ${at + 1} stops before something Chausar does not know.`);
    } else {
      invalid(step.kind === 'click', `Step ${at + 1} is not a step Chausar knows.`);
    }
  });
  invalid(used.size === names.size, 'Every blank is used by a step.');
  return recipe;
}

/** The fingerprint of a recipe: what the owner approves. Any change to a step, a blank, the site or the name changes it. */
export function recipeDigest(recipe: FlowRecipe): string {
  const canonical = { name: recipe.name, origin: recipe.origin, blanks: recipe.blanks.map(({ name, label }) => ({ name, label })), steps: recipe.steps };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
