// The secret screen and the telemetry rules (venture/core/secrets.ts and core/telemetry.ts, catalogue H17 and H18).
// Text sent to a model, kept as a call's trace, written to the journal, the evidence ledger or a share link is
// screened: known key prefixes and long high-entropy strings become "[redacted secret]" (placeholders stay), URLs lose
// user info and secret-looking query values, and browser read-backs lose card numbers, bank accounts, OTPs, Aadhaar
// and PAN. Usage counters carry only allowlisted fields, and the tools Chausar launches run with telemetry off.
// Every secret below is synthetic. No network: the model transport is a recording fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Context } from '../runtime/contracts.ts';
import { TrustService } from '../runtime/trust.ts';
import { VENTURE_ERRORS } from '../runtime/venture/contracts.ts';
import type {
  ModelHttpRequest, ModelTask, SecretName, SecretShelf, ShareLinkView, VentureDeps,
} from '../runtime/venture/contracts.ts';
import { digest, houseStyleFindings, listRecords, ventureAction } from '../runtime/venture/records.ts';
import {
  REDACTED, luhnValid, redactPayload, redactSecrets, redactUrl, screenReadback, secretFindings, verhoeffValid,
} from '../runtime/venture/core/secrets.ts';
import {
  TELEMETRY_OFF_ENV, USAGE_FIELDS, audienceOf, sendUsage, showWhatWouldBeSent,
} from '../runtime/venture/core/telemetry.ts';
import { PRESETS, createModelPort, handlers as modelHandlers } from '../runtime/venture/models/index.ts';
import { cliEnv } from '../runtime/venture/models/cli.ts';
import { delegateEnv } from '../runtime/venture/delivery/harness/delegate.ts';
import { journalled, proposeAction } from '../runtime/venture/journal/index.ts';
import { recordEvidence } from '../runtime/venture/evidence/ledger.ts';
import { handlers as build } from '../runtime/venture/build/index.ts';
import { sharePage } from '../runtime/venture/build/share-links.ts';
import { seedBlueprint, seedOrder, seedRun, setup as viewsSetup } from './venture-views-env.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const agent: Context = { ...owner, channel: 'mcp' };

// Synthetic secrets, one per known kind. None of these is or was a real credential.
const SECRETS: Record<string, string> = {
  anthropic: 'sk-' + 'ant-api03-Zq8Rt2Lm9Xv4Bn7Kc1Wd6Hs3Jf5Gp0TyAbCdEf',
  openai: 'sk-' + 'proj-Hk3Lm8Nq2Rs7Tv1Wx6Yz0Ab5Cd9Ef4GhJk',
  github: 'gh' + 'p_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
  githubFine: 'github_' + 'pat_11ABCDEFG0aBcDeFgHiJkLmN_wXyZ0123456789AbCdEfGhIjKlMnOpQr',
  aws: 'AK' + 'IA2B3C4D5E6F7G8H9J',
  slack: 'xo' + 'xb-2048-4096-Zq8Rt2Lm9Xv4Bn7Kc1Wd',
  google: 'AI' + 'zaSyZq8Rt2Lm9Xv4Bn7Kc1Wd6Hs3Jf5Gp0Tyu',
  stripe: 'sk_' + 'live_Zq8Rt2Lm9Xv4Bn7Kc1Wd6Hs3',
  razorpay: 'rzp_' + 'live_Zq8Rt2Lm9Xv4Bn',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjaGF1c2FyLXRlc3QifQ.Zq8Rt2Lm9Xv4Bn7Kc1Wd6Hs3Jf5Gp0TyAb',
  generic: 'Zx9Qw3Er7Ty1Ui5Op2As',
  hex32: '3f9a1c7e5b2d8046a1c3e5f7b9d0e2f4',
};
const PEM = '-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEA\n-----END PRIVATE KEY-----';

