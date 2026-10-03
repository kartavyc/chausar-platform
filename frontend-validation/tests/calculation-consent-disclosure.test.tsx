import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Language } from '../../app/ui/src/app/presentation';
import { validateModelPreview } from '../../app/ui/src/bridge/conversation-contract';
import { ModelConsentSheet } from '../../app/ui/src/patterns/ModelConsentSheet';
import { conversationRequestFixture, planningPreviewFixture } from '../../app/ui/tests/conversation-fixtures';
import en from '../../app/ui/src/text/en.json';
import hi from '../../app/ui/src/text/hi.json';

// Map this file to frontend-validation/tests before running the red against the
// actual source. The proposal directory itself contains candidate component copies.
// These authored fields test presentation only, allowing the current checked
// projection to render before its separate contract repair. No production wire
// fields are stripped and no Engine, provider or outbound authority is created.
const currentWarning = 'Exact owner-requested periods and scenario assumptions are included separately from evidence Shape. Review them before approving this payload once; scenario inputs never alter source facts.';
const warnings = [
  { name: 'current', text: currentWarning },
  { name: 'changed', text: ' ' + currentWarning + '\nChanged Engine wording; review every explicit input before sending.' },
] as const;
const languages: readonly Language[] = ['en', 'hi'];
const cases = languages.flatMap(language => warnings.map(warning => ({
  language, name: warning.name, warning: warning.text,
})));
const titles: Readonly<Record<Language, string>> = {
  en: 'About your calculation inputs',
  hi: 'आपकी गणना के लिए दिए गए मानों के बारे में',
};
const messages = (language: Language): Readonly<Record<string, string>> => language === 'hi' ? hi : en;

function presentationPreview(warning: string) {
  const request = conversationRequestFixture();
  const checked = validateModelPreview(planningPreviewFixture(request), request);
  if (checked.purpose !== 'conversation') throw new Error('Fixture must be a planning preview');
  const metadata = {
    reviewedCalculationParameters: {},
    calculationParameterOrigins: {},
    calculationParametersDigest: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    calculationParameterDisclosure: {
      kind: 'owner-requested-calculation-parameters',
      period: null,
      comparePeriod: null,
      assumptions: null,
      missingInputClarifications: {
        change: 'Which current and comparison periods should I use?',
        scenario: 'What price change in basis points should I assume?',
      },
      origins: {},
    },
  } as const;
  return Object.freeze({ ...checked, ...metadata, calculationParameterDisclosureWarning: warning });
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network in calculation consent presentation checks'));
});

afterEach(() => {
  cleanup();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test.each(cases)('$language preserves the exact $name calculation warning and one deliberate review event', async ({ language, warning }) => {
  const user = userEvent.setup();
  const preview = presentationPreview(warning);
  const before = JSON.stringify(preview);
  const onClose = vi.fn();
  const onSendReviewed = vi.fn();
  const { container, rerender } = render(
    <TextProvider language={language}>
      <ModelConsentSheet stage="planning" preview={preview} origin={null} onClose={onClose} onSendReviewed={onSendReviewed} />
    </TextProvider>,
  );

  // The Engine warning is English, including unknown changed wording. The Hindi
  // heading is a title only; no Hindi companion for this warning is claimed.
  const warningNode = screen.getByText(warning, { exact: true, normalizer: value => value });
  expect(warningNode.textContent).toBe(warning);
  expect(warningNode.getAttribute('lang')).toBe('en');
  expect(screen.getByText(titles[language], { exact: true }).textContent).toBe(titles[language]);
  expect(screen.getAllByText(preview.naturalQuestion, { exact: true, normalizer: value => value }).every(node => node.textContent === preview.naturalQuestion)).toBe(true);
  expect(container.querySelector('pre')?.textContent).toBe(preview.payload);
  expect(screen.getByText(preview.digest, { exact: true }).textContent).toBe(preview.digest);
  expect(JSON.stringify(preview)).toBe(before);

  await user.keyboard('{Control>}{Enter}{/Control}');
  expect(onSendReviewed).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: messages(language)['ASK.consent.planning.send']! }));
  // This is a single explicit UI intent. Engine consent authority is tested
  // separately; a presentation callback cannot issue an outbound approval.
  expect(onSendReviewed).toHaveBeenCalledExactlyOnceWith({ previewId: preview.id, digest: preview.digest, consent: true });

  const nextLanguage: Language = language === 'en' ? 'hi' : 'en';
  rerender(
    <TextProvider language={nextLanguage}>
      <ModelConsentSheet stage="planning" preview={preview} origin={null} onClose={onClose} onSendReviewed={onSendReviewed} disabled />
    </TextProvider>,
  );
  expect(screen.getByText(warning, { exact: true, normalizer: value => value }).textContent).toBe(warning);
  expect(screen.getByText(titles[nextLanguage], { exact: true }).textContent).toBe(titles[nextLanguage]);
  expect(container.querySelector('pre')?.textContent).toBe(preview.payload);
  expect(screen.getAllByText(preview.naturalQuestion, { exact: true, normalizer: value => value }).every(node => node.textContent === preview.naturalQuestion)).toBe(true);
  expect(screen.getByText(preview.digest, { exact: true }).textContent).toBe(preview.digest);
  expect(JSON.stringify(preview)).toBe(before);
  await user.click(screen.getByRole('button', { name: messages(nextLanguage)['ASK.consent.planning.send']! }));
  expect(onSendReviewed).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: messages(nextLanguage)['ASK.consent.cancel']! }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onSendReviewed).toHaveBeenCalledTimes(1);
});
