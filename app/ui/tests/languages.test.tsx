// C5 task 37 (was english-only.test.tsx): English is eager and the app starts in it; Hindi is a pack the owner picks,
// loaded only then. A key the pack lacks shows the English words. Only Chausar's own screen words are in the pack.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { App } from '../src/shell/App';
import { FakeEngine, createFakeClient } from '../src/engine/fake';
import { CATALOGUES, pickLanguage, pluralForm, prepareLanguage, say, TextProvider, useLanguage, useT, type Catalogue, type Message } from '../src/text';
import { MOVE_STATE_LABEL, PLAN_FIXED_WORDS } from '../../../platform/runtime/venture/chief/plan-core';
import { REVIEW_FIXED_WORDS, REVIEW_OFFER_TITLE, REVIEW_WORDS, STEP_FIXED_WORDS, STEP_WORDS, type ChiefPlanStep } from '../../../platform/runtime/venture/chief/plan-view';
import { QUEUE_FIXED_WORDS } from '../../../platform/runtime/venture/views/queue-words';
import { SEARCH_LINES } from '../../../platform/runtime/venture/customers/find-states';
import { formatClock } from '../../../platform/runtime/owner-format';
import { PLAN_WORD_KEYS } from '../src/places/today/plan-words';
import { decidedWords } from '../src/parts/ApprovalRow';
import { wordedRow } from '../src/places/today/OutreachRows';
import type { ChiefPlanView, EngineClient, QueueRow } from '../src/engine/types';

const TEXT = join(import.meta.dirname, '../src/text');
const read = (path: string) => readFileSync(join(import.meta.dirname, path), 'utf8');
const texts = (message: Message | undefined): string[] => (message === undefined ? [] : typeof message === 'string' ? [message] : Object.values(message).filter((m): m is string => typeof m === 'string'));
/** The named values a message uses, across all its forms, sorted. */
const placeholders = (message: Message | undefined): string[] => [...new Set(texts(message).flatMap((text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)))].sort();
const pack = (): Catalogue => {
  const out: Record<string, Message> = {};
  for (const file of readdirSync(join(TEXT, 'hi'))) Object.assign(out, JSON.parse(readFileSync(join(TEXT, 'hi', file), 'utf8')));
  return out;
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); document.documentElement.lang = 'en'; });

describe('who picks the language', () => {
  it("the computer's language never picks Hindi", () => {
    expect(pickLanguage(['hi-IN', 'hi'])).toBe('en');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['hi-IN', 'hi']);
    expect(pickLanguage()).toBe('en');
    expect(read('../src/text/index.tsx')).not.toMatch(/navigator\.language/);
    expect(read('../src/main.tsx')).not.toMatch(/navigator\.language|[?&]lang=/);
  });

  it('the owner picks it: the words change once the pack lands, and the page says its language', async () => {
    window.location.hash = '#/business/app';
    render(<App client={createFakeClient(new FakeEngine())} language="en" />);
    const row = await screen.findByRole('region', { name: 'Language' });
    expect(document.documentElement.lang).toBe('en');
    await act(async () => { fireEvent.change(within(row).getByLabelText('Language'), { target: { value: 'hi' } }); });
    await waitFor(() => expect(document.documentElement.lang).toBe('hi'));
    expect(await screen.findByRole('region', { name: 'भाषा' })).toBeTruthy();
    expect((await screen.findByRole('region', { name: 'भाषा' })).textContent).toContain('मशीन');
    await act(async () => { fireEvent.change(within(screen.getByRole('region', { name: 'भाषा' })).getByLabelText('भाषा'), { target: { value: 'en' } }); });
    await waitFor(() => expect(document.documentElement.lang).toBe('en'));
    expect(await screen.findByRole('region', { name: 'Language' })).toBeTruthy();
  });

  it('a stored Hindi is read at the start, with English on screen until then', async () => {
    const engine = new FakeEngine();
    await engine.request('app.preferences.set', { language: 'hi' });
    window.location.hash = '#/business/app';
    render(<App client={createFakeClient(engine)} language="en" />);
    await waitFor(() => expect(document.documentElement.lang).toBe('hi'));
    expect(await screen.findByRole('region', { name: 'भाषा' })).toBeTruthy();
  });
});

