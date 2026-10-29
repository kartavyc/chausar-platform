import {ZOHO_BOOKS_GUIDE} from './zoho-books-guide.ts';
import {PLAYBOOK_GUIDES} from './playbook-guides.ts';
// Chausar venture launcher, connector setup guides (Ink v2 wave 4, package 4J7, catalogue K11). Every catalogue
// connector has a guide: numbered steps that ask for the least access the code uses, the step people skip, what the
// platform charges (dated only where Chausar's catalogue note says it), "No charge" for Chausar's own parts, a line on
// how Chausar checks access that is true for that connector, what it sends ("Sends: nothing, so nothing here can
// change Zoho Books."), and what the agents can and can't do with it. Only a connector that works in this build has a
// guide written by hand; one this build does not link says so and asks for no key: making one for Chausar now would
// only leave a key lying about. A half-configured connection names its missing setting (halfConfigured). guideProblems
// is the validation a test runs over the whole catalogue.
import type { State } from '../../contracts.ts';
import type { ConnectorGuide, VentureDeps } from '../contracts.ts';
import { listRecords } from '../records.ts';
import { CONNECTOR_CATALOGUE, type CatalogueEntry } from './catalogue.ts';
import { connectorModes } from './connectors.ts';
import { latestFollow, secretNameFor } from './github.ts';
import { stepsCheckedOnOf } from './posting-steps.ts';
import { BROWSER_SCRIPTS } from './browser.ts';
import { googleCalendarHost, mailboxConnectorOf } from './connector-truth.ts';

/** The day the catalogue's notes on prices were written (build/catalogue.ts, from research R6). */
export const CATALOGUE_NOTES_ON = '2026-10-16';
export const NO_CHARGE = 'No charge.';
const PRICES_UNCHECKED = "Chausar has not checked its prices. Read its own pricing page before you sign up.";
/** How a connector that does not connect in this build is checked: it is not. */
export const PLANNED_CHECKS = 'Nothing connects to it in this build, so there is no access to check.';

/**
 * What the catalogue's notes say about a platform's charges, by connector id, and whether the note itself says it
 * (only then is the line dated with the note's day). The rest are Chausar's own general words, undated.
 */
const CHARGES: Readonly<Record<string, { line: string; noted: boolean }>> = Object.freeze({
  vercel: { line: 'The free Hobby plan is for personal, non-commercial sites, so a business site needs a paid plan.', noted: true },
  netlify: { line: 'Newer free accounts get monthly credits, and sites pause when they run out.', noted: true },
  cloudflare: { line: 'Pages and DNS are free, and domains are sold at cost.', noted: true },
  hubspot: { line: 'Its CRM has a free edition.', noted: true },
  'zoho-crm': { line: 'It has a free edition.', noted: true },
  typeform: { line: 'Its free plan is small for real client intake.', noted: true },
  porkbun: { line: 'Domains are paid for each year. Buying one is spending, so it always waits for your approval.', noted: false },
  namecheap: { line: 'Domains are paid for each year.', noted: false },
  'lemon-squeezy': { line: 'A merchant of record takes a fee on each sale and pays out in US dollars.', noted: false },
  paddle: { line: 'A merchant of record takes a fee on each sale.', noted: false },
  'dodo-payments': { line: 'A merchant of record takes a fee on each sale. Check its prices and payouts before you choose it.', noted: false },
  'stripe-atlas': { line: 'Forming a company through it has a fee.', noted: false },
  firstbase: { line: 'Forming a company through it has a fee.', noted: false },
});
/** Chausar's own parts and the connectors that need nothing but this computer or the owner's own mail. */
const FREE = new Set(['chausar-crm', 'chausar-books', 'chausar-templates', 'mail-app', 'bank-account', 'mail-import', 'article-transcript', 'article-local-transcription', 'article-publishing', 'newsletter-owner-tool', 'tender-documents', 'tender-submission']);

type Hand = Omit<ConnectorGuide, 'charges' | 'missing'>;

