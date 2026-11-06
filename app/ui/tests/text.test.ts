import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOGUES, format, placeholders, pluralForm, type Message } from '../src/text';

const dir = (lang: string) => join(import.meta.dirname, '../src/text', lang) + '/';

describe('plural by exact digits', () => {
  it('English: one only for exactly 1', () => {
    expect(pluralForm('1', 'en')).toBe('one');
    expect(pluralForm('01', 'en')).toBe('one');
    expect(pluralForm('0', 'en')).toBe('other');
    expect(pluralForm('2', 'en')).toBe('other');
    expect(pluralForm('11', 'en')).toBe('other');
    expect(pluralForm('1.0', 'en')).toBe('other');
    expect(pluralForm('1,001', 'en')).toBe('other');
  });
  it('Hindi: one for 0 and 1', () => {
    expect(pluralForm('0', 'hi')).toBe('one');
    expect(pluralForm('1', 'hi')).toBe('one');
    expect(pluralForm('2', 'hi')).toBe('other');
  });
  it('never turns a long count into a float', () => {
    expect(pluralForm('100000000000000000001', 'en')).toBe('other');
    expect(pluralForm('000000000000000000001', 'en')).toBe('one');
    expect(pluralForm('not a count', 'en')).toBe('other');
  });
});

describe('format', () => {
  const catalogue: Record<string, Message> = {
    plain: 'Close',
    named: '{agent} · run {id}',
    count: { zero: 'Nothing needs you.', one: '{count} needs you', other: '{count} need you' },
  };
  it('fills named values as text', () => {
    expect(format(catalogue, 'en', 'named', { agent: 'Editor', id: '31' })).toBe('Editor · run 31');
    expect(format(catalogue, 'en', 'named', { agent: '<b>x</b>', id: 1 })).toBe('<b>x</b> · run 1');
  });
  it('chooses the plural form from the count digits', () => {
    expect(format(catalogue, 'en', 'count', { count: '0' })).toBe('Nothing needs you.');
    expect(format(catalogue, 'en', 'count', { count: '1' })).toBe('1 needs you');
    expect(format(catalogue, 'en', 'count', { count: 3 })).toBe('3 need you');
  });
  it('a missing key shows the key, never a blank', () => {
    expect(format(catalogue, 'en', 'nope')).toBe('nope');
  });
});

