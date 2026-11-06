// Wave 6, 6C2 and 6C7: About you reads the owner's words, resume or LinkedIn export into a family, offers and a country
// (strict schema, amounts never from the model), the tiles are the fallback and the keyword guesser runs only without AI;
// "Connect what your business needs" lists outside services per family, each skippable, with honest labels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIES, FAMILY_IDS } from '../runtime/venture/core/families.ts';
import { familyIdea, keywordFamily } from '../runtime/venture/core/family-plan.ts';
import { aboutTask, keptReply, linkedinProfileText } from '../runtime/venture/core/about.ts';
import { PROFESSIONS } from '../runtime/venture/core/professions.ts';
import { businessNeeds } from '../runtime/venture/core/needs.ts';
import { classifyIdea } from '../runtime/venture/core/service-types.ts';
import { zip } from '../runtime/venture/playbooks/kit/ooxml/zip.ts';
import { engineFor, connectPair, PASSPHRASE } from './fixtures/venture/compose-unit/harness.ts';
import { anthropicEntry } from './fixtures/venture/compose-unit/plans.ts';

const CA = "I'm a CA with 6 years in audit. I want to do books and GST for small shops near me in India.";
const ADVOCATE = 'I am an advocate in Pune, India. I want to help small firms with contracts and notices.';
const csv = (rows: string[][]) => rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
const linkedinZip = (profile: string[][] | null, extra: Record<string, string> = {}) => Buffer.from(zip([
  ...(profile ? [{ name: 'Profile.csv', bytes: new TextEncoder().encode(csv(profile)) }] : []),
  ...Object.entries(extra).map(([name, text]) => ({ name, bytes: new TextEncoder().encode(text) })),
])).toString('base64');
const PROFILE_HEAD = ['First Name', 'Last Name', 'Maiden Name', 'Address', 'Birth Date', 'Headline', 'Summary', 'Industry', 'Zip Code', 'Geo Location', 'Twitter Handles', 'Websites', 'Instant Messengers'];

test('the eleven families of D2, each planning as its service type (6E1 hook)', () => {
  assert.deepEqual(FAMILIES.map(family => family.label), [
    'Money and tax', 'Teaching and coaching', 'Creative work', 'Writing and content', 'Local services', 'Documents and reports',
    'Research and analysis', 'People and careers', 'Shop and back office', 'Tech services', 'Licensed work',
  ]);
  assert.equal(FAMILY_IDS.length, 11);
  for (const family of FAMILIES) {
    assert.equal(classifyIdea(family.planIdea), family.serviceType, family.id);
    assert.equal(familyIdea(family.id, ''), family.planIdea);
    assert.ok(family.offers.length >= 2, family.id);
    for (const words of [family.label, family.line, family.planIdea, ...family.offers.flatMap(offer => [offer.name, offer.line])]) {
      assert.doesNotMatch(words, /\d|₹|\$|\u2014/, `${family.id}: ${words}`);
    }
  }
});

test('the keyword guesser finds a CA, a tutor and a video editor, and says nothing for empty words', () => {
  assert.equal(keywordFamily(CA), 'money-tax');
  assert.equal(keywordFamily('I tutor maths to school students on weekends'), 'teaching');
  assert.equal(keywordFamily('Freelance video editor for YouTube creators'), 'creative');
  assert.equal(keywordFamily('hello there friend'), null);
});

test('familyIdea keeps owner words that already plan as the family, else leads with the family plan sentence', () => {
  assert.equal(familyIdea('money-tax', CA), CA);
  const tutor = familyIdea('teaching', 'I am a school teacher who loves maths');
  // W6 6E1: teaching plans as its own type now.
  assert.equal(classifyIdea(tutor), 'teaching');
  assert.ok(tutor.endsWith('I am a school teacher who loves maths'));
  // A correction to another family still plans as the corrected family.
  assert.equal(classifyIdea(familyIdea('creative', CA)), 'studio');
});

