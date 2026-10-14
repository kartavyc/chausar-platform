/** Opt-in Ask composition. The trusted host supplies an Engine controller and
 * revocation context; the existing App mount and legacy journeys remain intact. */
import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { App, type AppProps } from './App';
import type { Address } from './presentation.ts';
import type { ShellConfig } from './places.ts';
import { formatAddress, parseAddress, sameAddress } from './routes.ts';
import { workspaceLocked } from './composition.ts';
import { useT } from './text';
import { PageHeader } from './PageHeader';
import {
  answerAddress, boundConversationAddress, conversationSurfaceAddress,
  modelConsentAddress, newQuestionAddress, questionRequest, type ConversationQuestionSettings,
} from './conversation-surface.ts';
import type { ConversationHost, ConversationHostState, ConversationSavedAnswer, ModelConsent } from '../bridge/conversation-host.ts';
import { ModelConsentSheet } from '../patterns/ModelConsentSheet';
import { Button } from '../parts/Button';
import { ConversationAnswer, type ConversationReferenceIntent } from '../screens/ask/ConversationAnswer';

/** The exact selected saved answer an overview control was drawn beside: the host validates it before acting. */
export interface SavedReadbackOrigin { readonly id: string; readonly selectionKey: string }

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
  /**
   * Optional: an explicit human switch, within Saved, from the selected saved answer that owns the body to the
   * host's Saved overview. The control names the exact readback selection it was drawn beside; the host decides
   * whether that selection is still current, fences the answer operation itself and returns whether it accepted
   * the transition. Only an accepted transition consumes this workspace's bound address and opened selection,
   * synchronously, so the answer's still-connected controls are inert before React commits; a rejected older
   * control clears nothing of a newer selected answer. Nothing here leaves the readback on its own: default
   * rendering and precedence are unchanged.
   */
  readonly onSavedOverview?: ((origin: SavedReadbackOrigin) => boolean) | undefined;
}

function AskPage({ state, savedPlace, onContinue, onPreviewFinalWriting, onReference, onSavedOverview }: {
  state: ConversationHostState;
  savedPlace: boolean;
  onContinue: (id: string) => void;
  onPreviewFinalWriting: () => void;
  onReference: (intent: ConversationReferenceIntent) => void;
  /** Bound by the parent to the exact readback selection this page was drawn for. */
  onSavedOverview: (() => void) | undefined;
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
    {savedPlace && onSavedOverview !== undefined && <p><Button variant="link" onClick={() => onSavedOverview()}>{t('RETAINED.saved.show')}</Button></p>}
  </section>;
}

export function ConversationWorkspace({ app, conversation, questionSettings, contextKey, readback, onReference, onSavedOverview }: ConversationWorkspaceProps) {
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
  /**
   * Whether a control drawn in the answer `owner` may still act, read synchronously at the press and before any
   * navigation or request: the surface is still bound, the actual hash still names that bound address, and the
   * conversation still shows exactly that answer. An answer the human has left (an accepted overview, a cancellation,
   * a newer selection) leaves its still-connected Continue and Preview writing inert, whatever React has committed.
   */
  const ownedAnswer = (owner: ConversationSavedAnswer | null): Address | null => {
    const address = conversationSurfaceAddress(shell, activeRef.current, locked), held = bound.current;
    if (owner === null || address === null || held === null || !boundConversationAddress(held, address) || !sameAddress(parseAddress(window.location.hash), held)) return null;
    const shown = conversation.snapshot();
    return shown.kind === 'answer' && shown.saved === owner ? address : null;
  };
  const continueAnswer = (id: string, owner: ConversationSavedAnswer | null) => {
    const address = ownedAnswer(owner);
    if (address === null || owner === null || owner.id !== id) return;
    retain(answerAddress(address)); void conversation.selectContinuation(id);
  };
  const previewFinalWriting = (owner: ConversationSavedAnswer | null) => {
    const address = ownedAnswer(owner);
    if (address === null) return;
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
    // With no conversation in progress, Ask, New belongs to the page the host composes there (the menu of
    // calculations from the ask lane and the route picker).
    if (displayed.kind === 'idle' && address.sub !== 'saved') {
      const own = app.renderPlace?.(address);
      if (own !== undefined && own !== null) return own;
    }
    // Every answer control names the exact answer this body was drawn for; an older control names an older one.
    const owner = displayed.kind === 'answer' ? displayed.saved : null;
    // The overview control names the exact readback selection this body was drawn for. Only when the host accepts that exact
    // selection does this surface consume its bound address and opened selection, synchronously, so the answer's still-connected
    // controls are inert before React commits; a rejected older control changes nothing of a newer selected answer.
    const overview = onSavedOverview === undefined || readback === undefined ? undefined
      : () => {
        if (!onSavedOverview({ id: readback.id, selectionKey: readback.selectionKey })) return;
        bound.current = null; openedSelection.current = null;
      };
    return <AskPage state={displayed} savedPlace={address.sub === 'saved'} onContinue={id => continueAnswer(id, owner)} onPreviewFinalWriting={() => previewFinalWriting(owner)}
      onReference={intent => { if (displayed.kind === 'answer') onReference(intent, displayed.saved); }} onSavedOverview={overview} />;
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
