// Chausar venture launcher, agents (Ink v2 wave 4, package 4B1): the one chat consent per business. Agent chat (and
// Chats and network search after it) sends the owner's message and what Chausar reads to answer it to the owner's own
// AI, so the first message waits for the owner's consent to exactly that, naming the AI. A later change of the AI
// connection (preset, connection or model) makes it stale. With templates only nothing is sent, so none is asked.
// A chat call carries client data: it goes by deps.models.preview and runPreview under this consent, never generate.
import { check, type Context, type State } from '../../contracts.ts';
import { PURPOSE_TIER } from '../contracts.ts';
import type { ChatConsentRecord, ChatConsentView, ModelPresetId, ModelStatusView, VentureDeps, VentureRecord } from '../contracts.ts';
import { digest, exactPayload, listRecords, requireAppChannel, ventureAction } from '../records.ts';
import { PRESETS } from '../models/presets.ts';
import { readAs } from '../delivery/shared.ts';

/** The tier every chat call uses (agent-chat). The consent names the AI that serves it. */
export const CHAT_TIER = PURPOSE_TIER['agent-chat'];
const TEMPLATES: ModelPresetId = 'built-in-templates';

/** The AI a chat would go to now: its preset, model and connection, or null when only templates serve the chat tier. */
export type ChatRoute = { presetId: ModelPresetId; model: string | null; connectionId: string | null; label: string; withKey: boolean };

/** The route a chat call would take now, read from the model status. Null with templates only. */
export function chatRoute(status: ModelStatusView): ChatRoute | null {
  const tier = status.tiers[CHAT_TIER];
  if (!tier || tier.presetId === TEMPLATES) return null;
  const spec = PRESETS.find(preset => preset.id === tier.presetId);
  const connection = status.connections.filter(item => item.status === 'connected' && item.presetId === tier.presetId && item.tiers.includes(CHAT_TIER)).at(-1);
  return {
    presetId: tier.presetId, model: tier.model, connectionId: connection?.id ?? null, label: spec?.label ?? tier.presetId,
    withKey: spec?.kind === 'anthropic-messages' || spec?.kind === 'openai-responses',
  };
}

/**
 * What the owner agrees to, naming the AI: an API key route says "with your key"; a command-line tool says where it
 * runs. 4D3: it names what a network search sends too, so a consent given before that text is stale and asked again.
 */
export function chatConsentText(route: ChatRoute): string {
  return `Chats send your message and what Chausar reads to answer it (run steps, file names, figures with their receipts, the agent's notes; for a network search, your question as you typed it, your contacts' titles and companies with each contact's own name masked, and your notes and meeting titles with the full names of people in your network and of clients who are people masked; emails and phone numbers are masked everywhere) to ${route.label}${route.withKey ? ' with your key' : ''}. Keys, passphrases and bank or card numbers are never sent.`;
}

type Standing = { view: ChatConsentView; route: ChatRoute | null };

/** The consent as it stands for this business now: needed, given, stale (the AI changed since) or not needed. */
export function chatConsentState(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord): Standing {
  const route = chatRoute(deps.models.status(ctx));
  if (!route) return { view: { state: 'not-needed', text: null, digest: null, at: null }, route };
  const text = chatConsentText(route);
  const textDigest = digest(text);
  const last = listRecords(state, 'venture-chat-consent', venture.id).at(-1);
  if (!last) return { view: { state: 'needed', text, digest: textDigest, at: null }, route };
  const same = last.textDigest === textDigest && last.presetId === route.presetId && last.connectionId === route.connectionId && last.model === route.model;
  return { view: { state: same ? 'given' : 'stale', text, digest: textDigest, at: same ? last.at : null }, route };
}

/**
 * Refuses a chat that would send anything before the owner's consent holds: CHAT_CONSENT_REQUIRED (the message is the
 * consent text), or CHAT_CONSENT_STALE when the AI connection changed since. Returns the route the chat goes by, or
 * null with templates only, when nothing is sent and no consent is needed. 4C1 (Chats) and 4D3 (network search) use it too.
 */
export function requireChatConsent(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord): ChatRoute | null {
  const { view, route } = chatConsentState(deps, ctx, state, venture);
  check(view.state !== 'needed', 'CHAT_CONSENT_REQUIRED', view.text ?? '');
  check(view.state !== 'stale', 'CHAT_CONSENT_STALE', `Your AI connection changed since you agreed, so chats wait until you agree again. ${view.text ?? ''}`);
  return route;
}

/**
 * venture.chats.consent { digest } (approve, app only): the owner agrees to what chats send, as the thread showed it.
 * digest: the consent text's digest (APPROVAL_STALE when the AI changed since the owner read it). With templates only
 * nothing is sent, so nothing is stored and the answer is 'not-needed'.
 */
export async function chatsConsentHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ChatConsentView> {
  requireAppChannel(ctx, 'venture.chats.consent');
  const body = exactPayload(payload, ['digest'], ['digest']);
  check(typeof body.digest === 'string' && /^[a-f0-9]{64}$/.test(body.digest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the consent you read.');
  const seen = body.digest;
  readAs(deps, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'chats.consent', tx => {
    const { view, route } = chatConsentState(deps, ctx, tx.state, tx.venture!);
    if (!route) return view;
    check(view.digest === seen, 'APPROVAL_STALE', 'What chats send changed since you read it. Read it again.');
    if (view.state === 'given') return view;
    const record = tx.put<ChatConsentRecord>({
      ...tx.base('venture-chat-consent'), textDigest: view.digest!, presetId: route.presetId, connectionId: route.connectionId, model: route.model, by: ctx.memberId,
    });
    return { state: 'given', text: view.text, digest: view.digest, at: record.at };
  });
}