describe('the rule the repo states', () => {
  it('AGENTS.md and CONTRIBUTING.md say English and Hindi, never English only', () => {
    const rules = readFileSync(resolve(import.meta.dirname, '../../../AGENTS.md'), 'utf8');
    expect(rules).not.toMatch(/English only/i);
    expect(rules).toContain("English and Hindi: Hindi is a pack the owner picks, loaded only then; a missing Hindi key shows the English words.");
    expect(readFileSync(resolve(import.meta.dirname, '../../../CONTRIBUTING.md'), 'utf8')).not.toMatch(/English only/i);
  });
});

describe('the pack is lazy', () => {
  it('English is in the first chunk; Hindi and its fonts are not', () => {
    const source = read('../src/text/index.tsx');
    expect(source).toMatch(/import\.meta\.glob\('\.\/en\/\*\.json', \{ eager: true/);
    const lazy = /import\.meta\.glob\('\.\/hi\/\*\.json'([^)]*)\)/.exec(source);
    expect(lazy, 'the Hindi glob').not.toBeNull();
    expect(lazy![1]).not.toMatch(/eager/);
    expect(source).toMatch(/import\('\.\.\/tokens\/fonts-hi\.css'\)/);
    expect(Object.keys(CATALOGUES)).toEqual(['en']);
    expect(read('../src/tokens/fonts.css')).not.toContain('Devanagari');
    expect(read('../src/tokens/tokens.css')).not.toContain('@font-face');
    expect(read('../src/main.tsx')).not.toContain('fonts-hi');
  });

  it('the pack font files, their licence and their notice are here, and every url is local', () => {
    const css = read('../src/tokens/fonts-hi.css');
    const files = readdirSync(join(import.meta.dirname, '../assets/fonts'));
    const urls = [...css.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]!);
    expect(urls).toHaveLength(2);
    for (const url of urls) { expect(url).not.toMatch(/^https?:/); expect(files).toContain(url.split('/').pop()); }
    expect(existsSync(resolve(import.meta.dirname, '../assets/fonts/NotoSansDevanagari-OFL.txt'))).toBe(true);
    expect(readFileSync(resolve(import.meta.dirname, '../../../NOTICE'), 'utf8')).toContain('Noto Sans Devanagari');
    const manifest = JSON.parse(read('../assets/fonts/manifest.json')) as { fonts: { file: string; bytes: number }[]; totalFontBytes: number; exclusiveFontBudgetBytes: number };
    expect(manifest.fonts.reduce((sum, font) => sum + font.bytes, 0)).toBe(manifest.totalFontBytes);
    expect(manifest.totalFontBytes).toBeLessThanOrEqual(manifest.exclusiveFontBudgetBytes);
  });

  it('prepareLanguage loads the pack, and English needs nothing', async () => {
    await prepareLanguage('en');
    await prepareLanguage('hi');
    function Words() { const t = useT(); return <p>{t('common.language.title')}</p>; }
    render(<TextProvider language="hi"><Words /></TextProvider>);
    expect(screen.getByText('भाषा')).toBeTruthy();
  });
});

