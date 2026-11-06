import type { BlueprintStep, MethodLevel, ModelPurpose, ModelTier, PricingModel, QueueActionId, Same, ServiceType, StepCapability, VentureHostKind, VentureMethod, VenturePackageId, VenturePayloads, VentureResults, VentureRunEventType, VentureStorage, W4Method, W5Method } from './contracts.ts';
// Runtime values for venture contracts. The type module imports these only as types.


export const VENTURE_CONTRACT_VERSION = 'chausar.dev/venture/v1alpha1' as const;


/** India GST state codes (first two digits of a GSTIN) and their names. Used for place of supply. */
export const INDIA_STATES: Readonly<Record<string, string>> = Object.freeze({
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
});


// ---------------------------------------------------------------------------
// 3. Service types, the venture record, terms, checklist
// ---------------------------------------------------------------------------

// W6 6E1 (D2): teaching, local services and licensed work have their own types, listed before 'other' so a keyword tie
// still goes to the older type (core/service-types.ts classifyIdea).
export const SERVICE_TYPES = ['agency', 'studio', 'consulting', 'bookkeeping', 'research', 'content', 'support', 'teaching', 'local-services', 'licensed', 'other'] as const;

/** Plain labels for each service type. P1 uses them in templates, P4 in brief line one, P7 on screens. */
export const SERVICE_TYPE_LABELS: Readonly<Record<ServiceType, string>> = Object.freeze({
  agency: 'Marketing agency', studio: 'Creative studio', consulting: 'Consulting practice', bookkeeping: 'Bookkeeping studio',
  research: 'Research desk', content: 'Content shop', support: 'Support team for hire',
  teaching: 'Teaching and coaching', 'local-services': 'Local service business', licensed: 'Licensed practice', other: 'Service business',
});


export const LAUNCH_STAGES = ['rehearsal', 'shadow', 'approve-each', 'approve-sample', 'auto-spot-check'] as const;


export const VENTURE_RECORD_KINDS = [
  'venture-record', 'venture-interview', 'venture-blueprint', 'venture-term',
  'venture-model-connection', 'venture-model-call',
  'venture-price-receipt', 'venture-client', 'venture-order', 'venture-invoice', 'venture-payment',
  'venture-brief', 'venture-handoff', 'venture-build-follow', 'venture-build-read',
  'venture-playbook', 'venture-simulation-run', 'venture-delivery-run', 'venture-signal',
  'venture-event',
  // Delivery harness (section 8b): client files, tables the agent's tools made, work receipts, improvement runs.
  'venture-upload', 'venture-work-table', 'venture-work-receipt', 'venture-improvement-run',
  // Heavy work: what the owner's own Claude Code or Codex left after an approved brief.
  'venture-delegate-run',
  // Onboarding v2: the plan the AI composed from checked blocks before the vault existed.
  'venture-composition',
  // Connectors (P2-connectors): one post the owner approves on its own; one staged website edit.
  'venture-connector-post', 'venture-site-edit', 'venture-open-posting-account',
  // Spend (P2-spend): a charge record per paid call, a quote waiting for the owner, and the owner's rate card and cap.
  'venture-spend', 'venture-spend-quote', 'venture-spend-policy',
  // Ink frontend (P1-A): the owner's decisions on Today's rows, and the auto or hold gate on each agent step.
  'venture-queue-decision', 'venture-team-gate',
  // Evidence ledger (P2-evidence): one claim about a client or business field, its strength and whether it is applied.
  'venture-evidence',
  // Action journal (P2-journal): one outside effect, described, approved with a bound token, then applied or not.
  'venture-journal-entry',
  // Posture (P2-posture): an agent's own posture (it only tightens the business one), and one spot-check decision per run.
  'venture-agent-posture', 'venture-spot-check',
  // AI-native CA firm playbook (P3-ca-firm): the CA of record, rate-table confirmations and recorded CA sign-offs.
  'venture-ca-firm',
  // Bank statements and leads as engine methods: an account with its consent, one record per statement import, one
  // record per lead, and the business's lead settings (postal address and blocklist).
  'venture-bank-account', 'venture-bank-import', 'venture-lead', 'venture-lead-settings',
  // Ink final pass: a receipt for a sum code made from venture records (owed, received, spent), and a client share link.
  'venture-sum-receipt', 'venture-share-link',
  // Posting safety (W1 H19): a security check or a platform block on one posting channel, until cleared or over.
  'venture-channel-hold',
  // The untrusted screen (W1 H9): the business's screen mode, and one record per held content the owner released.
  'venture-screen-setting', 'venture-untrusted-release',
  // Ink v2 wave 2: the day each browser posting step's candidates last matched, and the owner's decision on a bank row.
  'venture-posting-steps', 'venture-bank-match',
  // Ink v2 wave 2 (2B1): the owner's stricter posting limits for one channel; the newest per channel is in use.
  'venture-posting-limits',
  // Ink v2 wave 2 (2C1): whether the judge runs on its own on drafts for a client or the public, and its standing consent.
  'venture-judge-setting',
  // Ink v2 wave 2 (2E2): the owner's whisper.cpp for transcripts made on this computer; the newest is in use.
  'venture-transcription-setup',
  // Wave 6 (6I1): push-to-talk settings and each recording's receipt
  'venture-talk-setting', 'venture-talk-heard',
  // Ink v2 wave 4 (named by package 4-0, section 9e; each package fills its own). Keeper's runs (4A1); agent threads,
  // proposals and the chat consent (4B1); notes and their changes (4B2); Chats and proposals (4C1); people, imports and
  // forgotten people (4D1); ties (4D2); searches (4D3); pipeline cards and settings (4E1); outreach drafts (4E2); the
  // read-only mailbox and inbound mail (4E3); Away and pause all (4F1); notifications and their settings (4G1); push
  // subscriptions (4G3); CLI checks (4H1); goals (4I1); decisions (4J1); draft edits, the triage rule and settings drafts
  // (4J2); bills, credit notes and recurring invoices (4J5); connection checks and file requests (4J7); the owner
  // profile (4J9); the signing key (4J10); order contracts (4J12); routines and their runs (4J13); drill runs (4J15);
  // voice and persona (4J17); what the AI knows and ideas (4J18). 4A1 added the owner clearing an agent's quarantine.
  'venture-keeper-run', 'venture-health-clear',
  'venture-agent-message', 'venture-agent-proposal', 'venture-chat-consent',
  'venture-agent-note', 'venture-agent-note-change',
  'venture-chief-thread', 'venture-chief-message', 'venture-proposal',
  // Wave 6 (6G1, D42): the owner's number of quiet days before a chat settles on its own; the newest is in use.
  'venture-chat-settle',
  // Wave 6 (6H3, D40): each owner's layout of a place, one record per change (the newest is in use), and the AI's
  // requests to open a place.
  'venture-layout', 'venture-layout-go',
  // C5 task 1: the agents each member has met on Team (the newest record of theirs holds them all).
  'venture-team-intro',
  // C5 task 7: Allow AI for new clients.
  'venture-client-ai-default',
  // C5 task 16: who the owner's CA is.
  'venture-accountant',
  'venture-ca-pack-order', 'venture-ca-pack',
  'venture-person', 'venture-network-import', 'venture-forgotten',
  'venture-tie', 'venture-network-search',
  'venture-opportunity', 'venture-pipeline-settings',
  'venture-outreach',
  'venture-mailbox', 'venture-inbound',
  // 4E3: the private calendar address (its host only; the address is a secret) and the calls that ended lately.
  'venture-calendar-feed',
  'venture-away', 'venture-pause',
  // 4F2: the owner raising one write cap for one day (venture.runs.allowWrites).
  'venture-write-allowance',
  'venture-notification', 'venture-notify-settings', 'venture-notify-digest',
  'venture-push-subscription',
  'venture-cli-check',
  'venture-goal',
  'venture-decision',
  'venture-draft-edit', 'venture-triage-rule', 'venture-settings-draft', 'venture-queue-view',
  'venture-bill', 'venture-credit-note', 'venture-recurring-invoice',
  'venture-connector-check', 'venture-file-request',
  'venture-owner-profile',
  'venture-signing-key',
  // 4J10: the chained journal's links and breaks (one record per business), and one signature per signed receipt.
  'venture-journal-chain', 'venture-receipt-signature',
  'venture-order-contract',
  // 4J12 (H25): one message from one agent to another (or a report up to the owner), apart from the owner's chats.
  'venture-agent-relay',
  'venture-routine', 'venture-routine-run',
  'venture-drill-run',
  'venture-voice', 'venture-persona',
  'venture-knowledge', 'venture-idea',
  // 4J8: an offer the owner added to the plan ("Add this to {business}"), kept apart so every rewrite keeps it.
  'venture-owner-offer',
  // Ink v2 wave 5 (named by package 5-0; each body is a type in the owning package's records file, a placeholder until
  // that package lands). Ideas reuse 4J18's 'venture-idea', routines 4J13's, imported mail 4E3's 'venture-inbound'.
  // The kit: 5A2 the GO card (playbooks/kit/records-sales.ts); 5A4 brand kits, assets and voice consent
  // (records-media.ts); 5A5 reports and their share links (records-report.ts); 5A6 monitors (build/records-connect.ts).
  'venture-go-no-go', 'venture-sales-proposal', 'venture-brand-kit', 'venture-asset', 'venture-voice-consent', 'venture-report', 'venture-report-share',
  'venture-monitor',
  // 5A6 (K13): one owner-installed local app's last run and what it asked of the owner (build/records-connect.ts).
  'venture-local-app',
  // The flagships (playbooks/<id>/records.ts): YouTube 5B1 edits and the names dictionary, 5B2 the style card; the CA
  // firm 5C1 citations, 5C2 differential cases and the ITR data pack; social 5D2 inbox items and the ad ledger, 5D3
  // influencer cases.
  'venture-youtube-edit', 'venture-youtube-dictionary', 'venture-youtube-style',
  'venture-ca-citations', 'venture-ca-differential', 'venture-ca-data-pack', 'venture-ca-working',
  'venture-social-inbox-item', 'venture-social-scheduled', 'venture-ad-ledger-entry', 'venture-influencer-case',
  // The new playbooks (playbooks/<id>/records.ts): seo-visibility 5E1 and 5E2; online-seller 5F1 and 5F2; support-desk
  // 5G; recruiting-desk 5H; job-search-desk 5I; translation-studio 5J1; bookkeeping-cfo 5K1 and 5K2; podcast-to-article
  // 5L; lead-generation 5M; newsletter-studio 5N; tender-desk 5O; website-studio 5P; narration-studio 5Q;
  // virtual-assistant 5R1; data-entry-desk 5R2; app-testing 5R3; dev-agency 5R4; monitored-data 5R5; phone-receptionist 5R6.
  'venture-seo-panel', 'venture-seo-observation', 'venture-seo-finding',
  'venture-seller-sku', 'venture-seller-feecard', 'venture-seller-stage', 'venture-seller-movement', 'venture-seller-case',
  'venture-support-ticket', 'venture-support-message', 'venture-support-request', 'venture-support-rating',
  'venture-recruit-role', 'venture-recruit-candidate', 'venture-recruit-touch', 'venture-recruit-interview',
  'venture-career-fact', 'venture-career-listing', 'venture-career-thread',
  'venture-translation-job', 'venture-translation-segment', 'venture-glossary',
  'venture-promise-to-pay', 'venture-collection-stage', 'venture-books-posting',
  'venture-article-ledger',
  'venture-lead-source',
  'venture-newsletter-issue', 'venture-newsletter-contact',
  'venture-tender-question',
  'venture-site-requirement', 'venture-site-release',
  'venture-narration-segment',
  'venture-room-brief',
  'venture-entry-record',
  'venture-test-finding',
  'venture-demo-project',
  'venture-dev-permission',
  'venture-watch-source', 'venture-triage-channel',
  'venture-call-log',
  // Wave 6 (6C5, 6C6): owner attestations of locked rules, and the profession and side-work answer.
  'venture-rule-attestation', 'venture-compliance',
  // Wave 6 (6F2, 6F9): an added playbook pack; one Sunra image or video generation with its rupee quote and rights.
  'venture-pack', 'venture-media-generation',
  // Wave 6 (6E7): the owner's trading journal (imports, opening holdings, tax packs).
  'venture-trade-journal',
  // Wave 6 (6E4, 6E5): a client document on the document desk; the sign-off desk's professionals, requests and signatures.
  'venture-document', 'venture-signoff',
  // Wave 6 (6E2, 6E3): a lesson batch on the lesson desk; the booking desk's open slots and bookings.
  'venture-lesson-batch', 'venture-booking-slot', 'venture-booking',
  // Wave 6 (6G3, D44): field history, companies and their links, timeline entries the owner logged, lists and their
  // entries (crm/crm-data.ts). 6G4: dated memory facts (memory/facts-data.ts).
  'venture-crm-change', 'venture-company', 'venture-crm-link', 'venture-crm-entry', 'venture-crm-list', 'venture-crm-list-item',
  'venture-memory-fact',
  // Wave 6 (6G2, D43): an agent the owner retired, who took over its work, and when it was brought back.
  'venture-agent-retirement',
  // Wave 6 (6H1, D39): a mini app the owner's AI wrote, with its versions, grant, pin and own notes (apps/apps.ts).
  'venture-mini-app',
  // Wave 6 (6H2, D41): one version of a recorded flow, and one dry run or run of it (flows/records.ts).
  'venture-flow', 'venture-flow-run',
  // Wave 6 (6J2, D47): the owner's report choices (newest wins) and each crash or answer waiting for Send report (core/feedback.ts).
  'venture-feedback-setting', 'venture-feedback-item',
  // One-shot C4 (T20): one share of an invoice the owner made (the desktop share, Save file) or "Mark as sent".
  'venture-invoice-share',
  // C7: owner-made trackers and their rows (trackers/trackers.ts).
  'venture-tracker', 'venture-tracker-row',
  // C7: one more agent the owner hired, and the interview on the way (agents/hire-store.ts).
  'venture-agent-hire',
  // C7: one event a relay brought in, ids and its confirmed facts only (build/event-triggers.ts).
  'venture-relay-event',
] as const;


/**
 * Pinned template structure. P1 (offers, steps, interview), P5 (sections, scenarios) and the P6
 * fixtures all depend on these exact ids. Code makes the structure; a model only fills in words.
 */
export const OFFER_IDS = ['offer_1', 'offer_2'] as const;

export const STEP_IDS = ['step_1', 'step_2', 'step_3', 'step_4'] as const;

/**
 * Who does each step in this build. An agent can only draft from the client's message, so steps that need
 * files, inboxes, tools or sending are the owner's, with an agent planned. step_3 is always the drafting step.
 */
export const STEP_PLAN: readonly { id: string; doneBy: BlueprintStep['doneBy']; capability: StepCapability; note: string }[] = Object.freeze([
  { id: 'step_1', doneBy: 'you', capability: 'planned', note: 'You collect what the client sends and add the files to the order, where the agent reads them. Reading inboxes for you is planned.' },
  { id: 'step_2', doneBy: 'you', capability: 'planned', note: 'You do the hands-on work. For bookkeeping, an agent reconciles a month from the files you add, for you to check; other hands-on work is planned.' },
  { id: 'step_3', doneBy: 'agent-then-you', capability: 'drafts-now', note: "An agent drafts a reply from the client's message. You check it." },
  { id: 'step_4', doneBy: 'you', capability: 'planned', note: 'You send it to the client. Sending for you is planned.' },
] as const);

export const APPROVAL_COUNT = 2;

export const INTERVIEW_IDS = Object.freeze({ first: 'q_1', second: 'q_2', pricingModel: 'q_pricing_model', price: 'q_price', tax: 'q_tax', taxRate: 'q_tax_rate' } as const);

export const SECOND_OFFER_MODEL: Readonly<Record<ServiceType, PricingModel>> = Object.freeze({
  agency: 'project', studio: 'hourly', consulting: 'project', bookkeeping: 'project',
  research: 'hourly', content: 'project', support: 'hourly',
  teaching: 'hourly', 'local-services': 'project', licensed: 'project', other: 'project',
});

/** Headings promise work ahead, never work done: agents in this build only draft from the client's message. */
export { REQUIRED_SECTIONS } from './delivery/template-outline.ts';

export const SCENARIO_KINDS = ['clean', 'messy', 'pushback'] as const;

/** Starter connectors; '<payment-rail>' is replaced with country.paymentRails[0]. */
export const STARTER_CONNECTORS = Object.freeze(['lovable', 'github', '<payment-rail>', 'mail-app', 'cal-com', 'chausar-books'] as const);


// ---------------------------------------------------------------------------
// 5. Models (P2): presets, connections, calls, the model port
// ---------------------------------------------------------------------------

export const MODEL_PRESET_IDS = ['anthropic-haiku-5-5', 'anthropic-sonnet-5-5', 'openai-gpt-6-luna', 'openrouter', 'claude-code-cli', 'codex-cli', 'built-in-templates'] as const;