test('the model schema is strict: listed family, offers without amounts, evidence copied from the owner words', () => {
  const task = aboutTask({ text: CA, file: null });
  assert.equal(task.purpose, 'decide');
  // A5: v2 adds the exact profession (its own tests are below).
  assert.equal(task.schemaName, 'chausar-owner-about-v2');
  const good = { familyId: 'money-tax', professionId: 'chartered-accountant', offers: [{ name: 'Monthly books', line: 'Bank matching and bills' }], countryCode: 'IN', evidence: 'near me in India' };
  assert.deepEqual(task.validate(good), good);
  for (const bad of [
    { ...good, familyId: 'astronaut' },
    { ...good, offers: [{ name: 'Monthly books', line: 'From 5000 a month' }] },
    { ...good, offers: [{ name: 'Books for ₹ less', line: 'x' }] },
    { ...good, offers: [1, 2, 3, 4].map(() => ({ name: 'Books', line: 'line' })) },
    { ...good, countryCode: 'ZZ' },
    { ...good, extra: true },
    { ...good, familyId: null },
  ]) assert.throws(() => task.validate(bad), { code: 'MODEL_OUTPUT_REJECTED' }, JSON.stringify(bad));
  assert.deepEqual(task.validate({ familyId: null, professionId: null, offers: [], countryCode: null, evidence: null }), { familyId: null, professionId: null, offers: [], countryCode: null, evidence: null });
  // One-shot A4 (live on Codex, a resume PDF): evidence that is not copied from the owner's words or file never sets the
  // country, and no longer throws the whole read away: the field and offers stand, the country is left unknown.
  assert.deepEqual(task.validate({ ...good, evidence: 'The owner lives in India.' }), { ...good, countryCode: null, evidence: null });
});

test('a LinkedIn export gives only headline, summary, industry and location from Profile.csv', () => {
  const text = linkedinProfileText(linkedinZip([PROFILE_HEAD, ['Asha', 'Rao', '', '12 Hill Road', '1 Jan', 'Chartered Accountant', 'Audit and GST for retailers', 'Accounting', '560001', 'Bengaluru, Karnataka, India', '@asha', 'asha.example', 'none']], { 'Connections.csv': 'First Name,Last Name\nSecret,Person\n', 'messages.csv': 'private' }));
  assert.match(text, /Headline: Chartered Accountant/);
  assert.match(text, /Location: Bengaluru, Karnataka, India/);
  for (const hidden of ['Asha', 'Rao', 'Hill Road', '560001', '@asha', 'Secret', 'private']) assert.ok(!text.includes(hidden), hidden);
  assert.throws(() => linkedinProfileText(linkedinZip(null, { 'Positions.csv': 'Title\nCA\n' })), { code: 'INVALID_VENTURE_REQUEST' });
  assert.throws(() => linkedinProfileText(Buffer.from('not a zip at all').toString('base64')), { code: 'INVALID_VENTURE_REQUEST' });
});

test('about.read without AI uses the keyword guess and the family offers; a profile link is refused', async t => {
  const { engine } = await engineFor(t);
  const read = await engine.request('venture.about.read', { text: CA }) as any;
  assert.equal(read.source, 'keywords');
  assert.equal(read.family.id, 'money-tax');
  assert.deepEqual(read.offers, FAMILIES[0]!.offers.map(offer => ({ ...offer })));
  assert.equal(read.country, null);
  assert.equal(read.idea, CA);
  await assert.rejects(engine.request('venture.about.read', { text: 'https://www.linkedin.com/in/someone-synthetic' }), { code: 'INVALID_VENTURE_REQUEST', message: /export/ });
  await assert.rejects(engine.request('venture.about.read', {}), { code: 'INVALID_VENTURE_REQUEST' });
  assert.equal((await engine.request('workspace.status', {})).open, false);
});

test('about.read through the connected AI returns its family, offers and country; amounts never come back', async t => {
  const answer = { familyId: 'money-tax', offers: [{ name: 'Monthly books', line: 'Bank matching, bills and a short report' }, { name: 'GST returns', line: 'A filing pack for each return' }], countryCode: 'IN', evidence: 'near me in India' };
  const { engine } = await engineFor(t, { responses: [anthropicEntry('decide', answer, [CA, 'familyId', 'untrusted'])] });
  await connectPair(engine);
  const read = await engine.request('venture.about.read', { text: CA }) as any;
  assert.equal(read.source, 'ai');
  assert.equal(read.family.id, 'money-tax');
  assert.equal(read.family.label, 'Money and tax');
  assert.deepEqual(read.offers, answer.offers);
  assert.deepEqual(read.country, { code: 'IN', name: 'India', currency: 'INR' });
  assert.equal(read.evidence, 'near me in India');
  assert.equal(read.idea, CA);
  // A1 final check: the read names its own call, which the kept card carries so the plan can say the AI wrote it.
  assert.match(read.callId, /^[A-Za-z0-9_-]{1,128}$/);
  assert.ok(!JSON.stringify(read).match(/price|amount/i));
});