// Text that looks a little like a key but is not one: ids, digests, model names, tax ids, paths, placeholders.
const NOT_SECRETS = [
  'claude-sonnet-5-5', 'anthropic-sonnet-5-5', 'gpt-6-luna-2026-10-15', 'venture-journal-entry_3b241101-e2bb-4255-8caf-4136c566a962',
  createHash('sha256').update('x').digest('hex'), '2026-10-23T10:00:00.000Z', 'INV/2026-27/000123', '27AAPFU0939F1ZV',
  'docs/venture/models.md', 'platform/runtime/venture/core/net-guard.ts', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'showWhatWouldBeSent',
  'estimatedMaxCostMicros', '<your-key>', '<sk-ant-your-key-here>', 'sk-ant-xxxxxxxxxxxxxxxxxxxx', 'YOUR_API_KEY', '${OPENAI_API_KEY}', 'sk-...',
  '₹1,23,456.00', '+91 98765 43210', 'HDFC0001234', 'NEFT-HDFCN52026102312345678', 'UPI/CR/429183746521/PAYTM', 'practice_bookkeeping-messy_1',
  'kartavy.rocks2026@example.com', 'आपका बिल तैयार है', 'https://api.github.com/repos/owner/chausar-platform/contents/README.md?ref=main',
];

// ---------------------------------------------------------------------------
// 1. The text screen
// ---------------------------------------------------------------------------

test('redactSecrets: every known key prefix and long high-entropy strings become [redacted secret], the words around stay', () => {
  for (const [kind, secret] of Object.entries(SECRETS)) {
    const text = `Use ${secret} for the upload.`;
    const out = redactSecrets(text);
    assert.equal(out, `Use ${REDACTED} for the upload.`, kind);
    assert.ok(secretFindings(text).length > 0, kind);
  }
  assert.equal(redactSecrets(`key:\n${PEM}\nend`), `key:\n${REDACTED}\nend`);
  assert.equal(redactSecrets('Authorization: Bearer abcDEF123456ghiJKL789'), `Authorization: Bearer ${REDACTED}`);
  assert.equal(redactSecrets('password=hunter2pass and more'), `password=${REDACTED} and more`);
  assert.equal(redactSecrets('{"apiKey": "q9X2LmP4", "name": "Cafe"}'), `{"apiKey": "${REDACTED}", "name": "Cafe"}`);
  assert.equal(redactSecrets('client_secret: tq8M2nB7'), `client_secret: ${REDACTED}`);
});

test('redactSecrets: ids, digests, model names, tax ids, paths, money and placeholders are left alone', () => {
  for (const text of NOT_SECRETS) {
    assert.equal(redactSecrets(text), text, text);
    assert.deepEqual(secretFindings(text), [], text);
  }
  assert.equal(redactSecrets(''), '');
  assert.equal(redactSecrets('Please close my September books. The bank statement and bills are in the shared folder.'),
    'Please close my September books. The bank statement and bills are in the shared folder.');
});

// Words a post or an offer carries that mix letters and digits: hashtags, handles, promo codes, invoice numbers.
const POST_WORDS = [
  '#Diwali2026Specials', '#Diwali2026SpecialsOfferWeek4Pune', '#a1B2c3D4e5F6g7H8i9J0kLmN', '@chausar_official2026', '@Cafe2026AromaPune7Kitchen',
  'DIWALI2026', 'SAVE20NOW', 'FESTIVE2026SALE', 'GET50OFF2026', 'INV-2026-000123', 'INV2026A0042', 'Diwali2026SpecialsOffer',
];

test('redactSecrets: hashtags, handles, promo codes and invoice numbers in a post are never redacted', () => {
  for (const word of POST_WORDS) {
    assert.equal(redactSecrets(word), word, word);
    assert.deepEqual(secretFindings(word), [], word);
  }
  const post = 'Diwali offers at @CafeAroma2026! Use code DIWALI2026 or SAVE20NOW at checkout. #Diwali2026Specials #Pune2026Eats Invoice INV-2026-000123.';
  assert.equal(redactSecrets(post), post);
  // A real key in the same post is still taken out, and only the key.
  assert.equal(redactSecrets(`${post} ${SECRETS.generic}`), `${post} ${REDACTED}`);
  assert.equal(redactSecrets(`${post} ${SECRETS.anthropic}`), `${post} ${REDACTED}`);
});

const HEX64 = createHash('sha256').update('session').digest('hex');
const HEX40 = createHash('sha1').update('session').digest('hex');
const HEX32 = '3f9a1c7e5b2d8046a1c3e5f7b9d0e2f4';
const enc = encodeURIComponent(REDACTED);