/** 'agent-turn' is one tool-using turn of a delivery agent (cheap tier); 'improve' proposes one playbook patch. */
/** 'decide' reads the open box and picks views (cheap tier); 'compose' fills the plan from library blocks (main tier). */
/** 'agent-chat' (4B1) answers the owner in an agent's thread, or drafts a "from now on" patch, under the chat consent (main tier). */
/** 'goal-suggest' (4I1) suggests a monthly goal from the plan's offers and prices only, a model estimate (cheap tier). */
/** 'chief-chat' (4C1) answers in Chats from read tools under the chat consent (main tier, as agent chat); 'chief-fit' (4C1) judges which way to earn fits, from the ways and business kinds only (cheap tier). */
/** 'meeting-digest' (4E3) reads the owner's notes from a call for people, promised intros and next steps, under the chat consent (main tier, as agent chat). */
/** 'network-search' (4D3) turns the owner's question into traits and filters, then checks candidates' stored fields against them, under the chat consent (main tier, as agent chat). */
/** 'outreach-draft' (4E2) drafts one message the owner sends themselves, from the card's facts and the owner's words, under the chat consent (main tier, as agent chat). */
/** 'plan-suggest' (4J8) rewrites the open business's plan words to take in the owner's sentence: words only, never a price or a new offer (main tier). */
/** 'persona-test' (4J17) writes an agent's first reply to each practice client in an unsaved persona, for the owner to read; practice clients only, no client data (fast tier). */
/** 'triage-rule' (4J2, O18) maps the owner's own words for Today's order to fixed fields; the owner's words only, no client data (fast tier). */
export const MODEL_PURPOSES = ['interview', 'blueprint', 'brief', 'delivery', 'client-sim', 'judge', 'agent-turn', 'improve', 'decide', 'compose', 'agent-chat', 'goal-suggest', 'chief-chat', 'chief-fit', 'network-search', 'meeting-digest', 'outreach-draft', 'plan-suggest', 'persona-test', 'triage-rule'] as const;

export const PURPOSE_TIER: Readonly<Record<ModelPurpose, ModelTier>> = Object.freeze({
  interview: 'fast', 'client-sim': 'fast', judge: 'fast', blueprint: 'main', brief: 'main', delivery: 'main',
  'agent-turn': 'fast', improve: 'main', decide: 'fast', compose: 'main', 'agent-chat': 'main', 'goal-suggest': 'fast',
  'chief-chat': 'main', 'chief-fit': 'fast', 'network-search': 'main', 'meeting-digest': 'main', 'outreach-draft': 'main', 'plan-suggest': 'main',
  'persona-test': 'fast', 'triage-rule': 'fast',
});


// ---------------------------------------------------------------------------
// 7. Build handoff and GitHub follow (P4)
// ---------------------------------------------------------------------------

export const BUILDER_IDS = ['lovable', 'replit', 'bolt', 'v0'] as const;


export const CONNECTOR_CATEGORIES = ['build', 'site-domain', 'payments', 'email', 'booking', 'customers', 'messaging', 'docs-ops', 'marketing', 'books-tax', 'legal-entity', 'analytics'] as const;

/**
 * The action journal (P2-journal, venture/journal/). Every outside effect is one entry: described, then approved inside
 * the app, then applied, rejected or outcome_unknown. A connector post is its own journalled record with the same fields.
 */
export const JOURNAL_ACTION_IDS = ['invoice.issue', 'delivery.send', 'connector.post', 'site.apply', 'bank.alert', 'connector.write', 'notify.push', 'notify.relay', 'credit.issue', 'owner.handoff'] as const;


/** https origins the app may open from a user click. Mirrored verbatim in app/desktop/ipc-contract.cjs. */
export const EXTERNAL_ORIGINS = Object.freeze([
  'https://accounts.google.com', 'https://lovable.dev', 'https://replit.com', 'https://bolt.new', 'https://v0.app', 'https://github.com',
  'https://vercel.com', 'https://www.netlify.com', 'https://www.cloudflare.com', 'https://porkbun.com', 'https://www.namecheap.com',
  'https://razorpay.com', 'https://www.cashfree.com', 'https://stripe.com', 'https://www.paypal.com', 'https://www.lemonsqueezy.com', 'https://www.paddle.com', 'https://dodopayments.com',
  'https://workspace.google.com', 'https://www.zoho.com', 'https://resend.com', 'https://postmarkapp.com',
  'https://cal.com', 'https://calendly.com', 'https://calendar.google.com',
  'https://www.hubspot.com', 'https://attio.com',
  'https://business.whatsapp.com', 'https://telegram.org', 'https://slack.com', 'https://discord.com',
  'https://www.notion.com', 'https://drive.google.com', 'https://linear.app', 'https://www.airtable.com',
  'https://www.linkedin.com', 'https://x.com', 'https://www.instagram.com', 'https://www.facebook.com', 'https://ads.google.com', 'https://buffer.com',
  // 4E2: WhatsApp click-to-chat, the handoff that opens a chat with the text filled in; the owner presses send.
  'https://wa.me',
  'https://www.youtube.com', 'https://studio.youtube.com',
  'https://tallysolutions.com', 'https://www.xero.com', 'https://quickbooks.intuit.com',
  'https://www.mca.gov.in', 'https://www.gst.gov.in', 'https://documenso.com', 'https://www.docusign.com', 'https://www.firstbase.io',
  'https://posthog.com', 'https://plausible.io', 'https://analytics.google.com', 'https://tally.so', 'https://www.typeform.com',
  'https://console.anthropic.com', 'https://platform.openai.com',
  // Wave 5 catalogue Visit site links. These do not grant provider API access.
  'https://wordpress.org', 'https://dash.cloudflare.com', 'https://search.google.com',
  'https://boards.greenhouse.io', 'https://jobs.lever.co', 'https://jobs.ashbyhq.com',
  'https://overpass-api.de', 'https://operations.osmfoundation.org', 'https://developers.google.com',
  'https://redditinc.com', 'https://developer.happenstance.ai',
  // Exact catalogue Visit site origins only; no API permission or wildcard access.
  'https://bsky.app',
  'https://joinmastodon.org',
  'https://developer-docs.amazon.com',
  'https://advertising.amazon.com',
  'https://seller.flipkart.com',
  'https://supplier.meesho.com',
  'https://partners.myntrainfo.com',
  'https://seller.ajio.com',
  'https://seller.nykaa.com',
  'https://seller.jiomart.com',
  'https://apidocs.shiprocket.in',
  'https://help.delhivery.com',
  'https://www.whatsapp.com',
  'https://sorftime.com',
  'https://shopify.dev',
  'https://developer.android.com',
  'https://docs.docker.com',
  // Wave 6 (6C1): the sign-in pages the tools' own logins print (Codex device code; Claude Code's sign-in).
  'https://auth.openai.com', 'https://claude.ai', 'https://claude.com',
] as const);

/**
 * claims-grounded: every figure, date, name and certification in the draft's own words is in the client's message,
 * the answers, the files, the tool results or the receipts (no model). rules-judge: the judge's yes/no votes on the
 * draft rules, each citing evidence from the run, counted by code against each rule's floor; it runs in rehearsal only.
 * receipts: every number in the draft's words has a receipt or is labelled a model estimate (money, rates and tax fail
 * where the playbook allows no estimate), every file and link it names is in the run's evidence, and no number is one
 * the calculator refutes. prompt-leak: no words meant for the AI in a draft no flagship playbook checks (prompt-leak.ts).
 */
export const CHECK_IDS = ['no-numeric-prose', 'figures-resolve', 'required-sections', 'no-outside-writes', 'house-style', 'prompt-leak', 'length-bounds', 'turn-limit', 'questions-raised', 'no-done-claims', 'claims-grounded', 'receipts', 'rules-judge'] as const;

export const JUDGE_QUESTIONS = ['goal-met', 'tone-fits', 'policy-followed', 'no-unbacked-claims'] as const;


export const DELIVERY_REASONS = ['wrong-fact', 'missing-fact', 'missing-section', 'off-brief', 'tone', 'format', 'too-long', 'too-short', 'wrong-number', 'late', 'claims-work-not-done', 'other',
  // C5 task 9: the work was not wanted; it was not wrong, so it teaches nothing.
  'not-needed'] as const;

/** 4J13 (A12): how long a routine's parked run waits for the owner's approval before it counts as no. */
export const ROUTINE_ANSWER_MS = 24 * 60 * 60_000;


// ---------------------------------------------------------------------------
// 8b. Delivery harness: agent tools, the agent loop, sandboxes, client files, work receipts, improvement
// ---------------------------------------------------------------------------

/** Every tool a delivery agent can be granted. Names are 'collection.function', the agentOS host-function shape. */
export const TOOL_NAMES = [
  'files.list', 'files.read', 'dictionary.browse', 'dictionary.resolve',
  'calc.sum', 'calc.totals', 'books.reconcile', 'bills.pick',
  'sandbox.transform', 'sandbox.python',
  'handoff.client', 'handoff.owner', 'outbox.propose',
  'agent.delegate',
  // Ink v2 wave 2: a flagship playbook's own tools (delivery/harness/patches.ts FLAGSHIP_TOOLS): the CA firm's tax
  // engines, the YouTube pieces and the social report figures; and the note any agent makes of where a fact came from.
  'tax.income', 'tax.interest', 'tax.gst', 'tax.tds', 'tax.statements', 'tax.portal',
  'youtube.hooks', 'youtube.editList', 'youtube.chapters', 'youtube.retention',
  'social.report',
  'evidence.record',
  // Ink v2 wave 5 (named by package 5-0; each answers NOT_BUILT_YET until its package lands). The kit: 5A3 ideas.add;
  // 5A4 assets.record, media.clean; 5A6 localapp.run, mail.read, speech.say (delivery/harness/tools-kit.ts).
  'ideas.add', 'assets.record', 'media.clean', 'localapp.run', 'mail.read', 'speech.say',
  // YouTube (tools-youtube.ts): 5B1 editOps to dictionary; 5B2 style to export; 5B3 afterPublish to archive.
  'youtube.editOps', 'youtube.clean', 'youtube.captions', 'youtube.coverage', 'youtube.dictionary',
  'youtube.style', 'youtube.clips', 'youtube.broll', 'youtube.beats', 'youtube.export',
  'youtube.afterPublish', 'youtube.outliers', 'youtube.niche', 'youtube.comments', 'youtube.publicStats', 'youtube.archive',
  // The CA firm (tools-ca.ts): 5C1 citations, formChooser, advance; 5C2 whatIf, healthCheck, entry.
  'tax.citations', 'tax.formChooser', 'tax.advance', 'tax.whatIf', 'books.healthCheck', 'docs.entry',
  // Social (tools-social.ts): 5D1 formats, inventory, slots; 5D2 montage to adStyle; 5D3 fairPrice, keywords.
  'social.formats', 'social.inventory', 'social.slots', 'social.montage', 'social.inbox', 'social.diagnose', 'social.health',
  'social.adStyle', 'social.fairPrice', 'social.keywords',
  // The new playbooks, each in delivery/harness/tools-<playbook id>.ts: seo-visibility (5E1 diagnose to siteCheck, 5E2
  // the rest), online-seller (5F1 to listing, 5F2 the rest), support-desk (5G), recruiting-desk (5H), job-search-desk
  // (5I), translation-studio (5J1 to subtitle.check, 5J2 dub), bookkeeping-cfo (5K1 to money.checkup, 5K2 books.write and
  // vouchers.draft), podcast-to-article (5L), lead-generation (5M), newsletter-studio (5N), tender-desk (5O),
  // website-studio (5P), narration-studio (5Q), virtual-assistant (5R1), data-entry-desk (5R2), app-testing (5R3),
  // dev-agency (5R4), monitored-data and it-triage (5R5), phone-receptionist (5R6).
  'seo.diagnose', 'seo.aiAccess', 'seo.panel', 'seo.siteCheck', 'seo.corroborate', 'seo.lint', 'seo.meta', 'seo.impact', 'seo.refresh', 'seo.local',
  'seller.unitEconomics', 'seller.ads', 'seller.settlement', 'seller.listing', 'seller.stage', 'seller.alerts', 'seller.stock', 'seller.shortlist',
  'seller.catalogueSheet', 'seller.multiStore',
  'support.match', 'support.ticket',
  'recruit.criteria', 'recruit.ledger', 'recruit.slots',
  'career.facts', 'career.capture', 'career.shortlist', 'career.score',
  'translate.check', 'translate.terms', 'subtitle.check', 'dub.align', 'dub.verify',
  'cfo.ratios', 'cfo.scenarios', 'collections.ladder', 'money.checkup', 'books.write', 'vouchers.draft', 'seller.books', 'books.setup',
  'article.ledger', 'article.style',
  'leads.osm', 'leads.enrich', 'leads.dedupe', 'community.vote',
  'newsletter.presend', 'newsletter.import', 'newsletter.slices', 'newsletter.stats',
  'tender.questions', 'tender.ground',
  'site.requirements', 'site.uiReport', 'site.flow', 'site.preview',
  'narration.markup', 'narration.verify',
  'va.brief',
  'forms.map', 'forms.readBack',
  'apptest.logcat', 'demo.plan',
  'qa.verdict', 'security.scan',
  'monitor.extract', 'triage.summary',
  'calls.cost', 'calls.log',
] as const;


/** Where a failure is fixed. A wrong number is never fixed in a prompt: it points at the calculator's inputs. */
export const ATTRIBUTION_LEVELS = ['harness', 'tools', 'dictionary', 'calculator'] as const;

export const PLAYBOOK_PATCH_OPS = ['guidance.add', 'guidance.remove', 'tools.grant', 'tools.revoke', 'checks.add', 'limits.turns', 'alias.add'] as const;


/**
 * Heavy work: the owner's own Claude Code or Codex, already installed and signed in on this computer. Chausar only
 * launches it; it never reads the tool's login. Each run works in a fresh folder that holds only the order's files
 * and the brief the owner approved.
 */
export const DELEGATE_CLIS = ['claude-code', 'codex'] as const;


// ---------------------------------------------------------------------------
// 9. Events (the venture actor's broadcast log)
// ---------------------------------------------------------------------------

export const VENTURE_EVENTS = [
  'venture-created', 'retention-changed', 'interview-updated', 'blueprint-drafted', 'blueprint-accepted',
  'model-connected', 'model-disconnected', 'send-policy-changed',
  'price-quoted', 'client-added', 'order-created', 'order-delivered', 'invoice-prepared', 'invoice-issued', 'payment-recorded',
  'brief-ready', 'handoff-prepared', 'handoff-opened', 'repo-linked', 'repo-synced',
  'rule-attested', 'rule-attestation-withdrawn', 'compliance-recorded',
  'playbook-ready', 'simulation-finished', 'launch-stage-changed', 'delivery-waiting', 'delivery-ready', 'delivery-reviewed', 'signal-recorded',
  'upload-added', 'delivery-needs-answer', 'improvement-finished', 'playbook-adopted',
  'delivery-brief-waiting', 'delegate-finished',
  'plan-composed',
  // Ink v2 wave 2 (2B1): the sign-in window the owner asked for did not open or could not be used; the method never waits.
  'posting-sign-in-failed',
  // Ink v2 wave 2 (2B2): a check of the posting steps ran; its data holds counts and the guard's audit lines only.
  'posting-steps-checked',
  // Ink frontend (P1-A): what the desktop pushes over IPC and the web sends over /api/events (VentureRunEvent).
  'run.started', 'run.step', 'run.waiting', 'run.done', 'run.failed', 'queue.changed',
  // Ink v2 wave 4: run events too, so they reach the window and /api/events. Their data holds ids only, and a frame
  // never carries words, names or figures; notify.new carries a count (4G1).
  'agent.message', 'chief.message', 'proposal.created', 'notify.new', 'pipeline.changed', 'run.stopped', 'run.call', 'keeper.ran',
  // Ink v2 wave 5 (named by 5-0, ids only): an order's chain moved (5A1), a playbook desk's records changed (each
  // business package), an idea moved or was graded (5A3).
  'chain.changed', 'desk.changed', 'idea.changed', 'privacy.forgotten',
] as const;


/** The run event names inside VENTURE_EVENTS, in order. */
export const VENTURE_RUN_EVENT_TYPES: readonly VentureRunEventType[] = Object.freeze([
  'run.started', 'run.step', 'run.waiting', 'run.done', 'run.failed', 'queue.changed',
  'agent.message', 'chief.message', 'proposal.created', 'notify.new', 'pipeline.changed', 'run.stopped', 'run.call', 'keeper.ran',
  'chain.changed', 'desk.changed', 'idea.changed', 'privacy.forgotten',
] as const);

export const QUEUE_ACTION_IDS: readonly QueueActionId[] = Object.freeze([
  'approve', 'deny', 'later', 'watch', 'read', 'answer', 'send-to-ca', 'open', 'connect', 'set-prices', 'keep', 'issue', 'run-again',
  'sent', 'continue', 'stop', 'resume', 'show-file',
] as const);


