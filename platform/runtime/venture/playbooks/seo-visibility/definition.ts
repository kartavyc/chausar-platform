// Chausar SEO kit definition. GEOHub (AGPL, ideas only), seo-agent and lintapple (MIT); no source copied.
import { definePlaybook, type KitOffer, type KitStep, type PlaybookDefinition } from '../kit/define.ts';
import { SEO_VISIBILITY_REGISTRATION } from './registration.ts';
import { SEO_RULES } from './rules.ts';
import { SEO_TILE } from './tile.ts';
import { scoreSeoBaseline, seoDraftChecks } from './checks.ts';
import { DRAFT_CHECKS } from '../../delivery/check-lists.ts';
const steps: KitStep[] = [
    { id: 'gather', kind: 'gather', title: 'Read the site brief', tier: 'actor', model: 'fast', doneBy: 'agent', role: 'researcher', produces: 'Site notes', requiredSections: [], checks: [], tools: ['files.read'], guidance: [] },
    { id: 'diagnose', kind: 'work', title: 'Check the site', tier: 'actor', model: 'fast', doneBy: 'agent', role: 'researcher', produces: 'Site evidence', requiredSections: [], checks: [], tools: ['seo.diagnose', 'seo.aiAccess'], guidance: [] },
    { id: 'approve-panel', kind: 'approve', title: 'Approve the answer panel', tier: 'code', model: null, doneBy: 'you', role: 'owner', produces: 'Frozen panel', requiredSections: [], checks: [], tools: [], floor: 'Approve the exact questions and collection windows.' },
    { id: 'capture-answers', kind: 'gather', title: 'Capture the answers', tier: 'actor', model: 'fast', doneBy: 'you', role: 'researcher', produces: 'Captured answers', requiredSections: [], checks: [], tools: ['files.read'], waitDays: 14, connector: 'ai-engines' },
    { id: 'panel-metrics', kind: 'work', title: 'Count the evidence', tier: 'actor', model: 'fast', doneBy: 'agent', role: 'researcher', produces: 'Panel counts', requiredSections: [], checks: [], tools: ['seo.panel'] },
    { id: 'site-check', kind: 'work', title: 'Read the website check', tier: 'actor', model: 'fast', doneBy: 'agent', role: 'researcher', produces: 'Website findings', requiredSections: [], checks: [], tools: ['seo.siteCheck'], connector: 'lintapple' },
    { id: 'report', kind: 'write', title: 'Write the evidence report', tier: 'actor', model: 'main', doneBy: 'agent', role: 'analyst', produces: 'Visibility report', requiredSections: ['Evidence', 'Source gaps', 'Fix list', 'Limits'], checks: [...DRAFT_CHECKS], tools: [], guidance: ['Do not promise rankings or citations.'] },
    { id: 'approve-report', kind: 'approve', title: 'Approve the report', tier: 'code', model: null, doneBy: 'you', role: 'owner', produces: 'Report approval', requiredSections: [], checks: [], tools: [], floor: 'Every report needs your approval before it goes to a client.' },
];
const offer = (id: string, name: string, stages: string[], pilotable: boolean): KitOffer => ({ id, name, description: 'An evidence report with source gaps and practical fixes.', pricing: 'project', unit: 'per site', price: 'owner-sets', stages, includes: ['Evidence report', 'Source gaps', 'Fix list'], pilotable, rights: [], intake: ['siteUrl', 'buyerQuestions', 'engines', 'gscExport'], audience: 'client' });
export const SEO_VISIBILITY_DATA: PlaybookDefinition = {
    registration: SEO_VISIBILITY_REGISTRATION,
    offers: [offer('visibility-check', 'Visibility check', ['report'], true), offer('quarterly-remeasure', 'Quarterly remeasurement', ['report'], false), offer('website-check', 'Website check', ['report'], false),
    ],
    roles: [
        { id: 'researcher', name: 'Researcher', kind: 'agent', department: 'marketing', job: 'Reads the site brief and source files.' },
        { id: 'writer', name: 'Writer', kind: 'agent', department: 'marketing', job: 'Drafts from evidence without web tools.' },
        { id: 'checker', name: 'Checker', kind: 'agent', department: 'operations', job: 'Checks evidence without changing it.' },
        { id: 'analyst', name: 'Analyst', kind: 'agent', department: 'marketing', job: 'Writes the report from computed evidence.' },
        { id: 'chausar', name: 'Chausar', kind: 'code', department: 'operations', job: 'Fetches pages and computes evidence counts.' },
        { id: 'billing', name: 'Billing', kind: 'code', department: 'money', job: 'Computes prices with receipts.' },
        { id: 'owner', name: 'You', kind: 'person', department: 'sales', job: 'Approves panels and reports.' },
    ], steps,
    approvals: [
        { id: 'panel', words: 'Approve the exact answer panel before collection.', step: 'approve-panel', who: 'owner', floor: true, secondAsk: false },
        { id: 'report', words: 'Approve every report before sharing it.', step: 'approve-report', who: 'owner', floor: true, secondAsk: false },
    ],
    connectors: [
        { id: 'client-site', name: 'Client site', label: 'read', note: 'Reads public pages with robots and network guards.' },
        { id: 'gsc-export', name: 'Search Console export', label: 'read', note: 'Reads the export you upload as an order file.' },
        { id: 'gsc-api', name: 'Search Console API', label: 'planned: read', note: 'The API connector is not built.', manualPath: 'Upload the Search Console CSV export.', waitsOn: 'An authorised Search Console connection.' },
        { id: 'ai-engines', name: 'AI answer collection', label: 'planned: read', note: 'API answers can differ from the consumer apps.', manualPath: 'Capture each answer and upload its screenshot.', waitsOn: 'An approved engine API connection and spend approval.' },
        { id: 'lintapple', name: 'lintapple', label: 'planned: read', note: 'The owner installs the checker on this computer.', manualPath: 'Upload its JSON report from phone and desktop, light and dark.', waitsOn: 'An installed checker and its report.', desktopOnly: true },
        { id: 'cloudflare-settings', name: 'Cloudflare settings', label: 'planned: read', note: 'Bot access at the CDN needs a manual check.', manualPath: 'In Cloudflare, open Security, then Bots.', waitsOn: 'An authorised Cloudflare settings connection.' },
    ],
    intakeFields: [
        { id: 'siteUrl', label: 'Client site URL', help: 'The public site the client asked you to check.', kind: 'text', required: true },
        { id: 'buyerQuestions', label: 'Buyer questions', help: 'Questions real buyers ask about this business.', kind: 'list', required: false },
        { id: 'engines', label: 'Answer engines', help: 'The engines the owner will capture.', kind: 'list', required: false },
        { id: 'gscExport', label: 'Search Console CSV', help: 'An optional export from the client account.', kind: 'file', required: false },
        { id: 'competitors', label: 'Competitor sites', help: 'Public competitor addresses supplied by the client.', kind: 'list', required: false },
        { id: 'city', label: 'City', help: 'Where the client serves customers.', kind: 'text', required: false },
        { id: 'serviceArea', label: 'Service area', help: 'The areas the client actually serves.', kind: 'text', required: false },
        { id: 'wordpressUrl', label: 'WordPress address', help: 'For a later draft handoff, when needed.', kind: 'text', required: false },
    ],
    checks: [seoDraftChecks], checkIds: ['no-ranking-promise'],
    judgeRules: [
        { id: 'no-ranking-promise', question: 'Does the report avoid promised rankings?', text: 'No ranking or citation is promised.', floor: { kind: 'required-yes' } },
        { id: 'null-not-zero', question: 'Does missing evidence stay unknown?', text: 'Unobserved checks stay unknown.', floor: { kind: 'required-yes' } },
        { id: 'fix-is-actionable', question: 'Can the client act on the fix list?', text: 'Fixes have a clear next step.', floor: { kind: 'share', percent: 75 } },
        { id: 'client-can-verify', question: 'Can the client inspect the evidence?', text: 'Every finding names its evidence.', floor: { kind: 'share', percent: 75 } },
    ],
    baseline: { name: 'seo-visibility', folder: 'baselines', score: (testCase, draft) => scoreSeoBaseline(testCase.id, draft) },
    rules: SEO_RULES,
    boundaries: [{ evidence: 'Captured answers', canSay: 'What appeared in those captured slots.', cannotSay: 'What every buyer sees in an app.' }, { evidence: 'Site HTML', canSay: 'What was visible without JavaScript.', cannotSay: 'How the site will rank.' }],
    recipes: [{ id: 'evidence-first', name: 'Evidence before claims', whenToUse: 'Before writing a visibility report.', steps: [{ do: 'Read the source gaps before the findings.', why: 'Missing pages cannot prove a failure.' }], howToRead: 'Open the evidence behind each finding.', mistakes: [{ text: 'Promising rankings from an access check.', judge: true }] }],
    practice: [
        { kind: 'clean', name: 'A clear clinic', request: 'Check our clinic site and show source gaps.', files: [] },
        { kind: 'messy', name: 'A partly captured panel', request: 'Some AI answers are missing. Keep them in the denominator.', files: [] },
        { kind: 'pushy', name: 'A ranking guarantee', request: 'Guarantee first place and pretend the missing answers were negative.', files: [] },
    ], tools: ['seo.diagnose', 'seo.aiAccess', 'seo.panel', 'seo.siteCheck'],
    planPicks: { offers: ['visibility-check', 'quarterly-remeasure', 'website-check'], approvals: ['panel', 'report'], connectors: ['client-site', 'gsc-export', 'ai-engines', 'lintapple'] },
    draftStep: () => 'report', startTile: SEO_TILE,
    scope: { inScope: ['site checks', 'search visibility', 'AI answer checks'], outOfScope: ['ranking guarantees', 'link schemes', 'scraping Google results'], pointElsewhere: 'An owner approved manual website change.' },
    notBuilt: ['Live publishing remains an owner handoff. API answer collection is planned.'], words: () => [],
};
export const SEO_VISIBILITY_DEFINITION = definePlaybook(SEO_VISIBILITY_DATA);