test('web addresses: path parts are never judged by entropy; only key prefixes and the hosts that carry a secret in the path', () => {
  const kept = [
    'https://www.linkedin.com/in/kartavy-c-3a1b2c4d5/',
    'https://www.linkedin.com/posts/cafe-aroma_diwali2026-specials-activity-7123456789012345678-AbCd',
    'https://maps.app.goo.gl/Zq8Rt2Lm9Xv4Bn7K6aBc',
    'https://drive.google.com/file/d/1A2b3C4d5E6f7G8h9I0jK1lM2nO3pQ4rS/view?usp=sharing',
    'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0',
    'https://www.justdial.com/Pune/Cafe-Aroma-Near-FC-Road-Shivajinagar/020PXX20-XX20-180312104512-Q8W3_BZDET',
    'https://medium.com/@chausar/how-we-closed-500-books-in-a-month-3f9a1c7e5b2d',
    `https://example.com/builds/${HEX32}/log`,
  ];
  for (const url of kept) {
    assert.equal(redactUrl(url), url, url);
    assert.equal(redactSecrets(`See ${url} today.`), `See ${url} today.`, url);
  }
  assert.equal(redactUrl('https://hooks.slack' + '.com/services/T0ABCDEF1/B0ABCDEF2/Zq8Rt2Lm9Xv4Bn7Kc1Wd6Hs3'), `https://hooks.slack${''}.com/services/T0ABCDEF1/B0ABCDEF2/${enc}`);
  assert.equal(redactUrl('https://api.telegram' + '.org/bot123456789:AAZq8Rt2Lm9Xv4Bn7Kc1Wd6Hs3Jf5Gp0Ty/sendMessage'), `https://api.telegram.org/${enc}/sendMessage`);
  assert.equal(redactUrl('https://discord' + '.com/api/webhooks/123456789012345678/Zq8Rt2Lm9Xv4Bn7Kc1Wd6Hs3Jf5Gp0TyAbCdEf'), `https://discord${''}.com/api/webhooks/123456789012345678/${enc}`);
  assert.equal(redactUrl(`https://example.com/keys/${SECRETS.anthropic}/view`), `https://example.com/keys/${enc}/view`);
});

test('hex: a digest is kept only as a whole token and never after a secret-like name; 0x and named values are redacted', () => {
  assert.equal(redactSecrets(`JWT_SECRET=${HEX64}`), `JWT_SECRET=${REDACTED}`);
  assert.equal(redactSecrets(`SESSION_SECRET=${HEX40}`), `SESSION_SECRET=${REDACTED}`);
  assert.equal(redactSecrets(`0x${HEX64}`), REDACTED);
  assert.equal(redactSecrets(`webhook secret: ${HEX64}`), `webhook secret: ${REDACTED}`);
  assert.equal(redactSecrets(`signing key = ${HEX40}`), `signing key = ${REDACTED}`);
  for (const text of [`digest ${HEX64}`, `sha256:${HEX64}`, `commit ${HEX40}`, `trace_id ${HEX32}`, `trace_id: ${HEX32}`, `request-id=${HEX32}`]) {
    assert.equal(redactSecrets(text), text, text);
  }
});

test('named values: SCREAMING_SNAKE environment names and a bare secret, token or key after an underscore', () => {
  assert.equal(redactSecrets('DB_PASSWORD=Hunter2pass'), `DB_PASSWORD=${REDACTED}`);
  assert.equal(redactSecrets('JWT_SECRET=supersecretvalue'), `JWT_SECRET=${REDACTED}`);
  assert.equal(redactSecrets('API_KEY=abcd1234'), `API_KEY=${REDACTED}`);
  assert.equal(redactSecrets('export GITHUB_TOKEN=abcdef12'), `export GITHUB_TOKEN=${REDACTED}`);
  assert.equal(redactSecrets('"STRIPE_KEY": "q9X2LmP4"'), `"STRIPE_KEY": "${REDACTED}"`);
  assert.equal(redactSecrets('webhook_secret: tq8M2nB7'), `webhook_secret: ${REDACTED}`);
});