test('about.read reads a LinkedIn export through the AI as the owner file, and refuses a PDF it cannot read', async t => {
  const zipped = linkedinZip([PROFILE_HEAD, ['Asha', 'Rao', '', '', '', 'Video Editor', 'Editing for YouTube creators', 'Media', '', 'Pune, Maharashtra, India', '', '', '']]);
  const answer = { familyId: 'creative', offers: [{ name: 'Video edits', line: 'Raw footage cut into ready videos' }], countryCode: 'IN', evidence: 'Pune, Maharashtra, India' };
  const { engine } = await engineFor(t, { responses: [anthropicEntry('decide', answer, ['Headline: Video Editor', 'background facts'])] });
  await connectPair(engine);
  const read = await engine.request('venture.about.read', { attachment: { name: 'Basic_LinkedInDataExport.zip', kind: 'linkedin-zip', contentBase64: zipped } }) as any;
  assert.equal(read.family.id, 'creative');
  assert.equal(read.country.code, 'IN');
  assert.equal(classifyIdea(read.idea), 'studio');
  assert.equal(read.file.included, true);
  await assert.rejects(engine.request('venture.about.read', { attachment: { name: 'resume.pdf', kind: 'resume-pdf', contentBase64: Buffer.from('%PDF-1.4 synthetic').toString('base64') } }), { code: 'TOOL_FAILED', message: /PDF/ });
});

