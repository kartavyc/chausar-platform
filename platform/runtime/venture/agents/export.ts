// Chausar venture launcher, agents (Ink v2 wave 4, package 4J17, catalogue A18): exporting and importing an agent. The
// export is one plain JSON file of what makes the agent: its steps (ids, kinds, titles and guidance), its persona and
// its standing orders (agents/versions.ts), and nothing else. It never holds the agent's notes, a client's or a
// contact's name (each becomes "the client" or "someone"), an email address or phone number, a key, or a card, bank,
// Aadhaar or one-time code number, and it reads only the open business, never another one's records. An import reads
// such a file as untrusted content: every word passes the untrusted screen (UNTRUSTED_HELD), the persona passes the
// persona rules, and the standing orders pass the owner rules of applyPatch on this agent's own steps. It becomes a
// proposal in the agent's thread (4B1's store, kind 'import'), never a direct change: accepting writes a new playbook
// version with the orders and a new persona version (both undoable as usual); rejecting changes nothing; a file
// drafted against a version that changed since is stale. Export here, import in another business: the agent duplicated.
import { ChausarError, check, newId, type Context, type State } from '../../contracts.ts';
import type {
  AgentExportFile, AgentProposalDecision, AgentProposalRecord, AgentProposalView, DiffLine, PersonaFields, PlaybookPatch, PlaybookRecord, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { digest, exactPayload, identifier, listRecords, plainText, requireAppChannel, tidyWords, ventureAction, type VentureTx } from '../records.ts';
import { screenReadback, secretFindings } from '../core/secrets.ts';
import { screenUntrusted } from '../policy/untrusted.ts';
import { applyPatch, type PlaybookBody } from '../delivery/harness/patches.ts';
import { dictionaryEntries } from '../delivery/harness/dictionary.ts';
import { currentPlaybook, ensurePlaybook, ownerVersion } from '../delivery/playbook.ts';
import { readAs } from '../delivery/shared.ts';
import { maskContacts } from '../network/protected.ts';
import { listPeople } from '../network/store.ts';
import { appendAgentMessage } from './store.ts';
import { chatAgent, type ChatAgent } from './roles.ts';
import { ownerLines, standingOrders } from './versions.ts';
import { proposalView } from './proposals.ts';
import { checkPersona, NO_PERSONA, personaInUse, writePersonaVersion } from './persona.ts';

/** What an agent file says it is, and the shape this build reads. */
export const AGENT_FILE_FORMAT = 'chausar-agent';
const AGENT_FILE_VERSION = 1;
const MAX_FILE_CHARS = 100_000;
const MAX_ORDERS = 40;
const CLIENT_WORDS = 'the client';
const PERSON_WORDS = 'someone';
const COMPANY_WORDS = 'a company';
/** A GSTIN and a PAN by their shape: two digits, a PAN, an entity digit, Z and a check letter; five letters, four digits, a letter. */
// Written whole or with spaces or hyphens between its parts ("27 ABCDE 1234 F1Z5").
const GSTIN_SHAPE = /\b[0-9]{2}[\s-]?[a-z]{5}[\s-]?[0-9]{4}[\s-]?[a-z][\s-]?[0-9a-z][\s-]?z[\s-]?[0-9a-z]\b/gi;
const PAN_SHAPE = /\b[a-z]{5}[0-9]{4}[a-z]\b/gi;
const NOT_A_FILE = 'That is not an agent file from Chausar. Export one from an agent, then import that file.';
const IMPORT_REPLY = 'You imported an agent file. Here is what it would change. Nothing changes until you accept it.';

type AgentFile = {
  format: typeof AGENT_FILE_FORMAT;
  version: typeof AGENT_FILE_VERSION;
  agent: { id: string; name: string; job: string };
  flagship: string | null;
  steps: { id: string; kind: string; title: string; guidance: string[] }[];
  persona: PersonaFields;
  standingOrders: { stepId: string; text: string }[];
};

// ---------------------------------------------------------------------------
// Export: no client data, no keys, no notes
// ---------------------------------------------------------------------------

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EDGE = '[\\p{L}\\p{M}\\p{Nd}]';

/** Every name the file must not hold, longest first: the business's clients (and each part of a name), then its contacts. */
function namesOf(state: State, venture: VentureRecord): { name: string; words: string }[] {
  const names: { name: string; words: string }[] = [];
  const add = (name: string, words: string) => {
    for (const part of [name, ...name.split(/\s+/).filter(item => item.length >= 3)]) if (part.trim()) names.push({ name: part.trim(), words });
  };
  for (const client of listRecords(state, 'venture-client', venture.id)) add(client.name, CLIENT_WORDS);
  for (const person of listPeople(state, venture.id)) add(person.name, PERSON_WORDS);
  // Leads found for outreach: the person and their company.
  for (const lead of listRecords(state, 'venture-lead', venture.id)) {
    if (typeof lead.name === 'string') add(lead.name, PERSON_WORDS);
    if (typeof lead.company === 'string' && lead.company) add(lead.company, COMPANY_WORDS);
  }
  return names.sort((a, b) => b.name.length - a.name.length);
}

/**
 * A line as the file keeps it: keys and id numbers out, email addresses and phone numbers masked, and every client's
 * or contact's name replaced, so "Keep Asha Rao's hooks short" becomes "Keep the client's hooks short". Null when a key
 * shape is still in it after that.
 */
function clean(text: string, names: readonly { name: string; words: string }[]): string | null {
  let out = maskContacts(screenReadback(text.replace(GSTIN_SHAPE, '[GSTIN]').replace(PAN_SHAPE, '[PAN]')).text);
  for (const item of names) out = out.replace(new RegExp(`(?<!${EDGE})${escaped(item.name)}(?!${EDGE})`, 'giu'), item.words);
  out = tidyWords(out.replace(new RegExp(`${escaped(CLIENT_WORDS)}(?:\\s+${escaped(CLIENT_WORDS)})+`, 'g'), CLIENT_WORDS));
  return secretFindings(out).length ? null : out;
}

function cleanPersona(persona: PersonaFields, names: readonly { name: string; words: string }[]): PersonaFields {
  const one = (text: string | null) => (text === null ? null : clean(text, names));
  return {
    tone: one(persona.tone), replyLength: persona.replyLength, greeting: one(persona.greeting), handOffLine: one(persona.handOffLine),
    blockedTopics: persona.blockedTopics.flatMap(topic => clean(topic, names) ?? []), signOff: one(persona.signOff),
  };
}

/** The agent file: steps, persona and standing orders of this business's agent, cleaned line by line. */
export function agentFile(state: State, venture: VentureRecord, agent: ChatAgent): AgentFile {
  const names = namesOf(state, venture);
  const orders = standingOrders(state, venture, agent);
  return {
    format: AGENT_FILE_FORMAT, version: AGENT_FILE_VERSION,
    agent: { id: agent.id, name: agent.name, job: clean(agent.job, names) ?? '' },
    flagship: agent.flagship?.id ?? null,
    steps: agent.steps.map(step => ({ id: step.id, kind: step.kind, title: clean(step.title, names) ?? '', guidance: (step.guidance ?? []).flatMap(line => clean(line, names) ?? []) })),
    persona: cleanPersona(personaInUse(state, venture, agent.id)?.persona ?? NO_PERSONA, names),
    standingOrders: orders.flatMap(order => { const text = clean(order.text, names); return text ? [{ stepId: order.stepId, text }] : []; }),
  };
}

/** venture.agents.export { agent } (read): the agent file, with no notes, client data, keys or other businesses' records. */
export async function agentsExportHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AgentExportFile> {
  const body = exactPayload(payload, ['agent'], ['agent']);
  const agentId = identifier(body.agent, 'Agent');
  const { state, venture } = readAs(deps, ctx, 'read');
  const agent = chatAgent(state, venture, agentId);
  return { fileName: `chausar-agent-${agent.id}.json`, text: JSON.stringify(agentFile(state, venture, agent), null, 2) };
}

// ---------------------------------------------------------------------------
// Import: untrusted, and only ever a proposal
// ---------------------------------------------------------------------------

/** The file's words, each screened as untrusted content; one aimed at an agent or a checker holds the whole file. */
function screened(text: unknown, field: string): string {
  check(typeof text === 'string', 'INVALID_VENTURE_REQUEST', NOT_A_FILE);
  const result = screenUntrusted({ source: 'client-file', text: text as string }, { mode: 'enforce' });
  if (result.status === 'quarantined' || result.text === null) {
    throw new ChausarError('UNTRUSTED_HELD', `The ${field} in this file has words aimed at an agent or a checker, or hidden characters, so nothing from it was imported.`);
  }
  return tidyWords(result.text);
}

const FILE_FIELDS = ['format', 'version', 'agent', 'flagship', 'steps', 'persona', 'standingOrders'] as const;
const STEP_FIELDS = ['id', 'kind', 'title', 'guidance'] as const;

/** The file as this build reads it: its shape checked, every word screened. Anything else is not an agent file. */
function readFile(text: string): { agentId: string; persona: unknown; orders: { stepId: string; text: string }[] } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new ChausarError('INVALID_VENTURE_REQUEST', NOT_A_FILE); }
  const file = raw as Partial<AgentFile> | null;
  check(!!file && typeof file === 'object' && !Array.isArray(file) && file.format === AGENT_FILE_FORMAT && file.version === AGENT_FILE_VERSION, 'INVALID_VENTURE_REQUEST', NOT_A_FILE);
  // Only the fields an export writes: a file that brings tools, a posture, limits, grants or anything else is refused,
  // and a step may carry only its id, kind, title and guidance (shown for reading; an import never changes a step).
  check(Object.keys(file).every(key => (FILE_FIELDS as readonly string[]).includes(key)), 'INVALID_VENTURE_REQUEST', `${NOT_A_FILE} It holds fields an agent file never has, such as tools, limits or a posture.`);
  check(Array.isArray(file.steps) && file.steps.every(step => !!step && typeof step === 'object' && !Array.isArray(step) && Object.keys(step).every(key => (STEP_FIELDS as readonly string[]).includes(key))),
    'INVALID_VENTURE_REQUEST', `${NOT_A_FILE} A step in it holds more than its id, kind, title and guidance.`);
  check(!!file.agent && typeof file.agent === 'object' && typeof file.agent.id === 'string' && Object.keys(file.agent).every(key => ['id', 'name', 'job'].includes(key)), 'INVALID_VENTURE_REQUEST', NOT_A_FILE);
  check(Array.isArray(file.standingOrders) && file.standingOrders.length <= MAX_ORDERS, 'INVALID_VENTURE_REQUEST', NOT_A_FILE);
  const orders = file.standingOrders.map(order => {
    check(!!order && typeof order === 'object' && typeof order.stepId === 'string' && Object.keys(order).every(key => key === 'stepId' || key === 'text'), 'INVALID_VENTURE_REQUEST', NOT_A_FILE);
    return { stepId: identifier(order.stepId, 'Step'), text: screened(order.text, 'standing order') };
  });
  const persona = file.persona && typeof file.persona === 'object' ? file.persona as Record<string, unknown> : null;
  check(persona, 'INVALID_VENTURE_REQUEST', NOT_A_FILE);
  const words = (value: unknown, field: string) => (typeof value === 'string' && value.trim() ? screened(value, field) : value);
  return {
    agentId: identifier(file.agent.id, 'Agent'), orders,
    persona: {
      ...persona, tone: words(persona.tone, 'tone'), greeting: words(persona.greeting, 'greeting'), handOffLine: words(persona.handOffLine, 'hand-off line'), signOff: words(persona.signOff, 'sign-off'),
      blockedTopics: Array.isArray(persona.blockedTopics) ? persona.blockedTopics.map(topic => words(topic, 'blocked topic')) : persona.blockedTopics,
    },
  };
}

