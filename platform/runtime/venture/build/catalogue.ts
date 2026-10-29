// Chausar venture launcher: the connector catalogue (package P4).
// 66 connectors in 12 categories, ported from research R6 section 8 and rewritten in plain words. YouTube and the
// read-only bank account joined with the posting modes and the bank shape (P2-connectors).
// `targets` lists the modes R6 aims for one day; connectors.ts decides which of them work in this build,
// so a card never claims more than the code does today. A vendorUrl is a plain "Visit site" link, never a mode.
import type { ConnectorCategory, ConnectorModeName } from '../contracts.ts';
// Ink v2 wave 5 (package 5-0): each new playbook's own entries, in build/catalogue/<id>.ts.
import { PLAYBOOK_CATALOGUE_ENTRIES } from './catalogue-playbooks.ts';

export type CatalogueRegion = 'global' | 'india';
export type CatalogueEntry = {
  id: string;
  name: string;
  category: ConnectorCategory;
  auth: string;
  regions: readonly CatalogueRegion[];
  regionNote: string | null;
  note: string;
  vendorUrl: string | null;
  targets: readonly ConnectorModeName[]; // the read and write modes R6 lists; handoff is decided by connectors.ts
};

const GI: readonly CatalogueRegion[] = Object.freeze(['global', 'india']);
const G: readonly CatalogueRegion[] = Object.freeze(['global']);
const I: readonly CatalogueRegion[] = Object.freeze(['india']);

function entry(
  category: ConnectorCategory, id: string, name: string, vendorUrl: string | null, targets: readonly ConnectorModeName[],
  regions: readonly CatalogueRegion[], auth: string, note: string, regionNote: string | null = null,
): CatalogueEntry {
  return Object.freeze({ id, name, category, auth, regions, regionNote, note, vendorUrl, targets: Object.freeze([...targets]) });
}

