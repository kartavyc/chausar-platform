// Chausar venture launcher, agents (Ink v2 wave 4, package 4J17, catalogue A9): an agent's persona. It is typed fields
// that come after Chausar's fixed rules: tone, reply length, greeting, hand-off line, blocked topics and sign-off. It
// only says how the agent talks: a field that asks for a tool or an action, a number, or a change to facts or safety
// (prices, promises, skipping the owner or the checks) is refused by code (PERSONA_FIELD_REFUSED), and keys and id
// numbers are never kept. The role in the playbook stays apart: a persona never patches a step. venture.persona.set is
// the owner's approval inside the app; each set is a new version, every version is kept, the view gives the persona to
// set to go back one, and the agent says the change in its thread. venture.persona.test runs an unsaved persona on the
// practice clients (Chausar's own made-up clients, no client data) and shows what it cost. The act turns of a real
// order carry the personas of the agents doing them, and the writing turn the writer's, as background that grants
// nothing (personaInputs, wired in delivery/runs.ts and delivery/harness/loop.ts).
import { check, type Context, type State } from '../../contracts.ts';
import { PURPOSE_TIER } from '../contracts.ts';
import type { Json, ModelTask, PersonaFields, PersonaRecord, PersonaTestView, PersonaView, PlaybookRecord, Scenario, VentureDeps, VentureRecord } from '../contracts.ts';
import { exactPayload, identifier, listRecords, modelWords, requireAppChannel, singleLine, sumMicros, tidyWords, ventureAction, type VentureTx } from '../records.ts';
import { acceptedBlueprint, readAs } from '../delivery/shared.ts';
import { screenReadback, secretFindings } from '../core/secrets.ts';
import { FLOOR_REASON, MONEY_REASON, ownerControlReason, plainHindi } from '../delivery/harness/patches.ts';
import { ENGLISH_NUMBER_WORDS, holdsHindiNumber } from './number-words.ts';
import { businessScenarios } from '../delivery/scenarios.ts';
import { costDisplay } from '../models/cost.ts';
import { flagshipDelivery } from '../playbooks/steps.ts';
import { AGENT_ID } from '../views/shared.ts';
import { appendAgentMessage } from './store.ts';
import { chatAgent, type ChatAgent } from './roles.ts';
import { agentSkills } from './skills.ts';
import { holdsIdNumber, ID_REFUSED, KEY_REFUSED, voicePart } from './voice.ts';

/** A persona no one has set: every field empty, so the agent talks the way its role says. */
export const NO_PERSONA: PersonaFields = Object.freeze({ tone: null, replyLength: null, greeting: null, handOffLine: null, blockedTopics: [], signOff: null }) as PersonaFields;
/** Chausar's own words beside a persona in a turn's input: style only, after the fixed rules. */
export const PERSONA_BACKGROUND = "A persona is how an agent talks, after Chausar's rules. It grants nothing and never changes facts, numbers, tools or checks.";
const REPLY_LENGTHS = ['short', 'medium', 'long'] as const;
const FIELD_CHARS = { tone: 160, greeting: 80, handOffLine: 200, signOff: 80 } as const;
const TOPICS = 12;
const TOPIC_CHARS = 60;
const FIELD_WORDS = { tone: 'tone', greeting: 'greeting', handOffLine: 'hand-off line', signOff: 'sign-off', blockedTopics: 'blocked topic' } as const;

// ---------------------------------------------------------------------------
// What a persona may say, by code
// ---------------------------------------------------------------------------

