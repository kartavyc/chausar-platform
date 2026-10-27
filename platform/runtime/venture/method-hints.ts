// Chausar venture launcher (Ink v2 wave 4, package 4J10; catalogue H38): a hint for every venture method, made with the
// method list itself, so every surface can say what a call does before it is made: readOnly (it changes nothing the
// owner decided or sees as done; it may store a receipt it worked out), undoable (nothing it does is lasting, or
// Chausar has a way to take it back), idempotent (asking again with the same request changes nothing more) and
// reachesOutside (it may send something off this computer: the owner's AI, a network, a site or a connected service).
// The level is the permission each handler authorizes at: wave 4's are W4_METHOD_LEVELS, the rest are read from their
// handlers here. A parity test (venture-method-hints.test.ts) checks one method set across VENTURE_METHODS, these
// hints, the desktop's IPC allowlist, the Ink app's method map and the hosted allow-list, and that every read is
// readOnly. The idea of hints beside each action follows mailcheap (lib/actions/define-action.js); learned from, not
// copied (AGPL).
import { VENTURE_METHODS, W4_METHOD_LEVELS, W5_METHOD_LEVELS } from './contracts.ts';
import type { MethodLevel, VentureMethod, W4Method, W5Method } from './contracts.ts';

export type MethodHint = { readOnly: boolean; undoable: boolean; idempotent: boolean; reachesOutside: boolean };
/** admin: the few methods that need the owner's admin rights (creating the business, the bank's consent and alerts). */
export type HintLevel = MethodLevel | 'admin';

/** r readOnly, u undoable, i idempotent, o reachesOutside. A read is 'rui'; a read that looks outside adds o. */
type Flags = '' | 'r' | 'u' | 'i' | 'o' | 'ui' | 'uo' | 'io' | 'uio' | 'rui' | 'ruio';