function bodyOf(playbook: PlaybookRecord): PlaybookBody {
  return { steps: structuredClone(playbook.steps), limits: structuredClone(playbook.limits!), aliases: structuredClone(playbook.aliases ?? {}) };
}

/** applyPatch's context for an owner patch on this agent's steps, as 4B1's chat uses (agents/proposals.ts). */
function ownerContext(state: State, venture: VentureRecord, agent: ChatAgent, playbook: PlaybookRecord) {
  return {
    serviceType: playbook.serviceType, entryIds: dictionaryEntries(state, venture).map(entry => entry.id), flagship: playbook.flagship ?? null,
    owner: { steps: agent.stepIds, added: ownerLines(state, agent, playbook) },
  };
}

const samePersona = (a: PersonaFields, b: PersonaFields) => JSON.stringify(a) === JSON.stringify(b);

/** The persona as diff lines the owner reads. */
function personaLines(persona: PersonaFields): DiffLine[] {
  const parts = [
    persona.tone ? `tone "${persona.tone}"` : null, persona.replyLength ? `${persona.replyLength} replies` : null, persona.greeting ? `greeting "${persona.greeting}"` : null,
    persona.handOffLine ? `hand-off line "${persona.handOffLine}"` : null, persona.blockedTopics.length ? `stays away from ${persona.blockedTopics.join(', ')}` : null,
    persona.signOff ? `sign-off "${persona.signOff}"` : null,
  ].filter((part): part is string => part !== null);
  return [{ op: 'add', text: parts.length ? `How I talk: ${parts.join('; ')}.` : 'How I talk: no persona, the way my role says.' }];
}