// ---------------------------------------------------------------------------
// 9e. Ink v2 wave 4: departments and Keeper, agent chat and notes, Chats with the chief of staff, the owner's network,
// the pipeline and outreach, run controls, notifications, the CLI status, goals and the 4J rows. Package 4-0 declared
// every name here with the fields its package text names; each package fills its own records and views. Field names
// that would clash with RecordBase.kind say what kind they are (proposalKind, importKind, outreachKind, sourceKind).
// app/ui mirrors the views in app/ui/src/engine/types.ts. Money is minor units as text, never a JS number.
// ---------------------------------------------------------------------------

/** The five departments every agent belongs to (4A1; playbooks/departments.ts holds their words and the role map). */
export const DEPARTMENT_IDS = ['sales', 'marketing', 'production', 'money', 'operations'] as const;

/**
 * What a proposal asks the engine to do once the owner approves it on Today (4C1): brief an agent (posted at once, no
 * Today card), start a run, start work on a floor step (4B1), draft an invoice or a reminder, quote, draft outreach, or
 * set a pipeline next step (4E3's meeting digest).
 */
export const PROPOSAL_KINDS = ['brief-agent', 'start-run', 'start-work', 'draft-invoice', 'draft-reminder', 'quote', 'outreach-draft', 'next-step'] as const;


/** The owner's own files the network is read from (4D1): nothing is fetched. */
export const NETWORK_IMPORT_KINDS = ['linkedin-connections', 'linkedin-messages', 'contacts-csv', 'vcard', 'calendar-ics', 'mail-headers'] as const;


/** Relationship bands, closest first (4D2); five dots to one. */
export const TIE_BANDS = ['close', 'know-well', 'know', 'met-once', 'cold'] as const;

/** The stored fields a plain-English search reads about a person (4D3). There is no location field: a place shows only in these words. */
export const SEARCH_FIELDS = ['title', 'company', 'earlier-role', 'note', 'meeting'] as const;


/** The pipeline's stages (4E1). Forward only; won, lost and not-now are terminal. */
export const PIPELINE_STAGES = ['found', 'asked', 'talking', 'proposal', 'won', 'lost', 'not-now'] as const;

export const LOST_REASONS = ['no-budget', 'no-reply', 'chose-someone-else', 'not-a-fit', 'timing', 'other', 'opted-out'] as const;


/** What a drafted message is (4E2). 'reminder': 4J5's invoice reminder, handed off the same way. */
export const OUTREACH_KINDS = ['intro-request', 'double-opt-in', 'connection-note', 'follow-up', 'reply', 'cold-email', 'reminder'] as const;


// ---------------------------------------------------------------------------
// 10. RPC methods: names, owners, payloads, results
// ---------------------------------------------------------------------------

/**
 * Ink v2 wave 4's methods, by package (named by package 4-0; each answers NOT_BUILT_YET until its package lands). They
 * are part of VENTURE_METHODS; listed apart so W4_METHOD_LEVELS can be typed complete.
 */
export const W4_METHODS = [
  // 4A1 departments, Keeper and agent health (views)
  'venture.team.keeper', 'venture.team.clearQuarantine',
  // 4B1 agent threads, "from now on" proposals, versions, standing orders and the chat consent (agents)
  'venture.agents.thread.list', 'venture.agents.thread.send', 'venture.agents.proposal.decide', 'venture.agents.version.undo',
  'venture.agents.orders.list', 'venture.chats.consent',
  // 4B2 notes (agents)
  'venture.agents.notes.list', 'venture.agents.notes.edit', 'venture.agents.notes.forget', 'venture.agents.notes.undo',
  // 4C1 Chats with Chausar as chief of staff, and proposals (chief)
  'venture.chief.threads', 'venture.chief.thread.list', 'venture.chief.thread.send', 'venture.chief.thread.pin', 'venture.chief.fit',
  'venture.proposals.raise', 'venture.proposals.dismiss',
  // 4D1 the owner's network: import, people, merge, privacy (network)
  'venture.network.import', 'venture.network.importUndo', 'venture.network.merge', 'venture.network.split', 'venture.network.forget',
  'venture.network.hide', 'venture.network.people', 'venture.network.person', 'venture.network.sources',
  // 4D2 strength and warm paths, 4D3 search (network)
  'venture.network.recompute', 'venture.network.know', 'venture.network.link',
  'venture.network.search', 'venture.network.searchMore', 'venture.network.saveSearch', 'venture.network.research',
  // 4E1 the pipeline and follow-ups, 4E2 drafts and handoffs (network)
  'venture.pipeline.list', 'venture.pipeline.followups', 'venture.pipeline.add', 'venture.pipeline.setNext', 'venture.pipeline.move', 'venture.pipeline.settings',
  'venture.outreach.draft', 'venture.outreach.open', 'venture.outreach.sent', 'venture.outreach.restricted',
  // 4E3 the read-only mailbox, inbound mail, the calendar address and "after a call" (network)
  'venture.mailbox.connect', 'venture.mailbox.disconnect', 'venture.mailbox.sync', 'venture.inbound.list', 'venture.inbound.confirm',
  'venture.network.calendar', 'venture.meeting.digest',
  // 4F1 run controls, pause all and Away; 4F2 the write caps (views)
  'venture.runs.stop', 'venture.runs.resume', 'venture.runs.roundGate', 'venture.runs.steer', 'venture.business.pause', 'venture.away.set', 'venture.away.get',
  'venture.runs.allowWrites',
  // 4G1 the notification centre, 4G3 web push and the relay (notify)
  'venture.notify.list', 'venture.notify.read', 'venture.notify.settings',
  'venture.notify.push.key', 'venture.notify.push.subscribe', 'venture.notify.push.unsubscribe', 'venture.notify.relay',
  // 4H1 the CLI status and per-role models (models)
  'venture.models.cli.status', 'venture.models.roles',
  // 4I1 goals (money)
  'venture.goals.get', 'venture.goals.set', 'venture.goals.suggest',
  // 4J1 decisions and allow-for-this-session (views)
  'venture.decisions.list', 'venture.policy.allowSession',
  // 4J2 send back, edit and undo, set approval, the triage rule (views); draft fixes and changes (delivery); settings drafts (core)
  'venture.queue.sendBack', 'venture.queue.edit', 'venture.queue.undo', 'venture.queue.set', 'venture.triage.set', 'venture.triage.preview',
  'venture.delivery.fix', 'venture.delivery.decideChange', 'venture.delivery.changes', 'venture.settings.draft', 'venture.settings.drafts',
  // 4J2 review: a set's server-made quote before it is approved (views), an owner draft copied from one that went out (delivery)
  'venture.queue.setPreview', 'venture.delivery.copy',
  // 4J3 a still from the cut (delivery)
  'venture.files.poster',
  // 4J4 aging, in and out, cash, margins, the export for the CA (money)
  'venture.money.aging', 'venture.money.flow', 'venture.money.cash', 'venture.money.margins', 'venture.money.export',
  // 4J5 bills, credit notes, recurring invoices, reminders, clearing a payment (money)
  'venture.bills.add', 'venture.bills.pay', 'venture.bills.list', 'venture.credit.issue', 'venture.invoice.recurring', 'venture.invoice.recurringList',
  'venture.invoice.remind', 'venture.payment.clear', 'venture.bills.stop',
  // 4J6 money (money) and runs (views) across the businesses on this computer
  'venture.money.across', 'venture.runs.across',
  // 4J7 connection checks and the client's file request (build)
  'venture.connectors.check', 'venture.share.request',
  // 4J8 the ways to earn (core), answered before any vault; the plan change for an open business (core)
  'venture.playbooks.list', 'venture.blueprint.suggest',
  // 4J9 the owner profile (core)
  'venture.owner.get', 'venture.owner.set',
  // 4J10 signed receipts (money) and the chained journal (views)
  'venture.receipt.verify', 'venture.journal.chain', 'venture.journal.acceptBreak',
  // 4J12 order contracts (money)
  'venture.order.contract', 'venture.order.contract.propose', 'venture.order.contract.sign',
  // 4J13 routines (agents)
  'venture.routines.list', 'venture.routines.runs', 'venture.routines.set', 'venture.routines.remove',
  // 4J14 reranking scored options (delivery)
  'venture.options.rerank',
  // 4J15 drills (delivery); auto readiness and the shadow summary (views)
  'venture.drills.run', 'venture.drills.list', 'venture.auto.readiness', 'venture.shadow.summary',
  // 4J16 the guidance report (delivery)
  'venture.playbook.guidance',
  // 4J17 the business voice, personas, export and import (agents)
  'venture.voice.get', 'venture.voice.set', 'venture.voice.learn', 'venture.persona.get', 'venture.persona.set', 'venture.persona.test',
  'venture.agents.export', 'venture.agents.import',
  // 4J18 what the AI knows, ideas and the capability page (agents)
  'venture.knowledge.list', 'venture.knowledge.add', 'venture.knowledge.remove', 'venture.knowledge.test',
  'venture.ideas.list', 'venture.ideas.start', 'venture.ideas.dismiss', 'venture.agents.capabilities',
] as const;


/**
 * Ink v2 wave 5's methods, by package (named by package 5-0; each answers NOT_BUILT_YET until its package lands). They
 * are part of VENTURE_METHODS; listed apart so W5_METHOD_LEVELS can be typed complete. Every one is owned by the
 * playbooks package (playbooks/index.ts) but 5A6's, owned by build (build/index.ts).
 */
export const W5_METHODS = [
  // 5A1 the chain of an order's stages, from a kit offer's stages
  'venture.order.chain',
  // 5A2 the sales proposal and the GO, HOLD or NO-GO card (5A2 added goNoGo.list, so Business lists the stored cards)
  'venture.salesProposal.draft', 'venture.salesProposal.get', 'venture.goNoGo.card', 'venture.goNoGo.list', 'venture.goNoGo.remove',
  // 5A3 the idea pipeline, beside 4J18's venture.ideas.list, .start and .dismiss
  'venture.ideas.add', 'venture.ideas.move', 'venture.ideas.grade',
  // 5A4 brand kits, asset records and voice consent
  'venture.brandKit.get', 'venture.brandKit.set', 'venture.assets.list', 'venture.assets.rerun', 'venture.assets.reuse',
  'venture.voiceConsent.record', 'venture.voiceConsent.revoke', 'venture.voiceConsent.list',
  // 5A5 client reports and their share links
  'venture.report.render', 'venture.report.share', 'venture.report.shareRotate', 'venture.report.shareDisable',
  // 5A5 added report.list, so reports and their live links stay findable after the screen closes
  'venture.report.list',
  // 5A6 monitors, mail import, the owner's local apps, the webhook handoff and speech providers (build)
  'venture.monitors.list', 'venture.monitors.add', 'venture.monitors.remove', 'venture.mail.import', 'venture.mail.threads',
  'venture.localApps.list', 'venture.webhook.set', 'venture.webhook.send', 'venture.speechOut.providers',
  // 5C1 the citations table and the stored sign-off; 5C2 differential cases and the ITR data pack
  'venture.ca.confirmCitations', 'venture.ca.signoff.get', 'venture.ca.differential.add', 'venture.ca.dataPack.export',
  // Every business's own records, through its desk (playbooks/desks.ts and desk-types.ts)
  'venture.desk.list', 'venture.desk.get', 'venture.desk.act',
] as const;


export const VENTURE_METHODS = [
  // P1 core (venture.countries and venture.preview are answered before a vault is open)
  'venture.countries', 'venture.preview', 'venture.create', 'venture.get', 'venture.events',
  'venture.interview.next', 'venture.interview.answer',
  'venture.blueprint.draft', 'venture.blueprint.get', 'venture.blueprint.update', 'venture.blueprint.accept',
  // P2 models
  'venture.models.presets', 'venture.models.connect', 'venture.models.disconnect', 'venture.models.status', 'venture.models.calls',
  'venture.agentSettings.get', 'venture.agentSettings.set', 'venture.mcpCredential.set',
  // Wave 6 (6F1, 6F2): the curated MCP server list, OAuth sign-in to a server, and playbook packs (models)
  'venture.mcpRegistry.list', 'venture.mcpOAuth.start', 'venture.packs.list', 'venture.packs.add', 'venture.packs.remove',
  // P3 money
  'venture.price.quote', 'venture.receipt.get',
  'venture.client.add', 'venture.client.list',
  'venture.client.aiConsent.get', 'venture.client.aiConsent.agree', 'venture.client.aiConsent.withdraw',
  // Wave 6 money (6D1 to 6D4): billing settings, an invoice's PDF and share links, Razorpay Payment Links
  'venture.billing.get', 'venture.billing.set', 'venture.invoice.pdf', 'venture.invoice.payLink',
  // One-shot C6: a thank-you receipt for one payment, its words and its file (the owner sends it).
  'venture.payment.receipt',
  'venture.order.create', 'venture.order.list', 'venture.order.deliver',
  'venture.invoice.prepare', 'venture.invoice.issue', 'venture.invoice.get', 'venture.invoice.list',
  'venture.payment.record', 'venture.books.summary',
  // P2-spend: what each paid call reserved and settled; the owner's monthly limit, ask-first figure and rate card
  'venture.spend.list', 'venture.spend.policy.get', 'venture.spend.policy.set',
  // P4 build and connectors
  'venture.build.brief', 'venture.build.handoff', 'venture.build.handoffOpened', 'venture.build.link', 'venture.build.sync', 'venture.build.status',
  'venture.connectors.list',
  // P5 delivery, rehearsal, launch, capabilities
  'venture.delivery.playbook', 'venture.simulation.scenarios', 'venture.simulation.run', 'venture.simulation.get', 'venture.simulation.fromSignal',
  'venture.launch.status', 'venture.launch.advance',
  'venture.delivery.run', 'venture.delivery.review', 'venture.delivery.list',
  'venture.agentApproval.decide',
  'venture.capabilities',
  // P5 delivery harness: client files, hand-off answers, work receipts, the gated improvement loop
  'venture.files.add', 'venture.files.list', 'venture.work.get',
  'venture.improve.status', 'venture.improve.run', 'venture.improve.get', 'venture.improve.adopt',
  // Heavy work: the owner approves or declines a brief for their own Claude Code or Codex, then reads what it left
  'venture.delegate.get',
  // Ink frontend views (P1-A): Today's queue, runs, the team and its gates
  'venture.queue.list', 'venture.queue.decide', 'venture.runs.list', 'venture.runs.get', 'venture.team.list', 'venture.team.gate',
  // Evidence ledger (P2-evidence): what backs each client and business field, and the owner applying a suggestion
  'venture.evidence.list', 'venture.evidence.apply',
  // Action journal (P2-journal): every outside effect and where it stands; the owner settles an unknown outcome (W1, H3)
  'venture.journal.list', 'venture.journal.resolve',
  // The untrusted screen (W1 H9): the business's screen mode, and the owner releasing one held content
  'venture.untrusted.mode', 'venture.untrusted.release',
  // Connectors made real: bank statement import and consent, staged website edits, and leads the owner contacts himself
  'venture.bank.import', 'venture.bank.consent', 'venture.site.stage', 'venture.site.apply', 'venture.site.revert',
  'venture.leads.add', 'venture.leads.list', 'venture.leads.draft', 'venture.leads.recordSend',
  // Ink final pass: what a Today row is about, an agent's own posture, dismissing a suggestion, Money at a glance and the
  // tax working, the CA firm's CA of record and sign-offs, the lead blocklist, and read-only preview links for clients
  'venture.queue.view', 'venture.team.posture', 'venture.evidence.dismiss', 'venture.money.overview', 'venture.tax.working',
  'venture.ca.get', 'venture.ca.setOfRecord', 'venture.ca.recordSignoff', 'venture.ca.confirmRates',
  'venture.leads.block', 'venture.share.create', 'venture.share.list', 'venture.share.revoke',
  // Ink v2 wave 2: the judge on real orders, going back a playbook version, a transcript made on this computer, posting
  // from a checked draft, the client's answer the owner records, the calendar file, bank statements into the books and
  // their alerts, stored CA receipts and portal differences, and the dated platform rules
  'venture.delivery.judge', 'venture.delivery.judgeSend', 'venture.improve.rollback', 'venture.files.transcribe',
  'venture.posting.propose', 'venture.posting.signIn', 'venture.posting.checkSteps', 'venture.share.recordAnswer', 'venture.social.calendar',
  'venture.bank.ledger', 'venture.bank.apply', 'venture.bank.alerts.get', 'venture.bank.alerts.set',
  'venture.ca.receipt', 'venture.ca.explainDiff', 'venture.rules.list', 'venture.rules.locks', 'venture.rules.attest',
  'venture.compliance.get', 'venture.compliance.set',
  // Ink v2 wave 2 (2C1): whether the judge runs on its own on drafts for a client or the public (judgeAuto)
  'venture.judge.auto.get', 'venture.judge.auto.set',
  // Ink v2 wave 2 (2B1): the owner's posting limits per channel
  'venture.posting.limits.get', 'venture.posting.limits.set',
  // Ink v2 wave 2 (2E2): the owner's whisper.cpp for transcripts made on this computer
  'venture.transcription.get', 'venture.transcription.set',
  // Wave 6 (6F6, 6F7): Telegram alerts from the owner's own bot, and phone access on this Wi-Fi or Tailscale (notify)
  'venture.notify.telegram', 'venture.phone.access',
  // Wave 6 (6F3, 6F8): web search and the polite page reader; people search on the owner's own keys (network)
  'venture.web.search', 'venture.web.read', 'venture.people.services', 'venture.people.lookup',
  // Wave 6 (6G3): the CRM, field history, companies, timelines and lists (network); 6G4: dated memory (agents)
  'venture.crm.client', 'venture.crm.client.edit', 'venture.crm.companies', 'venture.crm.company', 'venture.crm.company.save', 'venture.crm.link',
  'venture.crm.log', 'venture.crm.lists', 'venture.crm.list', 'venture.crm.list.save', 'venture.crm.list.place',
  'venture.memory.list', 'venture.memory.add', 'venture.memory.replace', 'venture.memory.visibility', 'venture.memory.forget',
  // Wave 6 (6G1, D42): a chat's state (pinned, active, snoozed, settled) and the quiet days before one settles (chief)
  'venture.chief.thread.state', 'venture.chief.settle.set',
  // Wave 6 (6G2, D43): the check before retiring an agent, retiring it, and Bring back (agents)
  'venture.agents.retire.check', 'venture.agents.retire', 'venture.agents.restore',
  // Wave 6 (6H1, D39): mini apps, their permission screen, versions, pin, export and the MCP Apps bridge (views)
  'venture.apps.list', 'venture.apps.get', 'venture.apps.make', 'venture.apps.grant', 'venture.apps.revoke', 'venture.apps.restore',
  'venture.apps.pin', 'venture.apps.export', 'venture.apps.call', 'venture.apps.remove',
  // Wave 6 (6I1, D45): push-to-talk (agents)
  'venture.talk.get', 'venture.talk.consent', 'venture.talk.setup', 'venture.talk.start', 'venture.talk.hear', 'venture.talk.say',
  // Wave 6 (6J2, D47): feedback, an opt-in Send report with its preview, short questions, crash notes and Delete my reports (core)
  'venture.feedback.get', 'venture.feedback.consent', 'venture.feedback.send', 'venture.feedback.answer', 'venture.feedback.crash', 'venture.feedback.delete',
  // Wave 6 (6H3, D40): a place's layout, read and changed by the owner; the AI's own changes come through the MCP tools (views)
  'venture.layout.get', 'venture.layout.change',
  // C2: the command bar's find across clients, invoices, orders, runs and chats (views)
  'venture.find',
  // Wave 6 (6H2, D41): recorded flows, record once and run with no AI (build)
  'venture.flows.list', 'venture.flows.act',
  // C5: new product ideas (W6-ALL-IDEAS section 2)
  'venture.team.introduced',
  'venture.away.preview',
  'venture.client.aiDefault.get',
  'venture.client.aiDefault.set',
  'venture.notify.telegram.findChat',
  'venture.accountant.get',
  'venture.accountant.set',
  'venture.accountant.schedule.get',
  'venture.accountant.schedule.set',
  'venture.accountant.pack.done',
  'venture.build.briefFile',
  'venture.diagnostics.today',
  // Ink v2 wave 4 (W4_METHODS above)
  ...W4_METHODS,
  // Ink v2 wave 5 (W5_METHODS above)
  ...W5_METHODS,
  // Onboarding v2: the draft desk, answered before the vault check (DRAFT_METHODS)
  'venture.ai.options', 'venture.ai.connect', 'venture.ai.disconnect', 'venture.ai.status', 'venture.ai.calls',
  'venture.compose.decide', 'venture.compose.fill', 'venture.compose.get', 'venture.compose.update',
  'venture.country.suggest',
  // Wave 6 (6C1, 6C2): the tools' own sign-in and About you, before the vault; 6C7: what the business needs.
  'venture.ai.tools', 'venture.ai.login.start', 'venture.ai.login.cancel',
  'venture.about.read', 'venture.about.pick', 'venture.about.families',
  'venture.needs.list',
  // A2: the owner chooses the Codex found on this computer (codex-trust.ts), answered by the engine with or without a vault.
  'venture.ai.setup.trust',
  // D5: Install Claude Code, after the owner's yes in main's own dialog, and how far it has come; answered by the engine.
  'venture.ai.claude.install', 'venture.ai.claude.progress',
  // One-shot C3: which step long work is on, for a page opened mid-job (work-progress.ts), answered by the engine.
  'venture.work.list',
  // One-shot C4 (T20): a share of an invoice the owner made, or their "Mark as sent" (money/invoice-share.ts).
  'venture.invoice.shared',
  // One-shot C4 (T32): the ready routines the plan already names, for the owner to add (agents/routines.ts).
  'venture.routines.suggestions',
  'venture.models.plan',
  'venture.routines.backup.get',
  'venture.routines.backup.set',
  'venture.trackers.list',
  'venture.trackers.get',
  'venture.trackers.set',
  'venture.trackers.remove',
  'venture.trackers.rows.add',
  'venture.trackers.rows.edit',
  'venture.trackers.rows.remove',
  'venture.trackers.rows.undo',
  'venture.agents.hire.start',
  'venture.agents.hire.answer',
  'venture.agents.hire.confirm',
  'venture.agents.hire.cancel',
  'venture.events.get',
  'venture.events.relay.set',
  'venture.events.calKey.set',
  'venture.agents.hire.duties',
] as const;