test('placeholders are kept only when the whole tail is a stand-in; a real-looking tail with a stand-in word is redacted', () => {
  assert.equal(redactSecrets('sk-' + 'ant-api03-HEREZq8Rt2Lm9Xv4Bn7Kc1Wd6'), REDACTED);
  assert.equal(redactSecrets('gh' + 'p_A1b2C3yourD4e5F6g7H8i9J0k1L2m3N4o5'), REDACTED);
  assert.equal(redactSecrets('password=yourPass99'), `password=${REDACTED}`);
  for (const text of ['<your-key>', '<sk-ant-your-key-here>', 'sk-ant-xxxxxxxxxxxxxxxxxxxx', 'gh' + 'p_************************', 'password=********',
    'api_key=<your-key>', 'API_KEY=${API_KEY}', 'GITHUB_TOKEN={{github_token}}', 'Bearer xxxxxxxxxxxxxxxx']) {
    assert.equal(redactSecrets(text), text, text);
  }
});

test('ids and file names are kept: payment and object ids, files before their extension', () => {
  for (const text of [
    'pay_29QQoUBi66xm2fAbCdEf', 'pi_3NqZ8x2eZvKYlo2C1abcDEFg', 'cus_NffrFeUfNV2HibAbC12x', 'order_IluGWxBm9U8zJ8', 'inv_Zq8Rt2Lm9Xv4Bn7Kc1Wd',
    'GSTR3B_27AAPFU0939F1ZV_092026.json', 'Invoice_2026_Oct_v3_final2.pdf', 'export_Zq8Rt2Lm9Xv4Bn7Kc1Wd6.csv', 'Uploaded GSTR3B_27AAPFU0939F1ZV_092026.json today.',
  ]) {
    assert.equal(redactSecrets(text), text, text);
  }
});

test('OTP read-backs: the number before its label is redacted too', () => {
  assert.equal(screenReadback('482913 is your OTP.').text, '[redacted OTP] is your OTP.');
  assert.equal(screenReadback('Use 4829 as your one time password.').text, 'Use [redacted OTP] as your one time password.');
  assert.equal(screenReadback('5521 is the verification code for login.').text, '[redacted OTP] is the verification code for login.');
  assert.equal(screenReadback('Order 482913 is ready.').text, 'Order 482913 is ready.');
});

test('redactPayload: any value under a secret key is redacted, numbers and flags too; dates stay as ISO text', () => {
  const out = redactPayload({
    token: 12345678, otp: 482913, secret: true, apiKey: null, password: '', at: new Date('2026-10-23T10:00:00.000Z'), nested: { pin: 411001, count: 2 },
    list: [new Date('2026-10-24T00:00:00.000Z')],
  });
  assert.deepEqual(out, {
    token: REDACTED, otp: REDACTED, secret: REDACTED, apiKey: null, password: '', at: '2026-10-23T10:00:00.000Z', nested: { pin: 411001, count: 2 },
    list: ['2026-10-24T00:00:00.000Z'],
  });
});

test('the module says plainly what it cannot catch', async () => {
  const source = await readFile(new URL('../runtime/venture/core/secrets.ts', import.meta.url), 'utf8');
  assert.match(source, /split into chunks under 16 characters/);
});

test('share links: a post with hashtags, handles and promo codes is kept exactly, so its digest matches what the client approves', async () => {
  const env = await viewsSetup();
  const plan = await seedBlueprint(env);
  const { order } = await seedOrder(env, plan);
  const text = 'Diwali offers at @CafeAroma2026! Use code DIWALI2026 or SAVE20NOW. #Diwali2026Specials #Pune2026Eats';
  const run = await seedRun(env, order, {
    status: 'ready-for-review', servedBy: 'template', renderedText: text,
    deliverable: { title: '#Diwali2026Specials post', sections: [], questionsForClient: [] }, checks: [{ check: 'house-style', passed: true, detail: 'ok' }],
  });
  await (build as any)['venture.share.create'](env.deps, owner, { deliveryId: run.id });
  const [record] = listRecords(env.store.read(), 'venture-share-link');
  assert.equal(record.text, text);
  assert.equal(record.title, '#Diwali2026Specials post');
  assert.equal(record.draftDigest, digest({ deliveryId: run.id, title: '#Diwali2026Specials post', text }));
});

