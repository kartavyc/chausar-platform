/**
 * ModelConsentSheet: one request to an AI model, shown whole before it leaves.
 *   1. What the press allows: this one request.   4. Where it goes, what the receipt
 *   2. The question, as written.                     records, the preview and its digest.
 *   3. Every warning the engine supplied.         5. The exact text to be sent, all of it.
 * Rules kept here.
 * - This is not the business approval sheet. It shares no type and no action with it.
 * - The stage shown comes from the preview's own purpose. A supplied stage that does not
 *   agree with it gets no send control at all.
 * - The primary is always marked `money`, so Ctrl Enter never sends text out. Only a
 *   deliberate press calls back, once, with the id and digest of the preview on screen.
 * - Planning and final writing are separate requests. A press allows only the one shown;
 *   nothing here sends a second request, tries again or sends on a timer.
 * - The question, the warnings and the text are the engine's own words: text nodes, as
 *   supplied, never replaced, shortened or folded away. In Hindi, exact known warnings
 *   also have a local explanation beside the still-visible original Engine text.
 * - Nothing is kept: no state, no effect, no copy of the preview.
 */

import { useId, type ReactNode } from 'react';
import type { CheckedConversationPreview, CheckedModelPreview, CheckedSynthesisPreview } from '../bridge/conversation-contract.ts';
import type { ModelConsent } from '../bridge/conversation-host.ts';
import { useLanguage, useT } from '../app/text';
import { Sheet, type SheetPrimary } from '../parts/Sheet';
import { Button } from '../parts/Button';
import { knownModelDisclosureTranslationKey, type ModelDisclosureFamily } from './model-disclosure-translation';
import s from './ModelConsentSheet.module.css';

export type ModelConsentStage = 'planning' | 'final-writing';

export interface ModelConsentSheetProps {
  /** The stage the host is reviewing. It must agree with the preview's purpose. */
  stage: ModelConsentStage;
  preview: CheckedModelPreview;
  origin: HTMLElement | null;
  /** Cancel and close: the host drops this review. */
  onClose: () => void;
  /** The host's reviewed consent. Called only from a press of the primary. */
  onSendReviewed: (intent: ModelConsent) => void;
  /** The host is busy with this review: the send control is there but cannot be pressed. */
  disabled?: boolean | undefined;
}

/** The stage a preview is for, from its own purpose. */
const STAGE: Readonly<Record<CheckedModelPreview['purpose'], ModelConsentStage>> = {
  conversation: 'planning',
  'conversation-synthesis': 'final-writing',
};

/** A small grey name over what it names. */
function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={s.block}>
      <h3 className={s.label}>{title}</h3>
      {children}
    </section>
  );
}

function Pair({ name, mono = false, exact = false, children }: { name: string; mono?: boolean | undefined; exact?: boolean | undefined; children: ReactNode }) {
  return (
    <div className={s.pair}>
      <dt className={s.name}>{name}</dt>
      <dd className={[s.value, mono ? 'fig' : '', exact ? s.exact : ''].filter(Boolean).join(' ')}>{children}</dd>
    </div>
  );
}

/** An exact known Hindi explanation accompanies, and never replaces, the original. */
function DisclosureWarning({ family, warning }: { family: ModelDisclosureFamily; warning: string }) {
  const t = useT();
  const language = useLanguage();
  const translationKey = language === 'hi' ? knownModelDisclosureTranslationKey(family, warning) : undefined;
  return (
    <>
      {translationKey !== undefined && (
        <>
          <p className={s.exact} lang="hi">{t(translationKey)}</p>
          <p className={s.name}>{t('ASK.consent.disclosure.original')}</p>
        </>
      )}
      <p className={s.exact} lang={translationKey !== undefined ? 'en' : undefined}>{warning}</p>
    </>
  );
}

/** Planning: the question and definition warnings, and the earlier exchange when one is sent. */
function PlanningDisclosure({ preview }: { preview: CheckedConversationPreview }) {
  const t = useT();
  const exchangesId = useId();
  const earlier = preview.continuation;
  return (
    <>
      <Block title={t('ASK.consent.warning.question')}>
        <DisclosureWarning family="question" warning={preview.questionDisclosureWarning} />
      </Block>
      <Block title={t('ASK.consent.warning.definition')}>
        <DisclosureWarning family="definition" warning={preview.definitionDisclosureWarning} />
      </Block>
      {preview.continuationDisclosureWarning !== undefined && (
        <Block title={t('ASK.consent.warning.continuation')}>
          <DisclosureWarning family="continuation" warning={preview.continuationDisclosureWarning} />
        </Block>
      )}
      {earlier !== undefined && (
        <Block title={t('ASK.consent.earlier')}>
          <dl className={s.pairs}>
            <Pair name={t('ASK.consent.earlier.question')} exact>
              {earlier.originalQuestion}
            </Pair>
            <Pair name={t('ASK.consent.earlier.clarification')} exact>
              {earlier.clarification}
            </Pair>
          </dl>
          {earlier.exchanges !== undefined && earlier.exchanges.length > 0 && (
            <>
              <p id={exchangesId} className={s.name}>
                {t('ASK.consent.earlier.exchanges')}
              </p>
              <ol className={s.exchanges} aria-labelledby={exchangesId}>
                {earlier.exchanges.map((exchange, i) => (
                  <li key={i} className={s.exchange}>
                    <dl className={s.pairs}>
                      <Pair name={t('ASK.consent.exchange.question')} exact>
                        {exchange.question}
                      </Pair>
                      <Pair name={t('ASK.consent.exchange.clarification')} exact>
                        {exchange.clarification}
                      </Pair>
                    </dl>
                  </li>
                ))}
              </ol>
            </>
          )}
        </Block>
      )}
    </>
  );
}

