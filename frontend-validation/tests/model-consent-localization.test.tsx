import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider, missingHindiKeys } from '../../app/ui/src/app/text';
import type { Language } from '../../app/ui/src/app/presentation';
import { validateModelPreview, type CheckedModelPreview } from '../../app/ui/src/bridge/conversation-contract';
import { ModelConsentSheet, type ModelConsentStage } from '../../app/ui/src/patterns/ModelConsentSheet';
import { knownModelDisclosureTranslationKey, type ModelDisclosureFamily } from '../../app/ui/src/patterns/model-disclosure-translation';
import { conversationRequestFixture, groundedFixture, planningPreviewFixture, synthesisPreviewFixture } from '../../app/ui/tests/conversation-fixtures';
import en from '../../app/ui/src/text/en.json';
import hi from '../../app/ui/src/text/hi.json';

// Synthetic checked previews, no host or provider. No browser launch or pixel claim.
const families: readonly ModelDisclosureFamily[] = ['question', 'definition', 'continuation', 'synthesis'];
const originalLabel = hi['ASK.consent.disclosure.original'];
const messages: Readonly<Record<string, string>> = hi;
const englishMessages: Readonly<Record<string, string>> = en;
const fields = {
  question: 'questionDisclosureWarning', definition: 'definitionDisclosureWarning', continuation: 'continuationDisclosureWarning',
} as const;

function previewCase(family: ModelDisclosureFamily, warning?: string): { preview: CheckedModelPreview; stage: ModelConsentStage; warning: string } {
  if (family === 'synthesis') {
    const tools = groundedFixture();
    const raw = { ...synthesisPreviewFixture(tools), ...(warning === undefined ? {} : { synthesisDisclosureWarning: warning }) };
    return { preview: validateModelPreview(raw, { id: tools.id }), stage: 'final-writing', warning: raw.synthesisDisclosureWarning };
  }
  const request = { ...conversationRequestFixture(), continuationId: 'conversation_clarification_fixture' };
  const raw = { ...planningPreviewFixture(request), ...(warning === undefined ? {} : { [fields[family]]: warning }) };
  const checked = validateModelPreview(raw, request);
  if (checked.purpose !== 'conversation') throw new Error('Fixture must be a planning preview');
  const actualWarning = checked[fields[family]];
  if (actualWarning === undefined) throw new Error('Fixture must include the selected warning');
  return { preview: checked, stage: 'planning', warning: actualWarning };
}

function show(family: ModelDisclosureFamily, language: Language = 'hi', warning?: string) {
  const fixture = previewCase(family, warning);
  const onSendReviewed = vi.fn();
  const onClose = vi.fn();
  const rendered = render(
    <TextProvider language={language}>
      <ModelConsentSheet stage={fixture.stage} preview={fixture.preview} origin={null} onClose={onClose} onSendReviewed={onSendReviewed} />
    </TextProvider>,
  );
  return { ...fixture, ...rendered, onSendReviewed, onClose };
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network in consent localization tests'));
});

