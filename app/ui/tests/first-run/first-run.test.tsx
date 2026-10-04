import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Language, View } from '../../src/app/presentation.ts';
import type { UiContext } from '../../src/host/contracts.ts';
import buttonStyles from '../../src/parts/Button.module.css';
import { FirstRunScreen } from '../../src/screens/first-run/FirstRun';
import type { FirstRunIntents, FirstRunStagesDone } from '../../src/screens/first-run/FirstRun';
import { createFirstRunController, summaryOf } from '../../src/screens/first-run/controller.ts';
import type { FirstRunController, FirstRunHandoff, FirstRunState } from '../../src/screens/first-run/controller.ts';
import type { DictionaryDraft } from '../../src/screens/first-run/contracts.ts';
import { acceptRow, acceptSettings, changeMeaning, pinOf, startReview, withDigest } from '../../src/screens/first-run/review.ts';
import type { Review } from '../../src/screens/first-run/review.ts';
import { PREVIEW_WORDS_BY_VIEW } from '../../src/screens/first-run/rows';
import { LOCAL, localCatalogueGaps, localKeyCollisions } from '../../src/screens/first-run/text';
import { MEMBER_ID, MEMBER_NAME, WORKSPACE, deferred, engine, guard, issued, nodeDigest, settle, syntheticEngine } from './fixture.ts';
import type { SyntheticEngine, TestGuard } from './fixture.ts';

/**
 * Real React composition with the synthetic Engine port (the frozen Engine's packs and
 * compiler through the fixture boundary; no transport, vault, model or business facts).
 * jsdom computes no layout: these checks qualify behavior, words and roles, not pixels,
 * fonts, Hindi reading or a live host.
 */
const en = LOCAL.en;
const hi = LOCAL.hi;
/** Every local key drawn inside an action Button. The shared checker resolves literal Button ids against the shared catalogue only, so these are checked here. */
const BUTTON_KEYS = ['FR-08.row.accept', 'FR-08.publish', 'FR-08.edit.save', 'FR-08.edit.discard', 'FR-08.changePack', 'FR-08.reconcile', 'FR.again'];
const VIEWS: readonly View[] = ['simple', 'guided', 'books'];
/** build.md part 4: the words in the main area of a screen at rest. */
const BUDGET: Readonly<Record<View, number>> = { simple: 90, guided: 120, books: 170 };
const ALL_DONE: FirstRunStagesDone = { you: true, vault: true, model: true, books: true };
const OK = Object.freeze({ ok: true } as const);
const disposals: (() => void)[] = [];
const errors: unknown[][] = [];
const must = <T,>(value: T | null | undefined, what = 'value'): T => { if (value === null || value === undefined) throw new Error(`missing ${what}`); return value; };
const text = (language: Language, key: string): string => must(LOCAL[language][key], key);
const cls = (name: string): string => must(buttonStyles[name], `Button class ${name}`);

interface Mounted {
  fixture: SyntheticEngine;
  live: TestGuard;
  controller: FirstRunController;
  onContinue: ReturnType<typeof vi.fn<(handoff: FirstRunHandoff) => void>>;
  onChangeSettings: ReturnType<typeof vi.fn<(draft: DictionaryDraft) => void>>;
  onLeave: ReturnType<typeof vi.fn<() => void>>;
  rerender: (language: Language) => void;
  unmount: () => void;
}

async function mount(language: Language = 'en', intents: Partial<FirstRunIntents> = {}, stagesDone: FirstRunStagesDone = ALL_DONE, view: View = 'guided'): Promise<Mounted> {
  const fixture = await syntheticEngine();
  const live = guard();
  const controller = createFirstRunController(fixture.port, { guard: live, digest: nodeDigest });
  const onContinue = vi.fn<(handoff: FirstRunHandoff) => void>();
  const onChangeSettings = vi.fn<(draft: DictionaryDraft) => void>();
  const onLeave = vi.fn<() => void>();
  const onLanguage = vi.fn<(language: Language) => void>();
  const all: FirstRunIntents = { onContinue, onChangeSettings, startFromConversation: { href: '#/ask', onLeave }, ...intents };
  const tree = (lang: Language) => <FirstRunScreen controller={controller} language={lang} onLanguage={onLanguage} view={view} stagesDone={stagesDone} intents={all} />;
  const rendered = render(tree(language));
  disposals.push(() => { controller.dispose(); });
  return { fixture, live, controller, onContinue, onChangeSettings, onLeave, rerender: lang => rendered.rerender(tree(lang)), unmount: () => rendered.unmount() };
}
const flush = async () => { await act(async () => { await settle(); }); };
const main = () => within(screen.getByRole('main'));
const filled = () => document.querySelectorAll(`.${cls('filled')}`).length;
/** Every action button: not a row control, not a language radio. */
const actionButtons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(button => !button.hasAttribute('data-row-main') && button.getAttribute('role') !== 'radio');
interface Scope { getByRole: typeof screen.getByRole }
function button(name: string | RegExp, scope: Scope = screen): HTMLButtonElement {
  const element = scope.getByRole('button', { name });
  if (!(element instanceof HTMLButtonElement)) throw new Error('expected a native button');
  return element;
}
/** This slice's own hairline rows, by their own attribute: the shared Steps list items never match. */
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-first-run-row]'));
const rowIds = () => rows().map(item => item.getAttribute('data-row-id'));
const row = (id: string) => must(rows().find(item => item.getAttribute('data-row-id') === id), `row ${id}`);
const rowButton = (id: string) => { const element = row(id).querySelector('[data-row-main]'); if (!(element instanceof HTMLButtonElement)) throw new Error('row control missing'); return element; };
const preview = (id: string) => row(id).querySelector('[data-row-preview]');
const disclosure = (id: string, name: string) => row(id).querySelector<HTMLDetailsElement>(`details[data-first-run-disclosure="${name}"]`);
const currentStep = () => must(document.querySelector('[aria-current="step"]'), 'current step').textContent ?? '';
/** The quiet Change button of a row, in either language. */
const changeButton = (id: string) => must(Array.from(row(id).querySelectorAll<HTMLButtonElement>('button')).find(item => ['Change', 'बदलें'].includes(item.textContent ?? '')), `Change in ${id}`);
/**
 * Visible words: aria-hidden state words count; the actual value of every textarea counts (a controlled
 * textarea has no text node); screen-reader-only text, hidden nodes, SVG and the content of closed
 * details do not.
 */
function visibleText(root: Element): string {
  const copy = root.cloneNode(true);
  if (!(copy instanceof Element)) throw new Error('clone');
  const values = Array.from(root.querySelectorAll('textarea')).map(area => area.value);
  copy.querySelectorAll('textarea').forEach((area, index) => { area.textContent = values[index] ?? ''; });
  copy.querySelectorAll('.sr, [hidden], svg, details:not([open]) > :not(summary)').forEach(node => node.remove());
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  const chunks: string[] = [];
  while (walker.nextNode()) chunks.push(walker.currentNode.textContent ?? '');
  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}
const wordCount = (value: string, language: Language) => [...new Intl.Segmenter(language, { granularity: 'word' }).segment(value)].filter(part => part.isWordLike).length;
/** The closed-row preview: the first exact words and a U+2026 ellipsis (rows.tsx). */
const firstWords = (meaning: string, words = PREVIEW_WORDS_BY_VIEW.guided) => `${meaning.split(/\s+/).slice(0, words).join(' ')}…`;
async function pick(pack = 'ecommerce') {
  const user = userEvent.setup();
  await flush();
  await user.click(rowButton(pack));
  await flush();
  return user;
}
async function acceptAll(user: ReturnType<typeof userEvent.setup>, language: Language = 'en') {
  for (const id of ['billed', 'received', 'earned', 'refunds', 'costs', 'purchases', 'settings']) {
    if (within(row(id)).queryByRole('button', { name: text(language, 'FR-08.row.accept') }) === null && rowButton(id).getAttribute('aria-expanded') !== 'true') await user.click(rowButton(id));
    const accept = within(row(id)).queryByRole('button', { name: text(language, 'FR-08.row.accept') });
    if (accept !== null) await user.click(accept);
    await flush();
  }
}
const definitionOf = (pack: DictionaryDraft, name: string) => must(pack.definitions.find(item => item.name === name), name);

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network in first-run tests'));
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args); });
});
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  cleanup();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  const seen = errors.splice(0).map(args => args.map(String).join(' '));
  expect(seen.filter(line => /MISSING_TRANSLATION|Missing message/i.test(line))).toEqual([]);
});

