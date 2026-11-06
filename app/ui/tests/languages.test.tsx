// C5 task 37 (was english-only.test.tsx): English is eager and the app starts in it; Hindi is a pack the owner picks,
// loaded only then. A key the pack lacks shows the English words. Only Chausar's own screen words are in the pack.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { App } from '../src/shell/App';
import { FakeEngine, createFakeClient } from '../src/engine/fake';
import { CATALOGUES, hindiCatalogue, pickLanguage, placeholders, pluralForm, prepareLanguage, say, TextProvider, useLanguage, useT, type Catalogue, type Message } from '../src/text';

const TEXT = join(import.meta.dirname, '../src/text');
const read = (path: string) => readFileSync(join(import.meta.dirname, path), 'utf8');
const texts = (message: Message | undefined): string[] => (message === undefined ? [] : typeof message === 'string' ? [message] : Object.values(message).filter((m): m is string => typeof m === 'string'));
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
    window.location.hash = '#/business/owner';
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
    window.location.hash = '#/business/owner';
    render(<App client={createFakeClient(engine)} language="en" />);
    await waitFor(() => expect(document.documentElement.lang).toBe('hi'));
    expect(await screen.findByRole('region', { name: 'भाषा' })).toBeTruthy();
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
    expect(read('../src/tokens/tokens.css').replace(/:root:lang\(hi\) \{[^}]*\}/, '')).not.toContain('Devanagari');
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
    expect(hindiCatalogue()!['common.language.title']).toBe('भाषा');
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
      expect(JSON.stringify(message), key).not.toContain('—');
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
    expect(read('../src/tokens/tokens.css')).toMatch(/:root:lang\(hi\)/);
  });
});

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