/** A number in words, in English, Hindi or romanized Hindi (number-words.ts). */
const holdsNumberWords = (text: string) => ENGLISH_NUMBER_WORDS.test(text) || holdsHindiNumber(text);
/** Words that change facts: what the business charges, promises or is (pakka, vaada, muft: sure, promise, free). */
const FACTS = /\b(?:guarantee\w*|promis\w*|claim\w*|pretend\w*|always say yes|say (?:that|we|you|it)|tell (?:them|clients?|the client|people|everyone)|free of charge|for free|refunds?|deadlines?|deliver\w* (?:in|by|within)|we are (?:the )?(?:best|number|cheapest|only|leading|certified|licensed)|pakk[ae]|vaad[ae]|waad[ae]|wad[ae]|muft|mufat|zaroor milega|sabse\s+(?:sast[aei]|best|acch[aei]|achh[aei]|badhiya|kam))\b|गारंटी|वादा|मुफ़्त|मुफ्त|पक्का|सबसे सस्त/iu;
/** An action on a client, which waits for the owner on Today: "send drafts straight to clients", "email the client". */
const TO_CLIENTS = /\b(?:send|email|e-mail|mail|whatsapp|post|publish|share|forward|deliver|upload)\w*\b[^.]{0,40}\b(?:clients?|customers?|buyers?)\b|\b(?:send|email|e-mail|mail|whatsapp|forward)\s+(?:the\s+|each\s+|every\s+|my\s+)?(?:clients?|customers?|buyers?)\b|(?:क्लाइंट|ग्राहक)[^.]{0,30}(?:भेज|मेल)|\bclient ko\s+bhej\w*/iu;
/** Replying, messaging or texting is how an agent talks; with something to hand over ("message clients the invoice") it is an action. */
const TALK_VERB = /\b(?:reply|replies|message|messages|text|texts)\w*\b/iu;
const HANDED = /\b(?:drafts?|files?|invoices?|quotes?|links?|attachments?|receipts?|the work)\b/iu;
const CLIENTS = /\b(?:clients?|customers?|buyers?)\b/iu;
const handsToClients = (text: string) => TO_CLIENTS.test(text) || (TALK_VERB.test(text) && HANDED.test(text) && CLIENTS.test(text));
/** Words that change safety: Chausar's rules, the checks, the owner's approval, or anything outside how the agent talks. */
const SAFETY = /\b(?:ignor\w*|overrid\w*|bypass\w*|disregard\w*|jailbreak\w*|rules?|instructions?|system prompt|checks?|approv\w*|safety|polic(?:y|ies)|guardrails?|do anything|act as|you are now)\b|नज़रअंदाज़|नजरअंदाज|अनदेखा|नियम|मंज़ूरी|मंजूरी/iu;

const refuse = (field: keyof typeof FIELD_WORDS, why: string): never => {
  check(false, 'PERSONA_FIELD_REFUSED', `The ${FIELD_WORDS[field]} ${why} A persona sets only how the agent talks; it comes after Chausar's rules and never changes them.`);
  throw new Error('unreachable');
};

/** Why a persona field cannot be kept, by code, or nothing. A blocked topic may name money: it keeps the agent away from it. */
function checkField(field: keyof typeof FIELD_WORDS, text: string): void {
  check(secretFindings(text).length === 0, 'CHAT_KEY_REFUSED', KEY_REFUSED);
  check(!holdsIdNumber(text), 'CHAT_KEY_REFUSED', ID_REFUSED);
  // Format characters (the soft hyphen and zero-width spaces among them) cannot split a word past the checks.
  const plain = plainHindi(text.replace(/\p{Cf}/gu, ''));
  if (/\p{Nd}/u.test(plain) || holdsNumberWords(plain) || /%/.test(plain)) refuse(field, 'has a number. Numbers come from your plan and Chausar\'s calculator.');
  const control = ownerControlReason(plain);
  if (control && !(field === 'blockedTopics' && control === MONEY_REASON)) refuse(field, `asks for more than a way of talking. ${control}`);
  if (field !== 'blockedTopics' && handsToClients(plain)) refuse(field, `asks the agent to act on a client. ${FLOOR_REASON}`);
  if (SAFETY.test(plain)) refuse(field, 'asks to change Chausar\'s rules, the checks or your approval.');
  if (field !== 'blockedTopics' && FACTS.test(plain)) refuse(field, 'changes what is true about the business: prices, promises and facts come from your plan.');
}

/** One text field: null when empty, else one tidy line within its length, checked. */
function field(value: unknown, name: keyof typeof FIELD_CHARS): string | null {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  check(typeof value !== 'string' || tidyWords(value).length <= FIELD_CHARS[name], 'INVALID_VENTURE_REQUEST', `The ${FIELD_WORDS[name]} is too long: keep it to ${FIELD_CHARS[name]} characters.`);
  const text = tidyWords(singleLine(value, `The ${FIELD_WORDS[name]}`, { min: 1, max: FIELD_CHARS[name] }));
  checkField(name, text);
  return text;
}