/** The methods before wave 4: each one's level and flags, read from its handler. */
const BEFORE_W4: Readonly<Record<Exclude<VentureMethod, W4Method | W5Method>, readonly [HintLevel, Flags]>> = Object.freeze({
  'venture.countries': ['read', 'rui'], 'venture.preview': ['read', 'rui'], 'venture.create': ['admin', ''], 'venture.get': ['read', 'rui'],
  'venture.events': ['read', 'rui'], 'venture.interview.next': ['prepare', 'uo'], 'venture.interview.answer': ['prepare', 'u'],
  'venture.blueprint.draft': ['prepare', 'uo'], 'venture.blueprint.get': ['read', 'rui'], 'venture.blueprint.update': ['prepare', 'u'],
  'venture.blueprint.accept': ['approve', ''],
  'venture.models.presets': ['read', 'rui'], 'venture.models.connect': ['approve', 'uio'], 'venture.models.disconnect': ['approve', 'ui'],
  'venture.models.status': ['read', 'rui'], 'venture.models.calls': ['read', 'rui'],
  'venture.price.quote': ['prepare', 'ui'], 'venture.receipt.get': ['read', 'rui'],
  'venture.client.add': ['prepare', ''], 'venture.client.list': ['read', 'rui'],
  'venture.order.create': ['prepare', ''], 'venture.order.list': ['read', 'rui'], 'venture.order.deliver': ['prepare', 'i'],
  'venture.invoice.prepare': ['prepare', 'u'], 'venture.invoice.issue': ['approve', 'i'], 'venture.invoice.get': ['read', 'rui'], 'venture.invoice.list': ['read', 'rui'],
  'venture.payment.record': ['prepare', ''], 'venture.books.summary': ['read', 'rui'],
  'venture.spend.list': ['read', 'rui'], 'venture.spend.policy.get': ['read', 'rui'], 'venture.spend.policy.set': ['admin', 'ui'],
  'venture.build.brief': ['prepare', 'u'], 'venture.build.handoff': ['prepare', 'u'], 'venture.build.handoffOpened': ['prepare', 'ui'],
  'venture.build.link': ['prepare', 'uio'], 'venture.build.sync': ['prepare', 'io'], 'venture.build.status': ['read', 'rui'],
  'venture.connectors.list': ['read', 'rui'],
  'venture.delivery.playbook': ['prepare', 'ui'], 'venture.simulation.scenarios': ['read', 'rui'], 'venture.simulation.run': ['prepare', 'uo'],
  'venture.simulation.get': ['read', 'rui'], 'venture.simulation.fromSignal': ['prepare', 'u'],
  'venture.launch.status': ['read', 'rui'], 'venture.launch.advance': ['approve', ''],
  'venture.delivery.run': ['prepare', ''], 'venture.delivery.approve': ['approve', 'o'], 'venture.delivery.review': ['approve', ''], 'venture.delivery.list': ['read', 'rui'],
  'venture.capabilities': ['read', 'rui'],
  'venture.files.add': ['prepare', ''], 'venture.files.list': ['read', 'rui'], 'venture.delivery.answer': ['prepare', ''], 'venture.work.get': ['read', 'rui'],
  'venture.improve.status': ['read', 'rui'], 'venture.improve.run': ['prepare', 'o'], 'venture.improve.get': ['read', 'rui'], 'venture.improve.adopt': ['approve', 'u'],
  'venture.delivery.delegate': ['approve', 'o'], 'venture.delegate.get': ['read', 'rui'],
  'venture.queue.list': ['read', 'rui'], 'venture.queue.decide': ['approve', 'o'], 'venture.runs.list': ['read', 'rui'], 'venture.runs.get': ['read', 'rui'],
  'venture.team.list': ['read', 'rui'], 'venture.team.gate': ['approve', 'ui'],
  'venture.evidence.list': ['read', 'rui'], 'venture.evidence.apply': ['prepare', ''],
  'venture.journal.list': ['read', 'rui'], 'venture.journal.resolve': ['approve', ''],
  'venture.untrusted.mode': ['approve', 'ui'], 'venture.untrusted.release': ['approve', ''],
  'venture.bank.import': ['admin', ''], 'venture.bank.consent': ['admin', ''],
  'venture.site.stage': ['prepare', 'u'], 'venture.site.apply': ['approve', 'uo'], 'venture.site.revert': ['approve', 'o'],
  'venture.leads.add': ['prepare', ''], 'venture.leads.list': ['read', 'rui'], 'venture.leads.draft': ['prepare', 'uo'], 'venture.leads.recordSend': ['approve', 'i'],
  'venture.queue.view': ['read', 'rui'], 'venture.team.posture': ['approve', 'ui'], 'venture.evidence.dismiss': ['prepare', 'u'],
  'venture.money.overview': ['read', 'rui'], 'venture.tax.working': ['read', 'rui'],
  'venture.ca.get': ['read', 'rui'], 'venture.ca.setOfRecord': ['approve', 'ui'], 'venture.ca.recordSignoff': ['approve', ''], 'venture.ca.confirmRates': ['approve', ''],
  'venture.leads.block': ['approve', 'i'], 'venture.share.create': ['approve', 'uo'], 'venture.share.list': ['read', 'rui'], 'venture.share.revoke': ['approve', 'i'],
  'venture.delivery.judge': ['prepare', 'o'], 'venture.delivery.judgeSend': ['approve', 'o'], 'venture.improve.rollback': ['approve', 'u'],
  'venture.files.transcribe': ['prepare', 'i'],
  'venture.posting.propose': ['prepare', 'u'], 'venture.posting.signIn': ['approve', 'o'], 'venture.posting.checkSteps': ['approve', 'o'],
  'venture.share.recordAnswer': ['approve', ''], 'venture.social.calendar': ['read', 'rui'],
  'venture.bank.ledger': ['read', 'rui'], 'venture.bank.apply': ['prepare', ''], 'venture.bank.alerts.get': ['read', 'rui'], 'venture.bank.alerts.set': ['admin', 'ui'],
  'venture.ca.receipt': ['read', 'rui'], 'venture.ca.explainDiff': ['approve', ''], 'venture.rules.list': ['read', 'rui'],
  'venture.judge.auto.get': ['read', 'rui'], 'venture.judge.auto.set': ['approve', 'ui'],
  'venture.posting.limits.get': ['read', 'rui'], 'venture.posting.limits.set': ['approve', 'ui'],
  'venture.transcription.get': ['read', 'rui'], 'venture.transcription.set': ['approve', 'ui'],
  'venture.ai.options': ['read', 'rui'], 'venture.ai.connect': ['approve', 'uio'], 'venture.ai.disconnect': ['approve', 'ui'], 'venture.ai.status': ['read', 'rui'],
  'venture.ai.calls': ['read', 'rui'], 'venture.compose.decide': ['approve', 'u'], 'venture.compose.fill': ['prepare', 'uo'], 'venture.compose.get': ['read', 'rui'],
  'venture.compose.update': ['prepare', 'u'],
});

