// A test-only kit definition for package 5A2's tests (Ink v2 wave 5): a small bookkeeping desk with one offer that can
// be a paid pilot and one that cannot, and the phrases its honest exit reads, in English and Hindi. Only the fields the
// sales mechanics read are filled; it is never registered, so no business picks it outside these tests.
import type { KitOffer, PlaybookDefinition } from '../runtime/venture/playbooks/kit/define.ts';

const offer = (id: string, name: string, pilotable: boolean, pricing: KitOffer['pricing']): KitOffer => ({
  id, name, description: `${name} for small shops.`, pricing, unit: pricing === 'monthly' ? 'per month' : 'per project', price: 'owner-sets',
  stages: ['collect', 'match', 'report'], includes: ['Bank matching', 'A short monthly report'], pilotable, rights: [], intake: [], audience: 'client',
});

export const FIXTURE_ID = 'kit-sales-fixture';

/** The fixture's Hindi for the phrases its honest exit reads (5A1's hi.json shape, as a lookup). */
export const FIXTURE_HI: Readonly<Record<string, string>> = Object.freeze({
  'bookkeeping': 'बहीखाता', 'bank reconciliation': 'बैंक मिलान', 'gst returns': 'जीएसटी रिटर्न',
  'website': 'वेबसाइट', 'logo design': 'लोगो डिज़ाइन', 'legal advice': 'कानूनी सलाह',
});

export const FIXTURE: PlaybookDefinition = {
  registration: {
    id: FIXTURE_ID, label: 'Fixture bookkeeping desk', serviceType: 'bookkeeping', picks: ['fixture bookkeeping desk'],
    summary: 'Monthly books for small shops, for tests.', riskLevel: 'low', lastReviewed: '2026-10-27',
  },
  offers: [offer('monthly-books', 'Monthly books', true, 'monthly'), offer('audit-share', 'Refund audit', false, 'project')],
  roles: [], steps: [], approvals: [], connectors: [], intakeFields: [], checks: [], checkIds: [], judgeRules: [],
  baseline: { name: 'fixture', folder: 'baselines', score: () => ({ pass: true, why: 'fixture' }) },
  rules: [], boundaries: [], recipes: [], practice: [], tools: [],
  planPicks: { offers: [], approvals: [], connectors: [] },
  draftStep: () => 'report',
  startTile: {
    category: 'money-and-tax', icon: 'books', line: 'Monthly books for shops.',
    youDo: { hoursMin: 2, hoursMax: 4, line: 'Check the report.' }, team: { roleIds: [], line: 'A bookkeeper agent.' },
    pay: { minRupees: 2000, maxRupees: 8000, per: 'per month' },
  },
  scope: {
    inScope: ['bookkeeping', 'bank reconciliation', 'gst returns'],
    outOfScope: ['website', 'logo design', 'legal advice'],
    pointElsewhere: 'a web designer or a lawyer near you can help',
  },
  notBuilt: [],
  words: () => [],
};