/** A persona as the owner typed it, checked field by field (PERSONA_FIELD_REFUSED for a tool, a number, facts or safety). */
export function checkPersona(value: unknown): PersonaFields {
  const body = exactPayload(value, ['tone', 'replyLength', 'greeting', 'handOffLine', 'blockedTopics', 'signOff'], ['tone', 'replyLength', 'greeting', 'handOffLine', 'blockedTopics', 'signOff']);
  check(body.replyLength === null || (REPLY_LENGTHS as readonly unknown[]).includes(body.replyLength), 'INVALID_VENTURE_REQUEST', 'Choose short, medium or long replies, or none.');
  check(Array.isArray(body.blockedTopics) && body.blockedTopics.length <= TOPICS, 'INVALID_VENTURE_REQUEST', `List up to ${TOPICS} topics the agent stays away from.`);
  const topics: string[] = [];
  for (const item of body.blockedTopics as unknown[]) {
    check(typeof item !== 'string' || tidyWords(item).length <= TOPIC_CHARS, 'INVALID_VENTURE_REQUEST', `A blocked topic is too long: keep it to ${TOPIC_CHARS} characters.`);
    const topic = tidyWords(singleLine(item, 'A blocked topic', { min: 1, max: TOPIC_CHARS }));
    checkField('blockedTopics', topic);
    if (!topics.some(held => held.toLowerCase() === topic.toLowerCase())) topics.push(topic);
  }
  return {
    tone: field(body.tone, 'tone'), replyLength: body.replyLength as PersonaFields['replyLength'], greeting: field(body.greeting, 'greeting'),
    handOffLine: field(body.handOffLine, 'handOffLine'), blockedTopics: topics, signOff: field(body.signOff, 'signOff'),
  };
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

const samePersona = (a: PersonaFields, b: PersonaFields) => JSON.stringify(a) === JSON.stringify(b);
const versionsOf = (state: State, venture: VentureRecord, agentId: string) => listRecords(state, 'venture-persona', venture.id).filter(record => record.agent === agentId).sort((a, b) => a.version - b.version);

/** The agent's persona in use: its newest version, or null when none was ever set. */
export function personaInUse(state: State, venture: VentureRecord, agentId: string): PersonaRecord | null {
  return versionsOf(state, venture, agentId).at(-1) ?? null;
}

/** The persona view: in use (or none), its version, the persona to set to go back one, and the agent's skills. */
export function personaView(state: State, venture: VentureRecord, agent: ChatAgent, line?: string): PersonaView {
  const versions = versionsOf(state, venture, agent.id);
  const current = versions.at(-1) ?? null;
  const before = versions.at(-2) ?? null;
  return {
    agent: agent.id, persona: structuredClone(current?.persona ?? NO_PERSONA), skills: agentSkills(agent),
    line: line ?? (current ? `Version ${current.version} is in use from ${agent.name}'s next run.` : `${agent.name} has no persona yet, so it talks the way its role says. Its role and the facts it uses stay the same whatever you set.`),
    version: current?.version ?? 0, undo: before ? structuredClone(before.persona) : null,
  };
}

/**
 * Inside the caller's transaction: stores the agent's next persona version and says so in its thread. source 'undo'
 * when it is the version before the one in use, set again.
 */
export function writePersonaVersion(tx: VentureTx, agent: ChatAgent, persona: PersonaFields, source: 'owner' | 'import'): PersonaRecord {
  const venture = tx.venture!;
  const versions = versionsOf(tx.state, venture, agent.id);
  const back = versions.length >= 2 && samePersona(versions.at(-2)!.persona, persona);
  const record = tx.put<PersonaRecord>({ ...tx.base('venture-persona'), agent: agent.id, persona: structuredClone(persona), version: (versions.at(-1)?.version ?? 0) + 1, source: back && source === 'owner' ? 'undo' : source });
  const words = source === 'import' ? 'The persona from the agent file you accepted is' : back ? 'Going back, my earlier way of talking is' : 'Your changes to how I talk are';
  const message = appendAgentMessage(tx, { agent: agent.id, from: 'agent', text: `${words} version ${record.version}, in use from my next run. You can undo it in my persona.`, author: 'engine' });
  tx.emit('agent.message', { agent: agent.id, messageId: message.id });
  return record;
}

// ---------------------------------------------------------------------------
// In a run's turns
// ---------------------------------------------------------------------------

/** One agent's persona as a turn carries it: owner words, so each line passes the id screen again. */
export type PersonaInput = { agent: string } & PersonaFields;
const STEP_KINDS_ACT: ReadonlySet<string> = new Set(['gather', 'question', 'work']);

function inputOf(name: string, persona: PersonaFields): PersonaInput {
  const screened = (text: string | null) => (text === null ? null : screenReadback(text).text);
  return {
    agent: name, tone: screened(persona.tone), replyLength: persona.replyLength, greeting: screened(persona.greeting), handOffLine: screened(persona.handOffLine),
    blockedTopics: persona.blockedTopics.map(topic => screenReadback(topic).text), signOff: screened(persona.signOff),
  };
}

/**
 * The personas a run's turns carry: for the act turns, those of the agents that do its act steps; for the writing turn,
 * the writer's. Only personas that were set; empty when none, so the turn's input stays the same without them.
 */
export function personaInputs(state: State, venture: VentureRecord, playbook: Pick<PlaybookRecord, 'steps' | 'flagship'>, which: 'act' | 'write'): PersonaInput[] {
  const flagship = flagshipDelivery(playbook.flagship ?? null);
  const steps = playbook.steps.filter(step => (which === 'act' ? STEP_KINDS_ACT.has(step.kind) : step.kind === 'write'));
  const roles = [...new Set(steps.map(step => (flagship ? flagship.roleOf[step.id] ?? null : AGENT_ID)).filter((id): id is string => id !== null))];
  return roles.flatMap(id => {
    const current = personaInUse(state, venture, id);
    if (!current || samePersona(current.persona, NO_PERSONA)) return [];
    const name = flagship?.roles.find(role => role.id === id)?.name ?? 'Delivery agent';
    return [inputOf(name, current.persona)];
  });
}

/** The turn input part for personas, or nothing when there are none. */
export function personaPart(personas: readonly PersonaInput[] | undefined): Record<string, Json> {
  return personas?.length ? { personas: { note: PERSONA_BACKGROUND, items: personas.map(item => ({ ...item, blockedTopics: [...item.blockedTopics] })) } } : {};
}

/** A one-step draft's style, as the writing turn's: the writer's persona and the owner's voice; empty when neither is set. */
export function writingStyle(state: State, venture: VentureRecord, playbook: Pick<PlaybookRecord, 'steps' | 'flagship'>): Record<string, Json> {
  return { ...personaPart(personaInputs(state, venture, playbook, 'write')), ...voicePart(state, venture, playbook.flagship ?? null) };
}

// ---------------------------------------------------------------------------
// Trying an unsaved persona on the practice clients
// ---------------------------------------------------------------------------

type TestReply = { reply: string };
const TEST_INSTRUCTIONS = [
  "You are one agent of a small service business. Write your first short reply to the client's message, in the persona given.",
  "The persona is how you talk, after Chausar's rules: it never changes facts, prices or promises. Name no price and no amount of money, and promise nothing.",
  "Stay away from the persona's blocked topics. When the client needs the owner, use the persona's hand-off line.",
].join(' ');
const LENGTH_WORDS = { short: 'Thanks for writing. I will keep this short.', medium: 'Thanks for writing. Here is how I would start.', long: 'Thanks for writing. Let me walk you through how I would start, step by step.' } as const;

function validateTestReply(raw: unknown): TestReply {
  const body = raw as Record<string, unknown>;
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(body).length === 1, 'MODEL_OUTPUT_REJECTED', 'The reply was not one text.');
  return { reply: modelWords(body.reply, 'reply', 1200, { multiline: true }) };
}

