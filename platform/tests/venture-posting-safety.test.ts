// Posting safety (catalogue H6, H19). A post comes only from a draft, by id, never from free text: the draft passed its
// checks, the client approved it where the playbook asks, and it is unchanged since; otherwise each post is refused
// with its reason. The posting window has a code gate on the element each action touches (submit, password, file,
// download, another site), a challenge or 403 page stops automatic actions on that site until the owner clears it, and
// a platform block freezes the channel for 72 hours. No real browser: a fake page model and fake ports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Context } from '../runtime/contracts.ts';
import type { BrowserPort, BrowserPostJob, BrowserPostResult, ConnectorCard, ConnectorPostRecord, ShareLinkView, VentureDeps } from '../runtime/venture/contracts.ts';
import { VENTURE_ERRORS } from '../runtime/venture/contracts.ts';
import { digest, houseStyleFindings, listRecords } from '../runtime/venture/records.ts';
import { handlers as build } from '../runtime/venture/build/index.ts';
import {
  FREEZE_HOURS, channelHold, clearChannelHold, connectorQueueRows, decideConnectorRow, decidePost, draftPostGate, proposePost,
} from '../runtime/venture/build/posting.ts';
import {
  BROWSER_SCRIPTS, READ_ELEMENT, gateBrowserAction, pageStop, playwrightBrowserPort, sensitiveKind, type ElementFacts,
} from '../runtime/venture/build/browser.ts';
import { shareDecide, sharePage } from '../runtime/venture/build/share-links.ts';
import { journalResolveHandler } from '../runtime/venture/journal/list.ts';
import { code, owner, setup } from './venture-views-env.ts';
import { clientDigest, seedClientAnswer, seedPostDraft, seedPostPlaybook } from './venture-post-drafts.ts';

const agent: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'mcp' };
const PRESENT = { present: true, reason: 'Playwright with Chromium found on this computer.' };

function fakeBrowser(results: BrowserPostResult[] = []) {
  const jobs: BrowserPostJob[] = [];
  const port: BrowserPort = {
    async probe() { return PRESENT; },
    async post(job) { jobs.push(job); return results.shift() ?? { outcome: 'posted', line: 'Posted.', url: null }; },
  };
  return { jobs, port };
}

async function posting(results: BrowserPostResult[] = []) {
  const env = await setup();
  const browser = fakeBrowser(results);
  const deps = { ...env.deps, connectors: { browser: browser.port, appReviewed: [], postTimeoutMs: 40 } } as VentureDeps;
  return { env, deps, browser };
}

// ---------------------------------------------------------------------------
// H6: posting takes only a checked, approved, unchanged draft by id
// ---------------------------------------------------------------------------