afterEach(() => {
  cleanup();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test.each(families)('Hindi %s disclosure has its full companion and visibly retains the exact Engine warning', (family) => {
  const { warning, container, onSendReviewed } = show(family);
  const key = knownModelDisclosureTranslationKey(family, warning);
  expect(key).toBe(`ASK.consent.disclosure.${family}`);
  if (key === undefined) throw new Error('Known fixture warning must have a translation');
  const translated = screen.getByText(messages[key]!);
  const original = screen.getByText(warning);
  expect(translated.getAttribute('lang')).toBe('hi');
  expect(original.getAttribute('lang')).toBe('en');
  expect(original.textContent).toBe(warning);
  expect(original.hidden).toBe(false);
  expect(original.closest('details, [hidden]')).toBeNull();
  expect(translated.parentElement).toBe(original.parentElement);
  expect(original.previousElementSibling?.textContent).toBe(originalLabel);
  expect(container.querySelector('img, script, iframe')).toBeNull();
  expect(onSendReviewed).not.toHaveBeenCalled();
});

test.each(families)('a changed %s Engine warning stays exact and has no stale Hindi explanation', (family) => {
  const known = previewCase(family).warning;
  const warning = `${known}\nNew Engine instruction: <img src="private-fixture" onerror="mustNotRun()">`;
  const { container, onSendReviewed } = show(family, 'hi', warning);
  expect(screen.getByText(warning, { exact: true, normalizer: value => value }).textContent).toBe(warning);
  expect(screen.queryByText(messages[`ASK.consent.disclosure.${family}`]!)).toBeNull();
  expect(container.querySelector('img, script, iframe')).toBeNull();
  expect(onSendReviewed).not.toHaveBeenCalled();
});

test.each(families)('the %s translation requires both the exact family and complete Engine text', (family) => {
  const warning = previewCase(family).warning;
  expect(knownModelDisclosureTranslationKey(family, warning)).toBe(`ASK.consent.disclosure.${family}`);
  for (const altered of [` ${warning}`, `${warning}\n`, warning.replace('Shape', 'Samples'), 'Unreviewed disclosure', '<script>unknown()</script>']) {
    expect(knownModelDisclosureTranslationKey(family, altered)).toBeUndefined();
  }
  for (const other of families.filter(value => value !== family)) {
    expect(knownModelDisclosureTranslationKey(other, warning)).toBeUndefined();
  }
});

test.each(['question', 'synthesis'] as const)('English %s review remains verbatim without duplicate companion paragraphs', (family) => {
  const { warning, onSendReviewed } = show(family, 'en');
  expect(screen.getAllByText(warning)).toHaveLength(1);
  expect(screen.queryByText(en['ASK.consent.disclosure.original'])).toBeNull();
  expect(screen.queryByText(originalLabel)).toBeNull();
  expect(onSendReviewed).not.toHaveBeenCalled();
});

test.each(['question', 'synthesis'] as const)('Hindi %s explanations preserve question, payload, digest and deliberate one-request consent', async (family) => {
  const user = userEvent.setup();
  const { preview, stage, container, onSendReviewed, onClose, rerender } = show(family);
  const before = JSON.stringify(preview);
  expect(screen.getAllByText(preview.naturalQuestion, { exact: true, normalizer: value => value }).every(node => node.textContent === preview.naturalQuestion)).toBe(true);
  expect(container.querySelector('pre')?.textContent).toBe(preview.payload);
  expect(screen.getByText(preview.digest).textContent).toBe(preview.digest);
  if (preview.purpose === 'conversation' && preview.continuation !== undefined) {
    expect(screen.getAllByText(preview.continuation.originalQuestion, { exact: true, normalizer: value => value }).every(node => node.textContent === preview.continuation!.originalQuestion)).toBe(true);
    expect(screen.getAllByText(preview.continuation.clarification).every(node => node.textContent === preview.continuation!.clarification)).toBe(true);
  }
  await user.keyboard('{Control>}{Enter}{/Control}');
  expect(onSendReviewed).not.toHaveBeenCalled();
  const key = `ASK.consent.${stage}.send`;
  await user.click(screen.getByRole('button', { name: messages[key]! }));
  expect(onSendReviewed).toHaveBeenCalledExactlyOnceWith({ previewId: preview.id, digest: preview.digest, consent: true });
  rerender(<TextProvider language="en"><ModelConsentSheet stage={stage} preview={preview} origin={null} onClose={onClose} onSendReviewed={onSendReviewed} /></TextProvider>);
  expect(onSendReviewed).toHaveBeenCalledTimes(1);
  expect(container.querySelector('pre')?.textContent).toBe(preview.payload);
  expect(JSON.stringify(preview)).toBe(before);
  await user.click(screen.getByRole('button', { name: en['ASK.consent.cancel'] }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onSendReviewed).toHaveBeenCalledTimes(1);
});

test('catalogue companions match the pinned Engine text and preserve privacy, separate evidence, and one-request scope', () => {
  const engine = readFileSync(resolve('platform/runtime/gateway.ts'), 'utf8');
  expect(missingHindiKeys()).toEqual([]);
  for (const family of families) {
    const warning = previewCase(family).warning;
    const key = `ASK.consent.disclosure.${family}`;
    expect(engine).toContain(`: '${warning}'`);
    expect(englishMessages[key]).toBe(warning);
    const translation = messages[key]!;
    expect(translation).toMatch(/[\u0900-\u097f]/);
    expect(translation).not.toMatch(/[?\ufffd]/);
    expect(translation).toMatch(/साक्ष्य की संरचना \(Shape\) से अलग/);
    expect(translation).toMatch(/निजी नामों/);
    expect(translation).toMatch(/निर्देशों/);
    expect(translation).toMatch(/अनुमति देने से पहले/);
    if (family !== 'synthesis') expect(translation).toMatch(/रकमों/);
  }
  expect(hi['ASK.consent.disclosure.definition']).toMatch(/परिभाषाएँ और पैरामीटरों के अर्थ/);
  expect(hi['ASK.consent.disclosure.continuation']).toMatch(/आपके वर्तमान जवाब के ठीक उसी पाठ/);
  expect(hi['ASK.consent.disclosure.continuation']).toMatch(/पहले की सभी बातचीत/);
  expect(hi['ASK.consent.disclosure.synthesis']).toMatch(/स्वीकार किए गए दावों का पाठ/);
  expect(hi['ASK.consent.disclosure.synthesis']).toMatch(/अलग अनुरोध को एक बार भेजने/);
  expect(originalLabel).toMatch(/[\u0900-\u097f]/);
  expect(originalLabel).not.toMatch(/[?\ufffd]/);
});