/**
 * Answered without a vault, a model or any write. The engine routes them before its vault check. venture.playbooks.list
 * (Ink v2 wave 4, 4J8) is the Start gallery's list of ways to earn.
 */
export const PRE_VAULT_METHODS: readonly VentureMethod[] = Object.freeze(['venture.countries', 'venture.preview', 'venture.playbooks.list', 'venture.compliance.get'] as const);

/**
 * Answered by the engine's draft desk before the vault check. They may call a model and write the in-memory draft
 * store, never the vault. The same nine as ONBOARDING_METHODS in onboarding-contracts.ts (a test pins them equal).
 */
export const DRAFT_METHODS: readonly VentureMethod[] = Object.freeze([
  'venture.ai.options', 'venture.ai.connect', 'venture.ai.disconnect', 'venture.ai.status', 'venture.ai.calls',
  'venture.compose.decide', 'venture.compose.fill', 'venture.compose.get', 'venture.compose.update',
  'venture.country.suggest',
  'venture.ai.tools', 'venture.ai.login.start', 'venture.ai.login.cancel',
  'venture.about.read', 'venture.about.pick', 'venture.about.families',
] as const);


/**
 * A2: answered by the engine itself (engine.ts), with or without a vault, never by a package: the owner's yes to the
 * Codex found on this computer. The engine checks the app channel and the owner's role itself.
 */
export const ENGINE_METHODS: readonly VentureMethod[] = Object.freeze(['venture.ai.setup.trust', 'venture.ai.claude.install', 'venture.ai.claude.progress', 'venture.work.list'] as const);

export const METHOD_OWNERS: Readonly<Record<VentureMethod, VenturePackageId>> = Object.freeze({
  'venture.countries': 'core',
  'venture.preview': 'core',
  'venture.create': 'core',
  'venture.get': 'core',
  'venture.events': 'core',
  'venture.interview.next': 'core',
  'venture.interview.answer': 'core',
  'venture.blueprint.draft': 'core',
  'venture.blueprint.get': 'core',
  'venture.blueprint.update': 'core',
  'venture.blueprint.accept': 'core',
  'venture.models.presets': 'models',
  'venture.models.connect': 'models',
  'venture.models.disconnect': 'models',
  'venture.models.status': 'models',
  'venture.models.calls': 'models',
  'venture.agentSettings.get': 'models',
  'venture.agentSettings.set': 'models',
  'venture.mcpCredential.set': 'models',
  'venture.mcpRegistry.list': 'models',
  'venture.mcpOAuth.start': 'models',
  'venture.packs.list': 'models',
  'venture.packs.add': 'models',
  'venture.packs.remove': 'models',
  'venture.price.quote': 'money',
  'venture.receipt.get': 'money',
  'venture.client.add': 'money',
  'venture.client.list': 'money',
  'venture.client.aiConsent.get': 'money',
  'venture.client.aiConsent.agree': 'money',
  'venture.client.aiConsent.withdraw': 'money',
  'venture.billing.get': 'money',
  'venture.billing.set': 'money',
  'venture.invoice.pdf': 'money',
  'venture.invoice.payLink': 'money',
  'venture.payment.receipt': 'money',
  'venture.order.create': 'money',
  'venture.order.list': 'money',
  'venture.order.deliver': 'money',
  'venture.invoice.prepare': 'money',
  'venture.invoice.issue': 'money',
  'venture.invoice.get': 'money',
  'venture.invoice.list': 'money',
  'venture.payment.record': 'money',
  'venture.books.summary': 'money',
  'venture.spend.list': 'money',
  'venture.spend.policy.get': 'money',
  'venture.spend.policy.set': 'money',
  'venture.build.brief': 'build',
  'venture.build.handoff': 'build',
  'venture.build.handoffOpened': 'build',
  'venture.build.link': 'build',
  'venture.build.sync': 'build',
  'venture.build.status': 'build',
  'venture.connectors.list': 'build',
  'venture.delivery.playbook': 'delivery',
  'venture.simulation.scenarios': 'delivery',
  'venture.simulation.run': 'delivery',
  'venture.simulation.get': 'delivery',
  'venture.simulation.fromSignal': 'delivery',
  'venture.launch.status': 'delivery',
  'venture.launch.advance': 'delivery',
  'venture.delivery.run': 'delivery',
  'venture.delivery.review': 'delivery',
  'venture.delivery.list': 'delivery',
  'venture.agentApproval.decide': 'delivery',
  'venture.capabilities': 'delivery',
  'venture.files.add': 'delivery',
  'venture.files.list': 'delivery',
  'venture.work.get': 'delivery',
  'venture.improve.status': 'delivery',
  'venture.improve.run': 'delivery',
  'venture.improve.get': 'delivery',
  'venture.improve.adopt': 'delivery',
  'venture.delegate.get': 'delivery',
  'venture.queue.list': 'views',
  'venture.queue.decide': 'views',
  'venture.runs.list': 'views',
  'venture.runs.get': 'views',
  'venture.team.list': 'views',
  'venture.team.gate': 'views',
  'venture.evidence.list': 'core',
  'venture.evidence.apply': 'core',
  'venture.journal.list': 'views',
  'venture.journal.resolve': 'views',
  'venture.untrusted.mode': 'views',
  'venture.untrusted.release': 'views',
  'venture.bank.import': 'build',
  'venture.bank.consent': 'build',
  'venture.site.stage': 'build',
  'venture.site.apply': 'build',
  'venture.site.revert': 'build',
  'venture.leads.add': 'build',
  'venture.leads.list': 'build',
  'venture.leads.draft': 'build',
  'venture.leads.recordSend': 'build',
  'venture.queue.view': 'views',
  'venture.team.posture': 'views',
  'venture.evidence.dismiss': 'core',
  'venture.money.overview': 'money',
  'venture.tax.working': 'money',
  'venture.ca.get': 'views',
  'venture.ca.setOfRecord': 'views',
  'venture.ca.recordSignoff': 'views',
  'venture.ca.confirmRates': 'views',
  'venture.leads.block': 'build',
  'venture.share.create': 'build',
  'venture.share.list': 'build',
  'venture.share.revoke': 'build',
  'venture.delivery.judge': 'delivery',
  'venture.delivery.judgeSend': 'delivery',
  'venture.improve.rollback': 'delivery',
  'venture.files.transcribe': 'delivery',
  'venture.posting.propose': 'build',
  'venture.posting.signIn': 'build',
  'venture.posting.checkSteps': 'build',
  'venture.share.recordAnswer': 'build',
  'venture.social.calendar': 'build',
  'venture.bank.ledger': 'build',
  'venture.bank.apply': 'build',
  'venture.bank.alerts.get': 'build',
  'venture.bank.alerts.set': 'build',
  'venture.ca.receipt': 'views',
  'venture.ca.explainDiff': 'views',
  'venture.rules.list': 'views',
  'venture.rules.locks': 'views',
  'venture.rules.attest': 'views',
  'venture.compliance.get': 'core',
  'venture.compliance.set': 'core',
  'venture.judge.auto.get': 'delivery',
  'venture.judge.auto.set': 'delivery',
  'venture.posting.limits.get': 'build',
  'venture.posting.limits.set': 'build',
  'venture.transcription.get': 'delivery',
  'venture.transcription.set': 'delivery',
  'venture.notify.telegram': 'notify',
  'venture.phone.access': 'notify',
  'venture.web.search': 'network',
  'venture.web.read': 'network',
  'venture.people.services': 'network',
  'venture.people.lookup': 'network',
  'venture.crm.client': 'network',
  'venture.crm.client.edit': 'network',
  'venture.crm.companies': 'network',
  'venture.crm.company': 'network',
  'venture.crm.company.save': 'network',
  'venture.crm.link': 'network',
  'venture.crm.log': 'network',
  'venture.crm.lists': 'network',
  'venture.crm.list': 'network',
  'venture.crm.list.save': 'network',
  'venture.crm.list.place': 'network',
  'venture.memory.list': 'agents',
  'venture.memory.add': 'agents',
  'venture.memory.replace': 'agents',
  'venture.memory.visibility': 'agents',
  'venture.memory.forget': 'agents',
  'venture.chief.thread.state': 'chief',
  'venture.chief.settle.set': 'chief',
  'venture.agents.retire.check': 'agents',
  'venture.agents.retire': 'agents',
  'venture.agents.restore': 'agents',
  'venture.apps.list': 'views',
  'venture.apps.get': 'views',
  'venture.apps.make': 'views',
  'venture.apps.grant': 'views',
  'venture.apps.revoke': 'views',
  'venture.apps.restore': 'views',
  'venture.apps.pin': 'views',
  'venture.apps.export': 'views',
  'venture.apps.call': 'views',
  'venture.apps.remove': 'views',
  'venture.talk.get': 'agents',
  'venture.talk.consent': 'agents',
  'venture.talk.setup': 'agents',
  'venture.talk.start': 'agents',
  'venture.talk.hear': 'agents',
  'venture.talk.say': 'agents',
  'venture.feedback.get': 'core',
  'venture.feedback.consent': 'core',
  'venture.feedback.send': 'core',
  'venture.feedback.answer': 'core',
  'venture.feedback.crash': 'core',
  'venture.feedback.delete': 'core',
  'venture.layout.get': 'views',
  'venture.layout.change': 'views',
  // Wave 6 (6F6, 6F7, 6F3, 6F8): kept in VENTURE_METHODS order.
  // Wave 6 (6G1)
  // Wave 6 (6G2)
  // Wave 6 (6H1)
  // Wave 6 (6I1)
  // Wave 6 (6J2)
  // Wave 6 (6H3)
  'venture.find': 'views',
  'venture.flows.list': 'build',
  'venture.flows.act': 'build',
  'venture.team.introduced': 'agents',
  'venture.away.preview': 'views',
  'venture.client.aiDefault.get': 'money',
  'venture.client.aiDefault.set': 'money',
  'venture.notify.telegram.findChat': 'notify',
  'venture.accountant.get': 'money',
  'venture.accountant.set': 'money',
  'venture.accountant.schedule.get': 'money',
  'venture.accountant.schedule.set': 'money',
  'venture.accountant.pack.done': 'money',
  'venture.build.briefFile': 'build',
  'venture.diagnostics.today': 'views',
  'venture.team.keeper': 'views',
  'venture.team.clearQuarantine': 'views',
  'venture.agents.thread.list': 'agents',
  'venture.agents.thread.send': 'agents',
  'venture.agents.proposal.decide': 'agents',
  'venture.agents.version.undo': 'agents',
  'venture.agents.orders.list': 'agents',
  'venture.chats.consent': 'agents',
  'venture.agents.notes.list': 'agents',
  'venture.agents.notes.edit': 'agents',
  'venture.agents.notes.forget': 'agents',
  'venture.agents.notes.undo': 'agents',
  'venture.chief.threads': 'chief',
  'venture.chief.thread.list': 'chief',
  'venture.chief.thread.send': 'chief',
  'venture.chief.thread.pin': 'chief',
  'venture.chief.fit': 'chief',
  'venture.proposals.raise': 'chief',
  'venture.proposals.dismiss': 'chief',
  'venture.network.import': 'network',
  'venture.network.importUndo': 'network',
  'venture.network.merge': 'network',
  'venture.network.split': 'network',
  'venture.network.forget': 'network',
  'venture.network.hide': 'network',
  'venture.network.people': 'network',
  'venture.network.person': 'network',
  'venture.network.sources': 'network',
  'venture.network.recompute': 'network',
  'venture.network.know': 'network',
  'venture.network.link': 'network',
  'venture.network.search': 'network',
  'venture.network.searchMore': 'network',
  'venture.network.saveSearch': 'network',
  'venture.network.research': 'network',
  'venture.pipeline.list': 'network',
  'venture.pipeline.followups': 'network',
  'venture.pipeline.add': 'network',
  'venture.pipeline.setNext': 'network',
  'venture.pipeline.move': 'network',
  'venture.pipeline.settings': 'network',
  'venture.outreach.draft': 'network',
  'venture.outreach.open': 'network',
  'venture.outreach.sent': 'network',
  'venture.outreach.restricted': 'network',
  'venture.mailbox.connect': 'network',
  'venture.mailbox.disconnect': 'network',
  'venture.mailbox.sync': 'network',
  'venture.inbound.list': 'network',
  'venture.inbound.confirm': 'network',
  'venture.network.calendar': 'network',
  'venture.meeting.digest': 'network',
  'venture.runs.stop': 'views',
  'venture.runs.resume': 'views',
  'venture.runs.roundGate': 'views',
  'venture.runs.steer': 'views',
  'venture.business.pause': 'views',
  'venture.away.set': 'views',
  'venture.away.get': 'views',
  // Wave 6 (6H2)
  // Ink v2 wave 4
  'venture.runs.allowWrites': 'views',
  'venture.notify.list': 'notify',
  'venture.notify.read': 'notify',
  'venture.notify.settings': 'notify',
  'venture.notify.push.key': 'notify',
  'venture.notify.push.subscribe': 'notify',
  'venture.notify.push.unsubscribe': 'notify',
  'venture.notify.relay': 'notify',
  'venture.models.cli.status': 'models',
  'venture.models.roles': 'models',
  'venture.goals.get': 'money',
  'venture.goals.set': 'money',
  'venture.goals.suggest': 'money',
  'venture.decisions.list': 'views',
  'venture.policy.allowSession': 'views',
  'venture.queue.sendBack': 'views',
  'venture.queue.edit': 'views',
  'venture.queue.undo': 'views',
  'venture.queue.set': 'views',
  'venture.triage.set': 'views',
  'venture.triage.preview': 'views',
  'venture.delivery.fix': 'delivery',
  'venture.delivery.decideChange': 'delivery',
  'venture.delivery.changes': 'delivery',
  'venture.settings.draft': 'core',
  'venture.settings.drafts': 'core',
  'venture.queue.setPreview': 'views',
  'venture.delivery.copy': 'delivery',
  'venture.files.poster': 'delivery',
  'venture.money.aging': 'money',
  'venture.money.flow': 'money',
  'venture.money.cash': 'money',
  'venture.money.margins': 'money',
  'venture.money.export': 'money',
  'venture.bills.add': 'money',
  'venture.bills.pay': 'money',
  'venture.bills.list': 'money',
  'venture.credit.issue': 'money',
  'venture.invoice.recurring': 'money',
  'venture.invoice.recurringList': 'money',
  'venture.invoice.remind': 'money',
  'venture.payment.clear': 'money',
  'venture.bills.stop': 'money',
  'venture.money.across': 'money',
  'venture.runs.across': 'views',
  'venture.connectors.check': 'build',
  'venture.share.request': 'build',
  'venture.playbooks.list': 'core',
  'venture.blueprint.suggest': 'core',
  'venture.owner.get': 'core',
  'venture.owner.set': 'core',
  'venture.receipt.verify': 'money',
  'venture.journal.chain': 'views',
  'venture.journal.acceptBreak': 'views',
  'venture.order.contract': 'money',
  'venture.order.contract.propose': 'money',
  'venture.order.contract.sign': 'money',
  'venture.routines.list': 'agents',
  'venture.routines.runs': 'agents',
  'venture.routines.set': 'agents',
  'venture.routines.remove': 'agents',
  'venture.options.rerank': 'delivery',
  'venture.drills.run': 'delivery',
  'venture.drills.list': 'delivery',
  'venture.auto.readiness': 'views',
  'venture.shadow.summary': 'views',
  'venture.playbook.guidance': 'delivery',
  'venture.voice.get': 'agents',
  'venture.voice.set': 'agents',
  'venture.voice.learn': 'agents',
  'venture.persona.get': 'agents',
  'venture.persona.set': 'agents',
  'venture.persona.test': 'agents',
  'venture.agents.export': 'agents',
  'venture.agents.import': 'agents',
  'venture.knowledge.list': 'agents',
  'venture.knowledge.add': 'agents',
  'venture.knowledge.remove': 'agents',
  'venture.knowledge.test': 'agents',
  'venture.ideas.list': 'agents',
  'venture.ideas.start': 'agents',
  'venture.ideas.dismiss': 'agents',
  'venture.agents.capabilities': 'agents',
  // Ink v2 wave 5 (named by package 5-0)
  'venture.order.chain': 'playbooks',
  'venture.salesProposal.draft': 'playbooks',
  'venture.salesProposal.get': 'playbooks',
  'venture.goNoGo.card': 'playbooks',
  'venture.goNoGo.list': 'playbooks',
  'venture.goNoGo.remove': 'playbooks',
  'venture.ideas.add': 'playbooks',
  'venture.ideas.move': 'playbooks',
  'venture.ideas.grade': 'playbooks',
  'venture.brandKit.get': 'playbooks',
  'venture.brandKit.set': 'playbooks',
  'venture.assets.list': 'playbooks',
  'venture.assets.rerun': 'playbooks',
  'venture.assets.reuse': 'playbooks',
  'venture.voiceConsent.record': 'playbooks',
  'venture.voiceConsent.revoke': 'playbooks',
  'venture.voiceConsent.list': 'playbooks',
  'venture.report.render': 'playbooks',
  'venture.report.share': 'playbooks',
  'venture.report.shareRotate': 'playbooks',
  'venture.report.shareDisable': 'playbooks',
  'venture.report.list': 'playbooks',
  'venture.monitors.list': 'build',
  'venture.monitors.add': 'build',
  'venture.monitors.remove': 'build',
  'venture.mail.import': 'build',
  'venture.mail.threads': 'build',
  'venture.localApps.list': 'build',
  'venture.webhook.set': 'build',
  'venture.webhook.send': 'build',
  'venture.speechOut.providers': 'build',
  'venture.ca.confirmCitations': 'playbooks',
  'venture.ca.signoff.get': 'playbooks',
  'venture.ca.differential.add': 'playbooks',
  'venture.ca.dataPack.export': 'playbooks',
  'venture.desk.list': 'playbooks',
  'venture.desk.get': 'playbooks',
  'venture.desk.act': 'playbooks',
  'venture.ai.options': 'models',
  'venture.ai.connect': 'models',
  'venture.ai.disconnect': 'models',
  'venture.ai.status': 'models',
  'venture.ai.calls': 'models',
  'venture.compose.decide': 'core',
  'venture.compose.fill': 'core',
  'venture.compose.get': 'core',
  'venture.compose.update': 'core',
  // Never routed through VentureHost: the engine's draft desk (draft/handlers.ts) answers them.
  'venture.country.suggest': 'core',
  'venture.ai.tools': 'models',
  'venture.ai.login.start': 'models',
  'venture.ai.login.cancel': 'models',
  'venture.about.read': 'core',
  'venture.about.pick': 'core',
  'venture.about.families': 'core',
  'venture.needs.list': 'core',
  'venture.ai.setup.trust': 'models',
  'venture.ai.claude.install': 'models',
  'venture.ai.claude.progress': 'models',
  'venture.work.list': 'views',
  'venture.invoice.shared': 'money',
  'venture.routines.suggestions': 'agents',
  'venture.models.plan': 'models',
  'venture.routines.backup.get': 'agents',
  'venture.routines.backup.set': 'agents',
  'venture.trackers.list': 'agents',
  'venture.trackers.get': 'agents',
  'venture.trackers.set': 'agents',
  'venture.trackers.remove': 'agents',
  'venture.trackers.rows.add': 'agents',
  'venture.trackers.rows.edit': 'agents',
  'venture.trackers.rows.remove': 'agents',
  'venture.trackers.rows.undo': 'agents',
  'venture.agents.hire.start': 'agents',
  'venture.agents.hire.answer': 'agents',
  'venture.agents.hire.confirm': 'agents',
  'venture.agents.hire.cancel': 'agents',
  'venture.events.get': 'build',
  'venture.events.relay.set': 'build',
  'venture.events.calKey.set': 'build',
  'venture.agents.hire.duties': 'agents',
});

