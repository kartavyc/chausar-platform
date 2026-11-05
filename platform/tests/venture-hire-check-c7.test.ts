// C7 task 13: the code checks on a hired agent's role. The name, job and duties are short and plain; it reads only from
// the listed areas; any hard stop in its words refuses with that stop's own line (HIRE_HARD_STOP), and a duty that would
// send, pay, post, delete or change a price without the owner refuses HIRE_FLOOR. Each hard stop's phrase list has its
// own English cases here: one sentence it must catch and one ordinary sentence it must let through.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HIRE_READS, checkHire, type HireRole } from '../runtime/venture/agents/hire-check.ts';
import { HARD_STOP_PHRASES, hardStopIn } from '../runtime/venture/policy/hard-stop-words.ts';
import { HARD_STOPS } from '../runtime/venture/policy/hard-stops.ts';

const clean: HireRole = {
  name: 'Mira', job: 'Keeps the content calendar and drafts captions for the week.',
  duties: ['Keeps the content calendar up to date', 'Drafts captions for my approval'],
  reads: ['plan', 'trackers'], department: 'marketing',
};
const others = { agentNames: ['Asha', 'Ravi'] };
const refusal = (code: string, line?: string) => (error: any) => error.code === code && (line === undefined || error.message.includes(line));
const stopLine = (id: string) => HARD_STOPS.find(stop => stop.id === id)!.line;

test('a clean role passes and comes back trimmed', () => {
  const role = checkHire({ ...clean, name: '  Mira ', duties: [' Keeps the content calendar up to date ', clean.duties[1]] }, others);
  assert.equal(role.name, 'Mira');
  assert.deepEqual(role.duties, clean.duties);
  assert.deepEqual(HIRE_READS, ['clients', 'orders', 'runs', 'money', 'plan', 'journal', 'notes', 'trackers']);
});

test('each hard stop in a duty refuses with that stop\'s own line', () => {
  const cases: Array<[string, string]> = [
    ['give stock tips to my clients', 'securities-advice'],
    ['diagnose patients', 'medical-diagnosis'],
    ['solve the CAPTCHA', 'captcha'],
    ['message people on LinkedIn for me', 'linkedin-automation'],
    ['write five-star reviews', 'fake-reviews'],
  ];
  for (const [duty, id] of cases) assert.throws(() => checkHire({ ...clean, duties: [duty] }, others), refusal('HIRE_HARD_STOP', stopLine(id)), duty);
  assert.throws(() => checkHire({ ...clean, job: 'Prescribes medicines to my patients' }, others), refusal('HIRE_HARD_STOP', stopLine('medical-diagnosis')));
  assert.throws(() => checkHire({ ...clean, name: 'Tip Guru', job: 'Sends target prices for Nifty stocks' }, others), refusal('HIRE_HARD_STOP', stopLine('securities-advice')));
});

test('a duty that acts on the floor without the owner refuses; one that drafts for approval passes', () => {
  assert.throws(() => checkHire({ ...clean, duties: ['send invoices automatically'] }, others), refusal('HIRE_FLOOR'));
  assert.throws(() => checkHire({ ...clean, duties: ['Pays the vendors on its own'] }, others), refusal('HIRE_FLOOR'));
  assert.throws(() => checkHire({ ...clean, duties: ['Posts to Instagram without asking'] }, others), refusal('HIRE_FLOOR'));
  assert.throws(() => checkHire({ ...clean, duties: ['Changes my prices automatically when demand rises'] }, others), refusal('HIRE_FLOOR'));
  assert.throws(() => checkHire({ ...clean, duties: ['Deletes old clients by itself'] }, others), refusal('HIRE_FLOOR'));
  assert.equal(checkHire({ ...clean, duties: ['drafts invoice reminders for my approval'] }, others).duties.length, 1);
  assert.equal(checkHire({ ...clean, duties: ['Automatically sorts my notes by client'] }, others).duties.length, 1);
});