describe('what shows', () => {
  const hindi: Catalogue = { 'x.here': 'यहाँ {name}', 'x.count': { one: '{count} काम', other: '{count} काम हैं' } };
  const english: Catalogue = { 'x.here': 'Here {name}', 'x.missing': 'Only in English {name}', 'x.count': { one: '{count} job', other: '{count} jobs' }, 'x.plural': { one: '{count} day', other: '{count} days' } };

  it('a key missing in Hindi shows the English words, with English plurals', () => {
    expect(say(english, hindi, 'hi', 'x.here', { name: 'A' })).toBe('यहाँ A');
    expect(say(english, hindi, 'hi', 'x.missing', { name: 'A' })).toBe('Only in English A');
    expect(say(english, hindi, 'hi', 'x.plural', { count: '0' })).toBe('0 days');
    expect(say(english, hindi, 'en', 'x.here', { name: 'A' })).toBe('Here A');
  });

  it('with no pack loaded yet, or an English pick, English shows', () => {
    expect(say(english, null, 'hi', 'x.here', { name: 'A' })).toBe('Here A');
    function Words() { const t = useT(); return <p>{useLanguage()}:{t('place.today')}</p>; }
    render(<TextProvider language="en"><Words /></TextProvider>);
    expect(screen.getByText('en:Today')).toBeTruthy();
  });

  it('Hindi plurals: one for 0 and 1', () => {
    expect(pluralForm('0', 'hi')).toBe('one');
    expect(pluralForm('1', 'hi')).toBe('one');
    expect(pluralForm('2', 'hi')).toBe('other');
    expect(pluralForm('0', 'en')).toBe('other');
    expect(say(english, hindi, 'hi', 'x.count', { count: '0' })).toBe('0 काम');
    expect(say(english, hindi, 'hi', 'x.count', { count: '2' })).toBe('2 काम हैं');
  });
});

describe('the Hindi catalogue', () => {
  const hi = pack();
  const en = CATALOGUES.en;

  it('every Hindi key exists in English, with the same placeholders and the same kind of message', () => {
    expect(Object.keys(hi).filter((key) => !(key in en))).toEqual([]);
    for (const [key, message] of Object.entries(hi)) {
      expect(placeholders(message), key).toEqual(placeholders(en[key]));
      expect(typeof message, key).toBe(typeof en[key]);
    }
  });

  it('holds each key in the file its English sits in', () => {
    for (const file of readdirSync(join(TEXT, 'hi'))) {
      const english = JSON.parse(readFileSync(join(TEXT, 'en', file), 'utf8')) as Record<string, unknown>;
      for (const key of Object.keys(JSON.parse(readFileSync(join(TEXT, 'hi', file), 'utf8')) as object)) expect(key in english, `${file}: ${key}`).toBe(true);
    }
  });

  it('no em dash', () => {
    for (const [key, message] of Object.entries(hi)) {
      expect(JSON.stringify(message), key).not.toContain('\u2014');
    }
  });

  it('the Latin words in Hindi are names, codes or quoted labels', () => {
    const found = Object.entries(hi).flatMap(([key, message]) => texts(message).flatMap((text) => strayLatin(text).map((word) => `${key}: ${word}`)));
    expect(found).toEqual([]);
  });

  it('one Hindi word per concept', () => {
    const found = Object.entries(hi).flatMap(([key, message]) => texts(message).flatMap((text) => GLOSSARY.filter(({ avoid }) => avoid.test(text)).map(({ concept, use }) => `${key}: "${text}" (${concept}: use ${use})`)));
    expect(found).toEqual([]);
  });

  it('hi-review.json lists what no person has read, once each, and every listed key has Hindi', () => {
    const review = JSON.parse(readFileSync(join(TEXT, 'hi-review.json'), 'utf8')) as { notYetReviewed: string[]; about: string };
    expect(review.about).toMatch(/not yet reviewed/i);
    expect(review.notYetReviewed.length).toBeGreaterThan(1000);
    expect(new Set(review.notYetReviewed).size).toBe(review.notYetReviewed.length);
    expect(review.notYetReviewed.filter((key) => !(key in hi))).toEqual([]);
    // Places that never had Hindi before this pack are all in the queue.
    expect(review.notYetReviewed).toEqual(expect.arrayContaining(['common.language.title', 'business.directNeeds']));
  });

  it('a Hindi count takes the body face', () => {
    expect(read('../src/tokens/base.css')).toMatch(/:lang\(hi\) \[data-count\]/);
    expect(read('../src/tokens/tokens.css')).toMatch(/--font: 'Instrument Sans', 'Noto Sans Devanagari'/);
  });

  // Fix round 4 (real-app problem 18): every screen word of the app has its Hindi line. A missing key shows English by
  // design, so the check is here: nothing in the English pack is left without one.
  it('no English key is left without its Hindi line', () => {
    expect(Object.keys(en).filter((key) => !(key in hi))).toEqual([]);
  });

  // The rail and the page it opens are one place: English calls both Settings, and Hindi once called the rail "बिज़नेस".
  it('the rail names Settings the way the Settings page names itself, in both languages', () => {
    expect(en['place.business']).toBe(en['business.settings.nav']);
    expect(hi['place.business']).toBe(hi['business.settings.nav']);
  });
});