/** Methods that need a deliberate owner click inside the app (ctx.channel 'desktop', not source-tainted). */
export const APP_ONLY_METHODS: readonly VentureMethod[] = Object.freeze([
  'venture.agentApproval.decide',
  'venture.agentSettings.set', 'venture.mcpCredential.set',
  'venture.mcpOAuth.start', 'venture.packs.add', 'venture.packs.remove',
  'venture.client.aiConsent.agree', 'venture.client.aiConsent.withdraw',
  'venture.rules.attest', 'venture.compliance.set',
  'venture.billing.set', 'venture.invoice.pdf', 'venture.invoice.payLink', 'venture.payment.receipt',
  'venture.create', 'venture.blueprint.accept', 'venture.models.connect', 'venture.invoice.issue', 'venture.payment.record',
  'venture.build.handoffOpened', 'venture.build.link', 'venture.launch.advance', 'venture.delivery.review',
  'venture.files.add', 'venture.improve.adopt',
  'venture.ai.connect', 'venture.compose.decide', 'venture.compose.fill',
  'venture.country.suggest',
  'venture.ai.login.start', 'venture.ai.login.cancel', 'venture.about.read',
  'venture.queue.decide', 'venture.team.gate',
  'venture.evidence.apply',
  'venture.bank.import', 'venture.bank.consent', 'venture.site.apply', 'venture.site.revert', 'venture.leads.recordSend',
  'venture.spend.policy.set',
  'venture.team.posture', 'venture.evidence.dismiss', 'venture.ca.setOfRecord', 'venture.ca.recordSignoff', 'venture.ca.confirmRates',
  'venture.leads.block', 'venture.share.create', 'venture.share.revoke',
  'venture.journal.resolve',
  'venture.untrusted.mode', 'venture.untrusted.release',
  'venture.delivery.judgeSend', 'venture.improve.rollback', 'venture.files.transcribe', 'venture.posting.signIn', 'venture.posting.checkSteps',
  'venture.share.recordAnswer', 'venture.bank.apply', 'venture.bank.alerts.set', 'venture.ca.explainDiff',
  'venture.judge.auto.set',
  'venture.posting.limits.set',
  'venture.transcription.set',
  // Ink v2 wave 4
  'venture.team.clearQuarantine',
  'venture.agents.thread.send', 'venture.agents.proposal.decide', 'venture.agents.version.undo', 'venture.chats.consent',
  'venture.agents.notes.edit', 'venture.agents.notes.forget', 'venture.agents.notes.undo',
  'venture.chief.thread.send', 'venture.chief.thread.pin', 'venture.proposals.raise', 'venture.proposals.dismiss',
  'venture.network.import', 'venture.network.importUndo', 'venture.network.merge', 'venture.network.split', 'venture.network.forget', 'venture.network.hide',
  'venture.network.know', 'venture.network.link',
  'venture.network.search', 'venture.network.searchMore', 'venture.network.saveSearch', 'venture.network.research',
  'venture.pipeline.add', 'venture.pipeline.setNext', 'venture.pipeline.move', 'venture.pipeline.settings',
  'venture.outreach.draft', 'venture.outreach.open', 'venture.outreach.sent', 'venture.outreach.restricted',
  'venture.mailbox.connect', 'venture.mailbox.disconnect', 'venture.inbound.confirm', 'venture.network.calendar', 'venture.meeting.digest',
  'venture.runs.stop', 'venture.runs.resume', 'venture.runs.roundGate', 'venture.runs.steer', 'venture.business.pause', 'venture.away.set',
  'venture.runs.allowWrites',
  'venture.notify.settings', 'venture.notify.push.subscribe', 'venture.notify.push.unsubscribe', 'venture.notify.relay',
  'venture.notify.telegram', 'venture.phone.access',
  'venture.web.search', 'venture.web.read', 'venture.people.services', 'venture.people.lookup',
  'venture.crm.client.edit', 'venture.crm.company.save', 'venture.crm.link', 'venture.crm.log', 'venture.crm.list.save', 'venture.crm.list.place',
  'venture.memory.visibility', 'venture.memory.forget',
  'venture.chief.thread.state', 'venture.chief.settle.set',
  'venture.agents.retire', 'venture.agents.restore',
  // Wave 6 (6H1): making, allowing, changing, exporting and running a mini app happen in the app.
  'venture.apps.make', 'venture.apps.grant', 'venture.apps.revoke', 'venture.apps.restore', 'venture.apps.pin', 'venture.apps.export', 'venture.apps.call', 'venture.apps.remove',
  // Wave 6 (6H3): the owner's own layout change (the AI's go through its MCP tools, marked as the AI's).
  'venture.layout.change',
  'venture.talk.consent', 'venture.talk.setup', 'venture.talk.start', 'venture.talk.hear', 'venture.talk.say',
  // Wave 6 (6J2): turning reports on, sending, answering, noting a crash and Delete my reports happen in the app.
  'venture.feedback.consent', 'venture.feedback.send', 'venture.feedback.answer', 'venture.feedback.crash', 'venture.feedback.delete',
  'venture.goals.set',
  'venture.policy.allowSession',
  'venture.queue.sendBack', 'venture.queue.edit', 'venture.queue.undo', 'venture.queue.set', 'venture.triage.set',
  'venture.delivery.fix', 'venture.delivery.decideChange',
  'venture.files.poster',
  'venture.money.export',
  'venture.bills.add', 'venture.bills.pay', 'venture.credit.issue', 'venture.invoice.recurring', 'venture.invoice.remind', 'venture.payment.clear', 'venture.bills.stop',
  'venture.share.request',
  'venture.blueprint.suggest',
  'venture.owner.set',
  'venture.journal.acceptBreak',
  'venture.order.contract.sign',
  'venture.routines.set', 'venture.routines.remove',
  'venture.drills.run',
  'venture.voice.set', 'venture.voice.learn', 'venture.persona.set', 'venture.persona.test', 'venture.agents.import',
  'venture.knowledge.add', 'venture.knowledge.remove', 'venture.knowledge.test', 'venture.ideas.start', 'venture.ideas.dismiss',
  // Ink v2 wave 5 (5-0): every method that sets, records, revokes, adds, removes, exports, confirms, rotates or disables,
  // the desk's act and the webhook; also the report's share link (as venture.share.create is) and the mail import (as
  // venture.network.import is).
  'venture.ideas.add', 'venture.brandKit.set', 'venture.voiceConsent.record', 'venture.voiceConsent.revoke',
  'venture.report.share', 'venture.report.shareRotate', 'venture.report.shareDisable',
  'venture.monitors.add', 'venture.monitors.remove', 'venture.mail.import', 'venture.webhook.set', 'venture.webhook.send',
  'venture.ca.confirmCitations', 'venture.ca.differential.add', 'venture.ca.dataPack.export',
  'venture.client.aiDefault.set',
  'venture.notify.telegram.findChat',
  'venture.accountant.set',
  'venture.accountant.schedule.set',
  'venture.accountant.pack.done',
  'venture.desk.act',
  // One-shot C4 (T20): the owner's own share or mark, from the invoice sheet.
  'venture.invoice.shared',
  'venture.routines.backup.set',
  'venture.trackers.set',
  'venture.trackers.remove',
  'venture.trackers.rows.add',
  'venture.trackers.rows.edit',
  'venture.trackers.rows.remove',
  'venture.trackers.rows.undo',
  'venture.agents.hire.start',
  'venture.agents.hire.answer',
  'venture.agents.hire.confirm',
  'venture.agents.hire.cancel',
  'venture.events.relay.set',
  'venture.events.calKey.set',
  'venture.agents.hire.duties',
] as const);