const builder = (name: string, skipped: string): Hand => ({
  steps: [`Sign in to ${name} in your browser.`, `In Chausar, open the brief and choose ${name}.`, `Read the brief in ${name} and press send there yourself.`],
  skipped, checks: `There is nothing to connect, so there is no access to check: you sign in to ${name} yourself.`,
  sends: `Sends: nothing by itself. Chausar fills in or copies the brief; you press send in ${name}.`,
  agentLimits: `Agents can't open ${name} or send anything to it.`,
});
const poster = (name: string): Hand => ({
  steps: [
    'Use the desktop app: posting through your own browser works only there.',
    'If Chausar says Playwright with Chromium is missing, install it first.',
    `Press Sign in and sign in to ${name} yourself, in the Chausar browser window. Chausar never sees your password.`,
    'Run the posting steps check, then approve each post on Today.',
  ],
  skipped: 'Run the posting steps check before the first post, so Chausar knows the page still works the way it expects.',
  checks: `Chausar never sees your ${name} sign-in. The posting steps check shows the day each step last worked on the live page, and Check connections reports it.`,
  sends: `Sends: only the posts you approve, one at a time, from the ${name} account you signed in to. To post from another account, sign in to that one.`,
  agentLimits: 'Agents can only propose a post. Each one waits for your approval, and none goes out on its own.',
});
const inbox = (name: string, steps: string[], skipped: string): Hand => ({
  steps, skipped,
  checks: 'Chausar signs in and opens your inbox read only before it keeps anything, so a wrong password is refused at once. Check connections does the same again.',
  sends: `Sends: nothing, so nothing here can change your ${name} mail. Chausar reads read only and never marks a message read.`,
  agentLimits: "Agents can't read your mailbox. Only replies from people in your network and pipeline reach Today, screened first.",
});
const AGAIN = 'Chausar keeps it only while the app is open, so type it again after Chausar restarts.';