/**
 * venture.agents.import { text } (prepare, app only): an agent file read as untrusted, for the agent with the same id
 * on this team (AGENT_NOT_FOUND otherwise). Its standing orders not in use yet become owner patches on this agent's own
 * steps, each checked by applyPatch's owner rules now and again at Accept (one that does not apply is left out, with
 * why); its persona passes the persona rules (PERSONA_FIELD_REFUSED). Stored as a drafted proposal of kind 'import' in
 * the agent's thread; nothing changes until the owner accepts it. A file with nothing new is refused.
 */
export async function agentsImportHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ proposal: AgentProposalView }> {
  requireAppChannel(ctx, 'venture.agents.import');
  const body = exactPayload(payload, ['text'], ['text']);
  const text = plainText(body.text, 'The agent file', { min: 2, max: MAX_FILE_CHARS });
  const file = readFile(text);
  const persona = checkPersona(file.persona);
  const { state, venture: open } = readAs(deps, ctx, 'prepare');
  chatAgent(state, open, file.agentId);
  await ensurePlaybook(deps, ctx);
  return ventureAction(deps, ctx, 'prepare', 'agents.import', tx => {
    const venture = tx.venture!;
    const agent = chatAgent(tx.state, venture, file.agentId);
    const playbook = currentPlaybook(tx.state, venture);
    check(playbook, 'INVALID_VENTURE_REQUEST', 'Accept your plan first.');
    const context = ownerContext(tx.state, venture, agent, playbook);
    let after = bodyOf(playbook);
    const patches: PlaybookPatch[] = [];
    const skipped: string[] = [];
    for (const order of file.orders) {
      if (!agent.stepIds.includes(order.stepId)) { skipped.push(`"${order.text}" is for a step ${agent.name} does not do here.`); continue; }
      if ((after.steps.find(step => step.id === order.stepId)?.guidance ?? []).includes(order.text)) continue;
      const patch: PlaybookPatch = {
        id: newId('patch'), level: 'harness', op: 'guidance.add', stepId: order.stepId, value: order.text,
        note: { hypothesis: 'You imported this from an agent file.', expectedFixes: [], likelyRegressions: [] }, proposedBy: 'owner', parentHash: playbook.hash,
        // The file's words are the quote the owner rules hold the line to; the thread message id is set below.
        source: { messageId: '', quote: order.text },
      };
      try {
        const next = applyPatch(after, patch, context);
        const before = after.steps.find(step => step.id === order.stepId)?.guidance ?? [];
        patch.value = (next.steps.find(step => step.id === order.stepId)?.guidance ?? []).find(line => !before.includes(line)) ?? patch.value;
        after = next;
        patches.push(patch);
      } catch (error) {
        skipped.push(`"${order.text}" was left out: ${error instanceof Error ? error.message : 'it does not apply.'}`);
      }
    }
    const current = personaInUse(tx.state, venture, agent.id)?.persona ?? NO_PERSONA;
    const personaChange = samePersona(current, persona) ? null : persona;
    check(patches.length || personaChange, 'INVALID_VENTURE_REQUEST', `This file holds nothing new for ${agent.name}.${skipped.length ? ` ${skipped[0]}` : ''}`);
    const message = appendAgentMessage(tx, { agent: agent.id, from: 'agent', text: IMPORT_REPLY, author: 'engine' });
    tx.emit('agent.message', { agent: agent.id, messageId: message.id });
    for (const patch of patches) patch.source = { messageId: message.id, quote: patch.source?.quote ?? patch.value };
    const versions = tx.list('venture-playbook').map(record => record.version);
    const record: AgentProposalRecord = {
      ...tx.base('venture-agent-proposal'), agent: agent.id, proposalKind: 'import', quote: 'An agent file you imported.', quoteDigest: digest(text),
      messageId: message.id, patch: null, fromVersion: playbook.version, toVersion: patches.length ? Math.max(0, ...versions) + 1 : null, parentHash: playbook.hash,
      diff: [...patches.map(patch => ({ op: 'add' as const, text: patch.value })), ...(personaChange ? personaLines(personaChange) : [])],
      appliesTo: `Applies to ${agent.name} from the next run.${skipped.length ? ` Left out: ${skipped.join(' ')}` : ''}`, note: null, label: null,
      status: 'drafted', digest: '', decidedAt: null, decidedBy: null, imported: { patches, persona: personaChange, skipped },
    };
    record.digest = digest({ id: record.id, agent: record.agent, imported: record.imported, parentHash: record.parentHash, fromVersion: record.fromVersion, toVersion: record.toVersion });
    tx.put(record);
    return { proposal: proposalView(tx.state, venture, record, agent.name) };
  });
}