/** The reply built-in templates write in a persona: its own greeting, a line of its length, its hand-off line and sign-off. */
function templateReply(persona: PersonaFields): TestReply {
  const parts = [persona.greeting ? `${persona.greeting}.` : 'Hello.', LENGTH_WORDS[persona.replyLength ?? 'medium'], persona.handOffLine ?? '', persona.signOff ?? ''];
  return { reply: parts.filter(Boolean).join(' ').replace(/\.\./g, '.') };
}

function testTask(agent: ChatAgent, persona: PersonaFields, scenario: Scenario): ModelTask<TestReply> {
  return {
    purpose: 'persona-test', instructions: TEST_INSTRUCTIONS,
    input: { agent: { name: agent.name, job: agent.job }, persona: inputOf(agent.name, persona) as unknown as Json, client: { message: scenario.brief } },
    schemaName: 'venture-persona-test', schema: { type: 'object', additionalProperties: false, required: ['reply'], properties: { reply: { type: 'string', description: 'Your first reply, in plain words.' } } },
    validate: validateTestReply, template: () => templateReply(persona), containsClientData: false, maxOutputTokens: 600,
  };
}

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

/** venture.persona.get { agent } (read): the agent's persona in use, its version and undo, and its skills. */
export async function personaGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PersonaView> {
  const body = exactPayload(payload, ['agent'], ['agent']);
  const agentId = identifier(body.agent, 'Agent');
  const { state, venture } = readAs(deps, ctx, 'read');
  return personaView(state, venture, chatAgent(state, venture, agentId));
}

