// Chausar delivery harness (Ink v2 wave 4, package 4J11, catalogue H29): tools offered by group. Every tool belongs to
// one group. An act turn names every tool it may call, but carries the full fields only for the groups in use: the
// current step's, the asking tools (a hand-off is always one call away), and the groups of the tools the agent called
// in its last turn (fields load on demand, the turn after first use). The current step is the first agent step that
// names tools and has none of them audited yet (judge/auditor.ts); once each has, the last one. A playbook whose steps
// name no tools offers every tool whole, as before. The idea follows kimo's toolgroups.rs (2026-10-21 harvest).
import { TOOL_NAMES } from '../../contracts.ts';
import type { HarnessState, PlaybookRecord, ToolName } from '../../contracts.ts';

export type ToolGroup = 'files' | 'dictionary' | 'calculator' | 'sandbox' | 'ask' | 'outside' | 'heavy' | 'tax' | 'youtube' | 'social' | 'evidence'
  // Ink v2 wave 5 (package 5-0): the kit's tools, and each new playbook's own tools as a group named for it
  | 'kit' | 'seo-visibility' | 'online-seller' | 'support-desk' | 'recruiting-desk' | 'job-search-desk' | 'translation-studio' | 'bookkeeping-cfo' | 'podcast-to-article' | 'lead-generation' | 'newsletter-studio' | 'tender-desk' | 'website-studio' | 'narration-studio' | 'virtual-assistant' | 'data-entry-desk' | 'app-testing' | 'dev-agency' | 'monitored-data' | 'it-triage' | 'phone-receptionist';

/** The group of every tool. A new tool without a group fails the tests (venture-context-hygiene.test.ts). */
export const TOOL_GROUPS: Readonly<Record<ToolName, ToolGroup>> = Object.freeze({
  'files.list': 'files', 'files.read': 'files',
  'dictionary.browse': 'dictionary', 'dictionary.resolve': 'dictionary',
  'calc.sum': 'calculator', 'calc.totals': 'calculator', 'books.reconcile': 'calculator', 'bills.pick': 'calculator',
  'sandbox.transform': 'sandbox', 'sandbox.python': 'sandbox',
  'handoff.client': 'ask', 'handoff.owner': 'ask',
  'outbox.propose': 'outside',
  'agent.delegate': 'heavy',
  'tax.income': 'tax', 'tax.interest': 'tax', 'tax.gst': 'tax', 'tax.tds': 'tax', 'tax.statements': 'tax', 'tax.portal': 'tax',
  'youtube.hooks': 'youtube', 'youtube.editList': 'youtube', 'youtube.chapters': 'youtube', 'youtube.retention': 'youtube',
  'social.report': 'social',
  'evidence.record': 'evidence',
  // Ink v2 wave 5 (package 5-0)
  // the kit (5A3, 5A4, 5A6)
  'ideas.add': 'kit',
  'assets.record': 'kit',
  'media.clean': 'kit',
  'localapp.run': 'kit',
  'mail.read': 'kit',
  'speech.say': 'kit',
  // YouTube (5B1 to 5B3)
  'youtube.editOps': 'youtube',
  'youtube.clean': 'youtube',
  'youtube.captions': 'youtube',
  'youtube.coverage': 'youtube',
  'youtube.dictionary': 'youtube',
  'youtube.style': 'youtube',
  'youtube.clips': 'youtube',
  'youtube.broll': 'youtube',
  'youtube.beats': 'youtube',
  'youtube.export': 'youtube',
  'youtube.afterPublish': 'youtube',
  'youtube.outliers': 'youtube',
  'youtube.niche': 'youtube',
  'youtube.comments': 'youtube',
  'youtube.publicStats': 'youtube',
  'youtube.archive': 'youtube',
  // the CA firm (5C1, 5C2)
  'tax.citations': 'tax',
  'tax.formChooser': 'tax',
  'tax.advance': 'tax',
  'tax.whatIf': 'tax',
  'books.healthCheck': 'tax',
  'docs.entry': 'tax',
  // social (5D1 to 5D3)
  'social.formats': 'social',
  'social.inventory': 'social',
  'social.slots': 'social',
  'social.montage': 'social',
  'social.inbox': 'social',
  'social.diagnose': 'social',
  'social.health': 'social',
  'social.adStyle': 'social',
  'social.fairPrice': 'social',
  'social.keywords': 'social',
  // seo-visibility (5E1, 5E2)
  'seo.diagnose': 'seo-visibility',
  'seo.aiAccess': 'seo-visibility',
  'seo.panel': 'seo-visibility',
  'seo.siteCheck': 'seo-visibility',
  'seo.corroborate': 'seo-visibility',
  'seo.lint': 'seo-visibility',
  'seo.meta': 'seo-visibility',
  'seo.impact': 'seo-visibility',
  'seo.refresh': 'seo-visibility',
  'seo.local': 'seo-visibility',
  // online-seller (5F1, 5F2, 5F3)
  'seller.unitEconomics': 'online-seller',
  'seller.ads': 'online-seller',
  'seller.settlement': 'online-seller',
  'seller.listing': 'online-seller',
  'seller.stage': 'online-seller',
  'seller.alerts': 'online-seller',
  'seller.stock': 'online-seller',
  'seller.shortlist': 'online-seller',
  'seller.catalogueSheet': 'online-seller',
  'seller.multiStore': 'online-seller',
  // support-desk (5G)
  'support.match': 'support-desk',
  'support.ticket': 'support-desk',
  // recruiting-desk (5H)
  'recruit.criteria': 'recruiting-desk',
  'recruit.ledger': 'recruiting-desk',
  'recruit.slots': 'recruiting-desk',
  // job-search-desk (5I)
  'career.facts': 'job-search-desk',
  'career.capture': 'job-search-desk',
  'career.shortlist': 'job-search-desk',
  'career.score': 'job-search-desk',
  // translation-studio (5J1, 5J2)
  'translate.check': 'translation-studio',
  'translate.terms': 'translation-studio',
  'subtitle.check': 'translation-studio',
  'dub.align': 'translation-studio',
  'dub.verify': 'translation-studio',
  // bookkeeping-cfo (5K1, 5K2)
  'cfo.ratios': 'bookkeeping-cfo',
  'cfo.scenarios': 'bookkeeping-cfo',
  'collections.ladder': 'bookkeeping-cfo',
  'money.checkup': 'bookkeeping-cfo',
  'books.write': 'bookkeeping-cfo',
  'vouchers.draft': 'bookkeeping-cfo',
  'seller.books': 'bookkeeping-cfo',
  'books.setup': 'bookkeeping-cfo',
  // podcast-to-article (5L)
  'article.ledger': 'podcast-to-article',
  'article.style': 'podcast-to-article',
  // lead-generation (5M)
  'leads.osm': 'lead-generation',
  'leads.enrich': 'lead-generation',
  'leads.dedupe': 'lead-generation',
  'community.vote': 'lead-generation',
  // newsletter-studio (5N)
  'newsletter.presend': 'newsletter-studio',
  'newsletter.import': 'newsletter-studio',
  'newsletter.slices': 'newsletter-studio',
  'newsletter.stats': 'newsletter-studio',
  // tender-desk (5O)
  'tender.questions': 'tender-desk',
  'tender.ground': 'tender-desk',
  // website-studio (5P)
  'site.requirements': 'website-studio',
  'site.uiReport': 'website-studio',
  'site.flow': 'website-studio',
  'site.preview': 'website-studio',
  // narration-studio (5Q)
  'narration.markup': 'narration-studio',
  'narration.verify': 'narration-studio',
  // virtual-assistant (5R1)
  'va.brief': 'virtual-assistant',
  // data-entry-desk (5R2)
  'forms.map': 'data-entry-desk',
  'forms.readBack': 'data-entry-desk',
  // app-testing (5R3)
  'apptest.logcat': 'app-testing',
  'demo.plan': 'app-testing',
  // dev-agency (5R4)
  'qa.verdict': 'dev-agency',
  'security.scan': 'dev-agency',
  // monitored-data (5R5)
  'monitor.extract': 'monitored-data',
  // it-triage (5R5)
  'triage.summary': 'it-triage',
  // phone-receptionist (5R6)
  'calls.cost': 'phone-receptionist',
  'calls.log': 'phone-receptionist',
});