export const CONNECTOR_CATALOGUE: readonly CatalogueEntry[] = Object.freeze([
  // Build
  entry('build', 'lovable', 'Lovable', 'https://lovable.dev/', ['read', 'write'], GI, 'None for the brief link',
    'Builds your website and client area from the brief. Turn on GitHub sync in Lovable so Chausar can follow the code.'),
  entry('build', 'replit', 'Replit', 'https://replit.com/', [], GI, 'None for the brief link',
    'Builds your website and client area from the brief. Connect GitHub in Replit so Chausar can follow the code.'),
  entry('build', 'bolt', 'Bolt', 'https://bolt.new/', [], GI, 'None',
    'Builds from the brief you paste. Its GitHub sync commits on its own and keeps its own version when there is a conflict.'),
  entry('build', 'v0', 'v0', 'https://v0.app/', ['write'], GI, 'None for copying the brief',
    'Builds from the brief you paste. It has no link that fills in a brief.'),
  entry('build', 'github', 'GitHub', 'https://github.com/', ['read', 'write'], GI, 'A fine-grained token for one repo, read only',
    'Where your builder keeps the code. Chausar reads one repo and never pushes to it.'),

  // Site and domain
  entry('site-domain', 'lovable-hosting', 'Lovable hosting', 'https://lovable.dev/', [], GI, 'Inside Lovable',
    'The simplest way to publish a site made in Lovable. Pushing to GitHub does not publish it.'),
  entry('site-domain', 'vercel', 'Vercel', 'https://vercel.com/', ['read'], GI, 'Sign-in or access token',
    'The free Hobby plan is for personal, non-commercial sites, so a business site needs a paid plan.'),
  entry('site-domain', 'netlify', 'Netlify', 'https://www.netlify.com/', ['read'], GI, 'Sign-in or access token',
    'Newer free accounts get monthly credits and sites pause when they run out. Check its terms for business use.'),
  entry('site-domain', 'cloudflare', 'Cloudflare (Pages, DNS, Registrar)', 'https://www.cloudflare.com/', ['write'], GI, 'API token',
    'Pages and DNS are free, and domains are sold at cost.'),
  entry('site-domain', 'porkbun', 'Porkbun', 'https://porkbun.com/', ['read', 'write'], GI, 'API key and secret',
    'Sells and renews domains. Buying a domain is spending, so it will always need your approval.'),
  entry('site-domain', 'namecheap', 'Namecheap', 'https://www.namecheap.com/', [], GI, 'API key and a fixed IP address',
    'Sells domains. Its API needs a fixed IP address, which suits servers better than home computers.'),

  // Payments
  entry('payments', 'razorpay', 'Razorpay', 'https://razorpay.com/', ['read', 'write'], I, 'Key id and secret',
    'The default for businesses in India. International cards need extra approval and Terms, Privacy, Refund and Shipping pages.',
    'Also Malaysia and Singapore, through Curlec.'),
  entry('payments', 'cashfree', 'Cashfree Payments', 'https://www.cashfree.com/', ['read', 'write'], I, 'App id and secret',
    'Payment links, and payments from abroad paid out in rupees.'),
  entry('payments', 'stripe', 'Stripe', 'https://stripe.com/', ['read', 'write'], GI, 'Restricted API key',
    'Payment links and card payments in many countries. In India it takes new accounts by invitation only, so India starts with Razorpay.',
    'In India, new accounts are by invitation only.'),
  entry('payments', 'paypal', 'PayPal', 'https://www.paypal.com/', ['read'], GI, 'Client id and secret',
    'Useful when clients in other countries pay you.',
    'In India, only for payments that come from other countries.'),
  entry('payments', 'lemon-squeezy', 'Lemon Squeezy', 'https://www.lemonsqueezy.com/', ['read'], GI, 'API key',
    'A merchant of record: it sells on your behalf and handles sales tax. Pays out in US dollars.',
    'In India, payouts go through PayPal.'),
  entry('payments', 'paddle', 'Paddle', 'https://www.paddle.com/', ['read'], GI, 'API key',
    'A merchant of record for software and digital services. Check that it accepts sellers from your country.',
    'Whether sellers based in India can join is not confirmed.'),
  entry('payments', 'dodo-payments', 'Dodo Payments', 'https://dodopayments.com/', ['read'], GI, 'API key',
    'A merchant of record founded in India. Check its prices and payouts before you choose it.'),

  // Email and inbox
  entry('email', 'mail-app', 'Your own mail app', null, [], GI, 'None',
    'Chausar drafts the message and you send it from your own mailbox.'),
  entry('email', 'google-workspace', 'Google Workspace (Gmail)', 'https://workspace.google.com/', ['read', 'write'], GI, 'An app password for IMAP',
    'Business email on your own domain. Chausar reads your inbox over IMAP with an app password in the desktop app. Sending from Chausar would need a Google review first.'),
  entry('email', 'zoho-mail', 'Zoho Mail', 'https://www.zoho.com/mail/', ['read'], GI, 'An app-specific password for IMAP',
    'Business email on your own domain, with a data centre in India. Chausar reads your inbox over IMAP with an app-specific password in the desktop app.'),
  entry('email', 'resend', 'Resend', 'https://resend.com/', ['write'], GI, 'API key',
    'Sends invoices and booking emails from your own domain. Not for cold outreach.'),
  entry('email', 'postmark', 'Postmark', 'https://postmarkapp.com/', ['write'], GI, 'Server token',
    'Sends transactional email, kept apart from newsletters.'),

  // Booking and calendar
  entry('booking', 'cal-com', 'Cal.com', 'https://cal.com/', ['read'], GI, 'API key',
    'A booking page for calls. You can put its link on your site yourself; adding it through the brief is planned.'),
  entry('booking', 'calendly', 'Calendly', 'https://calendly.com/', ['read'], GI, 'Personal access token',
    'A booking page for calls. You can put its link on your site yourself; adding it through the brief is planned.'),
  entry('booking', 'google-calendar', 'Google Calendar', 'https://calendar.google.com/', ['read', 'write'], GI, 'A private calendar address you paste',
    'Chausar reads your calendar from the private address you paste, in the desktop app, to see the calls that ended.'),

  // Customers and CRM
  entry('customers', 'chausar-crm', 'Chausar CRM (built-in)', null, ['read', 'write'], GI, 'None, it is inside Chausar',
    'Clients and orders, kept next to your books in your encrypted workspace.'),
  entry('customers', 'hubspot', 'HubSpot (free CRM)', 'https://www.hubspot.com/', ['read'], GI, 'Private app token or sign-in',
    'A free CRM. Linking it to Chausar is planned.'),
  entry('customers', 'zoho-crm', 'Zoho CRM', 'https://www.zoho.com/crm/', ['read'], GI, 'Zoho sign-in',
    'A CRM with a free edition. Linking it to Chausar is planned.'),
  entry('customers', 'attio', 'Attio', 'https://attio.com/', ['read'], GI, 'Workspace access token',
    'A flexible CRM. Linking it to Chausar is planned.'),

  // Messaging and support
  entry('messaging', 'whatsapp', 'WhatsApp (Business Platform)', 'https://business.whatsapp.com/', ['write'], GI, 'Meta business sign-up',
    "WhatsApp's business rules limit AI-first chat services; read them before using WhatsApp for client support."),
  entry('messaging', 'telegram', 'Telegram', 'https://telegram.org/', ['write'], GI, 'Bot token',
    'Alerts and quick approvals for you through a bot are planned.'),
  entry('messaging', 'slack', 'Slack', 'https://slack.com/', ['write'], GI, 'Incoming webhook or bot token',
    'Posting updates to a channel is planned.'),
  entry('messaging', 'discord', 'Discord', 'https://discord.com/', ['write'], GI, 'Bot token or channel webhook',
    'Suits a community around your business, not support with promised reply times.'),

  // Docs and ops
  entry('docs-ops', 'notion', 'Notion', 'https://www.notion.com/', ['write'], GI, 'Notion sign-in',
    'Copying your playbook and brief into Notion is planned.'),
  entry('docs-ops', 'google-drive', 'Google Drive', 'https://drive.google.com/', ['write'], GI, 'Google sign-in for files Chausar makes',
    'Saving files Chausar makes into your Drive is planned.'),
  entry('docs-ops', 'linear', 'Linear', 'https://linear.app/', ['read'], GI, 'Sign-in or API key',
    'Reading tasks from Linear is planned.'),
  entry('docs-ops', 'airtable', 'Airtable', 'https://www.airtable.com/', ['read'], GI, 'Personal access token',
    'Reading tables from Airtable is planned.'),

  // Marketing and social
  entry('marketing', 'linkedin', 'LinkedIn', 'https://www.linkedin.com/', ['write'], GI, 'LinkedIn sign-in',
    'Posting to your own profile is planned.'),
  entry('marketing', 'x', 'X', 'https://x.com/', [], GI, 'X sign-in',
    'Opening a ready post for you to send is planned.'),
  entry('marketing', 'instagram', 'Instagram', 'https://www.instagram.com/', ['write'], GI, 'Instagram sign-in',
    "Posting needs a professional account and Meta's app review. Planned."),
  entry('marketing', 'meta-ads', 'Meta Ads', 'https://www.facebook.com/business', ['read'], GI, 'Meta sign-in and app review',
    'Reading ad spend into your books as expenses is planned.'),
  entry('marketing', 'google-ads', 'Google Ads', 'https://ads.google.com/', ['read'], GI, 'Google sign-in',
    'Reading ad spend into your books as expenses is planned.'),
  entry('marketing', 'buffer', 'Buffer', 'https://buffer.com/', ['write'], GI, 'Buffer sign-in',
    'The one planned way to schedule social posts.'),
  entry('marketing', 'youtube', 'YouTube', 'https://www.youtube.com/', ['write'], GI, 'Google sign-in',
    'Google no longer locks API uploads from unverified apps to private. You publish in YouTube Studio: it stays private until you choose; an AI voice or presenter needs the altered or synthetic setting.'),

  // Books, tax and invoicing
  entry('books-tax', 'chausar-books', 'Chausar back office', null, ['read', 'write'], GI, 'None, it is inside Chausar',
    'Invoices, payments and books. Every number comes from Chausar\'s calculator with a receipt.'),
  entry('books-tax', 'zoho-books', 'Zoho Books', 'https://www.zoho.com/books/', ['read', 'write'], GI, 'Owner-created self client and current access token',
    'Connect the selected client organisation for the open session. Review exact supported drafts and approve issuing separately in the accounting desk.'),
  entry('books-tax', 'tally', 'TallyPrime', 'https://tallysolutions.com/', ['read', 'write'], I, 'TallyPrime on this computer',
    "Reads TallyPrime's Day Book into the back office. Tested with a synthetic recording, not a real installation."),
  entry('books-tax', 'xero', 'Xero', 'https://www.xero.com/', ['read'], G, 'Xero sign-in',
    'Reading your Xero books is planned.'),
  entry('books-tax', 'quickbooks-online', 'QuickBooks Online', 'https://quickbooks.intuit.com/', ['read'], G, 'Intuit sign-in',
    'Reading your QuickBooks books is planned.',
    'Not offered in India.'),
  entry('books-tax', 'stripe-tax', 'Stripe Tax', 'https://stripe.com/tax', ['read'], G, 'Stripe key',
    'Works out tax on Stripe sales in some countries. It does not support businesses based in India.'),
  entry('books-tax', 'bank-account', 'Bank account (read only)', null, ['read'], GI, 'Your consent, with an end date you can see',
    'Reads balances and transactions only and never moves money. In India this would go through an account aggregator.'),
  entry('books-tax', 'gst-einvoice', 'GST e-invoicing (IRP)', 'https://www.gst.gov.in/', ['write'], I, 'Through a GST suvidha provider',
    'Needed for business sales once turnover passes the government limit. New businesses rarely need it in their first year.'),

  // Legal and entity
  entry('legal-entity', 'stripe-atlas', 'Stripe Atlas', 'https://stripe.com/atlas', [], GI, 'None',
    'Forms a company in Delaware in the United States. A checklist from Chausar is planned. Not legal advice.',
    'Founders in India also need the overseas investment steps.'),
  entry('legal-entity', 'firstbase', 'Firstbase', 'https://www.firstbase.io/', [], G, 'None',
    'Forms a company in the United States. A checklist from Chausar is planned. Not legal advice.'),
  entry('legal-entity', 'india-company-spice', 'India private limited company (MCA SPICe+)', 'https://www.mca.gov.in/', [], I, 'None',
    'Register a private limited company with the MCA. A checklist from Chausar is planned. Not legal advice.'),
  entry('legal-entity', 'india-llp-fillip', 'India LLP (MCA FiLLiP)', 'https://www.mca.gov.in/', [], I, 'None',
    'Register a limited liability partnership with the MCA. A checklist from Chausar is planned. Not legal advice.'),
  entry('legal-entity', 'gst-registration', 'GST registration', 'https://www.gst.gov.in/', [], I, 'None',
    'Register for GST on the government portal. A checklist from Chausar is planned. Not legal or tax advice.'),
  entry('legal-entity', 'documenso', 'Documenso', 'https://documenso.com/', ['write'], GI, 'API key',
    'Sending engagement letters for signature after your approval is planned.'),
  entry('legal-entity', 'docusign', 'DocuSign', 'https://www.docusign.com/', ['write'], GI, 'DocuSign sign-in',
    'Sending documents for signature after your approval is planned.'),
  entry('legal-entity', 'chausar-templates', 'Chausar contract templates', null, ['write'], GI, 'None, it is inside Chausar',
    'Drafting a scope of work, an NDA or an engagement letter from templates is planned. Not legal advice.'),

  // Analytics and feedback
  entry('analytics', 'posthog', 'PostHog', 'https://posthog.com/', ['read'], GI, 'Project key',
    'Product analytics. The brief will tell your builder to add it with your own key. Planned.'),
  entry('analytics', 'plausible', 'Plausible', 'https://plausible.io/', ['read'], GI, 'API key',
    'Simple site analytics that respects privacy. Planned.'),
  entry('analytics', 'google-analytics-4', 'Google Analytics 4', 'https://analytics.google.com/', ['read'], GI, 'Google sign-in',
    'Site analytics from Google. Planned.'),
  entry('analytics', 'tally-forms', 'Tally forms', 'https://tally.so/', ['read'], GI, 'API key',
    'An intake form on your site, added through the brief, is planned.'),
  entry('analytics', 'typeform', 'Typeform', 'https://www.typeform.com/', [], GI, 'Sign-in or personal token',
    'Forms. Its free plan is small for real client intake. Planned.'),
  // Ink v2 wave 5, 5A6: mail files the owner imports, the webhook handoff (K24) and speech out on the owner's key.
  entry('email', 'mail-import', 'Mail files you import', null, ['read'], GI, 'None: a file you export from your mail app',
    'Import .eml or .mbox files. Each message is screened first.'),
  entry('docs-ops', 'n8n-webhook', 'n8n webhook', null, ['write'], GI, 'The webhook address n8n gives you',
    'Sends only an item you approve, as shown.'),
  entry('docs-ops', 'make-webhook', 'Make webhook', null, ['write'], GI, 'The webhook address Make gives you',
    'Sends only an item you approve, as shown.'),
  entry('docs-ops', 'google-tts', 'Google Cloud Text-to-Speech', null, ['write'], GI, 'API key',
    'Speech in Indian languages on your own key. Planned.'),
  entry('docs-ops', 'sarvam-tts', 'Sarvam AI (Bulbul)', null, ['write'], I, 'API key',
    'Indian languages, made in India. Planned.'),
  entry('docs-ops', 'elevenlabs', 'ElevenLabs', null, ['write'], GI, 'API key',
    'Natural voices on your own key; a cloned voice needs the speaker\'s recorded consent. Planned.'),
  // Ink v2 wave 5: each new playbook's own entries (build/catalogue-playbooks.ts; none until a package adds them)
  ...PLAYBOOK_CATALOGUE_ENTRIES,
]);

const BY_ID: ReadonlyMap<string, CatalogueEntry> = new Map(CONNECTOR_CATALOGUE.map(item => [item.id, item]));

export function catalogueEntry(id: string): CatalogueEntry | null {
  return BY_ID.get(id) ?? null;
}

/** The plain name of a connector, for example the payment rail named in the brief. Falls back to the id. */
export function connectorName(id: string): string {
  return BY_ID.get(id)?.name ?? id;
}

export const CATEGORY_LABELS: Readonly<Record<ConnectorCategory, string>> = Object.freeze({
  build: 'Build',
  'site-domain': 'Site and domain',
  payments: 'Payments',
  email: 'Email and inbox',
  booking: 'Booking and calendar',
  customers: 'Customers and CRM',
  messaging: 'Messaging and support',
  'docs-ops': 'Docs and ops',
  marketing: 'Marketing and social',
  'books-tax': 'Books, tax and invoicing',
  'legal-entity': 'Legal and entity',
  analytics: 'Analytics and feedback',
});