/**
 * venture.persona.set { agent, persona } (approve, app only): the agent's persona as a new version, kept; the agent
 * says so in its thread. It never touches the playbook. Setting the version before again is an undo.
 */
export async function personaSetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PersonaView> {
  requireAppChannel(ctx, 'venture.persona.set');
  const body = exactPayload(payload, ['agent', 'persona'], ['agent', 'persona']);
  const agentId = identifier(body.agent, 'Agent');
  const persona = checkPersona(body.persona);
  readAs(deps, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'agents.persona.set', tx => {
    const venture = tx.venture!;
    const agent = chatAgent(tx.state, venture, agentId);
    const record = writePersonaVersion(tx, agent, persona, 'owner');
    const back = record.version > 1 ? ` Version ${record.version - 1} is kept; undo sets it again.` : '';
    return personaView(tx.state, venture, agent, `Version ${record.version} is in use from ${agent.name}'s next run.${back}`);
  });
}

/**
 * venture.persona.test { agent, persona } (prepare, app only): the unsaved persona's first reply to each of the
 * business's three practice clients, through the owner's AI (or built-in templates), and what that cost. Nothing is
 * saved; practice clients are Chausar's own made-up clients, so no client data is sent.
 */
export async function personaTestHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PersonaTestView> {
  requireAppChannel(ctx, 'venture.persona.test');
  const body = exactPayload(payload, ['agent', 'persona'], ['agent', 'persona']);
  const agentId = identifier(body.agent, 'Agent');
  const persona = checkPersona(body.persona);
  const { state, venture } = readAs(deps, ctx, 'prepare');
  const agent = chatAgent(state, venture, agentId);
  const scenarios = businessScenarios(state, venture.id, acceptedBlueprint(state, venture).serviceType);
  const results: PersonaTestView['results'] = [];
  const spent: string[] = [];
  let confirmed = true;
  const tier = deps.models.status(ctx).tiers[PURPOSE_TIER['persona-test']];
  const by = tier?.presetId === 'built-in-templates' ? 'built-in templates' : 'your AI';
  // Each practice client is its own call: one that fails stops the test, with the replies and the cost so far.
  for (const scenario of scenarios) {
    let outcome: { value: TestReply; costMicros: string; priceConfirmed: boolean };
    try { outcome = await deps.models.generate(ctx, testTask(agent, persona, scenario)); } catch (error) {
      const why = error instanceof Error && error.message ? error.message : 'the call did not finish.';
      return { results, cost: costDisplay(sumMicros(spent), confirmed), line: `Stopped after ${results.length} of ${scenarios.length} practice clients: ${why} Nothing was saved.` };
    }
    results.push({ scenario: scenario.title, reply: outcome.value.reply });
    spent.push(outcome.costMicros);
    confirmed &&= outcome.priceConfirmed;
  }
  return { results, cost: costDisplay(sumMicros(spent), confirmed), line: `Tried on ${results.length} practice clients with ${by}. Nothing was saved.` };
}
