/** Opt-in Ask composition. The trusted host supplies an Engine controller and
 * revocation context; the existing App mount and legacy journeys remain intact. */
import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { App, type AppProps } from './App';
import type { Address } from './presentation.ts';
import type { ShellConfig } from './places.ts';
import { formatAddress, sameAddress } from './routes.ts';
import { workspaceLocked } from './composition.ts';
import { useT } from './text';
import { PageHeader } from './PageHeader';
import {
  answerAddress, boundConversationAddress, conversationSurfaceAddress,
  modelConsentAddress, newQuestionAddress, questionRequest, type ConversationQuestionSettings,
} from './conversation-surface.ts';
import type { ConversationHost, ConversationHostState, ConversationSavedAnswer, ModelConsent } from '../bridge/conversation-host.ts';
import { ModelConsentSheet } from '../patterns/ModelConsentSheet';
import { ConversationAnswer, type ConversationReferenceIntent } from '../screens/ask/ConversationAnswer';

export interface ConversationWorkspaceProps {
  readonly app: AppProps;
  readonly conversation: ConversationHost;
  readonly questionSettings: ConversationQuestionSettings;
  /** Changes whenever trusted workspace identity, authority or scope changes.
   * The host also invalidates the controller on an asynchronous revocation. */
  readonly contextKey: string;
  /** Required: every known business figure and evidence reference opens its receipt. */
  readonly onReference: (intent: ConversationReferenceIntent, saved: ConversationSavedAnswer) => void;
  /** Explicit saved-answer selection from the host's authorized journey. */
  readonly readback?: { readonly id: string; readonly address: Address; readonly selectionKey: string } | undefined;
}

function AskPage({ state, savedPlace, onContinue, onPreviewFinalWriting, onReference }: {
  state: ConversationHostState;
  savedPlace: boolean;
  onContinue: (id: string) => void;
  onPreviewFinalWriting: () => void;
  onReference: (intent: ConversationReferenceIntent) => void;
}): ReactNode {
  const t = useT();
  let content: ReactNode;
  switch (state.kind) {
    case 'answer':
      content = <ConversationAnswer saved={state.saved} onContinue={onContinue}
        onPreviewFinalWriting={onPreviewFinalWriting} onReference={onReference} />;
      break;
    case 'continuation':
      content = <><p>{state.value.clarification}</p><p>{t('ASK.workspace.continuation')}</p></>;
      break;
    case 'busy': content = <p role="status">{t('ASK.workspace.busy')}</p>; break;
    case 'review': content = <p>{t('ASK.workspace.review')}</p>; break;
    case 'unavailable': content = <p role="status">{t('ASK.workspace.unavailable', { code: state.code })}</p>; break;
    case 'idle': content = <p>{t('ASK.workspace.empty')}</p>; break;
  }
  return <section aria-label={t('SH-01.place.ask')}>
    {state.kind !== 'answer' && <PageHeader where={t('SH-01.place.ask')} title={t(savedPlace ? 'SH-01.sub.ask.saved' : 'SH-01.sub.ask.new')} />}
    {content}
  </section>;
}