/** Wave 4's methods: the flags; the level is W4_METHOD_LEVELS. Every read is 'rui'. */
const W4_FLAGS: Readonly<Record<W4Method, Flags>> = Object.freeze({
  'venture.team.keeper': 'rui', 'venture.team.clearQuarantine': 'i',
  'venture.agents.thread.list': 'rui', 'venture.agents.thread.send': 'o', 'venture.agents.proposal.decide': 'u', 'venture.agents.version.undo': 'u',
  'venture.agents.orders.list': 'rui', 'venture.chats.consent': 'ui',
  'venture.agents.notes.list': 'rui', 'venture.agents.notes.edit': 'u', 'venture.agents.notes.forget': 'u', 'venture.agents.notes.undo': 'u',
  'venture.chief.threads': 'rui', 'venture.chief.thread.list': 'rui', 'venture.chief.thread.send': 'o', 'venture.chief.thread.pin': 'ui', 'venture.chief.fit': 'u',
  'venture.proposals.raise': 'i', 'venture.proposals.dismiss': 'i',
  'venture.network.import': 'u', 'venture.network.importUndo': '', 'venture.network.merge': 'u', 'venture.network.split': 'u', 'venture.network.forget': '',
  'venture.network.hide': 'ui', 'venture.network.people': 'rui', 'venture.network.person': 'rui', 'venture.network.sources': 'rui',
  'venture.network.recompute': 'ui', 'venture.network.know': 'u', 'venture.network.link': 'u',
  'venture.network.search': 'o', 'venture.network.searchMore': 'o', 'venture.network.saveSearch': 'u', 'venture.network.research': 'o',
  'venture.pipeline.list': 'rui', 'venture.pipeline.followups': 'rui', 'venture.pipeline.add': '', 'venture.pipeline.setNext': 'ui', 'venture.pipeline.move': '',
  'venture.pipeline.settings': 'ui',
  'venture.outreach.draft': 'uo', 'venture.outreach.open': 'rui', 'venture.outreach.sent': 'i', 'venture.outreach.restricted': 'ui',
  'venture.mailbox.connect': 'uio', 'venture.mailbox.disconnect': 'ui', 'venture.mailbox.sync': 'io', 'venture.inbound.list': 'rui', 'venture.inbound.confirm': '',
  'venture.network.calendar': 'uio', 'venture.meeting.digest': 'o',
  'venture.runs.stop': 'i', 'venture.runs.resume': '', 'venture.runs.roundGate': 'ui', 'venture.runs.steer': '', 'venture.business.pause': 'ui',
  'venture.away.set': 'ui', 'venture.away.get': 'rui', 'venture.runs.allowWrites': 'u',
  'venture.notify.list': 'rui', 'venture.notify.read': 'ui', 'venture.notify.settings': 'ui',
  'venture.notify.push.key': 'rui', 'venture.notify.push.subscribe': 'ui', 'venture.notify.push.unsubscribe': 'ui', 'venture.notify.relay': 'ui',
  'venture.models.cli.status': 'rui', 'venture.models.roles': 'rui',
  'venture.goals.get': 'rui', 'venture.goals.set': 'ui', 'venture.goals.suggest': 'ui',
  'venture.decisions.list': 'rui', 'venture.policy.allowSession': 'u',
  'venture.queue.sendBack': '', 'venture.queue.edit': 'u', 'venture.queue.undo': 'u', 'venture.queue.set': '', 'venture.triage.set': 'ui', 'venture.triage.preview': 'ui',
  'venture.delivery.fix': 'o', 'venture.delivery.decideChange': '', 'venture.delivery.changes': 'rui', 'venture.settings.draft': 'u', 'venture.settings.drafts': 'rui',
  'venture.queue.setPreview': 'rui', 'venture.delivery.copy': 'u',
  'venture.files.poster': 'ui',
  'venture.money.aging': 'rui', 'venture.money.flow': 'rui', 'venture.money.cash': 'rui', 'venture.money.margins': 'rui', 'venture.money.export': 'i',
  'venture.bills.add': '', 'venture.bills.pay': '', 'venture.bills.list': 'rui', 'venture.credit.issue': '', 'venture.invoice.recurring': 'u',
  'venture.invoice.recurringList': 'rui', 'venture.invoice.remind': 'u', 'venture.payment.clear': '', 'venture.bills.stop': 'u',
  'venture.money.across': 'rui', 'venture.runs.across': 'rui',
  'venture.connectors.check': 'io', 'venture.share.request': 'uo',
  'venture.playbooks.list': 'rui', 'venture.blueprint.suggest': 'uo',
  'venture.owner.get': 'rui', 'venture.owner.set': 'ui',
  'venture.receipt.verify': 'rui', 'venture.journal.chain': 'rui', 'venture.journal.acceptBreak': '',
  'venture.order.contract': 'rui', 'venture.order.contract.propose': 'u', 'venture.order.contract.sign': '',
  'venture.routines.list': 'rui', 'venture.routines.runs': 'rui', 'venture.routines.set': 'ui', 'venture.routines.remove': '',
  'venture.options.rerank': 'rui',
  'venture.drills.run': 'u', 'venture.drills.list': 'rui', 'venture.auto.readiness': 'rui', 'venture.shadow.summary': 'rui',
  'venture.playbook.guidance': 'rui',
  'venture.voice.get': 'rui', 'venture.voice.set': 'ui', 'venture.voice.learn': 'uo', 'venture.persona.get': 'rui', 'venture.persona.set': 'ui', 'venture.persona.test': 'uo',
  'venture.agents.export': 'rui', 'venture.agents.import': 'u',
  'venture.knowledge.list': 'rui', 'venture.knowledge.add': 'u', 'venture.knowledge.remove': '', 'venture.knowledge.test': 'uo',
  'venture.ideas.list': 'rui', 'venture.ideas.start': '', 'venture.ideas.dismiss': 'u', 'venture.agents.capabilities': 'rui',
});