// One-shot A4 (hands-on row 9): the beta has no Python helper, so the resume is read by Chausar's own PDF reader.
function onePagePdf(line: string): string {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'];
  const content = `BT /F1 11 Tf 72 720 Td (${line}) Tj ET`;
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let text = '%PDF-1.4\n';
  objects.forEach((body, index) => { text += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  return Buffer.from(`${text}trailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1').toString('base64');
}

test('A4: with no PDF helper, a resume PDF is read by Chausar itself and its text goes to the AI as the owner file', async t => {
  const answer = { familyId: 'teaching', offers: [{ name: 'Weekly classes', line: 'Small batches with practice work' }], countryCode: 'IN', evidence: 'Based in Chennai, India' };
  const { engine } = await engineFor(t, { responses: [anthropicEntry('decide', answer, ['Tutor of mathematics for school students', 'background facts'])] });
  await connectPair(engine);
  const read = await engine.request('venture.about.read', { attachment: { name: 'resume.pdf', kind: 'resume-pdf', contentBase64: onePagePdf('Tutor of mathematics for school students. Based in Chennai, India.') } }) as any;
  assert.equal(read.family.id, 'teaching');
  assert.equal(read.country.code, 'IN');
  assert.equal(read.file.included, true);
  // A PDF with no text (a scan) says so plainly; it is never guessed at.
  await assert.rejects(engine.request('venture.about.read', { attachment: { name: 'scan.pdf', kind: 'resume-pdf', contentBase64: onePagePdf('') } }), { code: 'TOOL_FAILED', message: /no text Chausar can read/ });
});

// One-shot A4 (hands-on row 9): a LinkedIn export sent alone, with no words of the owner's, still names the field: the
// instructions say the owner's words or file, so the AI is never told to answer null for empty words.
test('A4: the About you instructions take the owner file as well as the words', () => {
  const task = aboutTask({ text: '', file: { name: 'Profile.csv', text: 'Headline: Freelance photographer' } });
  assert.match(task.instructions, /If neither the owner words nor the owner file say what work they do, return null/);
  assert.doesNotMatch(task.instructions, /If the owner words do not say what work they do/);
});

test('about.pick turns a tile into the same answer with no AI and no vault', async t => {
  const { engine } = await engineFor(t);
  const pick = await engine.request('venture.about.pick', { familyId: 'teaching' }) as any;
  assert.equal(pick.source, 'tile');
  assert.equal(pick.family.id, 'teaching');
  assert.equal(pick.idea, FAMILIES[1]!.planIdea);
  assert.deepEqual((await engine.request('venture.about.families', {}) as any).families.map((family: any) => family.id), [...FAMILY_IDS]);
  await assert.rejects(engine.request('venture.about.pick', { familyId: 'astronaut' }), { code: 'INVALID_VENTURE_REQUEST' });
});

test('a CA, a tutor and a video editor each get a sensible, different list of services, all skippable', () => {
  const ca = businessNeeds('money-tax', 'IN'), tutor = businessNeeds('teaching', 'IN'), editor = businessNeeds('creative', 'IN');
  const ids = (list: typeof ca) => list.map(need => need.id);
  assert.ok(ids(ca).includes('razorpay') && ids(ca).includes('gmail') && ids(ca).includes('probe42'), ids(ca).join());
  assert.ok(ids(tutor).includes('google-calendar') && ids(tutor).includes('telegram'), ids(tutor).join());
  assert.ok(ids(editor).includes('google-drive') && ids(editor).includes('sunra'), ids(editor).join());
  assert.notDeepEqual(ids(ca), ids(tutor));
  assert.notDeepEqual(ids(tutor), ids(editor));
  assert.notDeepEqual(ids(ca), ids(editor));
  for (const need of [...ca, ...tutor, ...editor]) {
    assert.ok(need.why.length > 10 && need.why.length <= 120, need.id);
    assert.doesNotMatch(need.why, /\u2014/);
    assert.equal(need.required, false, need.id);
    assert.ok(['write', 'read', 'handoff', 'planned'].includes(need.label), `${need.id} ${need.label}`);
    if (need.label === 'planned') assert.ok(need.waitsOn && need.meanwhile, need.id);
    assert.ok(['sign-in', 'key', 'guide', 'none'].includes(need.connect.kind), need.id);
  }
  // Razorpay is India's rail; outside India it is not suggested.
  assert.ok(!ids(businessNeeds('money-tax', 'US')).includes('razorpay'));
});

test('needs.list reads the kept family; skipping every service still leaves a working business', async t => {
  const { engine } = await engineFor(t);
  await engine.request('workspace.create', { name: 'Synthetic tutor', passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: familyIdea('teaching', 'I tutor maths to school students'), countryCode: 'IN', workingName: 'Synthetic tutor' });
  await engine.request('venture.owner.set', { familyId: 'teaching' });
  const list = await engine.request('venture.needs.list', {}) as any;
  assert.equal(list.family.id, 'teaching');
  assert.ok(list.needs.some((need: any) => need.id === 'google-calendar'));
  // Nothing connected, nothing required: the plan and Today still answer.
  let view = await engine.request('venture.interview.next', { useTemplate: true }) as any;
  assert.ok(view.interview);
  await assert.rejects(engine.request('venture.owner.set', { familyId: 'astronaut' }), { code: 'INVALID_VENTURE_REQUEST' });
  assert.equal((await engine.request('venture.owner.get', {}) as any).familyId, 'teaching');
});

test('every connector label in the needs data is the card\'s real strongest mode in this build', async () => {
  const { CARD_LABELS, RAIL_NAMES } = await import('../runtime/venture/core/needs.ts');
  const { CONNECTOR_CATALOGUE } = await import('../runtime/venture/build/catalogue.ts');
  const { connectorModes } = await import('../runtime/venture/build/connectors.ts');
  for (const [id, label] of Object.entries(CARD_LABELS)) {
    const entry = CONNECTOR_CATALOGUE.find(item => item.id === id);
    assert.ok(entry, id);
    const modes = connectorModes(entry);
    const real = (['write', 'read', 'handoff'] as const).find(mode => modes.some(item => item.mode === mode && item.status === 'available')) ?? 'planned';
    assert.equal(label, real, id);
  }
  for (const [id, name] of Object.entries(RAIL_NAMES)) assert.equal(CONNECTOR_CATALOGUE.find(item => item.id === id)?.name, name, id);
});

test('a resume PDF is read through the trusted PDF helper before the vault, as the owner file', async () => {
  const { createDraftDesk } = await import('../runtime/venture/draft/index.ts');
  const { replay, anthropicEntry: entry } = await import('./fixtures/venture/compose-unit/plans.ts');
  const resume = 'Tutor of mathematics for school students. Based in Chennai, India.';
  const answer = { familyId: 'teaching', offers: [{ name: 'Weekly classes', line: 'Small batches with practice work' }], countryCode: 'IN', evidence: 'Based in Chennai, India' };
  const calls: string[] = [];
  const desk = createDraftDesk({
    host: 'test', modelTransport: replay([entry('decide', answer, ['Tutor of mathematics'])]), demo: true,
    ventureExists: () => false, vaultOpen: () => false,
    helper: { run: async (operation, input) => { calls.push(`${operation}:${input.maxPages}`); return { result: { pages: [{ page: 1, text: resume }] }, receipt: null }; } },
  });
  const ctx = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' } as any;
  const options = await desk.request(ctx, 'venture.ai.options', {}) as any;
  for (const id of ['anthropic-haiku-5-5', 'anthropic-sonnet-5-5']) {
    await desk.request(ctx, 'venture.ai.connect', { presetId: id, consentDigest: options.presets.find((p: any) => p.id === id).consentDigest, apiKey: ['sk', 'ant-test-about-not-a-real-key-41d2'].join('-') });
  }
  const read = await desk.request(ctx, 'venture.about.read', { attachment: { name: 'resume.pdf', kind: 'resume-pdf', contentBase64: Buffer.from('%PDF-1.4 synthetic resume').toString('base64') } }) as any;
  assert.deepEqual(calls, ['pdf.extract:6']);
  assert.equal(read.family.id, 'teaching');
  assert.equal(read.country.code, 'IN');
  assert.equal(read.file.included, true);
  desk.clear();
});

// ---------------------------------------------------------------------------
// One-shot A5 (founder answer 3a): the AI's read picks the owner's exact profession, never only the field, and the
// owner confirms it in "Which of these are you?". Code checks the pick is a real profession of the chosen field; any
// other pick (unknown, another field's, or one with no field) is dropped, so the owner chooses from the field's list.
// ---------------------------------------------------------------------------

test('A5: the schema offers every profession of the catalogue, or null, and the instructions ask for the exact one', () => {
  const task = aboutTask({ text: ADVOCATE, file: null });
  assert.equal(task.schemaName, 'chausar-owner-about-v2');
  const property = (task.schema as any).properties.professionId;
  assert.deepEqual(property.type, ['string', 'null']);
  assert.deepEqual(property.enum, [...PROFESSIONS.map(item => item.id), null]);
  assert.ok((task.schema as any).required.includes('professionId'));
  assert.deepEqual((task.input as any).professions, PROFESSIONS.map(item => ({ id: item.id, label: item.label, familyId: item.family })));
  assert.match(task.instructions, /exact profession/);
  assert.match(task.instructions, /null for professionId/);
});

test('A5: a pick in the chosen field is kept; an unknown pick, another field\'s, or one with no field becomes null', () => {
  const task = aboutTask({ text: ADVOCATE, file: null });
  const good = { familyId: 'licensed', professionId: 'advocate', offers: [{ name: 'Consultations', line: 'Booked calls with notes' }], countryCode: 'IN', evidence: 'in Pune, India' };
  assert.deepEqual(task.validate(good), good);
  for (const pick of ['astronaut', 'doctor-of-stars', 'photographer', 'licensed', 42]) {
    assert.deepEqual(task.validate({ ...good, professionId: pick }), { ...good, professionId: null }, String(pick));
  }
  const { professionId: _left, ...missing } = good;
  assert.deepEqual(task.validate(missing), { ...good, professionId: null }, 'no pick is no pick');
  assert.deepEqual(task.validate({ familyId: null, professionId: 'advocate', offers: [], countryCode: null, evidence: null }), { familyId: null, professionId: null, offers: [], countryCode: null, evidence: null });
});

test('A5: about.read through the AI names the profession it picked; keywords and tiles pick none', async t => {
  const answer = { familyId: 'licensed', professionId: 'advocate', offers: [{ name: 'Consultations', line: 'Booked calls with notes' }], countryCode: 'IN', evidence: 'in Pune, India' };
  const { engine } = await engineFor(t, { responses: [anthropicEntry('decide', answer, [ADVOCATE, 'professionId', 'exact profession', 'Chartered accountant'])] });
  await connectPair(engine);
  const read = await engine.request('venture.about.read', { text: ADVOCATE }) as any;
  assert.equal(read.family.id, 'licensed');
  assert.deepEqual(read.profession, { id: 'advocate', label: 'Advocate' });
  const { engine: plain } = await engineFor(t);
  assert.equal((await plain.request('venture.about.read', { text: ADVOCATE }) as any).profession, null);
  assert.equal((await plain.request('venture.about.pick', { familyId: 'licensed' }) as any).profession, null);
});

test('A5: about.families lists each field\'s professions in the catalogue\'s order, every profession once', async t => {
  const { engine } = await engineFor(t);
  const { families } = await engine.request('venture.about.families', {}) as any;
  for (const family of families) {
    assert.deepEqual(family.professions, PROFESSIONS.filter(item => item.family === family.id).map(item => ({ id: item.id, label: item.label })), family.id);
    assert.ok(family.professions.length >= 2, family.id);
  }
  assert.deepEqual(families.flatMap((family: any) => family.professions.map((item: any) => item.id)).sort(), PROFESSIONS.map(item => item.id).sort());
});

// A5 fix round 1: an older id the catalogue still knows as an alias (home-chef for home-chef-tiffin) is not a pick
// from the supplied list, so it is no pick: the owner chooses, and the alias never turns into a profession silently.
test('A5: an alias in place of a listed profession id is no pick', () => {
  const task = aboutTask({ text: 'I run a home tiffin service in Indore.', file: null });
  const answer = { familyId: 'local-services', professionId: 'home-chef', offers: [{ name: 'Tiffin plans', line: 'Lunch for office workers' }], countryCode: null, evidence: null };
  assert.equal(task.validate(answer).professionId, null);
  assert.equal(task.validate({ ...answer, professionId: 'home-chef-tiffin' }).professionId, 'home-chef-tiffin');
});

// C5 task 6: the AI's first reply after About you. Kept when it is at most two sentences of plain words; one holding a
// digit (a figure would need a "model estimate" label) is dropped, as is a third sentence; no AI keeps no reply.
test('the About you reply: a plain reply is kept, one with a figure or too long is dropped, the read still stands', () => {
  const task = aboutTask({ text: CA, file: null });
  const good = { familyId: 'money-tax', professionId: 'chartered-accountant', offers: [{ name: 'Monthly books', line: 'Bank matching and bills' }], countryCode: 'IN', evidence: 'near me in India' };
  assert.deepEqual(task.validate({ ...good, reply: 'You keep books for small shops. I set up monthly books and GST returns for you.' }),
    { ...good, reply: 'You keep books for small shops. I set up monthly books and GST returns for you.' });
  assert.deepEqual(task.validate({ ...good, reply: 'I set up 3 offers at Rs 500.' }), good);
  assert.deepEqual(task.validate({ ...good, reply: 'One. Two sentences here. And a third one.' }), good);
  assert.deepEqual(task.validate({ ...good, reply: null }), good);
  assert.deepEqual(keptReply('Read more at https://example.com today.'), null);
  assert.ok(task.schema && JSON.stringify(task.schema).includes('"reply"'));
});

test('about.read through the AI carries its kept reply; without an AI there is none', async t => {
  const answer = { familyId: 'money-tax', offers: [{ name: 'Monthly books', line: 'Bank matching, bills and a short report' }], countryCode: 'IN', evidence: 'near me in India', reply: 'You run a bookkeeping practice. I suggested monthly books to start.' };
  const { engine } = await engineFor(t, { responses: [anthropicEntry('decide', answer, [CA, 'familyId', 'untrusted'])] });
  await connectPair(engine);
  const read = await engine.request('venture.about.read', { text: CA }) as any;
  assert.equal(read.reply, 'You run a bookkeeping practice. I suggested monthly books to start.');
  const plain = await engineFor(t, {});
  const keywords = await plain.engine.request('venture.about.read', { text: CA }) as any;
  assert.equal(keywords.source, 'keywords');
  assert.equal(keywords.reply, undefined);
});