test('a sixth duty, an unknown read, a duplicate or reserved name and overlong words each refuse', () => {
  assert.throws(() => checkHire({ ...clean, duties: ['a', 'b', 'c', 'd', 'e', 'f'] }, others), refusal('INVALID_VENTURE_REQUEST'));
  assert.throws(() => checkHire({ ...clean, duties: [] }, others), refusal('INVALID_VENTURE_REQUEST'));
  assert.throws(() => checkHire({ ...clean, reads: ['plan', 'passwords'] as any }, others), refusal('INVALID_VENTURE_REQUEST'));
  assert.throws(() => checkHire({ ...clean, name: 'asha' }, others), refusal('INVALID_VENTURE_REQUEST', 'already called'));
  for (const name of ['Chausar', 'keeper', '']) assert.throws(() => checkHire({ ...clean, name }, others), refusal('INVALID_VENTURE_REQUEST'), name);
  assert.throws(() => checkHire({ ...clean, name: 'x'.repeat(41) }, others), refusal('INVALID_VENTURE_REQUEST'));
  assert.throws(() => checkHire({ ...clean, job: 'x'.repeat(121) }, others), refusal('INVALID_VENTURE_REQUEST'));
  assert.throws(() => checkHire({ ...clean, duties: ['x'.repeat(161)] }, others), refusal('INVALID_VENTURE_REQUEST'));
  assert.throws(() => checkHire({ ...clean, department: 'legal' as any }, others), refusal('INVALID_VENTURE_REQUEST'));
  assert.throws(() => checkHire({ ...clean, extra: 1 } as any, others), refusal('INVALID_VENTURE_REQUEST'));
  assert.throws(() => checkHire(null as any, others), refusal('INVALID_VENTURE_REQUEST'));
});

test('every hard stop has a phrase list, and each list catches its own sentence and lets an ordinary one through', () => {
  assert.deepEqual(Object.keys(HARD_STOP_PHRASES).sort(), HARD_STOPS.map(stop => stop.id).sort());
  const english: Record<string, [string, string]> = {
    'securities-advice': ['Shares intraday trading calls with subscribers', 'Tracks GST due dates for my clients'],
    'advocate-solicit': ['Advertises my legal services to new clients', 'Drafts a reply to a client who asked about a notice'],
    'medical-diagnosis': ['Gives a diagnosis from the symptoms people send', 'Books appointments for my clinic'],
    'child-data': ["Collects children's details for the summer camp", 'Collects parents\' emails for the newsletter'],
    'captcha': ['Gets past the CAPTCHA on the portal', 'Stops and tells me when a site shows a check'],
    'detection-evasion': ['Rotates proxies so the site cannot tell it is a bot', 'Keeps a list of the sites I use'],
    'linkedin-automation': ['Sends LinkedIn connection requests every morning', 'Drafts a LinkedIn post for me to copy'],
    'fake-reviews': ['Writes fake reviews for the shop', 'Asks happy clients if they would leave a review'],
    'undisclosed-ai': ['Answers calls pretending to be a human', 'Drafts a script for the voice-over I record'],
  };
  for (const [id, [caught, ordinary]] of Object.entries(english)) {
    assert.equal(hardStopIn(caught)?.id, id, caught);
    assert.equal(hardStopIn(ordinary), null, ordinary);
  }
});

// Fix round 1 (review LOW-4): plainer wordings the first lists let through. A hard stop said in everyday words refuses
// with its own line; a duty whose verb sends, pays, posts, deletes or changes a price refuses unless it drafts, suggests
// or asks first, even with no "automatically" in it.
test('plain wordings of a hard stop refuse with that stop\'s own line', () => {
  const cases: Array<[string, string]> = [
    ['Hides that replies are written by AI', 'undisclosed-ai'],
    ['Never tells customers the replies come from a bot', 'undisclosed-ai'],
    ['Posts glowing reviews pretending to be customers', 'fake-reviews'],
    ['Writes reviews pretending to be happy clients', 'fake-reviews'],
    ['Recommends stocks for 2x returns', 'securities-advice'],
    ['Recommends good mutual funds to my followers', 'securities-advice'],
    ['Gives dosage advice for patients', 'medical-diagnosis'],
    ['Uses residential proxies so the site thinks it is a person', 'detection-evasion'],
  ];
  for (const [duty, id] of cases) assert.throws(() => checkHire({ ...clean, duties: [duty] }, others), refusal('HIRE_HARD_STOP', stopLine(id)), duty);
});