/**
 * Wave 5's methods (package 5-0): the flags; the level is W5_METHOD_LEVELS. Every read is 'rui'. A desk action may
 * reach outside, so it says so until each package's own actions are known.
 */
const W5_FLAGS: Readonly<Record<W5Method, Flags>> = Object.freeze({
  'venture.order.chain': 'rui',
  'venture.salesProposal.draft': 'uo', 'venture.salesProposal.get': 'rui', 'venture.goNoGo.card': 'u',
  'venture.ideas.add': 'u', 'venture.ideas.move': '', 'venture.ideas.grade': '',
  'venture.brandKit.get': 'rui', 'venture.brandKit.set': 'ui', 'venture.assets.list': 'rui', 'venture.assets.rerun': 'o', 'venture.assets.reuse': 'u',
  'venture.voiceConsent.record': '', 'venture.voiceConsent.revoke': 'i', 'venture.voiceConsent.list': 'rui',
  'venture.report.render': 'ui', 'venture.report.share': 'uo', 'venture.report.shareRotate': '', 'venture.report.shareDisable': 'i',
  'venture.monitors.list': 'rui', 'venture.monitors.add': 'uo', 'venture.monitors.remove': 'i', 'venture.mail.import': 'u', 'venture.mail.threads': 'rui',
  'venture.localApps.list': 'rui', 'venture.webhook.set': 'ui', 'venture.speechOut.providers': 'rui',
  'venture.ca.confirmCitations': '', 'venture.ca.signoff.get': 'rui', 'venture.ca.differential.add': '', 'venture.ca.dataPack.export': 'i',
  'venture.desk.list': 'rui', 'venture.desk.get': 'rui', 'venture.desk.act': 'o',
});

const hintOf = (flags: Flags): MethodHint => Object.freeze({
  readOnly: flags.includes('r'), undoable: flags.includes('u'), idempotent: flags.includes('i'), reachesOutside: flags.includes('o'),
});
const w4 = (method: VentureMethod): method is W4Method => Object.hasOwn(W4_FLAGS, method);
const w5 = (method: VentureMethod): method is W5Method => Object.hasOwn(W5_FLAGS, method);

/** Each method's level: wave 4's from W4_METHOD_LEVELS, wave 5's from W5_METHOD_LEVELS, the rest from their handlers. */
export const METHOD_LEVEL_OF: Readonly<Record<VentureMethod, HintLevel>> = Object.freeze(Object.fromEntries(
  VENTURE_METHODS.map(method => [method, w4(method) ? W4_METHOD_LEVELS[method] : w5(method) ? W5_METHOD_LEVELS[method] : BEFORE_W4[method][0]]),
) as Record<VentureMethod, HintLevel>);

/** The hints, in VENTURE_METHODS order: one per venture method, made from that list, so none can be missing. */
export const METHOD_HINTS: Readonly<Record<VentureMethod, MethodHint>> = Object.freeze(Object.fromEntries(
  VENTURE_METHODS.map(method => [method, hintOf(w4(method) ? W4_FLAGS[method] : w5(method) ? W5_FLAGS[method] : BEFORE_W4[method][1])]),
) as Record<VentureMethod, MethodHint>);