/**
 * The import kind's decision (called from 4B1's venture.agents.proposal.decide, after its stale check). Accept writes
 * one new playbook version with the file's orders, each checked again under the owner rules, and a new persona version
 * (source 'import'); the agent says so in its thread. Reject stores the decision and changes nothing.
 */
export function decideImport(tx: VentureTx, record: AgentProposalRecord, decision: 'accept' | 'reject'): AgentProposalDecision {
  const venture = tx.venture!;
  const agent = chatAgent(tx.state, venture, record.agent);
  const decided = { decidedAt: tx.now, decidedBy: tx.ctx.memberId };
  if (decision === 'reject') {
    const stored = tx.replace<AgentProposalRecord>({ ...record, status: 'rejected', ...decided });
    return { proposal: proposalView(tx.state, venture, stored, agent.name), line: 'You said no, so nothing changed.' };
  }
  const current = currentPlaybook(tx.state, venture)!;
  const imported = record.imported ?? { patches: [], persona: null, skipped: [] };
  let made: PlaybookRecord | null = null;
  if (imported.patches.length) {
    let after = bodyOf(current);
    for (const patch of imported.patches) after = applyPatch(after, patch, ownerContext(tx.state, venture, agent, current));
    made = ownerVersion(tx, current, after, [...(current.patches ?? []), ...imported.patches], { proposalId: record.id });
  }
  if (imported.persona) writePersonaVersion(tx, agent, imported.persona, 'import');
  const stored = tx.replace<AgentProposalRecord>({ ...record, status: 'accepted', toVersion: made?.version ?? null, ...decided });
  const line = made ? `Version ${made.version} is in use from the next run, with the orders from the file. You can undo it.` : 'The persona from the file is in use from the next run. You can undo it.';
  const message = appendAgentMessage(tx, { agent: agent.id, from: 'agent', text: line, author: 'engine', proposalId: record.id });
  tx.emit('agent.message', { agent: agent.id, messageId: message.id });
  return { proposal: proposalView(tx.state, venture, stored, agent.name), line, ...(made ? { playbook: { id: made.id, version: made.version } } : {}) };
}