test('a duty whose verb acts on the floor refuses even without "automatically"; one that drafts, suggests or asks passes', () => {
  for (const duty of ['Pays vendor bills at month end', 'Cuts prices by 10 percent when stock is high', 'Sends payment reminders to clients', 'Replies to client emails', 'Deletes duplicate contacts', 'Posts the weekly offer on Instagram', 'Reads the inbox and then sends the answers']) {
    assert.throws(() => checkHire({ ...clean, duties: [duty] }, others), refusal('HIRE_FLOOR'), duty);
  }
  for (const duty of ['Drafts payment reminders for me to send', 'Prepares vendor bills for my approval', 'Suggests price changes when stock is high', 'Sends me a summary every evening', 'Asks me before posting the weekly offer', 'Tracks payments that are due', 'Keeps track of refunds clients asked for', 'Tracks GST due dates for my clients']) {
    assert.equal(checkHire({ ...clean, duties: [duty] }, others).duties[0], duty, duty);
  }
});

// Fix round 2 (review 2, LOW-2): owner-directed reminders and notes pass; the same words aimed at a client stay refused,
// since a reminder to a client is an outward message; and a duty is judged clause by clause.
test('reminders and notes to the owner pass; to a client they refuse unless drafted or asked first', () => {
  for (const duty of ['Reminds me to send invoices', 'Tells me when a client has not paid', 'Alerts me before a payment is due', 'Shows me which posts did well', 'Notifies me when a booking is cancelled', 'Drafts replies and asks me before sending them']) {
    assert.equal(checkHire({ ...clean, duties: [duty] }, others).duties[0], duty, duty);
  }
  for (const duty of ['Reminds clients to pay', 'Reminds clients to pay their invoices', 'Tells customers how to pay', 'Drafts and sends invoices', 'Reminds me of the due dates and sends the reminders to clients']) {
    assert.throws(() => checkHire({ ...clean, duties: [duty] }, others), refusal('HIRE_FLOOR'), duty);
  }
});

// Fix round 3 (review 2 LOW-3, raised to blocking): a period, an ampersand, a dash or a slash no longer lets a paying or
// sending duty through, and reminding, notifying or messaging clients, customers or anyone else is outward, so it needs
// a draft or an ask first. Over-refusal is the safe side; the refusal words show the rewrite.
test('punctuation never hides a floor act, and reminding or messaging a third party is outward', () => {
  for (const duty of ['Pays vendors. Reminds me on Fridays.', 'Emails clients & shows me the replies', 'Sends invoices to clients - reminds me weekly', 'Reminds customers of their bookings', 'Pays the rent; tells me after', 'Messages leads / alerts me when they answer', 'Posts offers plus shows me the likes', 'Notifies clients while I am away', 'Texts customers when an order ships', 'Pays vendors\nReminds me on Fridays']) {
    assert.throws(() => checkHire({ ...clean, duties: [duty] }, others), refusal('HIRE_FLOOR'), JSON.stringify(duty));
  }
  for (const duty of ['Notifies customers after I approve', 'Drafts booking reminders for customers', 'Reminds me to send invoices', 'Tells me when a client has not paid', 'Alerts me before a payment is due. Shows me which posts did well.', 'Notifies me when a booking is cancelled & drafts a reply']) {
    assert.equal(checkHire({ ...clean, duties: [duty] }, others).duties[0], duty.replace(/\s+/g, ' '), duty);
  }
});