/** The guides written by hand: every connector this build really links, hands off to, reads or keeps inside Chausar. */
const HAND: Readonly<Record<string, Hand>> = Object.freeze({
  'zoho-books': ZOHO_BOOKS_GUIDE,
  ...PLAYBOOK_GUIDES,
  lovable: builder('Lovable', 'Turn on GitHub sync in Lovable, so Chausar can follow the code.'),
  replit: builder('Replit', 'Connect GitHub in Replit, so Chausar can follow the code.'),
  bolt: builder('Bolt', 'Bolt keeps its own version when GitHub sync has a conflict. Check which version is live.'),
  v0: builder('v0', 'v0 has no link that fills in a brief: paste the whole brief before you send.'),
  github: {
    steps: [
      'On GitHub, make a fine-grained personal access token.',
      'Under Repository access, choose Only select repositories and pick the one repo your builder uses.',
      'Under Repository permissions, set Contents and Metadata to Read-only, and Actions and Deployments to Read-only for the build checks. Leave every other permission at No access.',
      'Set an end date, then paste the token and the repo address in Chausar.',
    ],
    skipped: 'Set an end date on the token, so a lost token stops working on its own.',
    checks: 'Chausar does not read GitHub when you link the repo. It reads it when you press Check GitHub, and Check connections reads the repo page once.',
    sends: 'Sends: nothing, so nothing here can change your repo. Chausar reads it and never pushes.',
    agentLimits: "Agents can't read or change the repo. Only the build page reads it.",
  },
  tally: {
    steps: ['Use the desktop app: TallyPrime is read on this computer.', 'Open TallyPrime with the company you want.', 'In Chausar, add it under Sources and choose that company.', 'Chausar reads the Day Book into the back office.'],
    skipped: 'Keep TallyPrime open while Chausar reads it: it reads only what TallyPrime serves on this computer.',
    checks: 'Chausar reads TallyPrime only when you read it under Sources. Check connections says when that last happened and does not reach TallyPrime on its own.',
    sends: 'Sends: nothing, so nothing here can change TallyPrime.',
    agentLimits: "Agents can't read TallyPrime. Its figures reach them only as the back office's receipts.",
  },
  'bank-account': {
    steps: ["Download a statement from your bank's site as a CSV file.", 'In Chausar, import it under Connections, Bank, and name the account.', 'Chausar counts each row once, so importing the same file again adds nothing.'],
    skipped: 'Download the statement as CSV: Chausar reads CSV statements only.',
    checks: 'There is no bank sign-in to check: no bank provider is linked, and Chausar reads only the statement files you import.',
    sends: 'Sends: nothing, so nothing here can move money or change your bank. Chausar never asks for your bank password.',
    agentLimits: "Agents can't read your bank rows or move money. Matching them to bills waits for you.",
  },
  'mail-app': {
    steps: ['Nothing to connect.', 'Chausar drafts the message or the invoice email.', 'Open it in your own mail app and press send yourself.'],
    skipped: 'Read the draft before you send it: Chausar never sends it for you.',
    checks: 'There is nothing to connect, so there is no access to check.',
    sends: 'Sends: nothing. You send each message yourself, from your own mailbox.',
    agentLimits: 'Agents can only propose an email. It waits for your approval, and you send it yourself.',
  },
  'zoho-mail': inbox('Zoho', [
    'In Zoho Mail, open Settings, then Mail Accounts, and check that IMAP Access is on.',
    'In your Zoho account, open Security, then App Passwords, and make an app-specific password for Chausar.',
    'Use the desktop app: under Connections, type the server (imap.zoho.com, or imap.zoho.in for an account in India), port 993, your address and that password.',
    `${AGAIN}`,
  ], 'Make an app-specific password: with two-factor sign-in on, your Zoho password itself does not work over IMAP.'),
  'google-workspace': inbox('Gmail', [
    'Turn on 2-Step Verification for your Google account.',
    'Under Security, then App passwords, make an app password for Chausar. A Workspace admin can block app passwords; then this does not work for that account.',
    'Use the desktop app: under Connections, type imap.gmail.com, port 993, your address and that password.',
    `${AGAIN}`,
  ], 'Turn on 2-Step Verification first: without it Google offers no app passwords.'),
  'google-calendar': {
    steps: [
      'In Google Calendar, open Settings, then your calendar, then Integrate calendar.',
      'Copy the Secret address in iCal format.',
      'Use the desktop app: paste it under Connections, as your calendar address.',
      AGAIN,
    ],
    skipped: 'Copy the secret address, not the public one: the public address shows nothing unless the calendar is public. Anyone with the secret address can read the calendar, so keep it to yourself.',
    checks: 'Chausar reads the address once before it keeps it, so an address that does not answer is refused at once. Check connections reads it again.',
    sends: 'Sends: nothing, so nothing here can change your calendar.',
    agentLimits: "Agents can't read your calendar. Calls that ended show on Today for your notes, with no title or other guest kept.",
  },
  'chausar-crm': {
    steps: ['Nothing to set up: it is inside Chausar.', 'Add clients and orders under Clients.'],
    skipped: "Add each client's billing name once, so invoices and statements read right.",
    checks: 'Nothing to check: it is inside Chausar.',
    sends: 'Sends: nothing outside Chausar. Clients and orders stay in your encrypted workspace.',
    agentLimits: "Agents see only the order they work on, never your other clients' records.",
  },
  'chausar-books': {
    steps: ['Nothing to set up: it is inside Chausar.', 'Issue invoices and record payments under Money.'],
    skipped: 'Check your tax number and rates in the plan before the first invoice.',
    checks: 'Nothing to check: it is inside Chausar.',
    sends: 'Sends: nothing outside Chausar. Every number comes from the calculator with a receipt.',
    agentLimits: "Agents can't issue an invoice or record a payment. Each one waits for you.",
  },
  linkedin: poster('LinkedIn'),
  x: poster('X'),
  // Ink v2 wave 5 (5A6): mail files you import, and your own n8n or Make webhook.
  'mail-import': {
    steps: ['In your mail app, save the mails as .eml files, or export a folder as an .mbox file.', 'Under Connections, choose Import mail files and pick the file.'],
    skipped: 'Export only the folder you need: a file over 25 MB is refused, and the smaller the file, the less of other people\'s mail Chausar keeps.',
    checks: 'Nothing to connect: Chausar reads only the file you pick, and screens each message before it keeps anything.',
    sends: 'Sends: nothing. Chausar never sends mail.',
    agentLimits: "Agents read only the mail of the order's own client, screened first, and never your mailbox.",
  },
  'n8n-webhook': {
    steps: ['In n8n, add a Webhook node to a workflow and copy its production address.', 'Under Connections, paste it as your n8n webhook, and send the test item if you like.', AGAIN],
    skipped: 'Use the production address, not the test one, and keep the workflow active, or n8n will refuse what Chausar sends.',
    checks: 'With the test item, Chausar sends that one fixed item first and keeps the address only if n8n did not refuse it.',
    sends: 'Sends: only an item you approve, exactly as shown, to that webhook. Chausar never makes or changes a workflow.',
    agentLimits: "Agents can't send to your webhook. Each item waits for you to approve it as shown.",
  },
  'make-webhook': {
    steps: ['In Make, add a Custom webhook trigger to a scenario and copy its address.', 'Under Connections, paste it as your Make webhook, and send the test item if you like.', AGAIN],
    skipped: 'Turn the scenario on, or Make will hold what Chausar sends until you do.',
    checks: 'With the test item, Chausar sends that one fixed item first and keeps the address only if Make did not refuse it.',
    sends: 'Sends: only an item you approve, exactly as shown, to that webhook. Chausar never makes or changes a scenario.',
    agentLimits: "Agents can't send to your webhook. Each item waits for you to approve it as shown.",
  },
});