export function ConversationWorkspace({ app, conversation, questionSettings, contextKey, readback, onReference }: ConversationWorkspaceProps) {
  const state = useSyncExternalStore(conversation.subscribe, conversation.snapshot, conversation.snapshot);
  const [active, setActive] = useState<Address | null>(null);
  const activeRef = useRef<Address | null>(null);
  const bound = useRef<Address | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  const context = useRef(contextKey);
  const settings = useRef(questionSettings);
  const boundHost = useRef(conversation);
  const openedSelection = useRef<string | null>(null);
  const shell: ShellConfig = { kind: app.shellKind, view: app.view, administers: app.administers, allowed: app.allowed };
  const locked = app.lock != null || workspaceLocked(app.today.data.state);
  // Clear the display synchronously on context replacement, before effect cleanup.
  const sameContext = context.current === contextKey && settings.current === questionSettings && boundHost.current === conversation;
  const surface = sameContext ? conversationSurfaceAddress(shell, active, locked) : null;

  useLayoutEffect(() => {
    if (context.current !== contextKey || settings.current !== questionSettings || boundHost.current !== conversation) {
      context.current = contextKey; settings.current = questionSettings;
      boundHost.current = conversation; openedSelection.current = null;
      bound.current = null; conversation.invalidate();
    }
  }, [contextKey, questionSettings, conversation]);
  useLayoutEffect(() => () => { bound.current = null; openedSelection.current = null; conversation.invalidate(); }, [conversation]);
  useLayoutEffect(() => {
    if (bound.current !== null && conversationSurfaceAddress(shell, bound.current, locked) === null) {
      bound.current = null; openedSelection.current = null;
      conversation.invalidate(locked ? 'VAULT_LOCKED' : 'ACCESS_DENIED');
    }
  }, [conversation, locked, app.allowed, app.administers, app.shellKind, app.view]);

  const navigate = (address: Address) => { window.location.hash = formatAddress(address); };
  const retain = (address: Address) => { bound.current = address; navigate(address); };
  const captureOrigin = () => {
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const onAddress = useCallback((address: Address | null) => {
    activeRef.current = address;
    setActive(current => current === null && address === null || current !== null && address !== null && sameAddress(current, address) ? current : address);
    if (bound.current !== null && !boundConversationAddress(bound.current, address)) {
      bound.current = null; openedSelection.current = null; conversation.invalidate();
    }
    app.onAddress?.(address);
  }, [conversation, app.onAddress]);

  const onAsk = (text: string) => {
    const address = newQuestionAddress(shell, locked);
    if (address === null || !sameContext) { bound.current = null; conversation.invalidate('ACCESS_DENIED'); return; }
    try {
      const request = questionRequest(questionSettings, text);
      if (request === null) return;
      captureOrigin(); retain(modelConsentAddress(address));
      void conversation.preview(request);
    } catch { retain(answerAddress(address)); conversation.invalidate('INVALID_REPLY'); }
  };
  const editQuestion = (text: string) => {
    const current = bound.current;
    if (current !== null) retain(answerAddress(current));
    conversation.editQuestion();
    app.ask.onChange?.(text);
  };
  const closeReview = () => {
    const current = bound.current;
    if (current !== null) retain(answerAddress(current));
    conversation.cancel();
  };
  const sendReviewed = (consent: ModelConsent) => {
    if (surface === null || !boundConversationAddress(bound.current, surface)) {
      bound.current = null; conversation.invalidate('ACCESS_DENIED'); return;
    }
    retain(answerAddress(surface));
    void conversation.sendReviewed(consent);
  };
  const continueAnswer = (id: string) => {
    const address = conversationSurfaceAddress(shell, activeRef.current, locked);
    if (address === null || !boundConversationAddress(bound.current, address)) return;
    retain(answerAddress(address)); void conversation.selectContinuation(id);
  };
  const previewFinalWriting = () => {
    const address = conversationSurfaceAddress(shell, activeRef.current, locked);
    if (address === null || !boundConversationAddress(bound.current, address)) return;
    captureOrigin(); retain(modelConsentAddress(address)); void conversation.previewFinalWriting();
  };

  const readbackAddress = readback === undefined ? null : formatAddress(readback.address);
  const readbackSelection = readback === undefined ? null : JSON.stringify([readback.id, readback.selectionKey, readbackAddress]);
  const activeAddress = active === null ? null : formatAddress(active);
  useLayoutEffect(() => {
    if (readback === undefined) {
      if (activeRef.current?.place === 'ask' && activeRef.current.sub === 'saved' && bound.current !== null) {
        bound.current = null; openedSelection.current = null; conversation.invalidate();
      }
      return;
    }
    if (openedSelection.current !== null && openedSelection.current !== readbackSelection) {
      bound.current = null; openedSelection.current = null; conversation.invalidate();
    }
    if (openedSelection.current === readbackSelection || readbackAddress !== activeAddress || !sameContext) return;
    const address = conversationSurfaceAddress(shell, activeRef.current, locked);
    if (address === null || address.sub !== 'saved') return;
    openedSelection.current = readbackSelection;
    bound.current = address; void conversation.open(readback.id);
  }, [conversation, readback?.id, readback?.selectionKey, readbackAddress, activeAddress, sameContext, locked, app.allowed, app.shellKind, app.view, app.administers]);

  // A new saved selection hides the prior body before the read effect runs.
  const selectedReadback = surface?.sub !== 'saved' || (readback !== undefined && openedSelection.current === readbackSelection);
  const visible = surface !== null && selectedReadback && boundConversationAddress(bound.current, surface);
  const sheet = visible && state.kind === 'review' ? {
    address: surface,
    content: <ModelConsentSheet stage={state.stage} preview={state.preview} origin={origin.current}
      onClose={closeReview} onSendReviewed={sendReviewed} />,
  } : app.sheet;
  const renderPlace = (address: Address): ReactNode => {
    if (conversationSurfaceAddress(shell, address, locked) === null) return app.renderPlace?.(address);
    const ownedTransition = visible && boundConversationAddress(surface, address) && openedSelection.current === readbackSelection;
    if (address.sub === 'saved' && (readback === undefined || (!sameAddress(address, readback.address) && !ownedTransition))) return app.renderPlace?.(address);
    const displayed: ConversationHostState = visible && boundConversationAddress(surface, address) ? state : { kind: 'idle' };
    return <AskPage state={displayed} savedPlace={address.sub === 'saved'} onContinue={continueAnswer} onPreviewFinalWriting={previewFinalWriting}
      onReference={intent => { if (displayed.kind === 'answer') onReference(intent, displayed.saved); }} />;
  };
  // Remount the frame's private draft/voice state on a trusted context replacement.
  const showHelp = app.onHelp === undefined ? undefined : (requestedOrigin?: HTMLElement | null, fallback?: HTMLElement | null) => {
    if (locked || !sameContext) return;
    const opener = state.kind === 'review' || state.kind === 'busy' ? origin.current : requestedOrigin;
    // Fence captured send callbacks and pending approvals before changing the hash.
    bound.current = null; openedSelection.current = null; conversation.cancel();
    app.onHelp?.(opener, fallback);
  };
  return <App key={contextKey} {...app} ask={{ ...app.ask, onAsk, onChange: editQuestion }}
    onAddress={onAddress} renderPlace={renderPlace} sheet={sheet} onHelp={showHelp} />;
}
