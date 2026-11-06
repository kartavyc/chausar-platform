// Chausar venture launcher, recorded flows (wave 6, package 6H2; DECISIONS D41): exact replay with no AI. The recipe
// runs step by step in Chausar's own browser window through a small port (the desktop's flow-browser.cjs, over the
// engine worker's channel; flows/port.ts). Before each step the control must match exactly one visible element with
// the very fingerprint the recording kept; anything else is a changed page and the run stops there. A filled box must
// show exactly the words put in. A press the page now treats as a submit is never made without approval. A password,
// card or code box stops for the owner to type it in the window. A submit, payment or post stops the run before it is
// pressed, for that run's own approval through the exact-approval journal (flows/methods.ts); a dry run ends there.
// After each step the page is checked: a CAPTCHA or a security check is a hard stop (browser.ts pageStop), never
// solved or worked around, and a page that left the recipe's site is a changed page.
import { check } from '../../contracts.ts';
import { pageStop, type BrowserScript } from '../build/browser.ts';
import { FLOW_MAX_VALUE, type FlowControl, type FlowEffect, type FlowRecipe, type FlowSecret, type FlowTarget, type RecordedEvent, type FlowCandidate } from './recipe.ts';

/** What the window says about a target now: how many visible elements match, and the first match's facts. */
export type FlowFind = { count: number; fingerprint: string | null; submitLike: boolean; secret: boolean; filled: boolean };
/** What the page itself shows: its address, its title, and whether a CAPTCHA frame or widget is on it. */
export type FlowPageFacts = { url: string; title: string; captcha: boolean };
export type { FlowControlOption } from './flow-types.ts';
import type { FlowControlOption } from './flow-types.ts';

/** Chausar's browser window for recorded flows. runId ties every call to the one window open for that run. */
export type FlowBrowserPort = {
  /** Opens the recording window at url and answers once the owner pressed Done or closed it. */
  record(runId: string, url: string): Promise<{ events: RecordedEvent[] }>;
  open(runId: string, url: string): Promise<FlowPageFacts>;
  find(runId: string, target: FlowTarget): Promise<FlowFind>;
  fill(runId: string, target: FlowTarget, control: FlowControl, value: string): Promise<{ shown: string | null }>;
  /** approved: this is the submit the owner approved for this run; anything that submits is refused without it. */
  click(runId: string, target: FlowTarget, approved: boolean): Promise<{ facts: FlowPageFacts; answered: boolean; blocked?: boolean }>;
  facts(runId: string): Promise<FlowPageFacts>;
  controls(runId: string): Promise<FlowControlOption[]>;
  close(runId?: string): Promise<void>;
};

export type ReplayStop =
  | { outcome: 'done'; line: string }
  | { outcome: 'tested'; gate: number | null; line: string }
  | { outcome: 'held'; step: number; effect: FlowEffect; line: string }
  | { outcome: 'needs-you'; step: number; secret: FlowSecret; line: string }
  | { outcome: 'changed'; step: number; line: string }
  | { outcome: 'challenge'; step: number; line: string };

const EFFECT_WORDS: Readonly<Record<FlowEffect, string>> = Object.freeze({ submit: 'submit', pay: 'payment', post: 'post' });
const SECRET_WORDS: Readonly<Record<FlowSecret, string>> = Object.freeze({ password: 'password', card: 'card details', otp: 'one-time code' });
const SITE_SCRIPT = { connectorId: 'site', challengePaths: [] } as unknown as BrowserScript;

/** The line a run stopped before a submit says. */
export function heldLine(label: string, effect: FlowEffect): string {
  return `Chausar stopped before ${label}. Approve this exact ${EFFECT_WORDS[effect]} to go on.`;
}

/** Refuses (FLOW_INVALID) values that are not exactly one plain string for each blank of the recipe. */
export function checkValues(recipe: FlowRecipe, values: unknown): Record<string, string> {
  check(values && typeof values === 'object' && !Array.isArray(values), 'FLOW_INVALID', 'Give a value for each blank.');
  const given = values as Record<string, unknown>;
  const names = recipe.blanks.map(blank => blank.name);
  check(Object.keys(given).length === names.length && names.every(name => Object.hasOwn(given, name)), 'FLOW_INVALID', 'Give a value for each blank, and nothing else.');
  for (const name of names) check(typeof given[name] === 'string' && (given[name] as string).length <= FLOW_MAX_VALUE && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(given[name] as string), 'FLOW_INVALID', 'Each value is plain text.');
  return Object.fromEntries(names.map(name => [name, given[name] as string]));
}

/** Why a page stops the run, or null: a CAPTCHA or a check page, or an address off the recipe's site. */
function pageProblem(facts: FlowPageFacts, recipe: FlowRecipe, step: number): ReplayStop | null {
  if (facts.captcha || pageStop({ url: facts.url, status: null, title: facts.title, notice: '' }, SITE_SCRIPT)) {
    return { outcome: 'challenge', step, line: 'The site showed a CAPTCHA or a security check. Chausar never solves one, so it stopped. Clear it yourself and run the flow again.' };
  }
  let origin = '';
  try { origin = new URL(facts.url).origin; } catch { origin = ''; }
  if (origin !== recipe.origin) return { outcome: 'changed', step, line: `The page left ${recipe.origin}, so Chausar stopped.` };
  return null;
}