test('local catalogues are complete, do not shadow shared keys, and keep the copy rules; every local Button label exists in both languages within 22 code points', () => {
  expect(localCatalogueGaps()).toEqual([]);
  expect(localKeyCollisions()).toEqual([]);
  for (const [key, message] of [...Object.entries(en), ...Object.entries(hi)]) {
    expect(message, key).not.toMatch(/[—!]/u);
  }
  for (const key of BUTTON_KEYS) {
    expect(typeof en[key], key).toBe('string');
    expect(typeof hi[key], key).toBe('string');
    expect([...text('en', key)].length, key).toBeLessThanOrEqual(22);
    expect([...text('hi', key)].length, key).toBeLessThanOrEqual(22);
  }
  expect(text('en', 'FR-06.state')).toBe('draft, not yet checked');
  // The exact approved phrase is 25 characters and is drawn as a navigation link, never as an action button.
  expect(text('en', 'FR-06.conversation')).toBe('Start from a conversation');
  expect([...text('en', 'FR-06.conversation')].length).toBe(25);
  expect(text('en', 'FR-08.footer.local')).toBe('Nothing has left this computer.');
  expect(en['FR-08.row.binding']).toBeUndefined();
  expect(hi['FR-08.settings.fields']).toBeUndefined();
});

test('FR-06: six plain pack rows in Engine order, each a draft not yet checked; the conversation link is a real internal link that cancels first', async () => {
  const frozen = await engine();
  const { fixture, controller, onLeave } = await mount();
  await flush();
  expect(screen.getByText('chausar')).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'English' })).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'हिंदी' })).toBeTruthy();
  for (const name of ['You', 'Vault', 'Model', 'Your books', 'Meanings', 'First answer']) expect(main().getByText(name)).toBeTruthy();
  expect(currentStep()).toContain('Your books');
  expect(main().getByRole('heading', { level: 1 }).textContent).toBe('Pick a starter pack');
  expect(rowIds()).toEqual(['ecommerce', 'retail', 'services', 'distributor', 'manufacturing', 'saas']);
  expect(rows().map(item => item.querySelector('[data-row-main]')?.textContent)).toEqual(frozen.packs().map(pack => `draft, not yet checked${pack.label}draft, not yet checked`));
  expect(rows().every(item => item.querySelector('[data-row-main] button') === null)).toBe(true);
  expect(main().getAllByText('draft, not yet checked', { selector: 'span[aria-hidden="true"]' })).toHaveLength(6);
  expect(filled()).toBe(0);
  expect(actionButtons().every(item => [...(item.textContent ?? '')].length <= 22)).toBe(true);
  expect(fixture.count('ontology.publish')).toBe(0);
  const link = screen.getByRole('link', { name: 'Start from a conversation' });
  expect(link instanceof HTMLAnchorElement).toBe(true);
  expect(link.getAttribute('href')).toBe('#/ask');
  expect(screen.queryByRole('button', { name: 'Start from a conversation' })).toBeNull();
  const user = userEvent.setup();
  await user.click(link);
  expect(onLeave).toHaveBeenCalledTimes(1);
  expect(controller.snapshot().kind).toBe('idle');
  expect(fixture.methods()).toEqual(['ui.context', 'ontology.packs', 'ontology.get', 'ui.context']);
  cleanup();
  await mount('en', { startFromConversation: { href: 'https://example.invalid/ask' } });
  await flush();
  expect(screen.queryByRole('link')).toBeNull();
  cleanup();
  await mount('en', { startFromConversation: undefined });
  await flush();
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.queryByText('Start from a conversation')).toBeNull();
});