test('redactUrl: no user info, secret-looking query values and fragments go, the rest of the address stays', () => {
  const url = `https://admin:hunter2@example.com/callback?code=Ab12Cd34Ef56&state=ok&page=2&access_token=${SECRETS.generic}#id_token=${SECRETS.jwt}`;
  const out = redactUrl(url);
  assert.ok(!out.includes('hunter2') && !out.includes('admin'), out);
  assert.ok(!out.includes('Ab12Cd34Ef56') && !out.includes(SECRETS.generic) && !out.includes('eyJ'), out);
  const parsed = new URL(out);
  assert.equal(parsed.hostname, 'example.com');
  assert.equal(parsed.searchParams.get('state'), 'ok');
  assert.equal(parsed.searchParams.get('page'), '2');
  assert.equal(parsed.searchParams.get('code'), REDACTED);
  assert.equal(parsed.searchParams.get('access_token'), REDACTED);
  assert.equal(redactUrl('https://example.com/a?code=IN&lang=hi'), 'https://example.com/a?code=IN&lang=hi', 'a short country code is not a secret');
  assert.equal(redactUrl(`https://example.com/x?ref=${SECRETS.hex32}`), `https://example.com/x?ref=${encodeURIComponent(REDACTED)}`);
  // Inside running text the same rules apply, and words after the address stay.
  assert.equal(redactSecrets('Open https://bob:pw1234@hooks.example.com/x?token=abcdefgh12 now.'), `Open https://hooks.example.com/x?token=${encodeURIComponent(REDACTED)} now.`);
  assert.equal(redactUrl('not a url sk-' + 'ant-api03-Zq8Rt2Lm9Xv4Bn7Kc1Wd6Hs3Jf5'), `not a url ${REDACTED}`);
});

test('redactPayload: secret-named keys and secret strings anywhere in a structure; keys, numbers and the original are untouched', () => {
  const input = {
    apiKey: 'q9X2', note: `key ${SECRETS.anthropic}`, count: 3, flags: [true, null], nested: { password: 'pw', 'x-api-key': 'abc', token: 'tok', pin: '411001' },
    list: [SECRETS.github, 'plain words'], estimatedMaxCostMicros: '120000',
  };
  const before = structuredClone(input);
  const out = redactPayload(input);
  assert.deepEqual(input, before, 'the input is not changed');
  assert.deepEqual(out, {
    apiKey: REDACTED, note: `key ${REDACTED}`, count: 3, flags: [true, null], nested: { password: REDACTED, 'x-api-key': REDACTED, token: REDACTED, pin: '411001' },
    list: [REDACTED, 'plain words'], estimatedMaxCostMicros: '120000',
  });
  assert.equal(redactPayload('gh' + 'p_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'), REDACTED);
  assert.equal(redactPayload(42), 42);
});

// ---------------------------------------------------------------------------
// 2. Browser read-backs
// ---------------------------------------------------------------------------

test('checksums: Luhn for cards, Verhoeff for Aadhaar', () => {
  assert.equal(luhnValid('4111111111111111'), true);
  assert.equal(luhnValid('4111111111111112'), false);
  assert.equal(verhoeffValid('2363'), true);
  assert.equal(verhoeffValid('2364'), false);
  assert.equal(verhoeffValid('498712345679'), true);
  assert.equal(verhoeffValid('498712345670'), false);
});

test('screenReadback: cards, Aadhaar, bank accounts beside an IFSC, OTPs, PAN and keys are redacted with what they were', () => {
  const page = [
    'Card 4111 1111 1111 1111 saved. Also 4111-1111-1111-1111 and 4111111111111111.',
    'Not a card: 4111 1111 1111 1112.',
    'Aadhaar 4987 1234 5679 linked; 498712345679 again; not one: 4987 1234 5670.',
    'Account 50100123456788, IFSC HDFC0001234.',
    'Your OTP is 482913. Do not share it. Verification code: 5521.',
    'Order 482913 shipped. Call +91 98765 43210.',
    'PAN ABCPE1234F on file.',
    `session=${SECRETS.generic}`,
  ].join('\n');
  const { text, found } = screenReadback(page);
  assert.equal(text, [
    'Card [redacted card number] saved. Also [redacted card number] and [redacted card number].',
    'Not a card: 4111 1111 1111 1112.',
    'Aadhaar [redacted Aadhaar number] linked; [redacted Aadhaar number] again; not one: 4987 1234 5670.',
    'Account [redacted bank account], IFSC HDFC0001234.',
    'Your OTP is [redacted OTP]. Do not share it. Verification code: [redacted OTP].',
    'Order 482913 shipped. Call +91 98765 43210.',
    'PAN [redacted PAN] on file.',
    `session=${REDACTED}`,
  ].join('\n'));
  assert.deepEqual([...found].sort(), ['aadhaar', 'bank-account', 'card', 'otp', 'pan', 'secret']);
  assert.deepEqual(screenReadback('Nothing private here: order 1042 is ready.'), { text: 'Nothing private here: order 1042 is ready.', found: [] });
  // A long account number with no IFSC near it stays: it may be an order or a reference.
  assert.equal(screenReadback('Reference 50100123456788 noted.').text, 'Reference 50100123456788 noted.');
});