/*
 * Fix round 4 (real-app problem 18c): with Hindi on, Today's week kept the state of each move in English ("Waiting on
 * you"). A state is one of five the engine names by code beside its own English label, so it is the app's word: said
 * from the pack by that code. The words of a move itself are what Chausar wrote, and those stay as written (the
 * Language note says so).
 */
describe('Today in Hindi: the app\'s own words come from the pack', () => {
  it('the state of each move this week is Hindi; the move the engine wrote stays as written', async () => {
    const engine = new FakeEngine();
    await engine.request('app.preferences.set', { language: 'hi' });
    window.location.hash = '#/today';
    render(<App client={createFakeClient(engine)} language="en" />);
    await waitFor(() => expect(document.documentElement.lang).toBe('hi'));
    const week = await waitFor(() => { const found = document.querySelector<HTMLElement>('[data-chief-plan]'); expect(found?.querySelector('[data-move]')).toBeTruthy(); return found!; });
    const states = [...week.querySelectorAll('[data-move]')].map((move) => [move.getAttribute('data-state'), move.querySelector('span:nth-of-type(3)')?.textContent]);
    expect(states.length).toBeGreaterThan(1);
    const pack = CATALOGUES.en;
    for (const [state, said] of states) {
      expect(said, String(state)).toBe(say(pack, hi_(), 'hi', `state.move.${state}`));
      expect(said, String(state)).not.toBe(pack[`state.move.${state}`]);
    }
    expect(week.textContent).not.toMatch(/Waiting on you|Planned|Dropped|On Today for your approval/);
  });

  // Real-app problem 18c: the setup moves, the line code writes for today, the first step while the plan waits and the
  // daily review's offer are code's own fixed words, so the pack says them too.
  it('the plan\'s fixed words are said from the pack in Hindi: no setup move, line, step or offer title stays English', async () => {
    // Ledgerline, as the tour saw it: its plan waits, so its setup moves, the line and the review offer all show.
    const engine = new FakeEngine();
    await engine.request('workspace.open', { folder: 'ledgerline' });
    await engine.request('app.preferences.set', { language: 'hi' });
    window.location.hash = '#/today';
    render(<App client={createFakeClient(engine)} language="en" />);
    await waitFor(() => expect(document.documentElement.lang).toBe('hi'));
    const week = await waitFor(() => { const found = document.querySelector<HTMLElement>('[data-chief-plan]'); expect(found?.querySelector('[data-move]')).toBeTruthy(); return found!; });
    const english = [...Object.values(PLAN_FIXED_WORDS), REVIEW_OFFER_TITLE];
    const shown = document.body.textContent ?? '';
    expect(english.filter((words) => shown.includes(words))).toEqual([]);
    // What was there to say: the first setup move, in the Hindi pack's words.
    expect(week.textContent).toContain(say(CATALOGUES.en, hi_(), 'hi', 'today.plan.fixed.acceptPlan'));
  });

  it('in English the pack says each fixed plan line exactly as code writes it', () => {
    for (const [words, key] of PLAN_WORD_KEYS) expect(CATALOGUES.en[key], key).toBe(words);
    // Every fixed line code writes for Today has its key: none is left to show in English under Hindi.
    const fixed = [...Object.values(PLAN_FIXED_WORDS), REVIEW_OFFER_TITLE, ...Object.values(STEP_FIXED_WORDS), ...Object.values(REVIEW_FIXED_WORDS), ...Object.values(QUEUE_FIXED_WORDS), SEARCH_LINES.approved, SEARCH_LINES.running];
    expect(fixed.filter((words) => !PLAN_WORD_KEYS.has(words))).toEqual([]);
    // The two lines with a part in them read in English exactly as the engine builds them.
    const en = (key: string, values: Record<string, string>) => say(CATALOGUES.en, null, 'en', key, values);
    expect(en('today.plan.also', { titles: 'Connect your AI, Keep this business' })).toBe(STEP_WORDS.also(['Connect your AI', 'Keep this business']));
    expect(en('today.plan.reviewAt', { time: formatClock('08:00') })).toBe(REVIEW_WORDS.line(true, '08:00'));
  });

  it('in English each state reads exactly as the engine words it', () => {
    for (const [state, label] of Object.entries(MOVE_STATE_LABEL)) expect(CATALOGUES.en[`state.move.${state}`], state).toBe(label);
  });
});