describe('catalogues', () => {
  it('every English key exists in Hindi, with the same placeholders and plural forms', () => {
    const en = CATALOGUES.en; const hi = CATALOGUES.hi;
    const missing = Object.keys(en).filter((k) => !(k in hi));
    expect(missing).toEqual([]);
    for (const [key, message] of Object.entries(en)) {
      expect(placeholders(hi[key]!), key).toEqual(placeholders(message));
      expect(typeof hi[key], key).toBe(typeof message);
    }
  });
  it('Hindi has no keys English lacks', () => {
    expect(Object.keys(CATALOGUES.hi).filter((k) => !(k in CATALOGUES.en))).toEqual([]);
  });
  it('the same files exist for both languages, and a place file only holds its own keys', () => {
    const en = readdirSync(dir('en')).sort(); const hi = readdirSync(dir('hi')).sort();
    expect(hi).toEqual(en);
    expect(en).toContain('common.json');
    const seen = new Set<string>();
    for (const file of en) {
      const place = file.replace(/\.json$/, '');
      const keys = Object.keys(JSON.parse(readFileSync(dir('en') + file, 'utf8')) as object);
      for (const key of keys) {
        if (place !== 'common') expect(key.startsWith(`${place}.`), `${file}: ${key}`).toBe(true);
        expect(seen.has(key), `duplicate ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });
  it('English copy has no em dashes', () => {
    for (const message of Object.values(CATALOGUES.en)) expect(JSON.stringify(message)).not.toContain('—');
    for (const message of Object.values(CATALOGUES.hi)) expect(JSON.stringify(message)).not.toContain('—');
  });
});

/* w3 3H2: the machine-drafted Hindi list for a native reviewer, the house style of English copy, and Hindi that keeps
   one word per concept and leaves no English in by accident (docs/superpowers/plans/2026-10-23-chausar-ink-v2-w3.md). */

const texts = (message: Message | undefined): string[] => (message === undefined ? [] : typeof message === 'string' ? [message] : Object.values(message).filter((m): m is string => typeof m === 'string'));
const readJson = <T,>(path: string): T => JSON.parse(readFileSync(join(import.meta.dirname, path), 'utf8')) as T;

describe('the Hindi a native reader still has to review (spec section 10)', () => {
  const { keys: atWaveStart } = readJson<{ keys: string[] }>('baselines/text-keys-w2.json');
  const { machineDrafted } = readJson<{ machineDrafted: string[] }>('../src/text/hi-review.json');

  it('the wave start baseline is the English keys of wave 2, sorted and unique', () => {
    expect(atWaveStart.length).toBeGreaterThan(1000);
    expect([...new Set(atWaveStart)].sort()).toEqual(atWaveStart);
  });
  it('every English key added since wave 2 is listed in src/text/hi-review.json', () => {
    const before = new Set(atWaveStart);
    const listed = new Set(machineDrafted);
    const missing = Object.keys(CATALOGUES.en).filter((key) => !before.has(key) && !listed.has(key));
    expect(missing, 'add these keys to src/text/hi-review.json, so the native reviewer sees their Hindi').toEqual([]);
  });
  it('every listed key exists in both catalogues, once', () => {
    expect(machineDrafted.filter((key) => !(key in CATALOGUES.en) || !(key in CATALOGUES.hi)), 'listed but not in both catalogues').toEqual([]);
    expect(new Set(machineDrafted).size).toBe(machineDrafted.length);
  });
});

/* w4 4Z: the same list for the keys wave 4 added, against the English keys of the wave 3 commit. The wave 2 check above
   stays: the wave 3 keys are still machine-drafted and wait for the same native reviewer. */
describe('the Hindi wave 4 added, for the native reviewer', () => {
  const w3 = readJson<{ commit: string; keys: string[] }>('baselines/text-keys-w3.json');
  const { machineDrafted, engine } = readJson<{ machineDrafted: string[]; engine?: string[] }>('../src/text/hi-review.json');

  it('the wave 4 baseline is the English keys of the wave 3 commit, sorted and unique', () => {
    expect(w3.commit).toBe('180ed4ff');
    expect(w3.keys.length).toBeGreaterThan(1500);
    expect([...new Set(w3.keys)].sort()).toEqual(w3.keys);
  });
  it('every English key added since wave 3 is in both catalogues and listed in src/text/hi-review.json', () => {
    const before = new Set(w3.keys);
    const listed = new Set(machineDrafted);
    const added = Object.keys(CATALOGUES.en).filter((key) => !before.has(key));
    expect(added.length).toBeGreaterThan(0);
    expect(added.filter((key) => !(key in CATALOGUES.hi)), 'added in wave 4 but missing in Hindi').toEqual([]);
    expect(added.filter((key) => !listed.has(key)), 'add these wave 4 keys to src/text/hi-review.json').toEqual([]);
  });
  it('lists the engine files whose Hindi is machine-drafted (HINDI_REVIEW), and each still says so', () => {
    expect(engine ?? []).not.toEqual([]);
    for (const file of engine ?? []) {
      expect(readFileSync(join(import.meta.dirname, '../../..', file), 'utf8'), file).toContain('HINDI_REVIEW');
    }
  });
});

/**
 * Words the house style keeps out of English copy (catalogue U14): hype and "AI-ish" words. "Unlocks" stays legal
 * because a locked button really does unlock ("Approve unlocks after you watch it"); "unlock your" is the hype.
 */
const HYPE = /\b(?:AI[- ]powered|powered by AI|magic(?:al|ally)?|seamless(?:ly)?|revolutionar\w*|revolutioni[sz]\w*|supercharg\w*|unlock (?:your|the|new|more)|delv\w*|leverag\w*|empower\w*|journey\w*|game[- ]chang\w*|cutting[- ]edge|state[- ]of[- ]the[- ]art|next[- ]level|effortless\w*|robust\w*|elevat\w*|streamlin\w*|tapestry|testament|unleash\w*|skyrocket\w*|transform your|in today's|dive (?:in|into)|embark\w*|realm|boost your)\b/i;

describe('English copy in the house style (catalogue U14)', () => {
  it('the hype check catches what it should, on samples', () => {
    for (const bad of ['Our AI-powered team', 'Seamless invoices', 'Unlock your potential', 'Let us delve in', 'Leverage AI', 'Start your journey', 'Supercharge sales', 'magic']) expect(HYPE.test(bad), bad).toBe(true);
    for (const good of ['Approve unlocks after you watch it', 'Tick that you saved it, then Continue unlocks.', 'Your AI', 'Invoices in INR.']) expect(HYPE.test(good), good).toBe(false);
  });
  it('an engine-failed run reads "Failed", never "Stopped": that word is the owner\'s own Stop (W4 4F)', () => {
    const FAILED = ['run.stopped', 'thread.runFailed', 'state.run.failed', 'state.step.failed', 'state.delivery.failed', 'story.status.failed', 'story.name.failed', 'ring.stepsFailed', 'ring.indeterminateFailed', 'steps.failed', 'team.dept.stopped', 'today.team.failed', 'today.working.stopped', 'clients.draft.failed', 'work.failedRun.chip', 'work.failedRun.noReason'];
    for (const key of FAILED) {
      expect(texts(CATALOGUES.en[key]).length, key).toBeGreaterThan(0);
      for (const text of texts(CATALOGUES.en[key])) expect(text, key).toMatch(/fail/i);
      for (const text of texts(CATALOGUES.hi[key])) expect(text, key).toContain('फ़ेल');
    }
  });
  it('no hype words, "AI-ish" words or exclamation marks in English copy', () => {
    const found = Object.entries(CATALOGUES.en).flatMap(([key, message]) => texts(message).filter((text) => HYPE.test(text) || text.includes('!')).map((text) => `${key}: ${text}`));
    expect(found).toEqual([]);
  });
});

/**
 * Latin words a Hindi string may hold: names of products, platforms, file kinds and Indian tax and bank terms, which
 * stay in Latin letters in Hindi too. Anything else in Latin letters must be a code (it holds . : / \ _ or a digit, or
 * is lower case with hyphens, like a file path or `model:anthropic-api`) or a label in quotes from another product's
 * screen, such as GitHub's 'Only select repositories'.
 */
const LATIN_IN_HINDI = new Set([
  'Chausar', 'chausar', 'AI', 'UI', 'API', 'ID', 'CA', 'ICAI', 'GST', 'GSTIN', 'TDS', 'PAN', 'IFSC', 'UPI', 'OTP', 'US', 'HDFC',
  'CSV', 'PDF', 'Excel', 'SRT', 'VTT', 'MB', 'https', 'ffmpeg', 'GitHub', 'Lovable', 'Replit', 'Claude', 'Anthropic', 'Haiku', 'Sonnet',
  'Codex', 'WhatsApp', 'LinkedIn', 'Instagram', 'Facebook', 'Threads', 'TikTok', 'X', 'YouTube', 'Shorts',
]);
const QUOTED = /'[^']*'|"[^"]*"|‘[^’]*’|“[^”]*”/g;
function strayLatin(text: string): string[] {
  const words = text.replace(/\{\w+\}/g, ' ').replace(QUOTED, ' ').match(/[A-Za-z][\w.:/\\-]*/g) ?? [];
  return words.map((word) => word.replace(/[.,:;]+$/, '')).filter((word) => !LATIN_IN_HINDI.has(word) && !/[.:/\\_\d]/.test(word) && !/^[a-z]+(?:-[a-z]+)+$/.test(word));
}

/**
 * One Hindi word per concept, so the owner never wonders whether two words mean two things. `avoid` holds the other
 * words machine drafting reaches for, and spellings without the nukta the catalogues use everywhere else.
 */
const GLOSSARY: { concept: string; use: string; avoid: RegExp }[] = [
  { concept: 'approve, accept', use: 'मंज़ूर', avoid: /स्वीकार|अनुमोदन|अप्रूव|मंजूर/ },
  { concept: 'reject, turn down', use: 'नामंज़ूर', avoid: /ठुकरा|अस्वीकार|रिजेक्ट/ },
  { concept: 'receipt', use: 'रसीद', avoid: /रिसीट|पावती/ },
  { concept: 'run', use: 'रन', avoid: /रन्स/ },
  { concept: 'agent', use: 'एजेंट', avoid: /एजेन्ट|एजंट|सहायक/ },
  { concept: 'business', use: 'बिज़नेस', avoid: /बिजनेस|व्यवसाय|कारोबार/ },
  { concept: 'client', use: 'क्लाइंट', avoid: /क्लाइन्ट|ग्राहक|कस्टमर/ },
  { concept: 'invoice', use: 'बिल', avoid: /इनवॉइस|इनवॉयस|इन्वॉइस|चालान|बीजक/ },
  { concept: 'draft', use: 'ड्राफ़्ट', avoid: /मसौद|ड्राफ्ट/ },
  { concept: 'price', use: 'दाम', avoid: /क़?ीमत/ },
  { concept: 'plan (the business plan; "planned" stays योजना में)', use: 'प्लान', avoid: /योजना(?! में)/ },
  { concept: 'failed', use: 'फ़ेल', avoid: /विफल|असफल|नाकाम|फेल/ },
  { concept: 'version', use: 'वर्ज़न', avoid: /संस्करण|वर्शन/ },
  { concept: 'save', use: 'सेव', avoid: /सहेज/ },
  { concept: 'delivered', use: 'डिलीवर', avoid: /पहुँचा दिया गया|पहुँचाया नहीं|को पहुँचाया/ },
  { concept: 'books (accounts)', use: 'बही-खाता', avoid: /किताब|बहीखाता|बुककीपिंग/ },
  { concept: 'journal', use: 'रोज़नामचा', avoid: /जर्नल/ },
  { concept: 'key (a secret, or this computer\'s key)', use: 'चाबी', avoid: /कुंजी|अपनी की(?![ऀ-ॿ])|की पेस्ट/ },
  { concept: 'self (spelling)', use: 'ख़ुद', avoid: /खुद/ },
  { concept: 'spend (spelling)', use: 'ख़र्च', avoid: /खर्च/ },
  { concept: 'date (spelling)', use: 'तारीख़', avoid: /तारीख(?!़)/ },
  { concept: 'need (spelling)', use: 'ज़रूर', avoid: /जरूर/ },
  { concept: 'file (spelling)', use: 'फ़ाइल', avoid: /फाइल/ },
];

describe('Hindi copy (spec section 3: every screen in Hindi, machine-drafted)', () => {
  it('the checks catch what they should, on samples', () => {
    expect(strayLatin('Only select repositories चुनें')).toEqual(['Only', 'select', 'repositories']);
    expect(strayLatin("'Only select repositories' चुनें, फिर {name} खोलें")).toEqual([]);
    expect(strayLatin('जैसे C:\\whisper.cpp\\whisper-cli.exe या model:anthropic-api, https://example.in/team. और 1.5 MB')).toEqual([]);
    expect(strayLatin('Claude Haiku और GitHub पर रिपो owner/name')).toEqual([]);
    expect(strayLatin('यह run फ़ेल हुआ')).toEqual(['run']);
    expect(GLOSSARY.filter(({ avoid }) => avoid.test('इसे स्वीकार करें')).map(({ concept }) => concept)).toEqual(['approve, accept']);
    expect(GLOSSARY.filter(({ avoid }) => avoid.test('सब योजना में हैं · प्लान · ख़र्च · तारीख़ · फ़ेल हुआ')).map(({ concept }) => concept)).toEqual([]);
    expect(GLOSSARY.filter(({ avoid }) => avoid.test('नई योजना · खर्च · तारीख')).map(({ concept }) => concept)).toEqual(['plan (the business plan; "planned" stays योजना में)', 'spend (spelling)', 'date (spelling)']);
    expect(GLOSSARY.filter(({ avoid }) => avoid.test('आपकी अपनी की से')).map(({ concept }) => concept)).toEqual(["key (a secret, or this computer's key)"]);
    expect(GLOSSARY.filter(({ avoid }) => avoid.test('आपकी अपनी कीमत · आपकी अपनी चाबी · यह कंप्यूटर की चाबी')).map(({ concept }) => concept)).toEqual(['price']);
  });
  it('no English left in by machine drafting: Latin words in Hindi are names, codes or quoted labels', () => {
    const found = Object.entries(CATALOGUES.hi).flatMap(([key, message]) => texts(message).flatMap((text) => strayLatin(text).map((word) => `${key}: ${word}`)));
    expect(found).toEqual([]);
  });
  it('one Hindi word per concept', () => {
    const found = Object.entries(CATALOGUES.hi).flatMap(([key, message]) =>
      texts(message).flatMap((text) => GLOSSARY.filter(({ avoid }) => avoid.test(text)).map(({ concept, use }) => `${key}: "${text}" (${concept}: use ${use})`)),
    );
    expect(found).toEqual([]);
  });
});