test('FR-08: closed rows carry the exact first words of the meaning; the open row carries the whole text and evidence; only Accept accepts; keys move and open rows', async () => {
  const frozen = await engine();
  const pack = frozen.pack(0);
  const { fixture } = await mount();
  const user = await pick();
  expect(main().getByRole('heading', { level: 1 }).textContent).toBe('Agree what your words mean0/7');
  expect(main().getByText('Online brand')).toBeTruthy();
  expect(currentStep()).toContain('Meanings');
  expect(rowIds()).toEqual(['billed', 'received', 'earned', 'refunds', 'costs', 'purchases', 'settings']);
  expect(main().getAllByText('proposed', { selector: 'span[aria-hidden="true"]' })).toHaveLength(6);
  expect(main().getByText('needs your answer', { selector: 'span[aria-hidden="true"]' })).toBeTruthy();
  for (const name of ['billed', 'received', 'earned', 'refunds', 'costs', 'purchases']) {
    const item = must(preview(name), `preview ${name}`);
    expect(item.textContent).toBe(firstWords(definitionOf(pack, name).meaning));
    expect(item.textContent?.codePointAt((item.textContent?.length ?? 1) - 1)).toBe(0x2026);
    expect(item.getAttribute('lang')).toBe('en');
  }
  expect(preview('settings')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  expect(filled()).toBe(0);
  const earned = rowButton('earned');
  expect(earned.getAttribute('aria-expanded')).toBe('false');
  await user.click(earned);
  expect(earned.getAttribute('aria-expanded')).toBe('true');
  expect(preview('earned')).toBeNull();
  const proposed = definitionOf(pack, 'earned').meaning;
  const meaning = within(row('earned')).getByText(proposed);
  expect(meaning.getAttribute('lang')).toBe('en');
  expect(meaning.getAttribute('data-origin')).toBe('engine');
  expect(meaning.closest('button')).toBeNull();
  expect(within(row('earned')).getByText('Evidence: none yet')).toBeTruthy();
  expect(disclosure('earned', 'binding')).toBeNull();
  expect(disclosure('earned', 'original')).toBeNull();
  expect(filled()).toBe(1);
  expect(actionButtons().every(item => [...(item.textContent ?? '')].length <= 22)).toBe(true);
  // Opening another row closes this one: one open row.
  await user.click(rowButton('billed'));
  expect(rowButton('earned').getAttribute('aria-expanded')).toBe('false');
  expect(rowButton('billed').getAttribute('aria-expanded')).toBe('true');
  await user.click(rowButton('billed'));
  expect(rowButton('billed').getAttribute('aria-expanded')).toBe('false');
  // Enter and Space on the focused row control open and close it.
  rowButton('received').focus();
  await user.keyboard('{Enter}');
  expect(rowButton('received').getAttribute('aria-expanded')).toBe('true');
  await user.keyboard(' ');
  expect(rowButton('received').getAttribute('aria-expanded')).toBe('false');
  // Nothing was accepted by opening rows.
  expect(main().getByRole('heading', { level: 1 }).textContent).toBe('Agree what your words mean0/7');
  await user.click(rowButton('earned'));
  await user.click(button('Accept', within(row('earned'))));
  await flush();
  expect(document.activeElement).toBe(rowButton('earned'));
  expect(within(row('earned')).getByText('Accepted', { selector: 'span[aria-hidden="true"]' })).toBeTruthy();
  expect(within(row('earned')).queryByRole('button', { name: 'Accept' })).toBeNull();
  expect(main().getByRole('heading', { level: 1 }).textContent).toBe('Agree what your words mean1/7');
  expect(filled()).toBe(0);
  expect(fixture.count('ontology.publish')).toBe(0);
  // Up and Down move between the row controls of this list only.
  rowButton('billed').focus();
  await user.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(rowButton('received'));
  await user.keyboard('{ArrowUp}');
  expect(document.activeElement).toBe(rowButton('billed'));
  await user.keyboard('{ArrowUp}');
  expect(document.activeElement).toBe(rowButton('billed'));
  rowButton('settings').focus();
  await user.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(rowButton('settings'));
});

test('the settings row shows the exact proposal and needs its own Accept; Publish exists only after everything; the square stays on Meanings through publication; Continue is a checked departure that cancels first', async () => {
  const { fixture, controller, onContinue } = await mount('en', { onChangeSettings: undefined });
  const states: string[] = [];
  onContinue.mockImplementation(() => { states.push(controller.snapshot().kind); });
  const user = await pick('retail');
  await user.click(rowButton('settings'));
  const settings = within(row('settings'));
  expect(settings.getByText('INR')).toBeTruthy();
  expect(settings.getByText('regular')).toBeTruthy();
  expect(settings.getByText('No dictionary is published yet.')).toBeTruthy();
  expect(settings.getByText('Not available in this step.')).toBeTruthy();
  expect(disclosure('settings', 'fields')).toBeNull();
  await user.click(rowButton('settings'));
  for (const id of ['billed', 'received', 'earned', 'refunds', 'costs', 'purchases']) {
    await user.click(rowButton(id));
    await user.click(button('Accept', within(row(id))));
    await flush();
  }
  expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  expect(main().getByText('Accept every row.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  await user.click(rowButton('settings'));
  await user.click(button('Accept', within(row('settings'))));
  await flush();
  const publish = button('Publish');
  expect(publish.classList.contains(cls('filled'))).toBe(true);
  expect(filled()).toBe(1);
  expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  expect(fixture.count('ontology.publish')).toBe(0);
  expect(main().getByText('Pending: calendar, ordering, Today.')).toBeTruthy();
  expect(main().getByText('Nothing has left this computer.')).toBeTruthy();
  const from = fixture.calls.length;
  await user.click(publish);
  await flush();
  expect(fixture.methods().slice(from)).toEqual(['ui.context', 'ontology.publish', 'ui.context', 'ontology.get', 'ui.context']);
  const current = must(fixture.current());
  expect(main().getByRole('status').textContent).toBe('Version 1 published, read back.');
  expect(main().getByText(`Hash ${current.hash}`)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  expect(filled()).toBe(0);
  expect(main().getByRole('heading', { level: 1 }).textContent).toBe('Agree what your words mean7/7');
  expect(main().getByText('Neighbourhood retail')).toBeTruthy();
  expect(currentStep()).toContain('Meanings');
  expect(currentStep()).not.toContain('First answer');
  expect(within(row('billed')).queryByRole('button', { name: 'Change' })).toBeNull();
  expect(controller.snapshot().kind).toBe('published');
  const before = fixture.calls.length;
  await user.click(button('Continue'));
  await flush();
  // One fresh context read before the handoff; the controller cancelled itself before the parent was given it.
  expect(fixture.methods().slice(before)).toEqual(['ui.context']);
  expect(onContinue).toHaveBeenCalledTimes(1);
  expect(states).toEqual(['left']);
  const handoff = must(onContinue.mock.calls[0])[0];
  expect(handoff.dictionary.hash).toBe(current.hash);
  expect(handoff.pending).toEqual({ calendar: 'not-configured', timeZone: 'not-configured', ordering: 'not-configured', todayDefaults: 'not-configured' });
  expect(handoff.contextKey).toBe(fixture.contextKey());
  expect(controller.snapshot().kind).toBe('left');
  expect(main().getByRole('status').textContent).toBe('Leaving this step.');
  expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  expect(screen.queryByText(/hash/i)).toBeNull();
  expect(fixture.count('ontology.publish')).toBe(1);
});

test('a retained Continue after a cancel, a lock, a dead guard or a context replacement hands the parent nothing; two presses hand over once', async () => {
  const scenarios: Array<{ name: string; disturb: (mounted: Mounted) => void; handoffs: number; after: FirstRunState['kind'] }> = [
    { name: 'cancel', disturb: mounted => { mounted.controller.cancel(); }, handoffs: 0, after: 'idle' },
    { name: 'lock', disturb: mounted => { mounted.live.set(false); mounted.controller.invalidate('VAULT_LOCKED'); }, handoffs: 0, after: 'unavailable' },
    { name: 'guard', disturb: mounted => { mounted.live.set(false); }, handoffs: 0, after: 'unavailable' },
    { name: 'context', disturb: mounted => { mounted.fixture.touch(); }, handoffs: 0, after: 'unavailable' },
    { name: 'double', disturb: () => {}, handoffs: 1, after: 'left' },
  ];
  for (const scenario of scenarios) {
    const mounted = await mount();
    const user = await pick();
    await acceptAll(user);
    await user.click(button('Publish'));
    await flush();
    expect(mounted.controller.snapshot().kind, scenario.name).toBe('published');
    const retained = button('Continue');
    let connectedAtClick = false;
    await act(async () => {
      scenario.disturb(mounted);
      connectedAtClick = retained.isConnected;
      retained.click();
      if (scenario.name === 'double') retained.click();
      await settle();
    });
    expect(connectedAtClick, scenario.name).toBe(true);
    expect(mounted.onContinue, scenario.name).toHaveBeenCalledTimes(scenario.handoffs);
    expect(mounted.controller.snapshot().kind, scenario.name).toBe(scenario.after);
    expect(mounted.fixture.count('ontology.publish'), scenario.name).toBe(1);
    expect(screen.queryByRole('button', { name: 'Continue' }), scenario.name).toBeNull();
    for (const secret of [WORKSPACE.name, MEMBER_NAME, MEMBER_ID]) expect(screen.queryByText(new RegExp(secret)), scenario.name).toBeNull();
    cleanup();
  }
});

test('a retained settings Change after a pack change, a lock or a dead guard hands the parent nothing; a valid one cancels this screen before the parent runs', async () => {
  const scenarios: Array<{ name: string; disturb: (mounted: Mounted) => void; calls: number; after: FirstRunState['kind'] }> = [
    { name: 'changed-pack', disturb: mounted => { mounted.controller.choosePack('retail'); }, calls: 0, after: 'review' },
    { name: 'cancel', disturb: mounted => { mounted.controller.cancel(); }, calls: 0, after: 'idle' },
    { name: 'lock', disturb: mounted => { mounted.live.set(false); mounted.controller.invalidate('VAULT_LOCKED'); }, calls: 0, after: 'unavailable' },
    { name: 'guard', disturb: mounted => { mounted.live.set(false); }, calls: 0, after: 'unavailable' },
    { name: 'normal', disturb: () => {}, calls: 1, after: 'left' },
  ];
  for (const scenario of scenarios) {
    const mounted = await mount();
    const seen: string[] = [];
    mounted.onChangeSettings.mockImplementation(() => { seen.push(mounted.controller.snapshot().kind); });
    const user = await pick();
    await user.click(rowButton('settings'));
    const retained = button('Change', within(row('settings')));
    let connectedAtClick = false;
    await act(async () => {
      scenario.disturb(mounted);
      connectedAtClick = retained.isConnected;
      retained.click();
      await settle();
    });
    expect(connectedAtClick, scenario.name).toBe(true);
    expect(mounted.onChangeSettings, scenario.name).toHaveBeenCalledTimes(scenario.calls);
    expect(mounted.controller.snapshot().kind, scenario.name).toBe(scenario.after);
    if (scenario.name === 'changed-pack') {
      const state = mounted.controller.snapshot();
      expect(state.kind === 'review' && state.review.pack, scenario.name).toBe('retail');
    }
    if (scenario.name === 'normal') {
      // Cancelled before the parent ran, with the exact reviewed draft.
      expect(seen).toEqual(['left']);
      expect(must(mounted.onChangeSettings.mock.calls[0])[0].pack).toBe('ecommerce');
      expect(main().getByRole('status').textContent).toBe('Leaving this step.');
    }
    expect(mounted.fixture.count('ontology.publish'), scenario.name).toBe(0);
    cleanup();
  }
});

test('Continue consumes admission at the actual parent callback: synchronous and queued LEFT loss by cancel, lock, dispose or a dead guard delivers nothing', async () => {
  const disturbances: Array<{ name: string; run: (mounted: Mounted) => void }> = [
    { name: 'cancel', run: mounted => { mounted.controller.cancel(); } },
    { name: 'lock', run: mounted => { mounted.live.set(false); mounted.controller.invalidate('VAULT_LOCKED'); } },
    { name: 'dispose', run: mounted => { mounted.controller.dispose(); } },
    { name: 'guard', run: mounted => { mounted.live.set(false); } },
  ];
  for (const queued of [false, true]) for (const disturbance of disturbances) {
    const name = `${queued ? 'microtask' : 'synchronous'} ${disturbance.name}`;
    const mounted = await mount();
    const user = await pick();
    await acceptAll(user);
    await user.click(button('Publish'));
    await flush();
    const retained = button('Continue');
    let notified = false;
    const unsubscribe = mounted.controller.subscribe(() => {
      if (mounted.controller.snapshot().kind !== 'left' || notified) return;
      notified = true;
      if (queued) queueMicrotask(() => disturbance.run(mounted));
      else disturbance.run(mounted);
    });
    await act(async () => { retained.click(); await settle(); });
    unsubscribe();
    expect(notified, name).toBe(true);
    expect(mounted.onContinue, name).not.toHaveBeenCalled();
    expect(['idle', 'unavailable'], name).toContain(mounted.controller.snapshot().kind);
    expect(screen.queryByRole('button', { name: 'Continue' }), name).toBeNull();
    expect(screen.queryByText(/hash/i), name).toBeNull();
    expect(mounted.fixture.count('ontology.publish'), name).toBe(1);
    cleanup();
  }
});

test('settings Change consumes admission immediately: synchronous LEFT cancel, lock, dispose or a dead guard delivers no draft', async () => {
  for (const disturbance of [
    (mounted: Mounted) => { mounted.controller.cancel(); },
    (mounted: Mounted) => { mounted.live.set(false); mounted.controller.invalidate('VAULT_LOCKED'); },
    (mounted: Mounted) => { mounted.controller.dispose(); },
    (mounted: Mounted) => { mounted.live.set(false); },
  ]) {
    const mounted = await mount();
    const user = await pick();
    await user.click(rowButton('settings'));
    let notified = false;
    const unsubscribe = mounted.controller.subscribe(() => {
      if (mounted.controller.snapshot().kind !== 'left' || notified) return;
      notified = true;
      disturbance(mounted);
    });
    await act(async () => { button('Change', within(row('settings'))).click(); await settle(); });
    unsubscribe();
    expect(notified).toBe(true);
    expect(mounted.onChangeSettings).not.toHaveBeenCalled();
    expect(['idle', 'unavailable']).toContain(mounted.controller.snapshot().kind);
    expect(rowIds()).toHaveLength(0);
    expect(mounted.fixture.count('ontology.publish')).toBe(0);
    cleanup();
  }
});

test('uncertified earlier stages are drawn as not sure, and the square rests there instead of on this step', async () => {
  await mount('en', {}, { you: true, vault: true, model: true, books: false });
  await pick();
  expect(currentStep()).toContain('Your books');
  expect(currentStep()).toContain('not sure what happened');
  expect(currentStep()).not.toContain('Meanings');
  cleanup();
  await mount('en', {}, { you: false, vault: true, model: true, books: true });
  await flush();
  expect(currentStep()).toContain('You');
  expect(currentStep()).not.toContain('Your books');
});

test('Change edits the words only: Publish is withdrawn while an edit is open, the meaning is not repeated beside the editor, Escape discards, Save resets the row, keeps the pack text behind a closed disclosure, and the publication carries the change', async () => {
  const frozen = await engine();
  const { fixture } = await mount();
  const user = await pick('saas');
  await acceptAll(user);
  expect(button('Publish')).toBeTruthy();
  await user.click(rowButton('earned'));
  await user.click(button('Change', within(row('earned'))));
  const field = within(row('earned')).getByLabelText('Meaning');
  if (!(field instanceof HTMLTextAreaElement)) throw new Error('expected a textarea');
  expect(document.activeElement).toBe(field);
  const proposed = definitionOf(frozen.pack(5), 'earned').meaning;
  expect(field.value).toBe(proposed);
  expect(row('earned').querySelector('[data-origin]')).toBeNull();
  expect(within(row('earned')).queryByText(proposed, { selector: 'p' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  expect(within(row('earned')).queryByRole('button', { name: 'Accept' })).toBeNull();
  expect(filled()).toBe(1);
  expect(button('Save', within(row('earned'))).classList.contains(cls('filled'))).toBe(true);
  await user.keyboard('{Escape}');
  expect(within(row('earned')).queryByLabelText('Meaning')).toBeNull();
  expect(document.activeElement).toBe(rowButton('earned'));
  expect(button('Publish')).toBeTruthy();
  expect(filled()).toBe(1);
  await user.click(button('Change', within(row('earned'))));
  const again = within(row('earned')).getByLabelText('Meaning');
  await user.clear(again);
  await user.type(again, 'short');
  await user.click(button('Save', within(row('earned'))));
  expect(within(row('earned')).getByText('At least eleven characters.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  const edited = 'Subscription service delivered during the period, from imported recognition events only.';
  await user.clear(again);
  await user.type(again, edited);
  await user.click(button('Save', within(row('earned'))));
  await flush();
  expect(document.activeElement).toBe(rowButton('earned'));
  expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  expect(within(row('earned')).getByText('Changed', { selector: 'span[aria-hidden="true"]' })).toBeTruthy();
  expect(within(row('earned')).getByText('Your words')).toBeTruthy();
  const changed = within(row('earned')).getByText(edited);
  expect(changed.getAttribute('lang')).toBeNull();
  expect(changed.getAttribute('data-origin')).toBe('changed');
  const original = must(disclosure('earned', 'original'), 'original disclosure');
  expect(original.open).toBe(false);
  expect(within(original).getByText('Original')).toBeTruthy();
  expect(within(original).getByText(proposed).getAttribute('lang')).toBe('en');
  expect(main().getByRole('heading', { level: 1 }).textContent).toBe('Agree what your words mean6/7');
  await user.click(rowButton('earned'));
  expect(must(preview('earned')).textContent).toBe(firstWords(edited));
  expect(must(preview('earned')).getAttribute('lang')).toBeNull();
  await user.click(rowButton('earned'));
  await user.click(button('Accept', within(row('earned'))));
  await flush();
  await user.click(button('Publish'));
  await flush();
  expect(must(fixture.current()).definitions.find(item => item.name === 'earned')?.meaning).toBe(edited);
  expect(main().getByRole('status').textContent).toBe('Version 1 published, read back.');
});

test('Change immediately revokes a retained connected Publish before React commits; separately committed clicks also issue nothing, and Escape restores a fresh Publish', async () => {
  for (const sameBatch of [true, false]) {
    const mounted = await mount();
    const user = await pick();
    await acceptAll(user);
    await user.click(rowButton('billed'));
    const retained = button('Publish');
    const change = changeButton('billed');
    let connectedAtClick = false;
    if (sameBatch) {
      await act(async () => { change.click(); connectedAtClick = retained.isConnected; retained.click(); await settle(); });
    } else {
      await act(async () => { change.click(); await settle(); });
      await act(async () => { connectedAtClick = retained.isConnected; retained.click(); await settle(); });
    }
    expect(connectedAtClick, `same batch ${sameBatch}`).toBe(sameBatch);
    expect(mounted.fixture.count('ontology.publish')).toBe(0);
    const state = mounted.controller.snapshot();
    expect(state.kind === 'review' && !state.publishing).toBe(true);
    const field = within(row('billed')).getByLabelText('Meaning');
    expect(field instanceof HTMLTextAreaElement).toBe(true);
    expect(document.activeElement).toBe(field);
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(filled()).toBe(1);
    await user.keyboard('{Escape}');
    await flush();
    expect(document.activeElement).toBe(rowButton('billed'));
    await user.click(button('Publish'));
    await flush();
    expect(mounted.fixture.count('ontology.publish')).toBe(1);
    expect(mounted.controller.snapshot().kind).toBe('published');
    cleanup();
  }
});

test('ending an edit in the same batch never revives the previous Publish token; pack replacement ends the editor and retains fresh review pins', async () => {
  const mounted = await mount();
  const user = await pick();
  await acceptAll(user);
  await user.click(rowButton('billed'));
  const retained = button('Publish');
  await act(async () => {
    changeButton('billed').click();
    rowButton('billed').click();
    expect(retained.isConnected).toBe(true);
    retained.click();
    await settle();
  });
  expect(mounted.fixture.count('ontology.publish')).toBe(0);
  expect(document.querySelector('textarea')).toBeNull();
  expect(button('Publish')).toBeTruthy();
  await user.click(rowButton('billed'));
  await user.click(changeButton('billed'));
  await user.click(button('Discard'));
  expect(document.activeElement).toBe(rowButton('billed'));
  expect(button('Publish')).toBeTruthy();
  await user.click(changeButton('billed'));
  await act(async () => { mounted.controller.choosePack('retail'); await settle(); });
  expect(document.querySelector('textarea')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  expect(main().getByText('Neighbourhood retail')).toBeTruthy();
  await acceptAll(user);
  await user.click(button('Publish'));
  await flush();
  expect(mounted.fixture.count('ontology.publish')).toBe(1);
  expect(must(mounted.fixture.current()).pack).toBe('retail');
});

test('provenance is the text, not the acceptance: an accepted and published Hindi meaning stays the person\'s own words, never Engine English, and the original stays inspectable', async () => {
  const frozen = await engine();
  const { fixture, controller } = await mount('hi');
  const user = await pick();
  const proposed = definitionOf(frozen.pack(0), 'billed').meaning;
  const hindi = 'यह मेरी लिखी हुई हिंदी पहचान है जो पूरा अर्थ सुरक्षित रखती है।';
  await user.click(rowButton('billed'));
  await user.click(changeButton('billed'));
  const field = within(row('billed')).getByLabelText('मतलब');
  if (!(field instanceof HTMLTextAreaElement)) throw new Error('expected a textarea');
  expect(field.value).toBe(proposed);
  await act(async () => { fireEvent.change(field, { target: { value: hindi } }); });
  expect(field.value).toBe(hindi);
  await user.click(button('सहेजें', within(row('billed'))));
  await flush();
  expect(within(row('billed')).getByText(text('hi', 'FR-08.state.changed'), { selector: 'span[aria-hidden="true"]' })).toBeTruthy();
  const check = (phase: string) => {
    expect(within(row('billed')).getByText(text('hi', 'FR-08.row.yourWords')), phase).toBeTruthy();
    const meaning = within(row('billed')).getByText(hindi);
    expect(meaning.getAttribute('lang'), phase).toBeNull();
    expect(meaning.getAttribute('data-origin'), phase).toBe('changed');
    const original = must(disclosure('billed', 'original'), `${phase} original`);
    expect(original.open, phase).toBe(false);
    expect(within(original).getByText(text('hi', 'FR-08.row.proposedWas'))).toBeTruthy();
    const quote = within(original).getByText(proposed);
    expect(quote.getAttribute('lang'), phase).toBe('en');
    expect(quote.getAttribute('data-origin'), phase).toBe('engine');
  };
  check('changed');
  await user.click(button('स्वीकारें', within(row('billed'))));
  await flush();
  expect(within(row('billed')).getByText('स्वीकृत', { selector: 'span[aria-hidden="true"]' })).toBeTruthy();
  check('accepted');
  await user.click(rowButton('billed'));
  expect(must(preview('billed')).textContent).toBe(firstWords(hindi));
  expect(must(preview('billed')).getAttribute('lang')).toBeNull();
  await acceptAll(user, 'hi');
  expect(filled()).toBe(1);
  await user.click(button('प्रकाशित करें'));
  await flush();
  expect(controller.snapshot().kind).toBe('published');
  expect(must(fixture.current()).definitions.find(item => item.name === 'billed')?.meaning).toBe(hindi);
  await user.click(rowButton('billed'));
  check('published');
  expect(within(row('billed')).queryByRole('button', { name: 'बदलें' })).toBeNull();
  expect(within(row('billed')).queryByRole('button', { name: 'स्वीकारें' })).toBeNull();
  // An unchanged row is still the Engine's own English.
  await user.click(rowButton('received'));
  const received = within(row('received')).getByText(definitionOf(frozen.pack(0), 'received').meaning);
  expect(received.getAttribute('lang')).toBe('en');
  expect(received.getAttribute('data-origin')).toBe('engine');
  expect(disclosure('received', 'original')).toBeNull();
});

test('an open editor ends with the state it was opened in: a publish in flight, a verified publication and a lock each withdraw Save and Discard', async () => {
  const { fixture, controller } = await mount();
  const user = await pick('services');
  await acceptAll(user);
  await user.click(rowButton('billed'));
  await user.click(button('Change', within(row('billed'))));
  expect(within(row('billed')).getByLabelText('Meaning')).toBeTruthy();
  const state = controller.snapshot();
  if (state.kind !== 'review') throw new Error('expected a review');
  const pin = must(pinOf(state.review));
  const gate = deferred<unknown>();
  fixture.onRequest((method, _payload, defaults) => { if (method !== 'ontology.publish') return undefined; fixture.onRequest(null); return gate.promise.then(() => defaults()); });
  await act(async () => { void controller.publishDictionary(pin); await settle(); });
  expect(await issued(fixture, 'ontology.publish', 1)).toBe(true);
  expect(main().getByRole('status').textContent).toBe('Publishing. Waiting for the dictionary to be read back.');
  expect(document.querySelector('textarea')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Change pack' })).toBeNull();
  expect(filled()).toBe(0);
  await act(async () => { gate.resolve(undefined); await settle(); });
  expect(main().getByRole('status').textContent).toBe('Version 1 published, read back.');
  expect(document.querySelector('textarea')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
  cleanup();

  const locked = await mount();
  const again = await pick('services');
  await again.click(rowButton('billed'));
  await again.click(button('Change', within(row('billed'))));
  expect(document.querySelector('textarea')).toBeTruthy();
  await act(async () => { locked.live.set(false); locked.controller.invalidate('VAULT_LOCKED'); });
  expect(document.querySelector('textarea')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  expect(rowIds()).toHaveLength(0);
  expect(main().getByText('The vault is locked.')).toBeTruthy();
  expect(locked.fixture.count('ontology.publish')).toBe(0);
});

test('Hindi: interface words are Hindi, Engine meanings stay exact English marked as English, and nothing is missing', async () => {
  const frozen = await engine();
  const { rerender } = await mount('hi');
  const user = await pick();
  expect(main().getByRole('heading', { level: 1 }).textContent).toBe('आपके शब्दों का मतलब तय करें0/7');
  expect(main().getByText('0/7')).toBeTruthy();
  expect(main().getAllByText('प्रस्तावित', { selector: 'span[aria-hidden="true"]' })).toHaveLength(6);
  expect(main().getByText('कैलेंडर, क्रम, आज: बाकी।')).toBeTruthy();
  expect(main().getByText('कंप्यूटर से कुछ नहीं गया।')).toBeTruthy();
  expect(main().getByText('हर पंक्ति स्वीकारें।')).toBeTruthy();
  expect(must(preview('costs')).getAttribute('lang')).toBe('en');
  await user.click(rowButton('costs'));
  const proposed = definitionOf(frozen.pack(0), 'costs').meaning;
  const meaning = within(row('costs')).getByText(proposed);
  expect(meaning.getAttribute('lang')).toBe('en');
  expect(within(row('costs')).getByText('सबूत: अभी नहीं')).toBeTruthy();
  expect(disclosure('costs', 'binding')).toBeNull();
  expect(button('स्वीकारें', within(row('costs')))).toBeTruthy();
  expect(button('बदलें', within(row('costs')))).toBeTruthy();
  expect(screen.getByRole('main').closest('[lang]')?.getAttribute('lang')).toBe('hi');
  rerender('en');
  expect(main().getByRole('heading', { level: 1 }).textContent).toBe('Agree what your words mean0/7');
});

function LanguageHost({ controller }: { controller: FirstRunController }) {
  const [language, setLanguage] = useState<Language>('en');
  return <FirstRunScreen controller={controller} language={language} onLanguage={setLanguage} stagesDone={ALL_DONE} />;
}

test('the language choice moves the focus with the choice, so Enter or Space on the focused word keeps the language it shows', async () => {
  const fixture = await syntheticEngine();
  const controller = createFirstRunController(fixture.port, { guard: guard(), digest: nodeDigest });
  disposals.push(() => { controller.dispose(); });
  render(<LanguageHost controller={controller} />);
  await flush();
  const user = userEvent.setup();
  const shellLang = () => screen.getByRole('main').closest('[lang]')?.getAttribute('lang');
  const english = screen.getByRole('radio', { name: 'English' });
  const hindi = screen.getByRole('radio', { name: 'हिंदी' });
  expect(english.getAttribute('aria-checked')).toBe('true');
  expect(hindi.getAttribute('lang')).toBe('hi');
  english.focus();
  await user.keyboard('{ArrowRight}');
  expect(shellLang()).toBe('hi');
  expect(hindi.getAttribute('aria-checked')).toBe('true');
  expect(document.activeElement).toBe(hindi);
  await user.keyboard('{Enter}');
  expect(shellLang()).toBe('hi');
  expect(main().getByRole('heading', { level: 1 }).textContent).toBe('एक शुरुआती पैक चुनें');
  await user.keyboard('{ArrowLeft}');
  expect(shellLang()).toBe('en');
  expect(document.activeElement).toBe(english);
  await user.keyboard(' ');
  expect(shellLang()).toBe('en');
  expect(main().getByRole('heading', { level: 1 }).textContent).toBe('Pick a starter pack');
  expect(fixture.count('ontology.publish')).toBe(0);
});

test('leaving during a held publish never resurrects evidence; the neutral unknown state asks for a readback; the late reply stays hidden', async () => {
  const { fixture, live, controller } = await mount();
  const user = await pick();
  await acceptAll(user);
  const gate = deferred<unknown>();
  fixture.onRequest((method, _payload, defaults) => { if (method !== 'ontology.publish') return undefined; fixture.onRequest(null); return gate.promise.then(() => defaults()); });
  await user.click(button('Publish'));
  expect(await issued(fixture, 'ontology.publish', 1)).toBe(true);
  await flush();
  expect(main().getByRole('status').textContent).toBe('Publishing. Waiting for the dictionary to be read back.');
  expect(controller.issuance()).toBe('issued');
  // The parent navigates away: the guard goes dead and the surface is cancelled.
  live.set(false);
  await act(async () => { controller.cancel(); });
  expect(main().getByRole('status').textContent).toBe('An earlier publish is unresolved. Read the dictionary back to see what is current.');
  expect(main().getByText('Step 5 of 6')).toBeTruthy();
  expect(screen.queryByText(/Online brand/)).toBeNull();
  expect(screen.queryByText(new RegExp(WORKSPACE.name))).toBeNull();
  expect(screen.queryByText(new RegExp(MEMBER_NAME))).toBeNull();
  expect(screen.queryByText(new RegExp(MEMBER_ID))).toBeNull();
  expect(screen.queryByText(/Published and read back/)).toBeNull();
  expect(rowIds()).toHaveLength(0);
  await act(async () => { gate.resolve(undefined); await settle(); });
  expect(screen.queryByText(/Published and read back/)).toBeNull();
  expect(screen.queryByText(/hash/i)).toBeNull();
  expect(rowIds()).toHaveLength(0);
  expect(fixture.count('ontology.publish')).toBe(1);
  expect(controller.issuance()).toBe('unresolved');
  expect(button('Read back')).toBeTruthy();
  live.set(true);
  await user.click(button('Read back'));
  await flush();
  expect(main().getByRole('status').textContent).toBe('Version 1 published, read back.');
  expect(fixture.count('ontology.publish')).toBe(1);
  expect(controller.issuance()).toBe('none');
});

test('unmounting cancels the controller: late reads land nowhere and an issued publish stays pinned without a retry', async () => {
  const fixture = await syntheticEngine();
  const packsGate = deferred<unknown>();
  fixture.onRequest((method, _payload, defaults) => { if (method !== 'ontology.packs') return undefined; fixture.onRequest(null); return packsGate.promise.then(() => defaults()); });
  const controller = createFirstRunController(fixture.port, { guard: guard(), digest: nodeDigest });
  disposals.push(() => { controller.dispose(); });
  const view = render(<FirstRunScreen controller={controller} language="en" onLanguage={() => {}} stagesDone={ALL_DONE} />);
  await flush();
  expect(main().getByRole('status').textContent).toBe('Reading the starter packs.');
  view.unmount();
  expect(controller.snapshot().kind).toBe('idle');
  await act(async () => { packsGate.resolve(undefined); await settle(); });
  expect(controller.snapshot().kind).toBe('idle');
  cleanup();

  const mounted = await mount();
  const user = await pick();
  await acceptAll(user);
  const gate = deferred<unknown>();
  mounted.fixture.onRequest((method, _payload, defaults) => { if (method !== 'ontology.publish') return undefined; mounted.fixture.onRequest(null); return gate.promise.then(() => defaults()); });
  await user.click(button('Publish'));
  expect(await issued(mounted.fixture, 'ontology.publish', 1)).toBe(true);
  mounted.unmount();
  expect(mounted.controller.issuance()).toBe('issued');
  expect(mounted.controller.snapshot()).toEqual({ kind: 'unknown', code: 'READ_INVALIDATED', reconciling: false, attempt: null });
  expect(mounted.controller.dispose()).toEqual({ ok: false, code: 'IN_FLIGHT' });
  await act(async () => { gate.resolve(undefined); await settle(); });
  expect(mounted.controller.issuance()).toBe('unresolved');
  expect(mounted.controller.snapshot().kind).toBe('unknown');
  expect(mounted.fixture.count('ontology.publish')).toBe(1);
  expect(await mounted.controller.load()).toEqual({ ok: false, code: 'PUBLISH_UNRESOLVED' });
  expect(mounted.controller.dispose()).toEqual({ ok: false, code: 'PUBLISH_UNRESOLVED' });
});

test('a viewer seat sees the read-only sentence and no control; an Engine refusal returns the review with nothing published', async () => {
  const viewerFixture = await syntheticEngine({ role: 'viewer' });
  const viewer = createFirstRunController(viewerFixture.port, { guard: guard(), digest: nodeDigest });
  disposals.push(() => { viewer.dispose(); });
  render(<FirstRunScreen controller={viewer} language="en" onLanguage={() => {}} stagesDone={ALL_DONE} />);
  await flush();
  expect(main().getByText('Your seat can read the books but cannot publish their meanings. An owner or cofounder does that.')).toBeTruthy();
  expect(main().queryAllByRole('button')).toHaveLength(0);
  expect(viewerFixture.methods()).toEqual(['ui.context']);
  cleanup();

  const { fixture } = await mount();
  const user = await pick('services');
  await acceptAll(user);
  fixture.onRequest(method => { if (method !== 'ontology.publish') return undefined; fixture.onRequest(null); throw Object.assign(new Error('refused'), { code: 'INVALID_DEFINITION' }); });
  await user.click(button('Publish'));
  await flush();
  expect(main().getByRole('status').textContent).toBe('This dictionary was refused. Nothing was published. Code INVALID_DEFINITION.');
  expect(fixture.current()).toBeNull();
  expect(button('Publish')).toBeTruthy();
  expect(filled()).toBe(1);
});

/** A controller that only shows one fixed state, for measuring copy. It never reads, publishes or leaves. */
function fixed(state: FirstRunState): FirstRunController {
  return {
    snapshot: () => state, subscribe: () => () => {}, onIssuance: () => () => {}, issuance: () => 'none',
    load: async () => OK, choosePack: () => OK, backToPacks: () => OK, acceptRow: () => OK, acceptSettings: () => OK, changeMeaning: () => OK,
    publishDictionary: async () => OK, reconcile: async () => OK,
    leave: async () => ({ ok: false, code: 'SELECTION_INVALID' }), leaveToSettings: () => ({ ok: false, code: 'SELECTION_INVALID' }),
    cancel() {}, invalidate() {}, dispose: () => OK,
  };
}

test.each(['en', 'hi'] as const)('Simple in %s keeps nonempty exact current previews in all six definitions of every pack and review phase, and opens the full current/original text with its provenance', async language => {
  const frozen = await engine();
  const packs = frozen.packs();
  const context: UiContext = { workspace: { ...WORKSPACE }, member: { id: MEMBER_ID, name: MEMBER_NAME, role: 'owner', epoch: 1, branches: ['*'] }, contextKey: 'a'.repeat(64) };
  const DIGEST = 'b'.repeat(64);
  const accepted = (initial: Review): Review => {
    let review = initial;
    for (const item of review.rows) review = must(acceptRow(review, item.definition.name, must(pinOf(review))));
    return must(acceptSettings(review, must(pinOf(review))));
  };
  let closedChecks = 0;
  let openedChecks = 0;
  let originalChecks = 0;
  for (const pack of packs) {
    const proposed = withDigest(startReview(pack, `simple-${pack.pack}`), DIGEST);
    let changed = proposed;
    for (const item of pack.definitions) changed = withDigest(must(changeMeaning(changed, item.name, `Reviewed: ${item.meaning}`, changed.revision)), DIGEST);
    const acceptedOriginal = accepted(proposed);
    const acceptedChanged = accepted(changed);
    for (const [phase, review, published] of [
      ['proposed', proposed, false], ['accepted', acceptedOriginal, false],
      ['changed', changed, false], ['changed accepted', acceptedChanged, false],
      ['published', acceptedOriginal, true], ['changed published', acceptedChanged, true],
    ] as const) {
      const summary = summaryOf(frozen.compile(review.draft, 1));
      const state: FirstRunState = published ? {
        kind: 'published', context, published: summary, review, reviewDigest: DIGEST,
        handoff: { workspaceId: WORKSPACE.id, memberId: MEMBER_ID, contextKey: context.contextKey, dictionary: summary, reviewDigest: DIGEST, pending: { calendar: 'not-configured', timeZone: 'not-configured', ordering: 'not-configured', todayDefaults: 'not-configured' } },
      } : { kind: 'review', context, packs, current: null, review, publishing: false, notice: null };
      const rendered = render(<FirstRunScreen controller={fixed(state)} language={language} onLanguage={() => {}} view="simple" stagesDone={ALL_DONE} intents={{ onContinue() {} }} />);
      const checkClosed = (openId: string | null) => {
        for (const item of review.rows) {
          const id = item.definition.name;
          if (id === openId) { expect(preview(id)).toBeNull(); continue; }
          const meaning = item.definition.meaning;
          const shown = must(preview(id), `${pack.pack} ${phase} ${language} ${id} Simple preview`);
          // Independent of the preview policy/helper: Simple must actually display a meaning word.
          const parts = meaning.split(/\s+/u).filter(Boolean);
          expect(shown.textContent?.trim().length).toBeGreaterThan(0);
          expect(shown.textContent).toBe(parts.length === 1 ? parts[0] : `${parts[0]}…`);
          expect(shown.closest('[data-row-main]')).toBe(rowButton(id));
          expect(shown.getAttribute('lang')).toBe(meaning === item.proposed ? 'en' : null);
          expect(rowButton(id).getAttribute('aria-expanded')).toBe('false');
          closedChecks += 1;
        }
        expect(preview('settings')).toBeNull();
        expect(filled()).toBeLessThanOrEqual(1);
      };
      checkClosed(null);
      for (const item of review.rows) {
        const id = item.definition.name;
        const original = item.definition.meaning === item.proposed;
        act(() => { rowButton(id).click(); });
        checkClosed(id);
        const current = must(row(id).querySelector<HTMLElement>('[data-origin]'));
        expect(current.textContent).toBe(item.definition.meaning);
        expect(current.hidden).toBe(false);
        expect(current.getAttribute('lang')).toBe(original ? 'en' : null);
        expect(current.getAttribute('data-origin')).toBe(original ? 'engine' : 'changed');
        expect(within(row(id)).getByText(text(language, 'FR-08.row.evidence'))).toBeTruthy();
        openedChecks += 1;
        if (!original) {
          expect(within(row(id)).getByText(text(language, 'FR-08.row.yourWords'))).toBeTruthy();
          const detail = must(disclosure(id, 'original'));
          expect(detail.open).toBe(false);
          const summaryControl = must(detail.querySelector('summary'));
          act(() => { summaryControl.click(); });
          expect(detail.open).toBe(true);
          expect(current.hidden).toBe(true);
          const quote = must(detail.querySelector('[data-origin="engine"]'));
          expect(quote.textContent).toBe(item.proposed);
          expect(quote.getAttribute('lang')).toBe('en');
          act(() => { summaryControl.click(); });
          expect(detail.open).toBe(false);
          expect(current.hidden).toBe(false);
          expect(current.textContent).toBe(item.definition.meaning);
          originalChecks += 1;
        }
        act(() => { rowButton(id).click(); });
      }
      rendered.unmount();
    }
  }
  expect(closedChecks).toBe(1296);
  expect(openedChecks).toBe(216);
  expect(originalChecks).toBe(108);
  console.info(JSON.stringify({ regression: 'Simple exact previews', language, closedChecks, openedChecks, originalChecks }));
});

test.each(VIEWS)('main copy in %s stays within Simple 90, Guided 120 and Books 170 in English and Hindi for every pack, proposed/accepted/published and bounded changed meanings, initial/changed textarea values, settled original disclosures and unknown states; one filled button and action labels within 22 code points', async view => {
  const frozen = await engine();
  const packs = frozen.packs();
  const context: UiContext = { workspace: { ...WORKSPACE }, member: { id: MEMBER_ID, name: MEMBER_NAME, role: 'owner', epoch: 1, branches: ['*'] }, contextKey: 'a'.repeat(64) };
  const DIGEST = 'b'.repeat(64);
  const reviewOf = (pack: DictionaryDraft, phase: 'proposed' | 'accepted'): Review => {
    let review = withDigest(startReview(pack, `g-${pack.pack}-${phase}`), DIGEST);
    if (phase === 'accepted') {
      for (const item of review.rows) review = must(acceptRow(review, item.definition.name, must(pinOf(review))));
      review = must(acceptSettings(review, must(pinOf(review))));
    }
    return review;
  };
  const measured: { case: string; view: View; words: number; filled: number; longLabels: string[]; meaningKept: boolean }[] = [];
  const measure = (name: string, view: View, language: Language, meaning: string | null) => {
    const mainElement = screen.getByRole('main');
    const textarea = document.querySelector('textarea');
    // The exact whole meaning is present: as a paragraph when the row is open, as the editor's value when editing.
    const meaningKept = meaning === null ? true : textarea !== null ? textarea.value === meaning : Array.from(mainElement.querySelectorAll('p:not([hidden])')).some(node => node.textContent === meaning && node.closest('details:not([open])') === null);
    measured.push({
      case: `${name} [${view}]`, view, words: wordCount(visibleText(mainElement), language), filled: filled(),
      longLabels: actionButtons().map(item => visibleText(item)).filter(label => [...label].length > 22), meaningKept,
    });
  };
  const show = (name: string, view: View, language: Language, state: FirstRunState, open: readonly string[] = [], editors: readonly string[] = [], meanings: Readonly<Record<string, string>> = {}, originals: Readonly<Record<string, string>> = {}) => {
    const rendered = render(<FirstRunScreen controller={fixed(state)} language={language} onLanguage={() => {}} view={view} stagesDone={ALL_DONE} intents={{ onContinue() {}, startFromConversation: { href: '#/ask' } }} />);
    measure(`${name} closed`, view, language, null);
    for (const id of open) {
      act(() => { rowButton(id).click(); });
      measure(`${name} ${id} open`, view, language, meanings[id] ?? null);
      expect(disclosure(id, 'binding')).toBeNull();
      expect(disclosure(id, 'fields')).toBeNull();
      const originalMeaning = originals[id];
      if (originalMeaning !== undefined) {
        const detail = must(disclosure(id, 'original'), `${name} ${id} original`);
        expect(detail.open).toBe(false);
        const summary = must(detail.querySelector('summary'));
        act(() => { summary.click(); });
        expect(detail.open).toBe(true);
        expect(within(row(id)).queryByRole('button', { name: text(language, 'FR-08.row.accept') })).toBeNull();
        expect(row(id).querySelector('[data-origin="changed"]')?.hasAttribute('hidden')).toBe(true);
        expect(row(id).querySelector('[data-origin="engine"]')?.textContent).toBe(originalMeaning);
        measure(`${name} ${id} original settled`, view, language, originalMeaning);
        act(() => { summary.click(); });
        expect(detail.open).toBe(false);
        measure(`${name} ${id} current restored`, view, language, meanings[id] ?? null);
      }
      if (editors.includes(id)) {
        act(() => { changeButton(id).click(); });
        expect(document.querySelector('textarea'), `${name} ${id} editor`).not.toBeNull();
        measure(`${name} ${id} editor`, view, language, meanings[id] ?? null);
        expect(disclosure(id, 'original')).toBeNull();
        act(() => { button(text(language, 'FR-08.edit.discard'), within(row(id))).click(); });
        measure(`${name} ${id} discarded`, view, language, meanings[id] ?? null);
      }
    }
    rendered.unmount();
  };
    for (const language of ['en', 'hi'] as const) {
      show('FR-06', view, language, { kind: 'choose', context, packs, current: null });
      for (const pack of packs) {
        const names = pack.definitions.map(item => item.name);
        const meanings = Object.fromEntries(pack.definitions.map(item => [item.name, item.meaning]));
        const ids = [...names, 'settings'];
        for (const phase of ['proposed', 'accepted'] as const) {
          const review = reviewOf(pack, phase);
          show(`${pack.pack} ${phase} ${language}`, view, language, { kind: 'review', context, packs, current: null, review, publishing: false, notice: null }, ids, names, meanings);
        }
        const review = reviewOf(pack, 'accepted');
        const published = summaryOf(frozen.compile(pack, 1));
        show(`${pack.pack} published ${language}`, view, language, {
          kind: 'published', context, published, review, reviewDigest: DIGEST,
          handoff: { workspaceId: WORKSPACE.id, memberId: MEMBER_ID, contextKey: context.contextKey, dictionary: published, reviewDigest: DIGEST, pending: { calendar: 'not-configured', timeZone: 'not-configured', ordering: 'not-configured', todayDefaults: 'not-configured' } },
        }, ids, [], meanings);
        show(`${pack.pack} unknown ${language}`, view, language, { kind: 'unknown', code: 'PUBLISH_UNKNOWN', reconciling: false, attempt: { pack: pack.pack, label: pack.label, reviewDigest: DIGEST } });
        // The independently failing bounded Earned fixture preserves every Engine word,
        // plus one word. Also cover saved Hindi wording, accepted provenance and the exact
        // textarea.value in all views and both interface languages. User text is never truncated.
        for (const fixture of ['engine-prefix', 'hindi'] as const) {
          const id = 'earned';
          const proposed = must(meanings[id]);
          const edited = fixture === 'engine-prefix' ? `Reviewed: ${proposed}` : 'इस अवधि में दी गई सेवा का मूल्य, केवल दर्ज मान्यता घटनाओं के आधार पर।';
          let changed = withDigest(must(changeMeaning(review, id, edited, review.revision)), DIGEST);
          for (const phase of ['changed', 'accepted'] as const) {
            if (phase === 'accepted') changed = must(acceptRow(changed, id, must(pinOf(changed))));
            show(`${pack.pack} ${id} ${phase} ${fixture} bounded ${language}`, view, language,
              { kind: 'review', context, packs, current: null, review: changed, publishing: false, notice: null },
              [id], [id], { [id]: edited }, { [id]: proposed });
          }
          const changedPublished = summaryOf(frozen.compile(changed.draft, 1));
          show(`${pack.pack} ${id} published ${fixture} bounded ${language}`, view, language, {
            kind: 'published', context, published: changedPublished, review: changed, reviewDigest: DIGEST,
            handoff: { workspaceId: WORKSPACE.id, memberId: MEMBER_ID, contextKey: context.contextKey, dictionary: changedPublished, reviewDigest: DIGEST, pending: { calendar: 'not-configured', timeZone: 'not-configured', ordering: 'not-configured', todayDefaults: 'not-configured' } },
          }, [id], [], { [id]: edited }, { [id]: proposed });
        }
      }
      show(`unknown hidden ${language}`, view, language, { kind: 'unknown', code: 'VAULT_LOCKED', reconciling: false, attempt: null });
      show(`unattributed ${language}`, view, language, { kind: 'unknown', code: 'PUBLISH_UNATTRIBUTED', reconciling: false, attempt: { pack: 'ecommerce', label: 'Online brand', reviewDigest: DIGEST } });
    }
  expect(measured).toHaveLength(978);
  expect(measured.filter(item => item.words > BUDGET[item.view]).map(item => `${item.case}: ${item.words}`)).toEqual([]);
  expect(measured.filter(item => item.filled > 1).map(item => item.case)).toEqual([]);
  expect(measured.filter(item => item.longLabels.length > 0).map(item => `${item.case}: ${item.longLabels.join(' | ')}`)).toEqual([]);
  expect(measured.filter(item => !item.meaningKept).map(item => item.case)).toEqual([]);
  const widest = measured.reduce((a, b) => (a.words >= b.words ? a : b));
  expect(widest.words, widest.case).toBeLessThanOrEqual(BUDGET[view]);
  console.info(JSON.stringify({ view, measuredStates: measured.length, maximumWords: widest.words, maximumCase: widest.case, budget: BUDGET[view] }));
  // All three views carry exact meaning words beside the word and state.
  expect(PREVIEW_WORDS_BY_VIEW).toEqual({ simple: 1, guided: 2, books: 3 });
});