/*
 * Round 5 (re-check 082): with Hindi on, Today still said "Also waiting: Keep this business.", the step's "Done",
 * "Daily review at 8:00 am.", "Plan accepted." and the "Keep this business" card in English. Each is a line code writes
 * the same every time (or with only a time or the cards' own titles in it), so the pack says it.
 */
describe('Today in Hindi, round 5: the step, the review line, the setup card and the plan\'s decided line', () => {
  const hiSay = (key: string, values?: Record<string, string>) => say(CATALOGUES.en, hi_(), 'hi', key, values);

  it('the step\'s Done, the also-waiting line and the review line are Hindi; no fixed English line is left', async () => {
    const engine = new FakeEngine();
    await engine.request('app.preferences.set', { language: 'hi' });
    const fake = createFakeClient(engine);
    const request = fake.request.bind(fake);
    const step: ChiefPlanStep = { kind: 'move', title: 'Prepare sample descriptions.', line: null, action: { id: 'done', label: STEP_FIXED_WORDS.done, moveId: 'mv_sample_2' }, agent: null, figure: null, goalAfterPercent: null, by: 'chief',
      also: { line: STEP_WORDS.also([QUEUE_FIXED_WORDS.keep]), rowIds: ['q-setup-keep'], titles: [QUEUE_FIXED_WORDS.keep] } };
    const client: EngineClient = {
      ...fake,
      request: (async (method: string, params?: unknown) => {
        const reply = await request(method as never, params as never);
        if (method !== 'venture.chief.plan.get') return reply;
        const view = reply as unknown as ChiefPlanView;
        return { ...view, next: step, review: { ...view.review, on: true, offer: null, time: '08:00', note: null, consent: null, line: REVIEW_WORDS.line(true, '08:00') } };
      }) as EngineClient['request'],
    };
    window.location.hash = '#/today';
    render(<App client={client} language="en" />);
    await waitFor(() => expect(document.documentElement.lang).toBe('hi'));
    const tile = await waitFor(() => { const found = document.querySelector<HTMLElement>('[data-also-waiting]'); expect(found).toBeTruthy(); return found!.closest('section')!; });
    expect(tile.querySelector('[data-also-waiting]')!.textContent).toBe(hiSay('today.plan.also', { titles: hiSay('today.fixed.keep') }));
    expect(within(tile).getByRole('button', { name: hiSay('today.plan.step.done') })).toBeTruthy();
    const week = document.querySelector<HTMLElement>('[data-chief-plan]')!;
    expect(week.textContent).toContain(hiSay('today.plan.reviewAt', { time: formatClock('08:00') }));
    const shown = document.body.textContent ?? '';
    expect(['Also waiting', 'Daily review at', QUEUE_FIXED_WORDS.keep, QUEUE_FIXED_WORDS.keepLine, QUEUE_FIXED_WORDS.planAccepted].filter((words) => shown.includes(words))).toEqual([]);
  });

  it('the Keep this business card and the plan\'s decided line are said from the pack; a line with a name stays as written', () => {
    const t = (key: string, values?: Record<string, string | number>) => say(CATALOGUES.en, hi_(), 'hi', key, values as Record<string, string>);
    const keep: QueueRow = { id: 'q-setup-keep', businessId: 'b', businessName: 'B', kind: 'setup', createdAt: '2026-11-16T19:43:00.000Z', digest: 'd',
      title: QUEUE_FIXED_WORDS.keep, line: QUEUE_FIXED_WORDS.keepLine, actions: [{ id: 'keep', label: 'Keep it', primary: true }] };
    const worded = wordedRow(keep, t);
    expect([worded.title, worded.line, worded.actions[0]!.label]).toEqual([hiSay('today.fixed.keep'), hiSay('today.fixed.keepLine'), hiSay('today.action.keep')]);
    const prices = { ...keep, id: 'q-setup-prices', title: 'Set your prices', line: 'Cake box has no price yet.' };
    expect(wordedRow(prices, t).line).toBe('Cake box has no price yet.');
    const plan: QueueRow = { ...keep, id: 'q-plan', kind: 'plan', title: 'Your plan is ready. Read it.', viewRef: { kind: 'plan', id: 'bp_1' } };
    expect(decidedWords(plan, QUEUE_FIXED_WORDS.planAccepted, t)).toEqual({ title: null, line: hiSay('today.fixed.planAccepted') });
    expect(decidedWords(plan, 'New price for Monthly books accepted.', t).line).toBe('New price for Monthly books accepted.');
    // English reads exactly the engine's words.
    const enT = (key: string, values?: Record<string, string | number>) => say(CATALOGUES.en, null, 'en', key, values as Record<string, string>);
    expect(wordedRow(keep, enT)).toBe(keep);
    expect(decidedWords(plan, QUEUE_FIXED_WORDS.planAccepted, enT).line).toBe('Plan accepted.');
  });
});
const hi_ = pack;