/** The groups always offered whole: asking a person ends a turn and must never wait for its fields. */
const ALWAYS: readonly ToolGroup[] = ['ask'];
const AGENT_KINDS = new Set(['gather', 'question', 'work']);

/** The group a tool belongs to. */
export function toolGroup(name: ToolName): ToolGroup {
  return TOOL_GROUPS[name];
}

/** What a tool outside the groups in use says instead of its fields. */
export const FIELDS_LATER = 'Fields not shown yet: they come with your next turn once you call a tool of this group, or when its step comes.';

/**
 * The offered tools whose full fields this turn carries, or null to carry every tool whole (no step names tools).
 * Read from the run's records only: its audited calls and its last turn's calls.
 */
export function loadedTools(playbook: Pick<PlaybookRecord, 'steps'>, state: Pick<HarnessState, 'toolCalls' | 'rounds' | 'turns'>, offered: readonly ToolName[]): Set<ToolName> | null {
  const steps = playbook.steps.filter(step => AGENT_KINDS.has(step.kind) && (step.tools?.length ?? 0) > 0);
  if (!steps.length) return null;
  const audited = new Set((state.rounds ?? []).flatMap(round => round.steps.filter(step => step.audited).map(step => step.tool)));
  const current = steps.find(step => !(step.tools ?? []).some(tool => audited.has(tool))) ?? steps[steps.length - 1];
  const groups = new Set<ToolGroup>([...ALWAYS, ...(current.tools ?? []).map(toolGroup)]);
  const last = state.turns.filter(turn => turn.step === 'act').at(-1)?.turn;
  for (const call of state.toolCalls) {
    if (call.turn === last && (TOOL_NAMES as readonly string[]).includes(call.tool)) groups.add(toolGroup(call.tool as ToolName));
  }
  return new Set(offered.filter(name => groups.has(toolGroup(name))));
}