// ---------------------------------------------------------------------------
// 3. Where text is kept or sent
// ---------------------------------------------------------------------------

class MemoryShelf implements SecretShelf {
  #values = new Map<string, string>();
  get(name: SecretName) { return this.#values.get(name) ?? null; }
  set(name: SecretName, value: string) { this.#values.set(name, value); }
  delete(name: SecretName) { this.#values.delete(name); }
  has(name: SecretName) { return this.#values.has(name); }
  clear() { this.#values.clear(); }
}
const unused = new Proxy({}, { get() { throw new Error('This service is not used here.'); } });

async function modelSetup() {
  const store = new VentureTestStore();
  const secrets = new MemoryShelf();
  const clock = () => new Date('2026-10-15T09:00:00.000Z');
  const http: ModelHttpRequest[] = [];
  const transport = {
    replay: false,
    async http(request: ModelHttpRequest) {
      http.push(structuredClone(request));
      return { status: 200, body: JSON.stringify({ content: [{ type: 'text', text: '{"words":"ok"}' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }) };
    },
    async process() { return { exitCode: 1, stdout: '' }; },
  };
  const port = createModelPort({ store, clock, transport, secrets, host: 'test', demo: false, claudeCodeTerms: 'accepted' } as any);
  const deps = { store, clock, models: port, services: { trust: new TrustService(store), calculator: unused, ontology: unused }, github: unused, secrets, host: 'test', demo: false, storage: 'experimental-file' } as unknown as VentureDeps;
  await ventureAction(deps, owner, 'admin', 'create', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Monthly bookkeeping for cafes', ideaDigest: 'synthetic', workingName: 'Ledger Cafe Books',
    country: { code: 'IN', name: 'India', currency: 'INR', minorDigits: 2 } as any, serviceType: 'bookkeeping', status: 'interview', launchStage: 'rehearsal',
    blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
  }), { create: true });
  const preset = PRESETS.find(item => item.id === 'anthropic-haiku-5-5')!;
  await (modelHandlers as any)['venture.models.connect'](deps, owner, { presetId: preset.id, consentDigest: preset.consentDigest, apiKey: 'sk-ant-test-not-a-real-key-0000' });
  return { store, deps, port, http };
}

type Words = { words: string };
function task(over: Partial<ModelTask<Words>> = {}): ModelTask<Words> {
  return {
    purpose: 'interview', instructions: `Write one short question. The owner pasted ${SECRETS.github} by mistake.`,
    input: { idea: `Bookkeeping for cafes, my key is ${SECRETS.anthropic}`, settings: { apiKey: 'q9X2LmP4' } },
    schemaName: 'test-words', schema: { type: 'object', additionalProperties: false, required: ['words'], properties: { words: { type: 'string' } } },
    validate: (raw: unknown) => raw as Words, template: () => ({ words: 'Template' }), containsClientData: false, maxOutputTokens: 1024, ...over,
  };
}

test('models: the screen runs before anything is sent; the request, the preview and the call record never hold the secret', async () => {
  const { store, deps, port, http } = await modelSetup();
  const outcome = await deps.models.generate(owner, task());
  assert.equal(outcome.value.words, 'ok');
  assert.equal(http.length, 1);
  for (const secret of [SECRETS.github, SECRETS.anthropic, 'q9X2LmP4']) assert.ok(!http[0].body.includes(secret), `sent: ${secret}`);
  assert.ok(http[0].body.includes(REDACTED));
  const [call] = listRecords(store.read(), 'venture-model-call');
  for (const secret of [SECRETS.github, SECRETS.anthropic, 'q9X2LmP4']) assert.ok(!call.payloadText.includes(secret), `kept: ${secret}`);
  assert.equal(call.payloadDigest, digest(http[0].body), 'the digest is of what was sent');
  // The key itself still goes where it belongs: the request header, never the body or the record.
  assert.equal(http[0].headers['x-api-key'], 'sk-ant-test-not-a-real-key-0000');
  const preview = await port.preview(owner, task({ purpose: 'judge', containsClientData: true }));
  assert.ok(preview && !preview.payloadText.includes(SECRETS.github) && preview.payloadText.includes('redacted secret'));
});

async function journalSetup() {
  const store = new VentureTestStore();
  const deps = { store, clock: () => new Date('2026-10-21T10:00:00.000Z') } as unknown as VentureDeps;
  await ventureAction(deps, owner, 'admin', 'seed', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Monthly books for cafes in Pune', ideaDigest: 'synthetic', workingName: 'Ledger Cafe Books', country: null,
    serviceType: 'bookkeeping', status: 'live', launchStage: 'approve-each', blueprintId: null, acceptedBlueprintId: null, playbookId: null,
    invoiceSequence: 0, updatedAt: tx.now,
  } as any), { create: true });
  return { store, deps };
}

test('journal: the description, the target, every journal line and the outcome address are screened; the subject is kept as given', async () => {
  const { store, deps } = await journalSetup();
  const subject = `run_1:${'a'.repeat(16)}`;
  const proposed = await proposeAction(deps, agent, {
    action: 'connector.write', subject, target: 'https://bob:pw1234@hooks.example.com/x', actionDigest: 'b'.repeat(64),
    line: `Send the reminder with key ${SECRETS.openai}.`, agent: 'Books agent', operation: 'send-deliverable',
  });
  assert.equal(proposed.subject, subject);
  assert.equal(proposed.target, 'https://hooks.example.com/x');
  assert.equal(proposed.describe, `Send the reminder with key ${REDACTED}.`);
  assert.equal(proposed.journal[0].line, `Send the reminder with key ${REDACTED}.`);

  const done = await journalled(deps, owner, {
    action: 'connector.write', subject: 'reminder_2', target: 'Mail app', actionDigest: 'c'.repeat(64), line: 'Send the second reminder.', operation: 'send-deliverable',
  }, async () => ({ outcome: 'applied', line: `Sent with token ${SECRETS.slack}.`, url: `https://example.com/p/1?access_token=${SECRETS.generic}&id=7`, value: null }));
  const entry = done.entry;
  assert.ok(entry.outcome && !entry.outcome.url!.includes(SECRETS.generic) && entry.outcome.url!.includes('id=7'), entry.outcome?.url ?? 'no url');
  assert.equal(entry.outcome!.line, `Sent with token ${REDACTED}.`);
  assert.equal(entry.journal.at(-1)!.line, `Sent with token ${REDACTED}.`);
  const stored = JSON.stringify(listRecords(store.read(), 'venture-journal-entry'));
  for (const secret of [SECRETS.openai, SECRETS.slack, SECRETS.generic, 'pw1234']) assert.ok(!stored.includes(secret), secret);
});

test('evidence: a value or a source that holds a secret is kept redacted', async () => {
  const { store, deps } = await journalSetup();
  await ventureAction(deps, owner, 'prepare', 'evidence', tx => {
    recordEvidence(tx, {
      subject: 'business', field: 'uploadNote', value: `Upload with ${SECRETS.aws} please`, type: 'owner-entered', by: 'owner',
      source: `pasted from https://u:p4ss@files.example.com/?token=${SECRETS.generic}`,
    });
  });
  const [record] = listRecords(store.read(), 'venture-evidence');
  assert.equal(record.value, `Upload with ${REDACTED} please`);
  for (const secret of [SECRETS.generic, 'p4ss']) assert.ok(!record.source.includes(secret), record.source);
});

test('share links: the text a client sees is screened before it is kept, and the digest is of what is shown', async () => {
  const env = await viewsSetup();
  const plan = await seedBlueprint(env);
  const { order } = await seedOrder(env, plan);
  const text = `Your September books are ready. Upload key: ${SECRETS.stripe}`;
  const run = await seedRun(env, order, {
    status: 'ready-for-review', servedBy: 'template', renderedText: text,
    deliverable: { title: `Books ${SECRETS.hex32}`, sections: [], questionsForClient: [] }, checks: [{ check: 'house-style', passed: true, detail: 'ok' }],
  });
  const deps: VentureDeps = { ...env.deps, host: 'hosted-web', publicUrl: 'https://app.example.com' } as VentureDeps;
  const made = await (build as any)['venture.share.create'](deps, owner, { deliveryId: run.id }) as ShareLinkView;
  const [record] = listRecords(env.store.read(), 'venture-share-link');
  assert.equal(record.text, `Your September books are ready. Upload key: ${REDACTED}`);
  assert.equal(record.title, `Books ${REDACTED}`);
  assert.equal(record.draftDigest, digest({ deliveryId: run.id, title: record.title, text: record.text }));
  const token = /\/share\/([A-Za-z0-9_-]{32})$/.exec(made.url ?? '')![1];
  const page = await sharePage(deps, owner, token);
  assert.ok(page && !page.text.includes(SECRETS.stripe));
});

// ---------------------------------------------------------------------------
// 4. Telemetry
// ---------------------------------------------------------------------------

test('usage counters: only allowlisted fields with the right shape, and what would be sent is exactly what is sent', async () => {
  const raw = {
    appVersion: '1.4.0', host: 'desktop', runsStarted: 3, runsFinished: 2, runsFailed: 'many', aiConnected: true,
    prompt: 'Close my September books', clientName: 'Cafe Aroma', screenText: 'Balance 1,20,000', email: 'owner@example.com', extra: 1,
  };
  const preview = showWhatWouldBeSent(raw);
  assert.deepEqual(preview, { appVersion: '1.4.0', host: 'desktop', runsStarted: 3, runsFinished: 2, aiConnected: true });
  let sent: unknown = null;
  const result = await sendUsage(raw, async body => { sent = body; });
  assert.deepEqual(sent, preview);
  assert.deepEqual(result, preview);
  assert.deepEqual(showWhatWouldBeSent({ appVersion: '1.4.0 (Cafe Aroma build)', host: 'my-laptop', runsStarted: -1, approvalsDecided: 1.5 }), {});
  for (const [field, spec] of Object.entries(USAGE_FIELDS)) assert.equal(spec.audience, 'public', field);
});

test('audience: anything not known to be public counts as private', () => {
  assert.equal(audienceOf('public'), 'public');
  for (const value of [undefined, null, '', 'unknown', 'team', 'Public ', 'clients', 42]) assert.equal(audienceOf(value as never), 'private', String(value));
});

test('tools Chausar launches run with their telemetry switched off, and get no key', () => {
  const claude = cliEnv('claude-cli', 1024);
  for (const [name, value] of Object.entries(TELEMETRY_OFF_ENV['claude-code'])) assert.equal(claude[name], value, name);
  const codex = cliEnv('codex-cli');
  for (const [name, value] of Object.entries(TELEMETRY_OFF_ENV.codex)) assert.equal(codex[name], value, name);
  const source = { PATH: '/bin', HOME: '/home/o', ANTHROPIC_API_KEY: 'sk-x', OPENAI_API_KEY: 'sk-y' };
  const delegatedClaude = delegateEnv('claude-code', '/work/tmp', source);
  for (const [name, value] of Object.entries(TELEMETRY_OFF_ENV['claude-code'])) assert.equal(delegatedClaude[name], value, name);
  const delegatedCodex = delegateEnv('codex', '/work/tmp', source);
  for (const [name, value] of Object.entries(TELEMETRY_OFF_ENV.codex)) assert.equal(delegatedCodex[name], value, name);
  for (const env of [claude, codex, delegatedClaude, delegatedCodex]) assert.ok(!('ANTHROPIC_API_KEY' in env) && !('OPENAI_API_KEY' in env));
});

// ---------------------------------------------------------------------------
// 5. House rules
// ---------------------------------------------------------------------------

test('static: the screen and telemetry files throw only declared codes and keep the house style', async () => {
  for (const file of ['secrets.ts', 'telemetry.ts']) {
    const source = await readFile(new URL(`../runtime/venture/core/${file}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/'([A-Z]+(?:_[A-Z]+)+)'/g)) assert.ok((VENTURE_ERRORS as readonly string[]).includes(match[1]), `${file}: ${match[1]}`);
    assert.deepEqual(houseStyleFindings(source), [], file);
  }
});