/**
 * Latin words a Hindi string may hold: names of products, platforms, file kinds and Indian tax and bank terms, which stay
 * in Latin letters in Hindi too. Anything else in Latin letters must be a code or a label in quotes from another product.
 */
const LATIN_IN_HINDI = new Set([
  'Chausar', 'chausar', 'AI', 'UI', 'API', 'ID', 'CA', 'ICAI', 'GST', 'GSTIN', 'TDS', 'PAN', 'IFSC', 'UPI', 'OTP', 'US', 'HDFC',
  'CSV', 'PDF', 'Excel', 'SRT', 'VTT', 'MB', 'https', 'ffmpeg', 'GitHub', 'Lovable', 'Replit', 'Claude', 'Anthropic', 'Haiku', 'Sonnet',
  'Codex', 'WhatsApp', 'LinkedIn', 'Instagram', 'Facebook', 'Threads', 'TikTok', 'X', 'YouTube', 'Shorts',
  // Names and file kinds since the wave 6 removal.
  'Bolt', 'Tally', 'Razorpay', 'Google', 'Drive', 'Telegram', 'Gmail', 'Zoho', 'Slack', 'Discord', 'SMTP', 'IMAP', 'RBI', 'FBIL', 'GSTR', 'HSN', 'SAC', 'QR', 'URL', 'XML', 'JSON', 'ZIP', 'USB', 'GB', 'KB', 'USD', 'INR', 'GPT', 'OpenAI', 'Gemini', 'DeepSeek', 'Ollama', 'Windows', 'Mac', 'Linux', 'Zoom', 'LUT', 'HTML', 'CSS', 'APK', 'Ctrl', 'Enter', 'Esc', 'Tab', 'K', 'Stripe', 'PayPal', 'Calendly', 'Notion', 'Hermes', 'Luna', 'Terra', 'Cal', 'com',
  'Zerodha', 'Groww', 'Upstox', 'Dhan', 'Tailscale', 'Sarvam', 'ChatGPT', 'OpenRouter', 'MCP', 'SWIFT', 'ISIN', 'CIN', 'Code',
]);
const QUOTED = /'[^']*'|"[^"]*"|‘[^’]*’|“[^”]*”/g;
function strayLatin(text: string): string[] {
  const words = text.replace(/\{\w+\}/g, ' ').replace(QUOTED, ' ').match(/[A-Za-z][\w.:/\\-]*/g) ?? [];
  return words.map((word) => word.replace(/[.,:;]+$/, '')).filter((word) => !LATIN_IN_HINDI.has(word) && !/[.:/\\_\d]/.test(word) && !/^[a-z]+(?:-[a-z]+)+$/.test(word));
}