/** Final writing: the one warning for the results being sent. */
function WritingDisclosure({ preview }: { preview: CheckedSynthesisPreview }) {
  const t = useT();
  return (
    <Block title={t('ASK.consent.warning.synthesis')}>
      <DisclosureWarning family="synthesis" warning={preview.synthesisDisclosureWarning} />
    </Block>
  );
}

export function ModelConsentSheet({ stage, preview, origin, onClose, onSendReviewed, disabled = false }: ModelConsentSheetProps) {
  const t = useT();
  const shown = STAGE[preview.purpose];

  const cancel = (
    <Button variant="quiet" onClick={onClose}>
      {t('ASK.consent.cancel')}
    </Button>
  );

  /* The review is for another stage than its preview: say so, and offer nothing to send. */
  if (shown !== stage) {
    return (
      <Sheet kind={t('ASK.consent.kind')} title={t('ASK.consent.mismatch.title')} onClose={onClose} origin={origin} actions={cancel}>
        <p className={s.note}>{t('ASK.consent.mismatch')}</p>
      </Sheet>
    );
  }

  /* Always `money`: the keyboard shortcut never sends. The press names the preview shown. */
  const primary: SheetPrimary = {
    label: t(`ASK.consent.${shown}.send`),
    onPress: () => onSendReviewed({ previewId: preview.id, digest: preview.digest, consent: true }),
    money: true,
    disabled,
  };

  return (
    <Sheet kind={t('ASK.consent.kind')} title={t(`ASK.consent.${shown}.title`)} onClose={onClose} origin={origin} primary={primary} actions={cancel}>
      <p className={s.note}>{t(`ASK.consent.${shown}.note`)}</p>

      <Block title={t('ASK.consent.question')}>
        <p className={s.exact}>{preview.naturalQuestion}</p>
      </Block>

      {preview.purpose === 'conversation' ? <PlanningDisclosure preview={preview} /> : <WritingDisclosure preview={preview} />}

      <Block title={t('ASK.consent.details')}>
        <dl className={s.pairs}>
          <Pair name={t('ASK.consent.route')} mono>
            {preview.routeId}
          </Pair>
          <Pair name={t('ASK.consent.endpoint')} mono={preview.endpoint !== undefined}>
            {preview.endpoint !== undefined ? preview.endpoint : t('ASK.consent.endpoint.unknown')}
          </Pair>
          <Pair name={t('ASK.consent.level')}>{t(`ASK.consent.level.${preview.send}`)}</Pair>
          <Pair name={t('ASK.consent.boundary')}>{t(`ASK.consent.boundary.${preview.receiptBoundary}`)}</Pair>
          <Pair name={t('ASK.consent.observed')}>{t(preview.providerPayloadObserved ? 'ASK.consent.observed.yes' : 'ASK.consent.observed.no')}</Pair>
          <Pair name={t('ASK.consent.preview')} mono>
            {preview.id}
          </Pair>
          <Pair name={t('ASK.consent.digest')} mono>
            {preview.digest}
          </Pair>
          {preview.purpose === 'conversation' && preview.continuationId !== undefined && (
            <Pair name={t('ASK.consent.continuation.id')} mono>
              {preview.continuationId}
            </Pair>
          )}
          {preview.purpose === 'conversation' && preview.continuationDigest !== undefined && (
            <Pair name={t('ASK.consent.continuation.digest')} mono>
              {preview.continuationDigest}
            </Pair>
          )}
          {preview.purpose === 'conversation-synthesis' && (
            <Pair name={t('ASK.consent.synthesis.turn')} mono>
              {preview.toolTurnId}
            </Pair>
          )}
          {preview.purpose === 'conversation-synthesis' && (
            <Pair name={t('ASK.consent.synthesis.digest')} mono>
              {preview.synthesisInputDigest}
            </Pair>
          )}
        </dl>
      </Block>

      <Block title={t('ASK.consent.payload')}>
        <pre className={[s.payload, 'fig'].join(' ')}>{preview.payload}</pre>
      </Block>
    </Sheet>
  );
}