/** Whether the target is the very control the recording saw: exactly one visible match with the same fingerprint. */
async function same(port: FlowBrowserPort, runId: string, target: FlowTarget): Promise<FlowFind | null> {
  const found = await port.find(runId, target);
  return found.count === 1 && found.fingerprint === target.fingerprint ? found : null;
}
const changed = (step: number, label: string): ReplayStop => ({ outcome: 'changed', step, line: `The page changed at "${label}". Chausar stopped; nothing after it was done.` });

/**
 * Runs the recipe from step from (0 opens the page) until it ends, stops or waits. mode 'dry' is the test before
 * approval: it ends at the first submit, unpressed. mode 'run' waits there for that run's approval. Nothing here asks a
 * model anything; every value comes from values, exactly as given.
 */
export async function replayFlow(input: { port: FlowBrowserPort; runId: string; recipe: FlowRecipe; values: Record<string, string>; mode: 'dry' | 'run'; from?: number }): Promise<ReplayStop> {
  const { port, runId, recipe, mode } = input;
  const values = checkValues(recipe, input.values);
  const from = input.from ?? 0;
  check(Number.isInteger(from) && from >= 0 && from <= recipe.steps.length, 'FLOW_INVALID', 'Start from a step of this flow.');
  for (let at = from; at < recipe.steps.length; at += 1) {
    const step = recipe.steps[at]!;
    if (step.kind === 'open') {
      const problem = pageProblem(await port.open(runId, step.url), recipe, at);
      if (problem) return problem;
      continue;
    }
    const found = await same(port, runId, step.target);
    if (!found) return changed(at, step.target.label);
    if (step.kind === 'secret') {
      if (!found.filled) return { outcome: 'needs-you', step: at, secret: step.secret, line: `Type your ${SECRET_WORDS[step.secret]} in the Chausar window at "${step.target.label}", then press Continue. Chausar never types or keeps it.` };
      continue;
    }
    if (step.kind === 'gate') {
      if (mode === 'dry') return { outcome: 'tested', gate: at, line: `The test reached ${step.target.label} and stopped before it. Nothing was sent.` };
      return { outcome: 'held', step: at, effect: step.effect, line: heldLine(step.target.label, step.effect) };
    }
    if (step.kind === 'fill') {
      if (found.secret || found.submitLike) return changed(at, step.target.label);
      const value = 'blank' in step.value ? values[step.value.blank]! : step.value.fixed;
      const { shown } = await port.fill(runId, step.target, step.control, value);
      if (shown !== value) return changed(at, step.target.label);
    } else {
      // A press the page now treats as a submit waits for approval like any submit: the page changed.
      if (found.submitLike) return changed(at, step.target.label);
      let pressed: Awaited<ReturnType<FlowBrowserPort['click']>>;
      try { pressed = await port.click(runId, step.target, false); } catch (error) {
        if ((error as { code?: string }).code === 'FLOW_HELD' || (error as { code?: string }).code === 'FLOW_CHANGED') return changed(at, step.target.label);
        throw error;
      }
      // The window cancelled a send the press tried: it is a submit now, and waits for approval like one.
      if (pressed.blocked) return { outcome: 'changed', step: at, line: `"${step.target.label}" tried to send something. Chausar stopped it; nothing was sent.` };
      const problem = pageProblem(pressed.facts, recipe, at);
      if (problem) return problem;
      continue;
    }
    const problem = pageProblem(await port.facts(runId), recipe, at);
    if (problem) return problem;
  }
  return mode === 'dry' ? { outcome: 'tested', gate: null, line: 'The test ran every step. Nothing was sent.' } : { outcome: 'done', line: 'Every step ran.' };
}

/**
 * The approved press itself: the gate's control is found again with its fingerprint right before the press, then
 * beforePress runs (the caller's last check, and the moment the press may have happened), and only then the control is
 * pressed with approved true. null when nothing was pressed: the page changed, the window closed before the press, or
 * the window refused the press before making it. An error after beforePress means the press may have happened.
 */
export async function pressApproved(port: FlowBrowserPort, runId: string, recipe: FlowRecipe, at: number, beforePress: () => void): Promise<{ facts: FlowPageFacts; answered: boolean } | null> {
  const step = recipe.steps[at];
  check(step?.kind === 'gate', 'FLOW_HELD', 'Only a stop before a submit is approved this way.');
  try { if (!await same(port, runId, step.target)) return null; } catch { return null; }
  beforePress();
  try { return await port.click(runId, step.target, true); } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'FLOW_HELD' || code === 'FLOW_CHANGED') return null;
    throw error;
  }
}