test('posting takes a draft id, never free text; the post is the draft line for that channel', async () => {
  const { deps, browser } = await posting();
  const run = await seedPostDraft(deps, ['X: Fresh pastries at 8.', 'LinkedIn: Our bakery opens at 8 every weekday.', 'X: Filter coffee all day.']);
  await assert.rejects(proposePost(deps, agent, { connectorId: 'x', text: 'Fresh pastries at 8.' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(proposePost(deps, agent, { connectorId: 'x', draftId: run.id, text: 'Anything else.' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(proposePost(deps, agent, { connectorId: 'x', draftId: 'delivery_missing' }), code('DELIVERY_NOT_FOUND'));
  // Two posts for X in one draft: the agent says which.
  await assert.rejects(proposePost(deps, agent, { connectorId: 'x', draftId: run.id }), (error: any) => error.code === 'INVALID_VENTURE_REQUEST' && /2 posts for X/.test(error.message));
  await assert.rejects(proposePost(deps, agent, { connectorId: 'x', draftId: run.id, part: 3 }), code('INVALID_VENTURE_REQUEST'));

  const second = await proposePost(deps, agent, { connectorId: 'x', draftId: run.id, part: 2, agent: 'Social writer' });
  assert.equal(second.text, 'Filter coffee all day.');
  assert.equal(second.draftId, run.id);
  assert.equal(second.draftDigest, clientDigest(run));
  const linkedin = await proposePost(deps, agent, { connectorId: 'linkedin', draftId: run.id });
  assert.equal(linkedin.text, 'Our bakery opens at 8 every weekday.');

  const only = await seedPostDraft(deps, ['LinkedIn: Our bakery opens at 8.']);
  await assert.rejects(proposePost(deps, agent, { connectorId: 'x', draftId: only.id }), (error: any) => error.code === 'INVALID_VENTURE_REQUEST' && /no post for X/.test(error.message));
  const long = await seedPostDraft(deps, [`X: ${'a'.repeat(281)}`]);
  await assert.rejects(proposePost(deps, agent, { connectorId: 'x', draftId: long.id }), code('INVALID_VENTURE_REQUEST'));

  const decided = await decidePost(deps, owner, { postId: second.id, digest: second.digest, action: 'approve' });
  assert.equal(decided.post.state, 'applied');
  assert.deepEqual(browser.jobs.map(job => job.text), ['Filter coffee all day.']);
});

test('a draft that did not pass its checks is refused with POST_DRAFT_UNCHECKED, every reason listed', async () => {
  const { deps } = await posting();
  const youtube = await seedPostPlaybook(deps, 'youtube');
  const refuse = async (lines: string[], fields: Parameters<typeof seedPostDraft>[2], expected: string, words?: RegExp) => {
    const run = await seedPostDraft(deps, lines, fields);
    await assert.rejects(proposePost(deps, agent, { connectorId: 'x', draftId: run.id }), (error: any) => {
      assert.equal(error.code, expected, error.message);
      if (words) assert.match(error.message, words);
      return true;
    });
    return run;
  };
  await refuse(['X: Fresh pastries at 8.'], { checks: [{ check: 'house-style', passed: false, detail: 'The draft uses a long dash.' }] }, 'POST_DRAFT_UNCHECKED', /long dash/);
  await refuse(['X: Fresh pastries at 8.'], { checks: [] }, 'POST_DRAFT_UNCHECKED', /checks have not run/);
  await refuse(['X: Fresh pastries at 8.'], { servedBy: 'template' }, 'POST_DRAFT_UNCHECKED', /template/);
  await refuse(['X: Fresh pastries at 8.'], { playbookId: youtube.id }, 'POST_DRAFT_UNCHECKED', /playbook's checks have not run/);
  await refuse(['X: Fresh pastries at 8.'], { playbookId: youtube.id, playbookChecks: [{ playbook: 'youtube', check: 'title-thumbnail', outcome: 'fail', detail: 'The title repeats the thumbnail.' }] }, 'POST_DRAFT_UNCHECKED', /repeats the thumbnail/);
  // The lint runs on the exact post text too, so an owner's edit or a non-flagship draft is covered.
  await refuse(['X: Here is a post: fresh pastries at 8.'], {}, 'POST_DRAFT_UNCHECKED', /words meant for the AI/);
  await refuse(['X: Fresh pastries at 8.'], { status: 'ready-for-review', verdict: null }, 'DELIVERY_NOT_READY', /Accept the draft first/);
  await refuse(['X: Fresh pastries at 8.'], { practice: true }, 'PRACTICE_DRAFT');

  const both = await refuse(['X: [hook] Fresh pastries at 8.'], { checks: [{ check: 'house-style', passed: false, detail: 'The draft uses a long dash.' }] }, 'POST_DRAFT_UNCHECKED');
  const gate = draftPostGate(deps.store.read(), { draftId: both.id, connectorId: 'x' });
  assert.equal(gate.allowed, false);
  assert.deepEqual(gate.reasons.map(reason => reason.code), ['POST_DRAFT_UNCHECKED', 'POST_DRAFT_UNCHECKED']);
  assert.equal(gate.text, '[hook] Fresh pastries at 8.');
  for (const reason of gate.reasons) assert.deepEqual(houseStyleFindings(reason.line), [], reason.line);
  assert.equal(listRecords(deps.store.read(), 'venture-connector-post').length, 0, 'a refused draft leaves no post behind');
});

test("a social agency draft needs the client's recorded approval of that exact text", async () => {
  const { deps } = await posting();
  const social = await seedPostPlaybook(deps, 'social-agency');
  const fields = { playbookId: social.id, playbookChecks: [{ playbook: 'social-agency', check: 'claims', outcome: 'pass' as const, detail: 'ok' }] };
  const run = await seedPostDraft(deps, ['X: Sunday thali at noon.'], fields);
  await assert.rejects(proposePost(deps, agent, { connectorId: 'x', draftId: run.id }), (error: any) => error.code === 'POST_CLIENT_NOT_APPROVED' && /has not approved/.test(error.message));
  await seedClientAnswer(deps, run, 'changes');
  await assert.rejects(proposePost(deps, agent, { connectorId: 'x', draftId: run.id }), (error: any) => error.code === 'POST_CLIENT_NOT_APPROVED' && /asked for changes/.test(error.message));

  // The client approved the agent's text; the owner then edited it, so the approval is for another text.
  const edited = await seedPostDraft(deps, ['X: Sunday thali at noon.'], { ...fields, status: 'edited', editedText: 'X: Sunday thali at noon, tables for six.' });
  const before = digest({ deliveryId: edited.id, title: 'Posts for October', text: edited.renderedText });
  await seedClientAnswer(deps, edited, 'approved', before);
  await assert.rejects(proposePost(deps, agent, { connectorId: 'x', draftId: edited.id }), (error: any) => error.code === 'POST_DRAFT_CHANGED' && /after your client approved/.test(error.message));
  await seedClientAnswer(deps, edited, 'approved');
  const post = await proposePost(deps, agent, { connectorId: 'x', draftId: edited.id });
  assert.equal(post.text, 'Sunday thali at noon, tables for six.', "the owner's edit is what goes out");

  // The real share link path: the digest the client's page shows is the one posting checks.
  const shared = await seedPostDraft(deps, ['X: Filter coffee from 7.'], fields);
  const hosted = { ...deps, host: 'hosted-web', publicUrl: 'https://app.example.com' } as VentureDeps;
  const made = await (build as Record<string, (d: VentureDeps, c: Context, p: unknown) => Promise<ShareLinkView>>)['venture.share.create'](hosted, owner, { deliveryId: shared.id });
  const token = /\/share\/([A-Za-z0-9_-]{32})$/.exec(made.url ?? '')![1];
  const page = (await sharePage(hosted, owner, token))!;
  await shareDecide(hosted, owner, token, { decision: 'approved', digest: page.digest });
  assert.equal((await proposePost(deps, agent, { connectorId: 'x', draftId: shared.id })).text, 'Filter coffee from 7.');
});

test('a draft that changed after the post was proposed is refused at approval: POST_DRAFT_CHANGED, nothing posted', async () => {
  const { env, deps, browser } = await posting();
  const run = await seedPostDraft(deps, ['X: Fresh pastries at 8.']);
  const post = await proposePost(deps, agent, { connectorId: 'x', draftId: run.id });
  await env.store.update(state => {
    const stored = state.conversations.find(item => item.id === run.id) as { renderedText: string };
    stored.renderedText = stored.renderedText.replace('8.', '9.');
  });
  await assert.rejects(decidePost(deps, owner, { postId: post.id, digest: post.digest, action: 'approve' }), code('POST_DRAFT_CHANGED'));
  const row = await decideConnectorRow(deps, owner, { id: post.id, digest: post.digest, action: 'approve' });
  assert.deepEqual([row.outcome, row.reason], ['refused', 'POST_DRAFT_CHANGED']);
  assert.equal(browser.jobs.length, 0);
  const denied = await decidePost(deps, owner, { postId: post.id, digest: post.digest, action: 'deny' });
  assert.equal(denied.post.state, 'rejected', 'the owner can still close it');
});

// ---------------------------------------------------------------------------
// H19: the posting window
// ---------------------------------------------------------------------------

const PAGE = 'https://x.com/compose/post';
const el = (over: Partial<ElementFacts> = {}): ElementFacts => ({
  tag: 'div', type: null, role: null, autocomplete: null, inForm: false, href: null, download: false, formAction: null, contentEditable: false, ...over,
});

test('the gate reads the element: submit, password, file, download and another site are sensitive; typing is not', () => {
  const click = { kind: 'click' as const }, fill = { kind: 'fill' as const };
  const kind = (action: Parameters<typeof sensitiveKind>[0], element: ElementFacts) => sensitiveKind(action, element, PAGE);
  assert.equal(kind(fill, el({ tag: 'input', type: 'password' })), 'password');
  assert.equal(kind(fill, el({ tag: 'input', type: 'text', autocomplete: 'one-time-code' })), 'password');
  assert.equal(kind(click, el({ tag: 'input', type: 'file' })), 'file');
  assert.equal(kind(click, el({ tag: 'a', href: 'https://x.com/export.zip', download: true })), 'download');
  assert.equal(kind(click, el({ tag: 'a', href: 'https://t.co/abc' })), 'off-site');
  assert.equal(kind(click, el({ tag: 'a', href: 'mailto:someone@example.com' })), 'off-site');
  assert.equal(kind(click, el({ tag: 'a', href: 'https://mobile.x.com/home' })), null, 'the same site');
  assert.equal(kind(click, el({ tag: 'button', type: 'submit', inForm: true, formAction: PAGE })), 'submit');
  assert.equal(kind(click, el({ tag: 'button', inForm: true, formAction: PAGE })), 'submit');
  assert.equal(kind(click, el({ tag: 'div', role: 'button', inForm: true, formAction: PAGE })), 'submit', 'role="button" in a form');
  assert.equal(kind(click, el({ tag: 'input', type: 'submit', inForm: true, formAction: 'https://collect.example/form' })), 'off-site');
  assert.equal(kind(click, el({ tag: 'button', type: 'button' })), null, 'a button outside a form submits nothing');
  assert.equal(kind({ kind: 'press', key: 'Enter' }, el({ tag: 'input', type: 'text', inForm: true, formAction: PAGE })), 'submit', 'Enter in a form');
  assert.equal(kind({ kind: 'press', key: 'Enter' }, el({ tag: 'textarea', inForm: true, formAction: PAGE })), null, 'Enter in a text area is a new line');
  assert.equal(kind({ kind: 'press', key: 'Enter' }, el({ contentEditable: true, inForm: true, formAction: PAGE })), null);
  assert.equal(kind({ kind: 'press', key: 'a' }, el({ tag: 'input', type: 'text', inForm: true })), null);
  assert.equal(kind(fill, el({ contentEditable: true })), null);
  // Any key whose last part is Enter submits a form, with or without a modifier.
  for (const key of ['Control+Enter', 'Meta+Enter', 'NumpadEnter', 'Shift+NumpadEnter']) {
    assert.equal(kind({ kind: 'press', key }, el({ tag: 'input', type: 'text', inForm: true, formAction: PAGE })), 'submit', key);
  }
  // Where code cannot tell what happens, it holds: a script link, a form control whose target it cannot read.
  assert.equal(kind(click, el({ tag: 'a', href: 'javascript:void(0)' })), 'unreadable');
  assert.equal(kind(click, el({ tag: 'button', type: 'submit', inForm: true, formAction: null })), 'unreadable');
  assert.equal(kind({ kind: 'press', key: 'Enter' }, el({ tag: 'input', type: 'text', inForm: true, formAction: null })), 'unreadable');
  const held = gateBrowserAction({ action: { kind: 'click' }, element: el({ tag: 'a', href: 'javascript:void(0)' }), pageUrl: PAGE, name: 'X', approvedSubmit: true });
  assert.equal(held.allow === false && held.kind, 'unreadable');
  assert.match(held.allow === false ? held.line : '', /could not see/);
});

test('the gate holds every sensitive action for the owner; the approved post click passes only as a submit on the site', () => {
  const approved = (element: ElementFacts | null) => gateBrowserAction({ action: { kind: 'click' }, element, pageUrl: PAGE, name: 'X', approvedSubmit: true });
  assert.deepEqual(approved(el({ tag: 'button', type: 'submit', inForm: true, formAction: PAGE })), { allow: true });
  assert.deepEqual(approved(el({ tag: 'button', type: 'button' })), { allow: true });
  for (const [element, kind, words] of [
    [el({ tag: 'input', type: 'password' }), 'password', /type every password/],
    [el({ tag: 'input', type: 'file' }), 'file', /pick every file/],
    [el({ tag: 'a', href: 'https://x.com/a.zip', download: true }), 'download', /download/],
    [el({ tag: 'a', href: 'https://t.co/abc' }), 'off-site', /leave X for t\.co/],
  ] as const) {
    const held = approved(element);
    assert.equal(held.allow, false, kind);
    assert.equal(held.allow === false && held.kind, kind);
    assert.match(held.allow === false ? held.line : '', words);
  }
  const submit = gateBrowserAction({ action: { kind: 'click' }, element: el({ tag: 'div', role: 'button', inForm: true, formAction: PAGE }), pageUrl: PAGE, name: 'X' });
  assert.equal(submit.allow, false, 'a submit nobody approved is held');
  const unread = approved(null);
  assert.equal(unread.allow, false, 'an element Chausar could not read is held');
  assert.match(unread.allow === false ? unread.line : '', /could not see/);
});

test('READ_ELEMENT, the function the page runs, reads the facts the gate needs from a DOM element', () => {
  const form = { action: 'https://x.com/compose' };
  const link = { href: 'https://x.com/file.csv', hasAttribute: (name: string) => name === 'download' };
  const attributes: Record<string, string> = { type: 'Submit', role: 'button' };
  const element = {
    tagName: 'BUTTON', form, isContentEditable: false,
    getAttribute: (name: string) => attributes[name] ?? null,
    closest: (selector: string) => (selector.startsWith('a') ? link : selector === 'form' ? form : null),
  };
  assert.deepEqual(READ_ELEMENT(element), {
    tag: 'button', type: 'submit', role: 'button', autocomplete: null, inForm: true, href: 'https://x.com/file.csv', download: true,
    formAction: 'https://x.com/compose', contentEditable: false,
  });
  assert.equal(READ_ELEMENT(null).tag, '');
  // A button's own formaction goes before its form's action: that is where it really sends.
  const own = { ...element, formAction: 'https://collect.example/form', hasAttribute: (name: string) => name === 'formaction' };
  assert.equal(READ_ELEMENT(own).formAction, 'https://collect.example/form');
  // Playwright sends the function's source to the page, so it must use nothing from this module: rebuilt from its
  // source alone, it reads the same facts.
  const rebuilt = new Function(`return (${READ_ELEMENT.toString()});`)() as typeof READ_ELEMENT;
  assert.deepEqual(rebuilt(element), READ_ELEMENT(element));
  assert.deepEqual(rebuilt(own), READ_ELEMENT(own));
});

test('the page check reads only what the platform owns: the address, the status, the title and its own notice element', () => {
  const x = BROWSER_SCRIPTS.x, linkedin = BROWSER_SCRIPTS.linkedin;
  const page = (over: Partial<Parameters<typeof pageStop>[0]> = {}) => ({ url: PAGE, status: 200, title: 'Home / X', notice: '', ...over });
  assert.equal(pageStop(page(), x), null, 'an ordinary compose page');
  assert.equal(pageStop(page({ status: 403 }), x)?.kind, 'challenge');
  assert.equal(pageStop(page({ status: 429 }), x)?.kind, 'challenge');
  assert.equal(pageStop(page({ title: 'Just a moment...' }), x)?.kind, 'challenge');
  assert.equal(pageStop(page({ notice: "Help us verify it's you. Solve this puzzle." }), x)?.kind, 'challenge');
  assert.equal(pageStop(page({ url: 'https://www.linkedin.com/checkpoint/challenge/abc' }), linkedin)?.kind, 'challenge');
  assert.equal(pageStop(page({ url: 'https://x.com/account/access' }), x)?.kind, 'challenge');
  assert.equal(pageStop(page({ notice: 'Your account has been suspended.' }), x)?.kind, 'blocked');
  assert.equal(pageStop(page({ title: 'Account suspended' }), x)?.kind, 'blocked');
  assert.equal(pageStop(page({ notice: 'Action blocked. We restrict certain activity to protect our community.' }), x)?.kind, 'blocked');
  assert.equal(pageStop(page({ url: 'https://x.com/i/flow/login', title: 'Log in to X' }), x), null, 'signed out is not a challenge');
  assert.ok(!linkedin.signedOutPaths.includes('/checkpoint'), 'a checkpoint is a challenge, not a signed-out session');
  for (const script of [x, linkedin]) assert.ok(script.noticeSelector.length > 0, `${script.name} names its own notice element`);
  assert.ok(!('text' in page()), 'the page check has no field for the feed or body text');
});

type PageModel = {
  url?: string; status?: number; title?: string; notice?: string; feed?: string;
  elements?: Record<string, ElementFacts | 'unreadable'>;
  failConfirm?: boolean; afterClick?: { title?: string; notice?: string };
};

/** An in-memory stand-in for the hold files beside the profile folders, and a clock. */
function holdDisk(start = Date.parse('2026-10-21T10:00:00.000Z')) {
  const files = new Map<string, string>();
  let now = start;
  return {
    files, advance: (ms: number) => { now += ms; },
    options: { holdFiles: { read: (path: string) => files.get(path.replaceAll('\\', '/')) ?? null, write: (path: string, text: string) => { files.set(path.replaceAll('\\', '/'), text); } }, now: () => now },
  };
}

function fakePage(model: PageModel = {}, disk: ReturnType<typeof holdDisk> = holdDisk()) {
  const calls: string[] = [];
  let clicked = false;
  const script = BROWSER_SCRIPTS.x;
  const elements: Record<string, ElementFacts | 'unreadable'> = {
    [script.textbox]: el({ contentEditable: true, role: 'textbox' }), [script.submit]: el({ tag: 'button', type: 'button', role: 'button' }), ...model.elements,
  };
  const locator = (selector: string) => ({
    first() { return this; },
    async evaluate() { const facts = elements[selector]; if (!facts || facts === 'unreadable') throw new Error('detached'); return facts; },
    async fill(text: string) { calls.push(`fill ${selector} ${text}`); },
    async click() { calls.push(`click ${selector}`); clicked = true; },
    async waitFor() { calls.push(`wait ${selector}`); if (model.failConfirm) throw new Error('Timeout 30000ms exceeded'); },
  });
  const page = {
    async goto(url: string) { calls.push(`goto ${url}`); return { status: () => model.status ?? 200 }; },
    url: () => model.url ?? PAGE,
    async title() { return clicked && model.afterClick?.title !== undefined ? model.afterClick.title : model.title ?? 'Home / X'; },
    // The platform's own notice element, by its selector; anything else the page holds is feed text.
    async evaluate(_fn: unknown, selector?: unknown) {
      if (selector !== script.noticeSelector) return model.feed ?? 'What is happening?!';
      return clicked && model.afterClick?.notice !== undefined ? model.afterClick.notice : model.notice ?? '';
    },
    locator,
  };
  const module = {
    chromium: {
      executablePath: () => 'C:/fake/chromium/chrome.exe',
      async launchPersistentContext() { launched += 1; return { pages: () => [page], newPage: async () => page, close: async () => {} }; },
    },
  };
  let launched = 0;
  const port = playwrightBrowserPort({ load: async () => module, exists: () => true, profileRoot: 'C:/profiles', ...disk.options });
  return { port, calls, launched: () => launched, post: () => port.post({ postId: 'post_1', connectorId: 'x', text: 'Hello', timeoutMs: 1000 }) };
}

test('the Playwright port: a clean compose page posts; a password field, a file input or another site is held before anything is sent', async () => {
  const clean = fakePage();
  assert.equal((await clean.post()).outcome, 'posted');
  const script = BROWSER_SCRIPTS.x;
  assert.deepEqual(clean.calls, [`goto ${script.composeUrl}`, `fill ${script.textbox} Hello`, `click ${script.submit}`, `wait ${script.confirm}`]);

  for (const [elements, words] of [
    [{ [script.textbox]: el({ tag: 'input', type: 'password' }) }, /type every password/],
    [{ [script.submit]: el({ tag: 'input', type: 'file' }) }, /pick every file/],
    [{ [script.submit]: el({ tag: 'a', href: 'https://elsewhere.example/post' }) }, /leave X/],
    [{ [script.submit]: 'unreadable' as const }, /could not see/],
  ] as const) {
    const fake = fakePage({ elements });
    const result = await fake.post();
    assert.equal(result.outcome, 'not-sent', JSON.stringify(elements));
    assert.match(result.line, words);
    assert.match(result.line, /Nothing was posted\./);
    assert.ok(!fake.calls.some(call => call.startsWith('click')), 'nothing is clicked');
    assert.equal('hold' in result, false, 'a held control is not a site hold');
  }
});

test('the Playwright port: a challenge or a block stops at once and reports a hold; signed out stays a plain not-sent', async () => {
  for (const model of [{ status: 403 }, { title: 'Just a moment...' }, { notice: 'Verify you are human to continue.' }] as PageModel[]) {
    const fake = fakePage(model);
    const result = await fake.post();
    assert.equal(result.outcome, 'not-sent', JSON.stringify(model));
    assert.deepEqual(result.outcome === 'not-sent' && result.hold, { kind: 'challenge', site: 'x.com' });
    assert.ok(!fake.calls.some(call => call.startsWith('fill') || call.startsWith('click')), 'no automatic action after a challenge');
  }
  const blocked = await fakePage({ notice: 'Your account is temporarily restricted.' }).post();
  assert.deepEqual(blocked.outcome === 'not-sent' && blocked.hold, { kind: 'blocked', site: 'x.com' });
  // Somebody's post in the feed saying an account was suspended is not the platform speaking: nothing stops.
  assert.equal((await fakePage({ feed: 'My account has been suspended, action blocked, verify you are human!' }).post()).outcome, 'posted');

  const late = await fakePage({ failConfirm: true, afterClick: { notice: "Confirm it's you before you continue." } }).post();
  assert.equal(late.outcome, 'unknown', 'after the click the post may have gone out');
  assert.deepEqual(late.outcome === 'unknown' && late.hold, { kind: 'challenge', site: 'x.com' });

  const signedOut = await fakePage({ url: 'https://x.com/i/flow/login' }).post();
  assert.equal(signedOut.outcome, 'not-sent');
  assert.match(signedOut.line, /Sign in to X/);
  assert.equal('hold' in signedOut, false, 'a session that ended is kept apart from a block');
});

test('holds per computer: a hold is written beside the profile folder and refuses posts and sign-in until cleared or over', async () => {
  const disk = holdDisk();
  const challenged = await fakePage({ notice: 'Verify you are human to continue.' }, disk).post();
  assert.equal(challenged.outcome, 'not-sent');
  const file = JSON.parse(disk.files.get('C:/profiles/x.hold.json') ?? 'null');
  assert.deepEqual([file?.kind, file?.site, file?.until, file?.clearedAt], ['challenge', 'x.com', null, null]);

  // Another business on this computer, or a vault that never saw it: the next post stops before the browser opens.
  const next = fakePage({}, disk);
  const refused = await next.post();
  assert.equal(refused.outcome, 'not-sent');
  assert.deepEqual(refused.outcome === 'not-sent' && refused.hold, { kind: 'challenge', site: 'x.com' });
  assert.equal(next.launched(), 0);
  const signIn = await next.port.signIn('x');
  assert.equal(signIn.present, false);
  assert.match(signIn.reason, /security check/);
  assert.equal(next.launched(), 0, 'sign-in is refused too');
  await next.port.clearHold!('x');
  assert.equal((await next.post()).outcome, 'posted');

  // A block is never cleared early; after 72 hours it is over.
  const frozen = holdDisk();
  await fakePage({ notice: 'Your account is temporarily restricted.' }, frozen).post();
  const later = fakePage({}, frozen);
  await later.port.clearHold!('x');
  assert.equal((await later.post()).outcome, 'not-sent');
  frozen.advance(72 * 3600000 + 1000);
  assert.equal((await later.post()).outcome, 'posted');
});

test('a challenge stops automatic actions on that channel until the owner clears it; a block freezes it for 72 hours', async () => {
  const { env, deps, browser } = await posting([
    { outcome: 'not-sent', line: 'X showed a security check. Nothing was posted.', hold: { kind: 'challenge', site: 'x.com' } },
  ]);
  const run = await seedPostDraft(deps, ['X: Fresh pastries at 8.', 'LinkedIn: Fresh pastries at 8.']);
  const first = await proposePost(deps, agent, { connectorId: 'x', draftId: run.id });
  const waiting = await proposePost(deps, agent, { connectorId: 'x', draftId: run.id });
  const decided = await decidePost(deps, owner, { postId: first.id, digest: first.digest, action: 'approve' });
  assert.equal(decided.post.state, 'rejected');
  const hold = channelHold(deps.store.read(), 'x', env.now())!;
  assert.deepEqual([hold.cause, hold.site, hold.until, hold.clearedAt, hold.postId], ['challenge', 'x.com', null, null, first.id]);
  assert.match(hold.line, /security check/);
  assert.deepEqual(houseStyleFindings(hold.line), []);

  await assert.rejects(proposePost(deps, agent, { connectorId: 'x', draftId: run.id }), code('CHANNEL_CHALLENGED'));
  await assert.rejects(decidePost(deps, owner, { postId: waiting.id, digest: waiting.digest, action: 'approve' }), code('CHANNEL_CHALLENGED'));
  assert.equal((await decideConnectorRow(deps, owner, { id: waiting.id, digest: waiting.digest, action: 'approve' })).reason, 'CHANNEL_CHALLENGED');
  assert.equal(browser.jobs.length, 1, 'nothing else ran on X');
  await proposePost(deps, agent, { connectorId: 'linkedin', draftId: run.id });
  const cards = await (build as Record<string, (d: VentureDeps, c: Context, p: unknown) => Promise<ConnectorCard[]>>)['venture.connectors.list'](deps, owner, {});
  const xBrowser = cards.find(card => card.id === 'x')!.postingOptions.find(option => option.mode === 'owner-browser-session')!;
  assert.equal(xBrowser.status, 'planned');
  assert.equal(xBrowser.reason, hold.line);

  await assert.rejects(clearChannelHold(deps, agent, { connectorId: 'x' }), code('APP_APPROVAL_REQUIRED'));
  const cleared = await clearChannelHold(deps, owner, { connectorId: 'x' });
  assert.equal(cleared?.clearedBy, 'owner');
  assert.equal(channelHold(deps.store.read(), 'x', env.now()), null);
  await proposePost(deps, agent, { connectorId: 'x', draftId: run.id });
});

test('a platform block freezes the channel for 72 hours, says not to reconnect, and cannot be cleared early', async () => {
  const { env, deps, browser } = await posting([
    { outcome: 'not-sent', line: 'X blocked this action. Nothing was posted.', hold: { kind: 'blocked', site: 'x.com' } },
  ]);
  assert.equal(FREEZE_HOURS, 72);
  const run = await seedPostDraft(deps, ['X: Fresh pastries at 8.']);
  const post = await proposePost(deps, agent, { connectorId: 'x', draftId: run.id });
  await decidePost(deps, owner, { postId: post.id, digest: post.digest, action: 'approve' });
  const hold = channelHold(deps.store.read(), 'x', env.now())!;
  assert.equal(hold.cause, 'blocked');
  assert.equal(Date.parse(hold.until!) - Date.parse(hold.at), 72 * 3600000);
  assert.match(hold.line, /do not sign in again or reconnect/i);
  await assert.rejects(proposePost(deps, agent, { connectorId: 'x', draftId: run.id }), code('CHANNEL_FROZEN'));
  await assert.rejects(clearChannelHold(deps, owner, { connectorId: 'x' }), code('CHANNEL_FROZEN'));

  env.advance(72 * 3600000 - 1000);
  await assert.rejects(proposePost(deps, agent, { connectorId: 'x', draftId: run.id }), code('CHANNEL_FROZEN'));
  env.advance(2000);
  assert.equal(channelHold(deps.store.read(), 'x', env.now()), null);
  const again = await proposePost(deps, agent, { connectorId: 'x', draftId: run.id });
  await decidePost(deps, owner, { postId: again.id, digest: again.digest, action: 'approve' });
  assert.equal(browser.jobs.length, 2);
  assert.equal(listRecords(deps.store.read(), 'venture-channel-hold').length, 1);
});

test('a text post shows its whole exact text, so it is described completely; a post with a picture or video not shown is not', async () => {
  const { deps, env } = await posting();
  const run = await seedPostDraft(deps, ['X: Fresh pastries at 8.', 'LinkedIn: Fresh pastries at 8.', 'Instagram: Fresh pastries at 8.']);
  const post = await proposePost(deps, agent, { connectorId: 'x', draftId: run.id });
  assert.equal(post.descriptionComplete, true);
  assert.equal(connectorQueueRows(deps.store.read()).find(row => row.id === post.id)?.descriptionComplete, true);
  const said = await proposePost(deps, agent, { connectorId: 'linkedin', draftId: run.id, descriptionComplete: false });
  assert.equal(said.descriptionComplete, false, 'a proposer may say part is not shown');
  await assert.rejects(proposePost(deps, agent, { connectorId: 'x', draftId: run.id, descriptionComplete: 'yes' }), code('INVALID_VENTURE_REQUEST'));

  // Instagram posts a picture or video with the caption; the owner sees only the caption, so it is never complete.
  const api = { async post() { return { outcome: 'posted' as const, line: 'Posted.', url: null }; } };
  const reviewed = { ...env.deps, connectors: { browser: fakeBrowser().port, appReviewed: ['instagram'], api: { instagram: api }, postTimeoutMs: 40 } } as VentureDeps;
  const media = await proposePost(reviewed, agent, { connectorId: 'instagram', draftId: run.id, mode: 'api', descriptionComplete: true });
  assert.equal(media.descriptionComplete, false);
});

test('the same post is never proposed again while it may have gone out or after it went out; after "did not go out" it may be', async () => {
  const maybe: BrowserPostResult = { outcome: 'unknown', line: 'X did not confirm the post.' };
  const { deps, browser } = await posting([maybe, { outcome: 'posted', line: 'Posted.', url: null }, maybe]);
  const resolve = (entryId: string, outcome: 'sent' | 'not-sent') => journalResolveHandler(deps, owner, { entryId, outcome });
  const run = await seedPostDraft(deps, ['X: Fresh pastries at 8.', 'X: Filter coffee all day.']);
  const first = await proposePost(deps, agent, { connectorId: 'x', draftId: run.id, part: 1 });
  assert.equal((await decidePost(deps, owner, { postId: first.id, digest: first.digest, action: 'approve' })).post.state, 'outcome_unknown');
  await assert.rejects(proposePost(deps, agent, { connectorId: 'x', draftId: run.id, part: 1 }), code('JOURNAL_OUTCOME_UNKNOWN'));
  await proposePost(deps, agent, { connectorId: 'x', draftId: run.id, part: 2 }); // another post of the draft is its own

  // The owner looked: it did not go out, so it may be proposed and sent again.
  await resolve(first.id, 'not-sent');
  const again = await proposePost(deps, agent, { connectorId: 'x', draftId: run.id, part: 1 });
  assert.equal((await decidePost(deps, owner, { postId: again.id, digest: again.digest, action: 'approve' })).post.state, 'applied');
  await assert.rejects(proposePost(deps, agent, { connectorId: 'x', draftId: run.id, part: 1 }), code('POST_ALREADY_DECIDED'));

  // It may have gone out, and the owner found that it did: never again.
  const only = await seedPostDraft(deps, ['LinkedIn: Our bakery opens at 8.']);
  const unsure = await proposePost(deps, agent, { connectorId: 'linkedin', draftId: only.id });
  await decidePost(deps, owner, { postId: unsure.id, digest: unsure.digest, action: 'approve' });
  await resolve(unsure.id, 'sent');
  await assert.rejects(proposePost(deps, agent, { connectorId: 'linkedin', draftId: only.id, part: 1 }), code('POST_ALREADY_DECIDED'));
  assert.equal(browser.jobs.length, 3);

  // Two proposals of one post, both waiting: once one goes out, the other is refused when approved and never runs.
  const twice = await seedPostDraft(deps, ['X: Sunday thali at noon.']);
  const a = await proposePost(deps, agent, { connectorId: 'x', draftId: twice.id });
  const b = await proposePost(deps, agent, { connectorId: 'x', draftId: twice.id });
  await decidePost(deps, owner, { postId: a.id, digest: a.digest, action: 'approve' });
  await assert.rejects(decidePost(deps, owner, { postId: b.id, digest: b.digest, action: 'approve' }), code('POST_ALREADY_DECIDED'));
  assert.equal(browser.jobs.length, 4);
});

test('the client approves the words they saw, and exactly those words go out: one digest for the share link and the post', async () => {
  const { deps, browser } = await posting();
  const social = await seedPostPlaybook(deps, 'social-agency');
  const fields = { playbookId: social.id, playbookChecks: [{ playbook: 'social-agency', check: 'claims', outcome: 'pass' as const, detail: 'ok' }] };
  const secret = `sk-${''}ant-api03-${'Q7x9Lm2Kp4Rt8Vw1Zy6B'.repeat(2)}`;
  const run = await seedPostDraft(deps, ['X: Filter coffee from 7. #PuneCafes #FilterCoffee', `LinkedIn: Our booking page key is ${secret}`], fields);
  const hosted = { ...deps, host: 'hosted-web', publicUrl: 'https://app.example.com' } as VentureDeps;
  const made = await (build as Record<string, (d: VentureDeps, c: Context, p: unknown) => Promise<ShareLinkView>>)['venture.share.create'](hosted, owner, { deliveryId: run.id });
  const token = /\/share\/([A-Za-z0-9_-]{32})$/.exec(made.url ?? '')![1];
  const page = (await sharePage(hosted, owner, token))!;
  await shareDecide(hosted, owner, token, { decision: 'approved', digest: page.digest });
  const seen = (channel: string) => page.text.split('\n').find(line => line.startsWith(`${channel}: `))!.slice(channel.length + 2);

  const x = await proposePost(deps, agent, { connectorId: 'x', draftId: run.id });
  assert.equal(x.draftDigest, page.digest, 'the post is bound to the digest the client approved');
  assert.equal(x.text, seen('X'));
  const linkedin = await proposePost(deps, agent, { connectorId: 'linkedin', draftId: run.id });
  assert.equal(linkedin.text, seen('LinkedIn'), 'the post carries the screened words the client saw');
  assert.ok(!linkedin.text.includes(secret), 'a key in a draft never goes out');
  await decidePost(deps, owner, { postId: x.id, digest: x.digest, action: 'approve' });
  assert.equal(browser.jobs[0].text, seen('X'));
});

test("an owner's edit is checked again on the exact post, instead of the checks the agent's version got", async () => {
  const { deps } = await posting();
  const dash = String.fromCharCode(0x2014);
  const failed = [{ check: 'house-style' as const, passed: false, detail: 'The agent used a long dash.' }];
  const edited = (text: string, extra: Parameters<typeof seedPostDraft>[2] = {}) => seedPostDraft(deps, [`X: Fresh pastries at 8 ${dash} come early.`], { checks: failed, status: 'edited', editedText: text, ...extra });
  // The agent's version failed; the owner's edit is clean, so it may go.
  assert.equal((await proposePost(deps, agent, { connectorId: 'x', draftId: (await edited('X: Fresh pastries at 8, come early.')).id })).text, 'Fresh pastries at 8, come early.');
  await assert.rejects(proposePost(deps, agent, { connectorId: 'x', draftId: (await edited(`X: Fresh pastries at 8 ${dash} come early!`)).id }), (error: any) => error.code === 'POST_DRAFT_UNCHECKED' && /long dash/.test(error.message));
  await assert.rejects(proposePost(deps, agent, { connectorId: 'x', draftId: (await edited('X: Here is a post: fresh pastries at 8.')).id }), (error: any) => error.code === 'POST_DRAFT_UNCHECKED' && /words meant for the AI/.test(error.message));
  // An edit that changed nothing keeps the stored results.
  await assert.rejects(proposePost(deps, agent, { connectorId: 'x', draftId: (await edited(`# Posts for October\n\n## Posts\nX: Fresh pastries at 8 ${dash} come early.`)).id }), (error: any) => error.code === 'POST_DRAFT_UNCHECKED' && /agent used a long dash/.test(error.message));
  // A social agency post runs the social checks on the owner's words.
  const social = await seedPostPlaybook(deps, 'social-agency');
  const bait = await edited('X: Fresh pastries at 8. Tag a friend who loves croissants!', { playbookId: social.id, playbookChecks: [{ playbook: 'social-agency', check: 'claims', outcome: 'pass', detail: 'ok' }] });
  await seedClientAnswer(deps, bait, 'approved');
  await assert.rejects(proposePost(deps, agent, { connectorId: 'x', draftId: bait.id }), (error: any) => error.code === 'POST_DRAFT_UNCHECKED' && /engagement/.test(error.message));
});

test('right before the browser starts, the channel and the draft are checked again; a change in between sends nothing', async () => {
  const { env, deps, browser } = await posting();
  const run = await seedPostDraft(deps, ['X: Fresh pastries at 8.']);
  const post = await proposePost(deps, agent, { connectorId: 'x', draftId: run.id });
  // The draft changes in the same commit that records the approval, after the checks before it passed.
  const update = env.store.update.bind(env.store);
  env.store.update = (change => update(async state => {
    const result = await change(state);
    const approved = state.conversations.find(item => item.id === post.id) as ConnectorPostRecord | undefined;
    const draft = state.conversations.find(item => item.id === run.id) as { renderedText: string };
    if (approved?.state === 'approved') draft.renderedText = draft.renderedText.replace('8.', '9.');
    return result;
  })) as typeof env.store.update;
  const decided = await decidePost(deps, owner, { postId: post.id, digest: post.digest, action: 'approve' });
  assert.equal(decided.post.state, 'rejected');
  assert.equal(decided.post.outcome?.by, 'engine');
  assert.match(decided.line, /changed/);
  assert.equal(browser.jobs.length, 0, 'nothing was sent');
});

test('static: the new refusal codes are declared, and the posting files keep the house style', async () => {
  for (const name of ['POST_DRAFT_UNCHECKED', 'POST_CLIENT_NOT_APPROVED', 'POST_DRAFT_CHANGED', 'CHANNEL_CHALLENGED', 'CHANNEL_FROZEN']) {
    assert.ok((VENTURE_ERRORS as readonly string[]).includes(name), name);
  }
  for (const file of ['build/posting.ts', 'build/browser.ts', 'playbooks/draft-checks.ts', 'playbooks/social/checks.ts']) {
    const source = await readFile(new URL(`../runtime/venture/${file}`, import.meta.url), 'utf8');
    assert.ok(!source.includes('\u2014'), file);
    assert.deepEqual(houseStyleFindings(source), [], file);
  }
});
