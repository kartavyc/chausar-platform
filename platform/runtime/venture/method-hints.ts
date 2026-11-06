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
import { VENTURE_METHODS, W4_METHOD_LEVELS, W5_METHOD_LEVELS } from './contract-values.ts';
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
  'venture.agentSettings.get': ['read', 'rui'], 'venture.agentSettings.set': ['approve', 'ui'], 'venture.mcpCredential.set': ['admin', 'i'],
  'venture.mcpRegistry.list': ['read', 'rui'], 'venture.mcpOAuth.start': ['admin', 'uo'],
  'venture.packs.list': ['read', 'rui'], 'venture.packs.add': ['approve', 'u'], 'venture.packs.remove': ['approve', 'i'],
  'venture.agentApproval.decide': ['approve', ''],
  'venture.price.quote': ['prepare', 'ui'], 'venture.receipt.get': ['read', 'rui'],
  'venture.client.add': ['prepare', ''], 'venture.client.list': ['read', 'rui'],
  'venture.client.aiConsent.get': ['read', 'rui'], 'venture.client.aiConsent.agree': ['approve', 'u'], 'venture.client.aiConsent.withdraw': ['approve', 'i'],
  'venture.notify.telegram': ['approve', 'uo'], 'venture.phone.access': ['approve', 'uo'],
  'venture.web.search': ['approve', 'u'], 'venture.web.read': ['prepare', 'uio'], 'venture.people.services': ['approve', 'u'], 'venture.people.lookup': ['approve', 'o'],
  // W6 6G1: a chat's state and the quiet days before one settles; each answer carries its exact Undo.
  'venture.chief.thread.state': ['prepare', 'ui'], 'venture.chief.settle.set': ['prepare', 'ui'],
  // W6 6H3: a place's layout; each change carries its exact Undo.
  'venture.layout.get': ['read', 'rui'], 'venture.layout.change': ['prepare', 'ui'],
  // C2: the command bar's find; it reads the lists the owner reads and writes nothing.
  'venture.find': ['read', 'rui'],
  'venture.diagnostics.today': ['read', 'rui'],
  'venture.build.briefFile': ['prepare', 'u'],
  'venture.accountant.pack.done': ['prepare', 'ui'],
  'venture.accountant.schedule.set': ['approve', 'ui'],
  'venture.accountant.schedule.get': ['read', 'rui'],
  'venture.accountant.set': ['prepare', 'ui'],
  'venture.accountant.get': ['read', 'rui'],
  'venture.notify.telegram.findChat': ['prepare', 'uio'],
  'venture.client.aiDefault.set': ['approve', 'ui'],
  'venture.client.aiDefault.get': ['read', 'rui'],
  'venture.away.preview': ['read', 'rui'],
  'venture.team.introduced': ['read', 'rui'],
  // W6 6H2: recorded flows. A run touches the website in the desktop's window; its submits go through the journal.
  'venture.flows.list': ['read', 'rui'], 'venture.flows.act': ['approve', 'o'],
  // W6 6G3: CRM reads, and owner edits whose every change is kept in the field history; 6G4: dated memory facts.
  'venture.crm.client': ['read', 'rui'], 'venture.crm.client.edit': ['prepare', 'u'], 'venture.crm.companies': ['read', 'rui'], 'venture.crm.company': ['read', 'rui'],
  'venture.crm.company.save': ['prepare', 'u'], 'venture.crm.link': ['prepare', 'ui'], 'venture.crm.log': ['prepare', ''], 'venture.crm.lists': ['read', 'rui'],
  'venture.crm.list': ['read', 'rui'], 'venture.crm.list.save': ['prepare', 'u'], 'venture.crm.list.place': ['prepare', 'ui'],
  'venture.memory.list': ['read', 'rui'], 'venture.memory.add': ['prepare', 'u'], 'venture.memory.replace': ['prepare', 'u'],
  'venture.memory.visibility': ['approve', 'ui'], 'venture.memory.forget': ['approve', ''],
  // W6 6G2: retiring is undone by Bring back, and Bring back by retiring again.
  'venture.agents.retire.check': ['read', 'rui'], 'venture.agents.retire': ['approve', 'u'], 'venture.agents.restore': ['approve', 'u'],
  // W6 6H1: mini apps. Making one sends the owner's words to their AI; versions, pin and the grant each come back with
  // Undo or Turn off; the bridge reads within the grant, keeps the app's notes and raises Today cards, never a send.
  'venture.apps.list': ['read', 'rui'], 'venture.apps.get': ['read', 'rui'], 'venture.apps.make': ['prepare', 'uo'], 'venture.apps.grant': ['approve', 'ui'],
  'venture.apps.revoke': ['approve', 'ui'], 'venture.apps.restore': ['prepare', 'ui'], 'venture.apps.pin': ['prepare', 'ui'], 'venture.apps.export': ['read', 'rui'],
  'venture.apps.call': ['prepare', ''], 'venture.apps.remove': ['approve', ''],
  // W6 6I1: push-to-talk. Hearing may send the recording to Sarvam; reading aloud calls the owner's speech provider.
  'venture.talk.get': ['read', 'rui'], 'venture.talk.consent': ['approve', 'ui'], 'venture.talk.setup': ['approve', 'ui'], 'venture.talk.start': ['prepare', 'u'],
  'venture.talk.hear': ['approve', 'o'], 'venture.talk.say': ['approve', 'o'],
  // W6 6J2: feedback. Turning reports on or off comes back with its opposite; Send report and Delete my reports reach PostHog and Sentry.
  'venture.feedback.get': ['read', 'rui'], 'venture.feedback.consent': ['approve', 'ui'], 'venture.feedback.send': ['approve', 'o'],
  'venture.feedback.answer': ['prepare', ''], 'venture.feedback.crash': ['prepare', ''], 'venture.feedback.delete': ['approve', 'o'],
  'venture.billing.get': ['read', 'rui'], 'venture.billing.set': ['approve', 'ui'], 'venture.invoice.pdf': ['prepare', 'ui'], 'venture.payment.receipt': ['read', 'rui'], 'venture.invoice.payLink': ['approve', 'o'],
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
  'venture.delivery.run': ['prepare', ''], 'venture.delivery.review': ['approve', ''], 'venture.delivery.list': ['read', 'rui'],
  'venture.capabilities': ['read', 'rui'],
  'venture.files.add': ['prepare', ''], 'venture.files.list': ['read', 'rui'], 'venture.work.get': ['read', 'rui'],
  'venture.improve.status': ['read', 'rui'], 'venture.improve.run': ['prepare', 'o'], 'venture.improve.get': ['read', 'rui'], 'venture.improve.adopt': ['approve', 'u'],
  'venture.delegate.get': ['read', 'rui'],
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
  'venture.rules.locks': ['read', 'rui'], 'venture.rules.attest': ['approve', ''], 'venture.compliance.get': ['read', 'rui'], 'venture.compliance.set': ['approve', ''],
  'venture.judge.auto.get': ['read', 'rui'], 'venture.judge.auto.set': ['approve', 'ui'],
  'venture.posting.limits.get': ['read', 'rui'], 'venture.posting.limits.set': ['approve', 'ui'],
  'venture.transcription.get': ['read', 'rui'], 'venture.transcription.set': ['approve', 'ui'],
  'venture.ai.options': ['read', 'rui'], 'venture.ai.connect': ['approve', 'uio'], 'venture.ai.disconnect': ['approve', 'ui'], 'venture.ai.status': ['read', 'rui'],
  'venture.ai.calls': ['read', 'rui'], 'venture.compose.decide': ['approve', 'u'], 'venture.compose.fill': ['prepare', 'uo'], 'venture.compose.get': ['read', 'rui'],
  'venture.compose.update': ['prepare', 'u'],
  'venture.country.suggest': ['approve', 'u'],
  // Wave 6: the tools' own sign-in (it reaches the tool's site), About you (it may ask the owner's AI), the needs list.
  'venture.ai.tools': ['read', 'rui'], 'venture.ai.login.start': ['approve', 'uo'], 'venture.ai.login.cancel': ['approve', 'ui'],
  'venture.about.read': ['approve', 'uo'], 'venture.about.pick': ['read', 'rui'], 'venture.about.families': ['read', 'rui'],
  'venture.needs.list': ['read', 'rui'],
  // A2: the owner's yes to the Codex found on this computer; it writes only Chausar's own trust folder.
  'venture.ai.setup.trust': ['approve', 'ui'],
  // D5: only the click in main's own dialog installs; the download reaches Anthropic's site.
  'venture.ai.claude.install': ['approve', 'uo'], 'venture.ai.claude.progress': ['read', 'rui'],
  // One-shot C3: which step long work is on; a read, and it never touches the vault.
  'venture.work.list': ['read', 'rui'],
  // One-shot C4 (T20): a note on the invoice of a share the owner made; it sends nothing.
  'venture.invoice.shared': ['prepare', ''],
  // One-shot C4 (T32): the ready routines from the plan; a read that stores nothing.
  'venture.routines.suggestions': ['read', 'rui'],
  'venture.agents.hire.duties': ['approve', 'u'],
  'venture.events.calKey.set': ['approve', 'ui'],
  'venture.events.relay.set': ['approve', 'ui'],
  'venture.events.get': ['read', 'rui'],
  'venture.agents.hire.cancel': ['prepare', 'u'],
  'venture.agents.hire.confirm': ['approve', 'u'],
  'venture.agents.hire.answer': ['prepare', 'o'],
  'venture.agents.hire.start': ['prepare', 'o'],
  'venture.trackers.rows.undo': ['prepare', 'u'],
  'venture.trackers.rows.remove': ['prepare', 'u'],
  'venture.trackers.rows.edit': ['prepare', 'u'],
  'venture.trackers.rows.add': ['prepare', 'u'],
  'venture.trackers.remove': ['approve', 'ui'],
  'venture.trackers.set': ['approve', 'ui'],
  'venture.trackers.get': ['read', 'rui'],
  'venture.trackers.list': ['read', 'rui'],
  'venture.routines.backup.set': ['approve', 'ui'],
  'venture.routines.backup.get': ['read', 'rui'],
  'venture.models.plan': ['read', 'rui'],
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
  'venture.salesProposal.draft': 'uo', 'venture.salesProposal.get': 'rui', 'venture.goNoGo.card': 'u', 'venture.goNoGo.list': 'rui', 'venture.goNoGo.remove': '',
  'venture.ideas.add': 'u', 'venture.ideas.move': '', 'venture.ideas.grade': '',
  'venture.brandKit.get': 'rui', 'venture.brandKit.set': 'ui', 'venture.assets.list': 'rui', 'venture.assets.rerun': 'o', 'venture.assets.reuse': 'u',
  'venture.voiceConsent.record': '', 'venture.voiceConsent.revoke': 'i', 'venture.voiceConsent.list': 'rui',
  'venture.report.render': 'u', 'venture.report.share': 'uo', 'venture.report.shareRotate': 'o', 'venture.report.shareDisable': 'i', 'venture.report.list': 'rui',
  'venture.monitors.list': 'rui', 'venture.monitors.add': 'uo', 'venture.monitors.remove': 'i', 'venture.mail.import': 'i', 'venture.mail.threads': 'rui',
  'venture.localApps.list': 'rui', 'venture.webhook.set': 'uio', 'venture.webhook.send': 'uio', 'venture.speechOut.providers': 'rui',
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