/** What a connector this build does not link says it would do until it is built, beside the general planned words. */
const UNTIL_BUILT: Readonly<Record<string, string>> = Object.freeze({
  youtube: 'Until then, copy the title and description from the draft yourself and publish in YouTube Studio. It stays private until you choose.',
});

/** A connector this build does not link: no key now, the least access it would ask for, and nothing it could change. */
function plannedGuide(item: CatalogueEntry): Hand {
  const writes = item.targets.includes('write');
  const inside = /^none\b/i.test(item.auth);
  return {
    steps: [
      `Nothing to set up in Chausar yet: linking ${item.name} is planned.`,
      inside ? 'When it is built, it needs no key or sign-in.'
        : `When it is built, Chausar will ask for ${item.auth.charAt(0).toLowerCase()}${item.auth.slice(1)}, with ${writes ? 'read access to what it needs and write access only for what you approve' : 'read access only to what it needs'}, and no access to anything else.`,
      UNTIL_BUILT[item.id] ?? `Until then, use ${item.name} on its own${item.vendorUrl ? ' site' : ''}.`,
    ],
    skipped: inside ? 'Nothing to make: it needs no key or sign-in.' : "Don't make a key or sign-in for Chausar yet: nothing here would use it, and an unused key is one more to lose.",
    checks: PLANNED_CHECKS,
    sends: `Sends: nothing, so nothing here can change ${item.name}.`,
    agentLimits: `Agents can't use ${item.name}: nothing connects to it in this build.`,
  };
}

/** What the platform charges: dated only where the catalogue's note says it; Chausar's own parts and the owner's own mail are free. */
function chargesOf(id: string): ConnectorGuide['charges'] {
  if (FREE.has(id)) return { line: NO_CHARGE, checkedOn: null };
  const said = CHARGES[id];
  return said ? { line: said.line, checkedOn: said.noted ? CATALOGUE_NOTES_ON : null } : { line: PRICES_UNCHECKED, checkedOn: null };
}

/** Whether a connector works in this build: a mode Chausar's code really does, or posting through the owner's browser. */
export function connectorWorks(item: CatalogueEntry): boolean {
  return connectorModes(item).some(mode => mode.status === 'available') || Object.hasOwn(BROWSER_SCRIPTS, item.id);
}

/** One connector's guide, with its missing setting when it is half configured. */
export function guideOf(item: CatalogueEntry, missing: string | null = null): ConnectorGuide {
  const hand = (connectorWorks(item) ? HAND[item.id] : undefined) ?? plannedGuide(item);
  return {
    steps: hand.steps.map((step, index) => `${index + 1}. ${step}`), skipped: hand.skipped, charges: chargesOf(item.id), checks: hand.checks,
    sends: hand.sends, agentLimits: hand.agentLimits, missing,
  };
}