/** Ink v2 wave 4: each wave 4 method's level, as its package text names it; its handler authorizes at this level. */
export const W4_METHOD_LEVELS: Readonly<Record<W4Method, MethodLevel>> = Object.freeze({
  'venture.team.keeper': 'read', 'venture.team.clearQuarantine': 'approve',
  'venture.agents.thread.list': 'read', 'venture.agents.thread.send': 'prepare', 'venture.agents.proposal.decide': 'approve', 'venture.agents.version.undo': 'approve',
  'venture.agents.orders.list': 'read', 'venture.chats.consent': 'approve',
  'venture.agents.notes.list': 'read', 'venture.agents.notes.edit': 'approve', 'venture.agents.notes.forget': 'approve', 'venture.agents.notes.undo': 'approve',
  'venture.chief.threads': 'read', 'venture.chief.thread.list': 'read', 'venture.chief.thread.send': 'prepare', 'venture.chief.thread.pin': 'prepare', 'venture.chief.fit': 'prepare',
  'venture.proposals.raise': 'prepare', 'venture.proposals.dismiss': 'prepare',
  'venture.network.import': 'approve', 'venture.network.importUndo': 'approve', 'venture.network.merge': 'approve', 'venture.network.split': 'approve', 'venture.network.forget': 'approve',
  'venture.network.hide': 'prepare', 'venture.network.people': 'read', 'venture.network.person': 'read', 'venture.network.sources': 'read',
  'venture.network.recompute': 'prepare', 'venture.network.know': 'prepare', 'venture.network.link': 'prepare',
  'venture.network.search': 'prepare', 'venture.network.searchMore': 'prepare', 'venture.network.saveSearch': 'prepare', 'venture.network.research': 'prepare',
  'venture.pipeline.list': 'read', 'venture.pipeline.followups': 'read', 'venture.pipeline.add': 'prepare', 'venture.pipeline.setNext': 'prepare', 'venture.pipeline.move': 'approve', 'venture.pipeline.settings': 'approve',
  'venture.outreach.draft': 'prepare', 'venture.outreach.open': 'read', 'venture.outreach.sent': 'approve', 'venture.outreach.restricted': 'approve',
  'venture.mailbox.connect': 'approve', 'venture.mailbox.disconnect': 'approve', 'venture.mailbox.sync': 'prepare', 'venture.inbound.list': 'read', 'venture.inbound.confirm': 'approve',
  'venture.network.calendar': 'approve', 'venture.meeting.digest': 'prepare',
  'venture.runs.stop': 'approve', 'venture.runs.resume': 'approve', 'venture.runs.roundGate': 'approve', 'venture.runs.steer': 'prepare', 'venture.business.pause': 'approve', 'venture.away.set': 'approve', 'venture.away.get': 'read',
  'venture.runs.allowWrites': 'approve',
  'venture.notify.list': 'read', 'venture.notify.read': 'prepare', 'venture.notify.settings': 'approve',
  'venture.notify.push.key': 'read', 'venture.notify.push.subscribe': 'approve', 'venture.notify.push.unsubscribe': 'approve', 'venture.notify.relay': 'approve',
  'venture.models.cli.status': 'read', 'venture.models.roles': 'read',
  'venture.goals.get': 'read', 'venture.goals.set': 'approve', 'venture.goals.suggest': 'prepare',
  'venture.decisions.list': 'read', 'venture.policy.allowSession': 'approve',
  'venture.queue.sendBack': 'approve', 'venture.queue.edit': 'approve', 'venture.queue.undo': 'approve', 'venture.queue.set': 'approve', 'venture.triage.set': 'approve', 'venture.triage.preview': 'prepare',
  'venture.delivery.fix': 'approve', 'venture.delivery.decideChange': 'approve', 'venture.delivery.changes': 'read', 'venture.settings.draft': 'prepare', 'venture.settings.drafts': 'read',
  'venture.queue.setPreview': 'read', 'venture.delivery.copy': 'prepare',
  'venture.files.poster': 'prepare',
  'venture.money.aging': 'read', 'venture.money.flow': 'read', 'venture.money.cash': 'read', 'venture.money.margins': 'read', 'venture.money.export': 'approve',
  'venture.bills.add': 'approve', 'venture.bills.pay': 'approve', 'venture.bills.list': 'read', 'venture.credit.issue': 'approve', 'venture.invoice.recurring': 'approve', 'venture.invoice.recurringList': 'read',
  'venture.invoice.remind': 'prepare', 'venture.payment.clear': 'approve', 'venture.bills.stop': 'approve',
  'venture.money.across': 'read', 'venture.runs.across': 'read',
  'venture.connectors.check': 'prepare', 'venture.share.request': 'approve',
  'venture.playbooks.list': 'read', 'venture.blueprint.suggest': 'prepare',
  'venture.owner.get': 'read', 'venture.owner.set': 'approve',
  'venture.receipt.verify': 'read', 'venture.journal.chain': 'read', 'venture.journal.acceptBreak': 'approve',
  'venture.order.contract': 'read', 'venture.order.contract.propose': 'prepare', 'venture.order.contract.sign': 'approve',
  'venture.routines.list': 'read', 'venture.routines.runs': 'read', 'venture.routines.set': 'approve', 'venture.routines.remove': 'approve',
  'venture.options.rerank': 'read',
  'venture.drills.run': 'prepare', 'venture.drills.list': 'read', 'venture.auto.readiness': 'read', 'venture.shadow.summary': 'read',
  'venture.playbook.guidance': 'read',
  'venture.voice.get': 'read', 'venture.voice.set': 'approve', 'venture.voice.learn': 'prepare', 'venture.persona.get': 'read', 'venture.persona.set': 'approve', 'venture.persona.test': 'prepare',
  'venture.agents.export': 'read', 'venture.agents.import': 'prepare',
  'venture.knowledge.list': 'read', 'venture.knowledge.add': 'prepare', 'venture.knowledge.remove': 'prepare', 'venture.knowledge.test': 'prepare',
  'venture.ideas.list': 'read', 'venture.ideas.start': 'prepare', 'venture.ideas.dismiss': 'prepare', 'venture.agents.capabilities': 'read',
});

/**
 * Ink v2 wave 5: each wave 5 method's level, as package 5-0 named it from the plan; its handler authorizes at this
 * level. A package that finds its level wrong changes its own line and says so.
 */
export const W5_METHOD_LEVELS: Readonly<Record<W5Method, MethodLevel>> = Object.freeze({
  'venture.order.chain': 'read',
  'venture.salesProposal.draft': 'prepare', 'venture.salesProposal.get': 'read', 'venture.goNoGo.card': 'prepare', 'venture.goNoGo.list': 'read', 'venture.goNoGo.remove': 'prepare',
  'venture.ideas.add': 'prepare', 'venture.ideas.move': 'prepare', 'venture.ideas.grade': 'prepare',
  'venture.brandKit.get': 'read', 'venture.brandKit.set': 'approve', 'venture.assets.list': 'read', 'venture.assets.rerun': 'prepare', 'venture.assets.reuse': 'prepare',
  'venture.voiceConsent.record': 'approve', 'venture.voiceConsent.revoke': 'approve', 'venture.voiceConsent.list': 'read',
  'venture.report.render': 'prepare', 'venture.report.share': 'approve', 'venture.report.shareRotate': 'approve', 'venture.report.shareDisable': 'approve',
  'venture.report.list': 'read',
  'venture.monitors.list': 'read', 'venture.monitors.add': 'approve', 'venture.monitors.remove': 'approve', 'venture.mail.import': 'approve', 'venture.mail.threads': 'read',
  'venture.localApps.list': 'read', 'venture.webhook.set': 'approve', 'venture.webhook.send': 'approve', 'venture.speechOut.providers': 'read',
  'venture.ca.confirmCitations': 'approve', 'venture.ca.signoff.get': 'read', 'venture.ca.differential.add': 'approve', 'venture.ca.dataPack.export': 'approve',
  'venture.desk.list': 'read', 'venture.desk.get': 'read', 'venture.desk.act': 'approve',
});

/** Methods whose success changes what saved answers may cite (the retired app/renderer cleared its cached answers on them). */
export const EVIDENCE_METHODS: readonly VentureMethod[] = Object.freeze([
  'venture.create', 'venture.invoice.issue', 'venture.payment.record', 'venture.order.deliver',
] as const);


/** Compile-time guards: payload and result maps cover exactly the method list. */
export const PAYLOAD_MAP_COMPLETE: Same<keyof VenturePayloads, VentureMethod> = true;

export const RESULT_MAP_COMPLETE: Same<keyof VentureResults, VentureMethod> = true;

export const OWNER_MAP_COMPLETE: Same<keyof typeof METHOD_OWNERS, VentureMethod> = true;


// ---------------------------------------------------------------------------
// 11. Errors
// ---------------------------------------------------------------------------