/** One Hindi word per concept, as the catalogue kept it before wave 6. */
const GLOSSARY: { concept: string; use: string; avoid: RegExp }[] = [
  { concept: 'approve, accept', use: 'मंज़ूर', avoid: /स्वीकार|अनुमोदन|अप्रूव|मंजूर/ },
  { concept: 'reject, turn down', use: 'नामंज़ूर', avoid: /ठुकरा|अस्वीकार|रिजेक्ट/ },
  { concept: 'receipt', use: 'रसीद', avoid: /रिसीट|पावती/ },
  { concept: 'agent', use: 'एजेंट', avoid: /एजेन्ट|एजंट|सहायक/ },
  { concept: 'business', use: 'बिज़नेस', avoid: /बिजनेस|व्यवसाय|कारोबार/ },
  { concept: 'client', use: 'क्लाइंट', avoid: /क्लाइन्ट|ग्राहक|कस्टमर/ },
  { concept: 'invoice', use: 'बिल', avoid: /इनवॉइस|इनवॉयस|इन्वॉइस|चालान|बीजक/ },
  { concept: 'draft', use: 'ड्राफ़्ट', avoid: /मसौद|ड्राफ्ट/ },
  { concept: 'price', use: 'दाम', avoid: /क़?ीमत/ },
  { concept: 'plan', use: 'प्लान', avoid: /योजना(?! में)/ },
  { concept: 'failed', use: 'फ़ेल', avoid: /विफल|असफल|नाकाम|फेल/ },
  { concept: 'version', use: 'वर्ज़न', avoid: /संस्करण|वर्शन/ },
  { concept: 'save', use: 'सेव', avoid: /सहेज/ },
  { concept: 'books (accounts)', use: 'बही-खाता', avoid: /किताब|बहीखाता|बुककीपिंग/ },
  { concept: 'journal', use: 'रोज़नामचा', avoid: /जर्नल/ },
  { concept: 'key', use: 'चाबी', avoid: /कुंजी|अपनी की(?![ऀ-ॿ])|की पेस्ट/ },
  { concept: 'self (spelling)', use: 'ख़ुद', avoid: /खुद/ },
  { concept: 'spend (spelling)', use: 'ख़र्च', avoid: /खर्च/ },
  { concept: 'date (spelling)', use: 'तारीख़', avoid: /तारीख(?!़)/ },
  { concept: 'need (spelling)', use: 'ज़रूर', avoid: /जरूर/ },
  { concept: 'file (spelling)', use: 'फ़ाइल', avoid: /फाइल/ },
];