/**
 * A connection set up part way, by its missing setting, or null: GitHub followed with a token the app no longer holds
 * (the shelf is memory only), a mailbox or a calendar address set up whose password or address the app no longer holds,
 * a bank account with no statement imported yet, a posting platform whose steps check was started but has not yet seen
 * every step work.
 */
export function halfConfigured(deps: Pick<VentureDeps, 'secrets'>, state: State, ventureId: string, connectorId: string): string | null {
  if (connectorId === 'github') {
    const follow = latestFollow(state, ventureId);
    if (follow && follow.tokenState === 'in-memory' && !deps.secrets.has(secretNameFor(follow.repo))) {
      return 'Missing: the GitHub token. Chausar keeps it only while the app is open, so paste it again.';
    }
    return null;
  }
  if (connectorId === 'zoho-mail' || connectorId === 'google-workspace') {
    const mailbox = listRecords(state, 'venture-mailbox', ventureId).at(-1);
    if (mailbox && mailbox.status === 'connected' && mailboxConnectorOf(mailbox.host) === connectorId && !deps.secrets.has('mailbox:password' as never)) {
      return 'Missing: the app password. Chausar keeps it only while the app is open, so type it again under Connections.';
    }
    return null;
  }
  if (connectorId === 'google-calendar') {
    const feed = listRecords(state, 'venture-calendar-feed', ventureId).at(-1);
    if (feed && feed.status === 'set' && googleCalendarHost(feed.host) && !deps.secrets.has('network:calendar' as never)) {
      return 'Missing: the calendar address. Chausar keeps it only while the app is open, so paste it again under Connections.';
    }
    return null;
  }
  if (connectorId === 'bank-account') {
    const accounts = listRecords(state, 'venture-bank-account', ventureId);
    const imported = new Set(listRecords(state, 'venture-bank-import', ventureId).map(item => item.accountId));
    const empty = accounts.find(account => !imported.has(account.id));
    return empty ? `Missing: a statement file for ${empty.label}. Import one under Bank.` : null;
  }
  if (connectorId === 'linkedin' || connectorId === 'x') {
    // A steps record exists once the owner started checking; until every step has worked, the check is what is missing.
    const started = listRecords(state, 'venture-posting-steps', ventureId).some(record => record.connectorId === connectorId);
    return started && !stepsCheckedOnOf(state, connectorId) ? 'Missing: a posting steps check where every step worked. Run it again before the first post.' : null;
  }
  return null;
}

/**
 * Every problem with the guides over a catalogue: a working connector with no guide of its own, a hand-written guide
 * on a connector that does not work in this build (it would describe a setup that does nothing), a connector Chausar's
 * catalogue does not know, or a guide with a part left empty. The whole catalogue answers [].
 */
export function guideProblems(catalogue: readonly CatalogueEntry[] = CONNECTOR_CATALOGUE): string[] {
  const problems: string[] = [];
  for (const item of catalogue) {
    const works = connectorWorks(item);
    if (works && !HAND[item.id]) { problems.push(`${item.id}: it works in this build but has no guide of its own.`); continue; }
    if (!works && HAND[item.id]) { problems.push(`${item.id}: it has a hand-written guide but does not work in this build.`); continue; }
    if (!CONNECTOR_CATALOGUE.some(known => known.id === item.id) && !HAND[item.id]) { problems.push(`${item.id}: it has no guide.`); continue; }
    const guide = guideOf(item);
    if (!guide.steps.length || !guide.skipped || !guide.checks || !guide.sends.startsWith('Sends: ') || !guide.agentLimits || !guide.charges.line) problems.push(`${item.id}: its guide has a part left empty.`);
  }
  return problems;
}

/** For a validation test only: whether a connector has a hand-written guide. */
export const hasHandGuide = (id: string) => Object.hasOwn(HAND, id);