/** Every error code the venture code introduces. All match ^[A-Z_]{1,64}$ so the desktop keeps them. */
export const VENTURE_ERRORS = [
  // C5 task 18: the GST return is for a registered business with a GSTIN.
  'GST_NOT_REGISTERED',
  // A2: why an AI turn failed, in owner words with the fix (models/ai-failure.ts); the Codex setup the owner records.
  // C7: a tracker's refusals (trackers/cells.ts, trackers/trackers.ts).
  'TRACKER_MONEY', 'TRACKER_NOT_FOUND', 'TRACKER_LIMIT', 'TRACKER_WORDS_HELD',
  // C7: event triggers (build/event-relay.ts, build/event-confirm.ts).
  'EVENT_RELAY_REFUSED', 'EVENT_NOT_CONFIRMED', 'EVENT_ANSWER_TOO_BIG', 'NETWORK_NOT_GIVEN',
  // C7: hiring one more agent (agents/hire-check.ts, agents/hire.ts).
  'HIRE_HARD_STOP', 'HIRE_FLOOR', 'HIRE_NOT_FOUND', 'HIRE_LIMIT', 'HIRE_POSTURE_FIXED',
  'AI_USAGE_LIMIT', 'AI_RATE_LIMITED', 'AI_CONTEXT_FULL', 'AI_MAX_TURNS', 'AI_STREAM_CUT', 'AI_SIGN_IN_REFUSED', 'AI_MODEL_UNAVAILABLE',
  'CODEX_SETUP_CHANGED', 'CODEX_SETUP_UNAVAILABLE', 'SITE_UNAVAILABLE',
  // One-shot A4: Chausar's own PDF reader (core/pdf-text-core.ts) refuses a locked, unreadable or too complex file.
  'PDF_ENCRYPTED', 'PDF_UNREADABLE', 'PDF_TOO_COMPLEX',
  // Wave 6 (6J2): reports turned off, a build without report keys, a deletion request that could not be sent.
  'FEEDBACK_OFF', 'FEEDBACK_NOT_SET_UP', 'FEEDBACK_SEND_FAILED',
  // Wave 6 (6H2): recorded flows.
  'FLOW_INVALID', 'FLOW_NOT_FOUND', 'FLOW_NOT_TESTED', 'FLOW_HELD', 'FLOW_BUSY', 'FLOW_BROWSER_UNAVAILABLE', 'FLOW_BROWSER_CLOSED',
  // Wave 6 (6C5, 6C6): hard stops, owner attestation and regulator switches.
  'HARD_STOP', 'RULE_NOT_FOUND', 'RULE_NOT_ATTESTABLE', 'REGULATOR_FORBIDS',
  // Wave 6 (6G3, 6G4): a company that is not here; a fact kept already, replaced already, or not found.
  'COMPANY_NOT_FOUND', 'FACT_EXISTS', 'FACT_REPLACED', 'FACT_NOT_FOUND',
  // Wave 6 (6E7): the trading journal.
  'TRADEBOOK_INVALID', 'TRADEBOOK_DUPLICATE', 'OPENING_INVALID', 'JOURNAL_EMPTY', 'TAX_YEAR_UNSUPPORTED',
  // Wave 6 (6E4, 6E5): the document desk and the sign-off desk.
  'DOCUMENT_NOT_FOUND', 'DOCUMENT_INPUT_INVALID', 'DOCUMENT_SOURCE_REQUIRED', 'DOCUMENT_BRIEF_REQUIRED', 'DOCUMENT_SECTION_REQUIRED', 'DOCUMENT_FIGURE_UNRECEIPTED', 'DOCUMENT_APPROVAL_REQUIRED',
  'SIGNOFF_REQUIRED', 'SIGNOFF_REGISTRATION_INVALID', 'SIGNOFF_SIGNER_MISMATCH', 'SIGNOFF_SIGNER_REQUIRED', 'SIGNOFF_PAPERS_NOT_READY', 'SIGNOFF_DECIDED',
  // Wave 6 (6E2, 6E3): the lesson desk, the booking desk and the owner's own message handoff.
  'LESSON_BATCH_NOT_FOUND', 'LESSON_LEARNER_NOT_FOUND', 'LESSON_SESSION_NOT_FOUND', 'LESSON_WORK_NOT_FOUND', 'LESSON_NOT_A_QUIZ', 'LESSON_ORDER_REQUIRED',
  'LESSON_ORDER_MISMATCH', 'LESSON_MESSAGE_NOT_FOUND', 'OWNER_MESSAGE_NO_ADDRESS',
  'BOOKING_NOT_FOUND', 'BOOKING_SLOT_NOT_FOUND', 'BOOKING_SLOT_CLASH', 'BOOKING_SLOT_TAKEN', 'BOOKING_SLOT_REQUIRED', 'BOOKING_ORDER_MISMATCH', 'BOOKING_ORDER_TAKEN',
  'BOOKING_QUOTE_REQUIRED', 'BOOKING_DEPOSIT_EXISTS', 'BOOKING_DEPOSIT_REQUIRED', 'BOOKING_DEPOSIT_NOT_ISSUED', 'BOOKING_NOT_HELD', 'BOOKING_NOT_CONFIRMED', 'BOOKING_CLOSED',
  'BOOKING_MESSAGE_NOT_FOUND',
  // Wave 6: scoped native jobs and owner-configured external tools.
  'JOB_BUSY', 'JOB_CLOSED', 'JOB_FILE_CHANGED', 'JOB_FILE_FORBIDDEN', 'JOB_RECIPIENT_FORBIDDEN', 'JOB_SCOPE_CHANGED', 'JOB_SOURCE_CHANGED',
  'MODEL_SEND_BLOCKED',
  'AGENT_ABORTED', 'AGENT_PROMPT_INVALID', 'AGENT_SHELL_UNAVAILABLE', 'AGENT_TURN_BUSY',
  'MCP_CALL_DECLINED', 'MCP_CONFIGURATION_APPROVAL_REQUIRED', 'MCP_CONFIGURATION_CHANGED', 'MCP_CONNECTION_FAILED', 'MCP_RESPONSE_INVALID', 'MCP_SERVER_NOT_FOUND', 'MCP_TOOL_CHANGED',
  'CALL_LOG_NOT_FOUND',
  // 5R5: exact monitored sources and one-channel triage.
  'SLACK_DISTRIBUTION_UNCONFIRMED', 'SLACK_RESPONSE_INVALID', 'SLACK_SEND_STOPPED', 'SLACK_SEND_UNCONFIRMED', 'TRIAGE_ADMIN_REQUIRED', 'TRIAGE_CHANNEL_MISMATCH', 'TRIAGE_CLAIM_UNSUPPORTED', 'TRIAGE_INPUT_INVALID', 'TRIAGE_SETUP_REQUIRED', 'TRIAGE_SOURCE_HELD', 'TRIAGE_SUMMARY_REQUIRED', 'WATCH_DESKTOP_REQUIRED', 'WATCH_FETCH_FAILED', 'WATCH_INPUT_INVALID', 'WATCH_PRICE_AMBIGUOUS', 'WATCH_SELECTOR_DRIFT', 'WATCH_SELECTOR_UNCHECKED', 'WATCH_SOURCE_NOT_FOUND', 'WATCH_TERMS_REQUIRED',
  // 5R6 exact scripts, imported call evidence and bounded call reservations.
  'CALL_ALREADY_IMPORTED', 'CALL_ALREADY_RESERVED', 'CALL_ALREADY_SETTLED', 'CALL_BUDGET_CHANGED', 'CALL_FACTS_HELD', 'CALL_FACTS_INVALID', 'CALL_LOG_INVALID', 'CALL_NOT_RESERVED', 'CALL_ORDER_REQUIRED', 'CALL_REQUEST_NOT_FOUND', 'CALL_RESPONSE_STOPPED', 'CALL_SEND_UNCONFIRMED', 'CALL_SETUP_REQUIRED', 'VOICE_PROVIDER_UNVERIFIED',
  // 5R4 exact copied-source developer review and approved local-tool refusals.
  'DEV_AUDIT_REQUIRED', 'DEV_CLI_PENDING', 'DEV_EVIDENCE_REQUIRED', 'DEV_EXPLOIT_REFUSED', 'DEV_LIVE_TARGET_REFUSED', 'DEV_PROJECT_NOT_FOUND', 'DEV_REVIEW_REQUIRED', 'DEV_SCANNER_CHANGED', 'DEV_SCANNER_REQUIRED', 'DEV_SCAN_FAILED', 'DEV_SCAN_INVALID', 'DEV_SCAN_REQUIRED', 'DEV_SECRET_FOUND', 'DEV_SOURCE_INVALID', 'FIRST_WEEK_REPORT_ONLY', 'PERMISSION_REQUIRED',
  // 5J2 source-bound dubbing and local caption refusals.
  'CAPTION_AUDIO_UNAVAILABLE', 'CAPTION_TOO_SLOW', 'CAPTION_BUSY', 'CAPTION_EVENT_STALE', 'CAPTION_NOT_SAVED', 'CAPTION_PERMISSION_REQUIRED', 'CAPTION_SAVE_FULL', 'CAPTION_SESSION_EXPIRED', 'DUB_APPROVAL_REQUIRED', 'DUB_AUDIO_REQUIRED', 'DUB_DISCLOSURE_REQUIRED', 'DUB_INPUT_INVALID', 'DUB_MEDIA_FAILED', 'DUB_NOT_FOUND', 'DUB_OUTCOME_UNKNOWN', 'DUB_OVERLONG', 'DUB_PROVIDER_FAILED', 'DUB_QUOTE_REQUIRED', 'DUB_RETRY_REFUSED', 'DUB_TIMING_INVALID',
  // 5F3 exact owner-store operations and ephemeral buyer sessions.
  'SHOPIFY_API_REFUSED', 'SHOPIFY_OUTCOME_UNKNOWN', 'SHOPIFY_OVERSOLD_MANUAL', 'SHOPIFY_RESPONSE_INVALID', 'SHOPIFY_SETUP_REQUIRED', 'SHOPIFY_SKU_MAPPING_REQUIRED', 'SHOPIFY_STORE_REQUIRED', 'STOREFRONT_AI_FAILED', 'STOREFRONT_BUSY', 'STOREFRONT_CATALOGUE_LIMIT', 'STOREFRONT_CATALOGUE_STALE', 'STOREFRONT_CONSENT_REQUIRED', 'STOREFRONT_HOSTED_ONLY', 'STOREFRONT_MODEL_UNAVAILABLE', 'STOREFRONT_NOT_FOUND', 'STOREFRONT_OUTPUT_REJECTED', 'STOREFRONT_PAUSED', 'STOREFRONT_QUESTION_INVALID', 'STOREFRONT_REQUEST_PENDING', 'STOREFRONT_SESSION_EXPIRED', 'STOREFRONT_SETUP_REQUIRED', 'STOREFRONT_UNAVAILABLE',
  'INFLUENCER_PRICE_REQUIRED',
  // 5Q exact manuscript, speech and render refusals.
  'NARRATION_NOT_FOUND', 'EXPLAINER_CAPTION_INVALID', 'EXPLAINER_QUOTE_REQUIRED', 'NARRATION_APPROVAL_REQUIRED', 'NARRATION_AUDIO_EXISTS', 'NARRATION_AUDIO_REQUIRED', 'NARRATION_DESTINATION_INVALID', 'NARRATION_DISTRIBUTOR_BLOCKED', 'NARRATION_LISTEN_REQUIRED', 'NARRATION_MARKUP_INVALID', 'NARRATION_MARKUP_SOURCE_CHANGED', 'NARRATION_MEASUREMENT_REQUIRED', 'NARRATION_MEDIA_FAILED', 'NARRATION_ORDER_REQUIRED', 'NARRATION_OUTCOME_UNKNOWN', 'NARRATION_PRICE_REQUIRED', 'NARRATION_PROVIDER_FAILED', 'NARRATION_QUOTE_REQUIRED', 'NARRATION_RETRY_REQUIRED', 'NARRATION_SOURCE_REQUIRED', 'NARRATION_TIMING_INVALID', 'NARRATION_VERIFICATION_REQUIRED',
  // 5D3 source-bound influencer campaigns and approved open-network text posts.
  'INFLUENCER_ACTUAL_INVALID', 'INFLUENCER_CASE_NOT_FOUND', 'INFLUENCER_CREATOR_INVALID', 'INFLUENCER_CREATOR_NOT_FOUND', 'INFLUENCER_INPUT_INVALID', 'INFLUENCER_KEYWORDS_INVALID', 'INFLUENCER_PACKET_INCOMPLETE', 'INFLUENCER_PRICE_CAP', 'INFLUENCER_PRICE_INVALID', 'OPEN_POSTING_ACCOUNT', 'OPEN_POSTING_CONNECT_FAILED', 'OPEN_POSTING_CONNECT_REQUIRED', 'OPEN_POSTING_CREDENTIAL', 'OPEN_POSTING_FAILED', 'OPEN_POSTING_INPUT', 'OPEN_POSTING_LENGTH', 'OPEN_POSTING_PERMISSION', 'OPEN_POSTING_REJECTED', 'OPEN_POSTING_RESPONSE',
  'CAREER_CLIENT_APPROVAL_REQUIRED', 'CAREER_APPROVAL_REQUIRED',
  'CAREER_RENDER_REQUIRED',
  'CAREER_CLAIM_BOUNDARY', 'CAREER_UNSTATED_FACT', 'CAREER_SOURCE_CHANGED',
  'CAREER_CAPTURE_CHANGED',
  'CAREER_CAPTURE_INCOMPLETE',
  'CAREER_NOT_FOUND',
  'CAREER_ORDER_REQUIRED',
  // 5P exact website owner-path refusals.
  'SITE_AUDIT_CURRENT', 'SITE_AUDIT_INVALID', 'SITE_AUDIT_REQUIRED', 'SITE_BRIEF_APPROVAL_REQUIRED', 'SITE_CAPTURE_HOSTED_ONLY', 'SITE_DEPLOYMENT_PENDING', 'SITE_FORM_ALREADY_IMPORTED', 'SITE_FORM_INVALID', 'SITE_HEALTH_FAILED', 'SITE_HEALTH_REQUIRED', 'SITE_HOST_FAILED', 'SITE_HOST_SETUP_REQUIRED', 'SITE_INPUT_INVALID', 'SITE_PREVIEW_INVALID', 'SITE_PRODUCTION_CHANGED', 'SITE_PROJECT_NOT_FOUND', 'SITE_RELEASE_INSPECTION_REQUIRED', 'SITE_RELEASE_INVALID', 'SITE_REQUIREMENT_INVALID', 'SITE_ROLLBACK_UNAVAILABLE', 'SITE_SOURCE_TOO_LARGE', 'SITE_UI_CHECK_REQUIRED', 'SITE_UI_REPORT_INVALID',
  // Newsletter source, consent, recipient and report boundaries.
  'PRIVATE_NEEDS_LOCAL',
  'NEWSLETTER_AUDIENCE_EMPTY', 'NEWSLETTER_CHECK_FAILED', 'NEWSLETTER_CONSENT_REQUIRED', 'NEWSLETTER_DRAFT_REQUIRED', 'NEWSLETTER_EXPORTED', 'NEWSLETTER_INPUT_INVALID', 'NEWSLETTER_NOT_FOUND', 'NEWSLETTER_RESULTS_MISMATCH', 'NEWSLETTER_RESULTS_REQUIRED', 'NEWSLETTER_SOURCE_MISMATCH', 'NEWSLETTER_SOURCE_REQUIRED',
  'TENDER_NOT_FOUND', 'TENDER_INPUT_INVALID', 'TENDER_SOURCE_REQUIRED', 'TENDER_COLUMN_MAP_REQUIRED', 'TENDER_EXPORT_INVALID', 'TENDER_WORKBOOK_PROTECTED', 'TENDER_ANSWER_REQUIRED', 'TENDER_GROUNDING_REQUIRED', 'TENDER_LENGTH_EXCEEDED', 'TENDER_APPROVAL_REQUIRED', 'PRICING_OWNER_ONLY',
  'INTERNAL_ORDER',
  // Wave 5 harness tools expose these exact public refusal codes.
  'BOOKS_SETUP_INVALID', 'BOOKS_CYCLE_INVALID', 'BOOKS_CONSENT_REQUIRED', 'BOOKS_SOURCE_CHANGED', 'CLIENT_LEDGER_REQUIRED', 'CLIENT_BALANCE_REQUIRED', 'BOOKS_WORK_NOT_FOUND', 'BOOKS_RECEIPT_REQUIRED',
  'STATEMENT_DOES_NOT_TIE', 'ARTICLE_NOT_FOUND', 'ARTICLE_OUTLINE_REQUIRED', 'ARTICLE_DRAFT_INVALID',
  'RECRUIT_ROLE_REQUIRED', 'RECRUIT_NOT_FOUND', 'SELLER_INPUT_INVALID', 'SELLER_PROVENANCE_REQUIRED',
  'SEO_INPUT_INVALID', 'PANEL_NOT_FOUND', 'PANEL_ORDER_REQUIRED', 'PANEL_APPROVAL_REQUIRED', 'SITE_CHECK_INVALID', 'SITE_CHECK_DESKTOP_ONLY', 'SITE_CHECK_PLANNED',
  'PRODUCT_PHOTO_REQUIRED', 'MEDIA_FILE_REQUIRED', 'SUPPORT_TICKET_NOT_FOUND', 'SUPPORT_THREAD_INVALID',
  'TRANSLATION_NOT_FOUND', 'TRANSLATION_REPAIR_LOSS', 'TRANSLATION_GLOSSARY_REQUIRED', 'WORD_TIMES_REQUIRED', 'EDIT_NOT_FOUND', 'SCRIPT_FILE_REQUIRED', 'SCRIPT_COVERAGE_FAILED',
  'BOARD_REQUIRED', 'BOARD_OUTPUT_INVALID', 'OUTPUT_APPROVAL_REQUIRED', 'STYLE_NOT_FOUND', 'STYLE_OWNED_REQUIRED', 'STYLE_SAMPLES_REQUIRED', 'STYLE_MEASUREMENTS_REQUIRED',
  'BROLL_INVALID', 'BROLL_REMOVED', 'BROLL_LICENCE_REQUIRED', 'BROLL_APPROVAL_REQUIRED', 'BROLL_REVIEW_REQUIRED', 'SOURCE_DOWNSCALED', 'FINISHING_FAILED', 'FINISHING_INPUT_INVALID',
  'INTERCHANGE_INVALID', 'PUBLISHING_TEXT_INVALID', 'CLIP_RULES_FAILED', 'CLIP_PAGE_INVALID', 'BEAT_RULES_FAILED', 'BEAT_INPUT_INVALID', 'AUDIO_INPUT_INVALID', 'AUDIO_TOO_LARGE',
  'SOCIAL_VOICE_CHANGED',
  'INVALID_VENTURE_REQUEST', 'INVALID_AMOUNT', 'INVALID_TAX_RATE', 'INVALID_TAX_ID', 'VENTURE_NOT_FOUND', 'VENTURE_EXISTS', 'UNKNOWN_COUNTRY',
  'CURRENCY_CONFLICT', 'NOT_BUILT_YET', 'APP_APPROVAL_REQUIRED', 'APPROVAL_STALE', 'INTERVIEW_DONE', 'INTERVIEW_INCOMPLETE', 'QUESTION_NOT_FOUND',
  'BLUEPRINT_NOT_FOUND', 'BLUEPRINT_NOT_ACCEPTED',
  'NO_MODEL_CONNECTED', 'MODEL_CONSENT_REQUIRED', 'MODEL_KEY_MISSING', 'MODEL_OUTPUT_REJECTED', 'MODEL_REFUSAL', 'MODEL_INCOMPLETE', 'CREDENTIAL_INVALID', 'CREDENTIAL_UNAVAILABLE',
  // A2 second review: the seal's port only (credential-port.ts noStore): this computer has no protected store at all.
  'CREDENTIAL_NO_STORE',
  'MODEL_FAILED', 'MODEL_TIMEOUT', 'BUDGET_REACHED', 'CLIENT_DATA_NEEDS_APPROVAL', 'SEND_DISABLED', 'FIXTURE_MISSING', 'CAPTURE_REFUSED', 'CLI_UNAVAILABLE', 'PRESET_UNAVAILABLE',
  'PLAN_ALREADY_KEPT', 'PRICE_REQUIRED', 'OFFER_NOT_FOUND', 'CLIENT_NOT_FOUND', 'ORDER_NOT_FOUND', 'INVOICE_NOT_FOUND', 'PAYMENT_NOT_FOUND', 'PAYMENT_NOT_CLEARED', 'INVOICE_NOT_DRAFT', 'PAYMENT_TOO_LARGE',
  'CLIENT_AI_CONSENT_REQUIRED', 'CLIENT_AI_CONSENT_CHANGED',
  'AI_SETTING_UNSUPPORTED',
  'RECEIPT_NOT_FOUND', 'BRIEF_NOT_FOUND', 'BRIEF_LINT_FAILED', 'HANDOFF_NOT_FOUND', 'REPO_NOT_LINKED', 'INVALID_REPO', 'TOKEN_NOT_FINE_GRAINED',
  'GITHUB_UNAUTHORIZED', 'GITHUB_NOT_FOUND', 'GITHUB_RATE_LIMITED', 'GITHUB_READ_FAILED',
  'PLAYBOOK_NOT_FOUND', 'SCENARIO_NOT_FOUND', 'SIMULATION_NOT_FOUND', 'SIGNAL_NOT_FOUND',
  'LAUNCH_STAGE_BLOCKED', 'STAGE_PLANNED', 'DELIVERY_NOT_FOUND', 'DELIVERY_NOT_WAITING', 'DELIVERY_NOT_READY', 'PRACTICE_DRAFT',
  'INVALID_EXTERNAL_URL', 'EXTERNAL_URL_NOT_ALLOWED',
  // The hosted web server's per-account rate limits (platform/runtime/hosted/limits.ts) reach model calls through the transport.
  'RATE_LIMITED',
  'UPLOAD_NOT_FOUND', 'UPLOAD_LIMIT', 'UNSUPPORTED_UPLOAD', 'WORK_RECEIPT_NOT_FOUND', 'DELIVERY_NOT_ASKING',
  'TOOL_DENIED', 'TOOL_INPUT_INVALID', 'TOOL_FAILED', 'TOOL_TIMEOUT', 'TOOL_SKIPPED', 'TIER_UNAVAILABLE', 'PROGRAM_INVALID', 'SANDBOX_FAILED', 'HARNESS_LIMIT',
  'IMPROVEMENT_NOT_FOUND', 'IMPROVEMENT_NOT_READY', 'CANDIDATE_STALE',
  'DELIVERY_NOT_BRIEFING', 'DELEGATE_DECLINED', 'DELEGATE_FAILED', 'DELEGATE_RUN_NOT_FOUND',
  // Onboarding v2: the composer before the vault
  'COMPOSE_NOT_FOUND', 'COMPOSE_REFUSED', 'COMPOSE_NOT_A_SERVICE',
  // Evidence ledger (P2-evidence): weaker evidence over a verified value, and an unknown item
  'EVIDENCE_WEAK', 'EVIDENCE_NOT_FOUND',
  // Spend (P2-spend): unpriced calls, the monthly cap, the charge record, and quotes bound to draft, figure and payer
  'SPEND_UNPRICED', 'SPEND_CAP', 'SPEND_ALREADY_CHARGED', 'QUOTE_WAITING', 'QUOTE_CHANGED', 'QUOTE_EXPIRED',
  // Connectors (P2-connectors): posts, staged website edits, the bank shape, leads and clip rights
  'POST_NOT_FOUND', 'POST_ALREADY_DECIDED',
  'SLOT_NOT_FOUND', 'SLOT_STALE', 'SLOT_FROZEN', 'SLOT_TIME_INVALID', 'SLOT_DESKTOP_ONLY',
  'SITE_EDIT_NOT_FOUND', 'SITE_EDIT_UNCHANGED', 'SITE_CHANGED_SINCE_REVIEW', 'SITE_WRITE_NOT_GRANTED', 'SITE_PATH_INVALID',
  'BANK_CONSENT_EXPIRED', 'BANK_POLL_LIMIT', 'BANK_STATEMENT_INVALID',
  // Bank statements into the books (Ink v2 wave 2, 2D): a row or account not found, decided once, transfers and directions
  'BANK_TRANSACTION_NOT_FOUND', 'BANK_ACCOUNT_NOT_FOUND', 'BANK_ALREADY_APPLIED', 'BANK_OWN_TRANSFER', 'BANK_NOT_MONEY_IN', 'BANK_NOT_MONEY_OUT',
  'LEADS_SOURCE_REQUIRED', 'LEADS_EMAIL_UNVERIFIED', 'LEADS_BLOCKED', 'LEADS_ADDRESS_MISSING',
  'RIGHTS_REQUIRED',
  // Ink frontend views (P1-A): runs, agents and the always-ask floor on agent gates
  'RUN_NOT_FOUND', 'AGENT_NOT_FOUND', 'STEP_NOT_FOUND', 'GATE_FLOOR',
  // Leads as engine methods: a lead id that is not in this business
  'LEADS_NOT_FOUND',
  // Lead stages (W1 H8): forward only, and won or lost stay as they are
  'LEADS_STAGE_BACKWARD', 'LEADS_STAGE_CLOSED',
  // Action journal (P2-journal): decide-once, expiry, bound single-use tokens, the idempotency key, shadow, unknown outcomes
  'JOURNAL_NOT_FOUND', 'JOURNAL_ALREADY_DECIDED', 'JOURNAL_EXPIRED', 'JOURNAL_TOKEN_INVALID', 'JOURNAL_TOKEN_USED', 'JOURNAL_KEY_REUSED',
  'JOURNAL_SHADOW', 'JOURNAL_OUTCOME_UNKNOWN',
  // Settling an unknown outcome (W1 H3), and a send to a model that broke part way, so it may have happened (W1 H15)
  'JOURNAL_NOT_UNKNOWN', 'MODEL_OUTCOME_UNKNOWN',
  // Posture (P2-posture): a policy that waits for the owner or blocks, and a spot check that is not there
  'POLICY_ASK', 'POLICY_DENIED', 'SPOT_CHECK_NOT_FOUND',
  // The untrusted screen (W1 H9): content held for the owner, a screen that could not check, a release of content not held
  'UNTRUSTED_HELD', 'SCREEN_FAILED', 'UNTRUSTED_NOT_HELD',
  // AI-native CA firm (P3-ca-firm): the CA of record, rate tables the CA confirms, cases not modelled, and tax inputs
  'CA_OF_RECORD_REQUIRED', 'CA_MEMBERSHIP_MISMATCH', 'SIGNOFF_NOT_FOUND', 'RATE_TABLE_MISSING', 'RATE_UNCONFIRMED', 'NOT_MODELLED', 'TAX_INPUT_INVALID',
  // CA gates (W1 H1, H7): regulated papers wait for the CA's sign-off; a date past every rate table's window is stale
  'CA_SIGNOFF_REQUIRED', 'RATE_TABLE_STALE',
  // Ink final pass: a Today row that is gone, an agent posture looser than the business stage, and client share links
  'QUEUE_ITEM_NOT_FOUND', 'POSTURE_ABOVE_STAGE', 'SHARE_NOT_FOUND', 'SHARE_LINK_REFUSED', 'SHARE_LINK_EXPIRED',
  // The network guard (W1 H16): a refused address or scheme, a failed lookup, redirects, size and time
  'NET_URL_REFUSED', 'NET_ADDRESS_REFUSED', 'NET_LOOKUP_FAILED', 'NET_REDIRECT_REFUSED', 'NET_TOO_MANY_REDIRECTS', 'NET_RESPONSE_TOO_LARGE',
  'NET_TIMEOUT', 'NET_FAILED',
  // The run's spend cap held before each call (W1 H4), and the gate again just before an approved action (W1 H13)
  'RUN_CAP_REACHED', 'RUN_CAP_NOT_REACHED', 'ORDER_NOT_ACTIVE', 'CLIENT_NOT_ACTIVE', 'RECHECK_FAILED',
  // Posting safety (W1 H6, H19): a post only from a checked, approved, unchanged draft; a channel held by a check or a block
  'POST_DRAFT_UNCHECKED', 'POST_CLIENT_NOT_APPROVED', 'POST_DRAFT_CHANGED', 'CHANNEL_CHALLENGED', 'CHANNEL_FROZEN',
  // The judge on real orders and going back a playbook version (Ink v2 wave 2, 2C1)
  'JUDGE_NOT_READY', 'JUDGE_NOT_WAITING', 'JUDGE_ALREADY_SENT', 'ROLLBACK_NOTHING', 'ROLLBACK_STALE',
  // Posting methods (Ink v2 wave 2, 2B1): a draft the owner has not approved, an id that names no post, a thread, the
  // house risk gate, a client's answer recorded twice, and an owner's posting limit looser than Chausar's own
  'POST_NOT_APPROVED', 'POST_NOT_A_POST', 'POST_THREAD_NOT_BUILT', 'POST_RISK_BLOCKED', 'ALREADY_DECIDED', 'POSTING_LIMIT_LOOSER',
  // A transcript made on this computer (Ink v2 wave 2, 2E2): ffmpeg or whisper.cpp missing, one already there, a failed run
  'TRANSCRIBE_NOT_AVAILABLE', 'TRANSCRIPT_EXISTS', 'SPEECH_FAILED', 'TRANSCRIBE_STOPPED',
  // Honest browser steps (Ink v2 wave 2, 2B2): signed out for a check, a check that could not run, a refused page script
  'POSTING_NOT_SIGNED_IN', 'POSTING_STEPS_NOT_CHECKED', 'PAGE_SCRIPT_REFUSED',
  // The calendar file (Ink v2 wave 2, 2F2): a draft that is not a social one, an order with no calendar to plan slots from
  'CALENDAR_NOT_A_SOCIAL_DRAFT', 'CALENDAR_NO_SLOTS',
  // Ink v2 wave 4 (named by package 4-0 from the package texts). Departments, Keeper and health (4A1)
  'DEPARTMENT_MISSING', 'AGENT_QUARANTINED', 'AGENT_IS_CODE',
  // Wave 6 (6G2): a retired agent's read-only shelf, and the last AI agent of a team, which cannot retire
  'AGENT_RETIRED', 'AGENT_LAST_ONE',
  // Wave 6 (6H1): mini apps.
  'APP_NOT_FOUND', 'APP_NEEDS_AI', 'APP_CODE_REFUSED', 'APP_NOT_PASSED', 'APP_NOT_ALLOWED', 'APP_TOOL_UNKNOWN', 'APP_NOTES_FULL', 'APP_PROPOSALS_FULL', 'APP_PROPOSAL_REFUSED',
  // Agent chat, "from now on" changes, versions and notes (4B1, 4B2)
  'CHAT_CONSENT_REQUIRED', 'CHAT_CONSENT_STALE', 'CHAT_KEY_REFUSED', 'PATCH_OWNER_OP', 'PATCH_NOT_YOUR_STEP',
  'PROPOSAL_STALE', 'PROPOSAL_DECIDED', 'UNDO_NOTHING', 'UNDO_CONFLICT', 'NOTE_CHANGED', 'NOTES_FULL',
  // Chats and proposals (4C1)
  'TOOL_NOT_ALLOWED', 'PROPOSAL_KIND_UNKNOWN', 'PROPOSAL_NOT_ALLOWED',
  // The owner's network, search, the pipeline and outreach (4D1 to 4E3)
  'NETWORK_FILE_TOO_LARGE', 'NETWORK_FILE_INVALID', 'NETWORK_ALREADY_IMPORTED', 'NETWORK_TRAIT_PROTECTED', 'RESEARCH_HOST_REFUSED',
  'PIPELINE_STAGE_BACKWARD', 'PIPELINE_STAGE_CLOSED', 'PIPELINE_EVIDENCE_REQUIRED', 'PIPELINE_BLOCKED', 'PIPELINE_TRIGGER_REQUIRED', 'PIPELINE_NOT_A_QUOTE',
  'OUTREACH_NO_CONFIRMED_PATH', 'OUTREACH_TOO_LONG', 'OUTREACH_BLOCKED', 'OUTREACH_BASIS_REQUIRED', 'OUTREACH_EXCLUDED_SERVICE', 'NEVER_CONTACT_LOST',
  'OUTREACH_NO_PHONE', 'OUTREACH_NO_PROFILE', 'OUTREACH_WHATSAPP_COLD', 'OUTREACH_DAILY_CAP', 'MAILBOX_OAUTH_ONLY',
  // 4E3: a mailbox that refused the app password, one not connected (or whose password is not loaded), one that failed
  'MAILBOX_LOGIN_FAILED', 'MAILBOX_NOT_CONNECTED', 'MAILBOX_FAILED',
  // Run controls, breakers, write caps and who pays (4F1, 4F2)
  'RUN_NOT_RUNNING', 'RUN_ALREADY_STOPPED', 'RUN_NOT_STOPPED', 'RUN_RESTART_REQUIRED', 'RUN_CONTROL_UNAVAILABLE', 'RUN_SUPERSEDED', 'BUSINESS_PAUSED', 'RUN_CAPABILITY_MISSING', 'WRITE_CAP_REACHED', 'PAYER_AMBIGUOUS',
  // Notifications and push (4G1, 4G3), the CLI status (4H1), goals (4I1)
  'NOTIFY_PAUSE_TOO_LONG', 'PUSH_ENDPOINT_REFUSED', 'PUSH_NOT_SUBSCRIBED', 'CLI_FLAGS_UNSUPPORTED', 'GOAL_INVALID', 'GOAL_MONTH_PAST',
  // Approvals, edits and set approval (4J1, 4J2)
  'ALLOW_SESSION_FLOOR', 'FILE_CHANGED', 'SEND_BACK_EMPTY', 'UNDO_TOO_LATE', 'UNDO_OUTSIDE_EFFECT', 'SET_KIND_REFUSED', 'SET_NEEDS_PICK',
  // Previews, money views, bills and credits (4J3 to 4J5)
  'POSTER_NOT_AVAILABLE', 'EXPORT_EXISTS', 'PAGING_LOOP', 'BILL_PAYMENT_TOO_LARGE', 'QUOTE_ALREADY_INVOICED', 'CREDIT_TOO_LARGE',
  // Wave 6 money (6D1 to 6D4)
  'ORDER_OVER_INVOICED', 'INVALID_UPI_ID', 'INVALID_BANK_DETAILS', 'FOREIGN_NEEDS_LUT', 'RAZORPAY_NOT_CONNECTED', 'RAZORPAY_FAILED',
  // Connector truth, file requests and the owner profile (4J7, 4J9)
  'CONNECTOR_FIELD_UNSUPPORTED', 'ROUTINE_NEEDS_CHECK', 'SHARE_USED', 'SHARE_EXPIRED', 'OWNER_NAME_INVALID',
  // The chained journal and journalled-action extras (4J10), execution places (4J11), step edges and contracts (4J12)
  'JOURNAL_CORRUPT', 'ACCOUNT_FENCE', 'ACTION_DENYLISTED', 'DELEGATE_BUSY', 'PLAYBOOK_CYCLE_UNCAPPED', 'ORDER_CONTRACT_UNSIGNED', 'CONTRACT_FIELD_LOCKED',
  // 4J12 (H25): an agent-to-agent message past a cascade cap, or to someone an agent may not message or hand back to
  'AGENT_RELAY_CAPPED', 'AGENT_RELAY_REFUSED',
  // 4J10: an end state before applied, verified without a dated check, an action waiting for the one it depends on
  'JOURNAL_NOT_APPLIED', 'JOURNAL_CHECK_UNDATED', 'JOURNAL_WAITING',
  // 4J11 (H33): a mock provider or a typed mock tool asked for on a real run (they serve tests and practice only)
  'MOCK_REAL_RUN',
  // Routines (4J13), the locked auto gate (4J15), NEEDS_FACTS (4J16), personas and questions (4J17), the hosted trial (4J23)
  'ROUTINE_NOT_STANDALONE', 'ROUTINE_NOT_YOURS', 'AUTO_LOCKED', 'NEEDS_FACTS', 'PERSONA_FIELD_REFUSED', 'QUESTION_HAS_APPROVAL', 'TRIAL_LIMIT',
  // Ideas (4J18): an idea with no record behind it, and one whose records no longer hold it
  'IDEA_NO_EVIDENCE', 'IDEA_RETIRED',
  // Ink v2 wave 5, 5A3: a dated rule, manual path, recipe or boundary a playbook cannot rest on; a rule a CA or lawyer
  // has not confirmed, on a client's work; the idea pipeline's refusals (unknown idea, a move back, a drop without a
  // reason, a grade before it was published or before its seven days)
  'RULE_INVALID', 'RULE_UNCONFIRMED', 'MANUAL_PATH_MISSING', 'RECIPE_INVALID', 'BOUNDARY_INVALID',
  'IDEA_NOT_FOUND', 'IDEA_STAGE_BACKWARD', 'IDEA_DROP_REASON', 'IDEA_NOT_PUBLISHED', 'IDEA_GRADE_EARLY',
  // 4J2 review: a copy of a draft that has not gone out, a set item never read in this version, a set that asks twice
  // without its second answer, and a settings draft holding a key, card or account number
  'COPY_NOT_SENT', 'VIEW_FIRST', 'SET_NEEDS_SECOND_ASK', 'DRAFT_HOLDS_SECRET',
  // Ink v2 wave 5, 5A1: a kit definition that breaks a rule, and a kit order missing a required intake field
  'PLAYBOOK_DEFINITION_INVALID', 'INTAKE_FIELD_REQUIRED', 'PLAYBOOK_ROUTE_INVALID', 'PLAYBOOK_WORKFLOW_CHANGED', 'SOCIAL_POST_REQUIRED', 'SOCIAL_REVISION_SHAPE', 'OFFER_EXTRA_ROUND',
  'SOURCE_THIN', 'SOCIAL_SOURCE_INVALID', 'SOCIAL_INPUT_INVALID', 'COMMUNITY_RULES_REQUIRED', 'COMMUNITY_NO_GO',
  // 5M: exact owner-approved research, source permissions, channel limits and paid lookup outcomes.
  'APPROVAL_CHANGED', 'CITY_NOT_FOUND', 'COLD_CHANNEL_REFUSED', 'COMMUNITY_OWNER_SOURCE_REQUIRED', 'COMMUNITY_QUOTE_MISSING', 'HAPPENSTANCE_SEARCH_UNCONFIRMED', 'KEY_REQUIRED', 'LEAD_HOST_CHANGED', 'LEAD_INTAKE_CHANGED', 'LEAD_RATE_STALE', 'LEAD_SOURCE_UNAVAILABLE', 'PRODUCT_CONFIRM_REQUIRED', 'WHATSAPP_CONSENT_REQUIRED',
  // Ink v2 wave 5, 5A2: share prices (no recorded base, a base without its file, a share outside 0.01% to 100%); the
  // pilot (a window outside 2 to 6 weeks, no price, an offer that is not a pilot); the sales proposal (an unpriced
  // offer, none found, a check that failed); an ask wholly outside what the business does
  'SHARE_BASE_MISSING', 'SHARE_BASE_UNPROVEN', 'INVALID_SHARE', 'PILOT_WINDOW', 'PILOT_UNPRICED', 'PILOT_NOT_OFFERED',
  'OFFER_UNPRICED', 'PROPOSAL_NOT_FOUND', 'PROPOSAL_CHECKS_FAILED', 'OUTSIDE_SCOPE',
  // Ink v2 wave 5, 5A6: the fetch policy and robots.txt; monitors; the owner's local apps; publish tiers' quota; the
  // webhook handoff; mail files; speech out (no dated price, quote first, a voice without a licence or consent)
  'FETCH_POLICY_REFUSED', 'FETCH_DISGUISE_REFUSED', 'ROBOTS_REFUSED', 'MONITOR_NOT_FOUND', 'MONITOR_LIMIT',
  'LOCAL_APP_NOT_FOUND', 'LOCAL_APP_UNAVAILABLE', 'LOCAL_APP_REFUSED', 'LOCAL_APP_FAILED', 'LOCAL_APP_NEEDS_YOU', 'QUOTA_REACHED',
  'WEBHOOK_NOT_SET', 'WEBHOOK_REFUSED', 'MAIL_FILE_TOO_LARGE', 'MAIL_FILE_UNREADABLE',
  'UNPRICED_CALL', 'QUOTE_FIRST', 'VOICE_NOT_ALLOWED', 'SPEECH_PLANNED', 'SPEECH_TOO_LONG',
  // Ink v2 wave 5, 5A4: asset records (an unknown licence, not found, not made yet, a rerun or reuse refused), a clip
  // still holding its location data, voice consent (none current, withdrawn, not found, another voice than the step
  // named), and a derived unit whose source changed
  'ASSET_LICENCE_UNKNOWN', 'ASSET_NOT_FOUND', 'ASSET_NOT_MADE', 'ASSET_REFUSED', 'MEDIA_NOT_CLEAN',
  'CONSENT_REQUIRED', 'CONSENT_WITHDRAWN', 'CONSENT_NOT_FOUND', 'VOICE_MISMATCH', 'DERIVED_STALE',
  // 5B3: source-bound YouTube analysis, comment handoffs and owner-key public reads.
  'YOUTUBE_RESEARCH_INVALID', 'YOUTUBE_RESEARCH_NOT_FOUND', 'YOUTUBE_SOURCE_REQUIRED',
  'YOUTUBE_REPLY_BAIT', 'YOUTUBE_REPLY_TOO_LONG', 'YOUTUBE_READ_FAILED', 'YOUTUBE_READ_USED', 'YOUTUBE_KEY_REQUIRED',
  'YOUTUBE_SERVICE_INVALID', 'YOUTUBE_SERVICE_EXISTS',
  // 5R2: exact client-source, guarded desktop form and saved-response boundaries.
  'FORM_ACTION_HELD', 'FORM_ALREADY_SUBMITTED', 'FORM_BROWSER_CLOSED', 'FORM_CAPTURE_INCOMPLETE',
  'FORM_CONSENT_REQUIRED', 'FORM_DESKTOP_REQUIRED', 'FORM_MAPPING_INVALID', 'FORM_ORDER_CLOSED',
  'FORM_ORDER_REQUIRED', 'FORM_PERMISSION_REQUIRED', 'FORM_PRIVACY_PENDING', 'FORM_READBACK_INVALID',
  'FORM_READBACK_UNAVAILABLE', 'FORM_RECORD_EXISTS', 'FORM_RECORD_NOT_FOUND', 'FORM_SEND_UNCONFIRMED',
  'FORM_SIGNIN_REQUIRED', 'FORM_SOURCE_CHANGED', 'FORM_SOURCE_INVALID', 'FORM_STILL_RUNNING',
  'FORM_TARGET_CHANGED', 'SITE_NOT_ALLOWED',
  // D5: Install Claude Code (models/claude-code-install.ts), wired to a method after the main lane.
  'CLAUDE_INSTALL_NEEDS_YES', 'CLAUDE_INSTALL_DOWNLOAD_FAILED', 'CLAUDE_INSTALL_FAILED', 'CLAUDE_INSTALL_UNSUPPORTED', 'CLAUDE_INSTALL_NOT_CHOSEN',
] as const;

/**
 * Desktop encrypted file storage is beta-grade. Other file hosts and the hosted web tier retain the practice label.
 */
export function experimentalStorage(deps: { storage: VentureStorage; host: VentureHostKind }): boolean {
  return deps.host === 'hosted-web' || (deps.storage === 'experimental-file' && deps.host !== 'desktop');
}
