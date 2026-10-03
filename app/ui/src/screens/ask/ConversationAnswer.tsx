/**
 * ConversationAnswer: one saved answer, drawn only from its checked readback.
 * The question is the page's title. Under it, by kind:
 *   clarification             the AI model's one question, and a way to answer it
 *   grounded-conversation     the checked result of each tool, as it came
 *   synthesized-conversation  the written paragraphs, each with its own references; the
 *                             cautions beside them; the results they were written from;
 *                             the receipt that binds the writing to those results
 *   business-context          statements with their origin and standing, what is not
 *                             known, what conflicts, and the limits of the reading
 *   calculation               the figures as the receipt shows them, its scope and gaps
 * Rules kept here.
 * - The view only shows. It keeps no state and no copy of an answer, asks the engine
 *   nothing, and works out no value: no total, no conversion, no assumed currency.
 * - A figure is the receipt's own display string, unchanged, and always a control that
 *   opens its receipt. There is no chart, because no series is supplied.
 * - A receipt whose coverage counted nothing has no known figure. It says so in words and
 *   draws none of its figures, whatever their display strings say.
 * - An identifier that leads somewhere is always a control; the parent decides what it
 *   opens. Nothing is linked from an id by guessing. Each kind of identifier keeps its own
 *   name: a saved answer is never called a receipt, and the writing receipt goes to the
 *   parent whole, as its own intent, never as a calculation receipt.
 * - At rest the answer is short: the written paragraphs with their references and
 *   cautions, each tool's name, its standing and its figures. The ledger behind them sits
 *   in native disclosures, closed until asked for and whole when opened. A standing, a
 *   gap or a stale mark is never put behind one.
 * - A statement about the business is never shown apart from its origin and standing.
 * - "Answer this" is offered only for a clarification, and passes only the saved id.
 *   "Preview writing" is offered only for checked results not yet written up; it opens
 *   the review of what would be sent and sends nothing.
 */

import { useId, type ReactNode } from 'react';
import type {
  CheckedBusinessAnswer,
  CheckedCalculationAnswer,
  CheckedClarification,
  CheckedConversationReadback,
  CheckedConversationReference,
  CheckedConversationToolResult,
  CheckedGroundedConversation,
  CheckedSynthesizedConversation,
  ConversationTool,
} from '../../bridge/conversation-contract.ts';
import type { CalculationReceiptEvidence, EngineFigureEvidence } from '../../bridge/presentation.ts';
import { useT, type TextValues } from '../../app/text';
import { Button } from '../../parts/Button';
import { Label } from '../../parts/Label';
import { MissingWords } from '../../parts/Figure';
import s from './ConversationAnswer.module.css';

/** Where an identifier in an answer leads. The parent decides what opens. */
export type ConversationReferenceIntent =
  | { readonly kind: 'evidence'; readonly id: string }
  | { readonly kind: 'answer'; readonly id: string }
  | { readonly kind: 'receipt'; readonly id: string }
  | { readonly kind: 'citation'; readonly id: string }
  | { readonly kind: 'model-receipt'; readonly id: string }
  | { readonly kind: 'calculation-receipt'; readonly id: string }
  | { readonly kind: 'business-context-receipt'; readonly id: string }
  | { readonly kind: 'conversation-tool-receipt'; readonly id: string }
  | { readonly kind: 'synthesis-receipt'; readonly receipt: CheckedSynthesizedConversation['receipt'] };

export interface ConversationAnswerProps {
  saved: CheckedConversationReadback;
  /** Opens the review of what final writing would send. It approves and sends nothing. */
  onPreviewFinalWriting?: (() => void) | undefined;
  /** Chooses this saved clarification to be answered. Only the saved id is passed. */
  onContinue?: ((savedId: string) => void) | undefined;
  /** Opens what an identifier or a figure names. Required: every figure opens its receipt. */
  onReference: (intent: ConversationReferenceIntent) => void;
}

type OnReference = ConversationAnswerProps['onReference'];
type IdIntent = Extract<ConversationReferenceIntent, { readonly id: string }>;

const TOOL_WORDS: Readonly<Record<ConversationTool, string>> = {
  'business.describe': 'ASK.answer.tool.business',
  'calculator.calculate': 'ASK.answer.tool.calculation',
};

/** A saved answer's id, named for the tool it came from. It is not a receipt id. */
const SAVED_ANSWER_WORDS: Readonly<Record<ConversationTool, string>> = {
  'business.describe': 'ASK.answer.savedAnswer.business',
  'calculator.calculate': 'ASK.answer.savedAnswer.calculation',
};

function Pair({ name, mono = false, children }: { name: string; mono?: boolean | undefined; children: ReactNode }) {
  return (
    <div className={s.pair}>
      <dt className={s.name}>{name}</dt>
      <dd className={[s.value, mono ? 'fig' : ''].filter(Boolean).join(' ')}>{children}</dd>
    </div>
  );
}

/** A named list: a small grey name over rows between hairlines. */
function Rows({ name, children }: { name: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className={s.group}>
      <p id={id} className={s.label}>
        {name}
      </p>
      <ul className={s.rows} aria-labelledby={id}>
        {children}
      </ul>
    </div>
  );
}

/** Detail behind a native disclosure: closed until it is asked for, whole when opened. */
function More({ name, children }: { name: string; children: ReactNode }) {
  return (
    <details className={s.more}>
      <summary className={s.summary}>{name}</summary>
      <div className={s.detail}>{children}</div>
    </details>
  );
}

/** A named list behind a native disclosure. Its name stays readable while it is closed. */
function MoreRows({ name, children }: { name: string; children: ReactNode }) {
  const id = useId();
  return (
    <details className={s.more}>
      <summary id={id} className={s.summary}>
        {name}
      </summary>
      <ul className={s.rows} aria-labelledby={id}>
        {children}
      </ul>
    </details>
  );
}

/** An identifier as supplied, as a control. The parent decides what it opens. */
function Reference({ intent, onReference }: { intent: IdIntent; onReference: OnReference }) {
  return (
    <Button variant="link" className={s.id} onClick={() => onReference(intent)}>
      {intent.id}
    </Button>
  );
}

/** Identifiers of one kind, each kept. An empty list is the word, never a blank. */
function References({ kind, ids, onReference }: { kind: 'evidence' | 'answer' | 'receipt' | 'citation'; ids: readonly string[]; onReference: OnReference }) {
  if (ids.length === 0) return <MissingWords missing="none" />;
  return (
    <span className={s.ids}>
      {ids.map((id) => (
        <Reference key={id} intent={{ kind, id }} onReference={onReference} />
      ))}
    </span>
  );
}

/** Identifiers that open nothing from here, as text. */
function Ids({ ids }: { ids: readonly string[] }) {
  if (ids.length === 0) return <MissingWords missing="none" />;
  return (
    <span className={s.ids}>
      {ids.map((id) => (
        <span key={id} className={s.id}>
          {id}
        </span>
      ))}
    </span>
  );
}

/** The exact value behind a figure, in words for a screen reader. Only supplied fields. */
function exactWords(t: (key: string, values?: TextValues) => string, figure: EngineFigureEvidence): string {
  if (figure.unit === 'money') {
    if (figure.currency !== undefined) return t('ASK.answer.figure.money.currency', { exact: figure.minor, currency: figure.currency });
    return t('ASK.answer.figure.money', { exact: figure.minor });
  }
  if (figure.currency !== undefined) return t('ASK.answer.figure.points.currency', { exact: figure.minor, currency: figure.currency });
  return t('ASK.answer.figure.points', { exact: figure.minor });
}

/** Whether a receipt's coverage leaves its figure unknown: nothing was counted. This is
 *  the engine's own meaning, as bridge/projections.ts figureFromReceipt reads it; a
 *  display string of zero does not make such a figure a measured zero. */
function figureUnknown(receipt: CalculationReceiptEvidence): boolean {
  return receipt.coverage.completeness === 'empty' || (receipt.coverage.completeness === 'partial' && receipt.coverage.countedRows === 0);
}

/** One figure of a receipt: its label and its display string, unchanged. It opens the receipt.
 *  Its spoken name is one message: the label, the display string, the exact words and the
 *  receipt it opens, each as supplied and said once. */
function FigureRow({ figure, receiptId, onReference }: { figure: EngineFigureEvidence; receiptId: string; onReference: OnReference }) {
  const t = useT();
  return (
    <div className={s.pair}>
      <dt>{figure.label}</dt>
      <dd className={s.value}>
        <Button
          variant="link"
          className={s.figure}
          title={t('FIGURE.title', { exact: figure.minor, receipt: receiptId })}
          aria-label={t('ASK.answer.figure.open', { label: figure.label, display: figure.display, exact: exactWords(t, figure), receipt: receiptId })}
          onClick={() => onReference({ kind: 'calculation-receipt', id: receiptId })}
        >
          {figure.display}
        </Button>
      </dd>
    </div>
  );
}

/** A calculation receipt. At rest: its words, its figures, its coverage standing, gaps
 *  and any stale mark. Behind the disclosure: scope, sources, row counts and its own id.
 *  When coverage counted nothing the figure is unknown: none of the receipt's figures is
 *  drawn, and the engine's words, which may quote one, wait behind the disclosure.
 *  The receipt's value and total fields are not drawn: they carry no display string, and
 *  nothing here formats or adds one. */
function CalculationReceipt({ receipt, message, onReference }: { receipt: CalculationReceiptEvidence; message?: string | undefined; onReference: OnReference }) {
  const t = useT();
  const period = receipt.period;
  const compare = receipt.comparePeriod;
  const unknown = figureUnknown(receipt);
  const words = (
    <>
      {message !== undefined && <p className={s.text}>{message}</p>}
      {receipt.explanation !== '' && receipt.explanation !== message && <p className={s.text}>{receipt.explanation}</p>}
    </>
  );
  return (
    <div className={s.group}>
      {!unknown && words}
      {receipt.stale && (
        <p className={s.note}>
          <Label kind="stale" /> {t('ST.stale.plain')}
        </p>
      )}
      {receipt.staleReason !== undefined && <p className={s.note}>{receipt.staleReason}</p>}

      {unknown ? (
        <dl className={s.figures}>
          <div className={s.pair}>
            <dt>{t('ASK.answer.calculation.figure')}</dt>
            <dd className={s.value}>
              <MissingWords missing="unknown" />
            </dd>
          </div>
        </dl>
      ) : receipt.figures.length > 0 ? (
        <dl className={s.figures}>
          {receipt.figures.map((figure) => (
            <FigureRow key={figure.key} figure={figure} receiptId={receipt.id} onReference={onReference} />
          ))}
        </dl>
      ) : (
        <p className={s.missing}>{t('ASK.answer.calculation.noFigures')}</p>
      )}

      <dl className={s.pairs}>
        <Pair name={t('ASK.answer.coverage.completeness')}>{t(`ASK.answer.coverage.completeness.${receipt.coverage.completeness}`)}</Pair>
      </dl>

      {receipt.coverage.gaps.length > 0 && (
        <Rows name={t('ASK.answer.coverage.gaps')}>
          {receipt.coverage.gaps.map((gap, i) => (
            <li key={i} className={s.row}>
              <p className={s.text}>{gap}</p>
            </li>
          ))}
        </Rows>
      )}

      <More name={t('ASK.answer.detail.calculation')}>
        {unknown && words}
        <dl className={s.pairs}>
          <Pair name={t('ASK.answer.calculation.operation')} mono>
            {receipt.operation}
          </Pair>
          <Pair name={t('ASK.answer.calculation.period')}>
            {period !== null ? t('ASK.answer.period', { from: period.from, to: period.to }) : t('ASK.answer.notSpecified')}
          </Pair>
          {compare !== null && <Pair name={t('ASK.answer.calculation.comparePeriod')}>{t('ASK.answer.period', { from: compare.from, to: compare.to })}</Pair>}
          <Pair name={t('ASK.answer.scope.branch')}>{receipt.branch ?? t('ASK.answer.notSpecified')}</Pair>
          <Pair name={t('ASK.answer.scope.asOf')} mono>
            {receipt.asOf}
          </Pair>
          <Pair name={t('ASK.answer.calculation.currency')} mono>
            {receipt.currency}
          </Pair>
          <Pair name={t('ASK.answer.sources')}>
            <Ids ids={receipt.sourceIds} />
          </Pair>
          {receipt.requestedSourceIds !== undefined && (
            <Pair name={t('ASK.answer.calculation.requestedSources')}>
              <Ids ids={receipt.requestedSourceIds} />
            </Pair>
          )}
          <Pair name={t('ASK.answer.coverage.selected')} mono>
            {receipt.coverage.selectedRows}
          </Pair>
          <Pair name={t('ASK.answer.coverage.counted')} mono>
            {receipt.coverage.countedRows}
          </Pair>
          <Pair name={t('ASK.answer.coverage.excluded')} mono>
            {receipt.coverage.excludedRows}
          </Pair>
          <Pair name={t('ASK.answer.coverage.conflicts')} mono>
            {receipt.coverage.unresolvedConflicts}
          </Pair>
          <Pair name={t('ASK.answer.calculationReceipt')}>
            <Reference intent={{ kind: 'calculation-receipt', id: receipt.id }} onReference={onReference} />
          </Pair>
        </dl>
      </More>
    </div>
  );
}

/** A saved calculation: the receipt itself, or the supported form with its message. */
function Calculation({ answer, onReference }: { answer: CheckedCalculationAnswer; onReference: OnReference }) {
  if ('supported' in answer) return <CalculationReceipt receipt={answer.receipt} message={answer.message} onReference={onReference} />;
  return <CalculationReceipt receipt={answer} onReference={onReference} />;
}

/** What is known about the business. At rest: its standing, how complete the reading is
 *  and whether it was read from practice data, which is said here and not a second time
 *  behind the scope disclosure. Each list sits behind a disclosure under its own name, so
 *  what is not known and what conflicts are named even while closed. Each statement stays with its category,
 *  origin, standing and citations. The checked message is those same statements, unknowns
 *  and the conflict notice joined into lines, so it is not drawn a second time without
 *  them; it is drawn only when there is nothing else to show. */
function BusinessContext({ answer, onReference }: { answer: CheckedBusinessAnswer; onReference: OnReference }) {
  const t = useT();
  const bare = answer.claims.length === 0 && answer.unknowns.length === 0 && answer.conflicts.length === 0;
  return (
    <div className={s.group}>
      <dl className={s.pairs}>
        <Pair name={t('ASK.answer.status')}>{t(`ASK.answer.business.status.${answer.status}`)}</Pair>
        <Pair name={t('ASK.answer.scope.completeness')}>{t(`ASK.answer.scope.completeness.${answer.scope.completeness}`)}</Pair>
        <Pair name={t('ASK.answer.scope.synthetic')}>{t(answer.scope.syntheticFixture ? 'CHOICE.yes' : 'CHOICE.no')}</Pair>
      </dl>

      {bare && answer.message !== '' && <p className={s.text}>{answer.message}</p>}

      {answer.claims.length > 0 && (
        <MoreRows name={t('ASK.answer.business.claims')}>
          {answer.claims.map((claim) => (
            <li key={claim.id} className={s.row}>
              <p className={s.text}>{claim.text}</p>
              <p className={s.tags}>
                <span className={s.tag}>{t(`ASK.answer.category.${claim.category}`)}</span>
                <span className={s.tag}>{t(`ASK.answer.origin.${claim.origin}`)}</span>
                <span className={s.tag}>{t(`ASK.answer.qualification.${claim.qualification}`)}</span>
              </p>
              <dl className={s.refs}>
                <Pair name={t('ASK.answer.refs.citations')}>
                  <References kind="citation" ids={claim.citationIds} onReference={onReference} />
                </Pair>
              </dl>
            </li>
          ))}
        </MoreRows>
      )}

      {answer.unknowns.length > 0 && (
        <MoreRows name={t('ASK.answer.business.unknowns')}>
          {answer.unknowns.map((unknown) => (
            <li key={unknown.category} className={s.row}>
              <p className={s.text}>{unknown.message}</p>
              <p className={s.tags}>
                <span className={s.tag}>{t(`ASK.answer.category.${unknown.category}`)}</span>
              </p>
            </li>
          ))}
        </MoreRows>
      )}

      {answer.conflicts.length > 0 && (
        <MoreRows name={t('ASK.answer.business.conflicts')}>
          {answer.conflicts.map((conflict, i) => (
            <li key={i} className={s.row}>
              <p className={s.text}>{conflict.reason}</p>
              <p className={s.tags}>
                <span className={s.tag}>{t(`ASK.answer.category.${conflict.category}`)}</span>
              </p>
              <dl className={s.refs}>
                <Pair name={t('ASK.answer.refs.citations')}>
                  <References kind="citation" ids={conflict.citationIds} onReference={onReference} />
                </Pair>
              </dl>
            </li>
          ))}
        </MoreRows>
      )}

      {answer.scope.limitations.length > 0 && (
        <MoreRows name={t('ASK.answer.business.limitations')}>
          {answer.scope.limitations.map((limitation, i) => (
            <li key={i} className={s.row}>
              <p className={s.text}>{limitation}</p>
            </li>
          ))}
        </MoreRows>
      )}

      {answer.citations.length > 0 && (
        <MoreRows name={t('ASK.answer.business.citations')}>
          {answer.citations.map((citation) => (
            <li key={citation.id} className={s.row}>
              <dl className={s.refs}>
                <Pair name={t('ASK.answer.citation')}>
                  <Reference intent={{ kind: 'citation', id: citation.id }} onReference={onReference} />
                </Pair>
                <Pair name={t('ASK.answer.citation.kind')}>{t(`ASK.answer.citation.kind.${citation.kind}`)}</Pair>
                <Pair name={t('ASK.answer.citation.path')} mono>
                  {citation.path}
                </Pair>
                {citation.sourceId !== undefined && (
                  <Pair name={t('ASK.answer.citation.source')} mono>
                    {citation.sourceId}
                  </Pair>
                )}
                {citation.sourceRow !== undefined && (
                  <Pair name={t('ASK.answer.citation.row')} mono>
                    {citation.sourceRow}
                  </Pair>
                )}
                {citation.branch !== undefined && <Pair name={t('ASK.answer.scope.branch')}>{citation.branch}</Pair>}
                {citation.validFrom !== undefined && (
                  <Pair name={t('ASK.answer.citation.validFrom')} mono>
                    {citation.validFrom}
                  </Pair>
                )}
                {citation.validTo !== undefined && (
                  <Pair name={t('ASK.answer.citation.validTo')} mono={citation.validTo !== null}>
                    {citation.validTo ?? t('ASK.answer.notSpecified')}
                  </Pair>
                )}
                {citation.learnedAt !== undefined && (
                  <Pair name={t('ASK.answer.citation.learnedAt')} mono>
                    {citation.learnedAt}
                  </Pair>
                )}
              </dl>
            </li>
          ))}
        </MoreRows>
      )}

      <More name={t('ASK.answer.detail.business')}>
        <dl className={s.pairs}>
          <Pair name={t('ASK.answer.scope.corpus')}>{t(`ASK.answer.scope.corpus.${answer.scope.corpus}`)}</Pair>
          <Pair name={t('ASK.answer.scope.branch')}>{answer.scope.branch ?? t('ASK.answer.notSpecified')}</Pair>
          <Pair name={t('ASK.answer.scope.asOf')} mono>
            {answer.scope.asOf}
          </Pair>
          <Pair name={t('ASK.answer.scope.onDate')} mono>
            {answer.scope.onDate}
          </Pair>
          <Pair name={t('ASK.answer.sources')}>
            <Ids ids={answer.sourceIds} />
          </Pair>
          <Pair name={t('ASK.answer.contextDigest')} mono>
            {answer.contextDigest}
          </Pair>
          <Pair name={t('ASK.answer.businessReceipt')}>
            <Reference intent={{ kind: 'business-context-receipt', id: answer.receipt.id }} onReference={onReference} />
          </Pair>
          {answer.receipt.modelReceiptId !== undefined && (
            <Pair name={t('ASK.answer.modelReceipt')}>
              <Reference intent={{ kind: 'model-receipt', id: answer.receipt.modelReceiptId }} onReference={onReference} />
            </Pair>
          )}
        </dl>
      </More>
    </div>
  );
}

/** One tool's result: its error as the engine worded it, or its checked answer. */
function ToolResult({ result, onReference }: { result: CheckedConversationToolResult; onReference: OnReference }) {
  const t = useT();
  const title = <h3 className={s.tool}>{t(TOOL_WORDS[result.tool])}</h3>;
  if (result.error !== undefined) {
    return (
      <>
        {title}
        <p className={s.note}>{t('ASK.answer.tool.error')}</p>
        <p className={s.text}>{result.error.message}</p>
        <p className={[s.code, 'fig'].join(' ')}>{t('ST.failed.code', { code: result.error.code })}</p>
      </>
    );
  }
  if (result.tool === 'business.describe') {
    return (
      <>
        {title}
        <BusinessContext answer={result.answer} onReference={onReference} />
      </>
    );
  }
  return (
    <>
      {title}
      <CalculationReceipt receipt={result.answer} onReference={onReference} />
    </>
  );
}

/** The checked results of one tool turn, in the order they came, and the turn's receipt
 *  behind a disclosure. A result reference names the saved answer of a tool; it is listed
 *  as that, apart from any calculation receipt id. */
function GroundedTools({ tools, onReference }: { tools: CheckedGroundedConversation; onReference: OnReference }) {
  const t = useT();
  const titleId = useId();
  return (
    <section className={s.section} aria-labelledby={titleId}>
      <h2 id={titleId} className={s.label}>
        {t('ASK.answer.tools')}
      </h2>
      <ol className={s.rows}>
        {tools.results.map((result, i) => (
          <li key={i} className={s.result}>
            <ToolResult result={result} onReference={onReference} />
          </li>
        ))}
      </ol>
      <More name={t('ASK.answer.detail.turn')}>
        <dl className={s.pairs}>
          <Pair name={t('ASK.answer.toolReceipt')}>
            <Reference intent={{ kind: 'conversation-tool-receipt', id: tools.receipt.id }} onReference={onReference} />
          </Pair>
          <Pair name={t('ASK.answer.modelReceipt')}>
            <Reference intent={{ kind: 'model-receipt', id: tools.modelReceiptId }} onReference={onReference} />
          </Pair>
          {tools.receipt.resultRefs.map((ref) => (
            <Pair key={ref.answerId} name={t(SAVED_ANSWER_WORDS[ref.tool])}>
              <Reference intent={{ kind: 'answer', id: ref.answerId }} onReference={onReference} />
            </Pair>
          ))}
        </dl>
      </More>
    </section>
  );
}

/** The references of one paragraph, all four lists as supplied. */
function ParagraphReferences({ reference, onReference }: { reference: CheckedConversationReference; onReference: OnReference }) {
  const t = useT();
  return (
    <dl className={s.refs}>
      <Pair name={t('ASK.answer.refs.evidence')}>
        <References kind="evidence" ids={reference.evidenceRefs} onReference={onReference} />
      </Pair>
      <Pair name={t('ASK.answer.refs.answers')}>
        <References kind="answer" ids={reference.answerIds} onReference={onReference} />
      </Pair>
      <Pair name={t('ASK.answer.refs.receipts')}>
        <References kind="receipt" ids={reference.receiptIds} onReference={onReference} />
      </Pair>
      <Pair name={t('ASK.answer.refs.citations')}>
        <References kind="citation" ids={reference.citationIds} onReference={onReference} />
      </Pair>
    </dl>
  );
}

/** A written answer: paragraphs with their references and the cautions, always in view;
 *  then the results, and the writing receipt behind a disclosure. */
function Synthesized({ answer, onReference }: { answer: CheckedSynthesizedConversation; onReference: OnReference }) {
  const t = useT();
  const writtenId = useId();
  const receipt = answer.receipt;
  return (
    <>
      <section className={s.section} aria-labelledby={writtenId}>
        <h2 id={writtenId} className={s.label}>
          {t('ASK.answer.written')}
        </h2>
        {answer.paragraphs.map((paragraph, i) => {
          const reference = answer.references[i];
          return (
            <div key={i} className={s.paragraph}>
              <p className={s.text}>{paragraph}</p>
              {reference !== undefined && <ParagraphReferences reference={reference} onReference={onReference} />}
            </div>
          );
        })}
        {answer.cautions.length > 0 && (
          <Rows name={t('ASK.answer.cautions')}>
            {answer.cautions.map((caution) => (
              <li key={caution.ref} className={s.row}>
                <p className={s.text}>{caution.text}</p>
                <dl className={s.refs}>
                  <Pair name={t('ASK.answer.refs.evidence')}>
                    <Reference intent={{ kind: 'evidence', id: caution.ref }} onReference={onReference} />
                  </Pair>
                </dl>
              </li>
            ))}
          </Rows>
        )}
      </section>

      <GroundedTools tools={answer.tools} onReference={onReference} />

      <More name={t('ASK.answer.synthesisReceipt')}>
        <dl className={s.pairs}>
          <Pair name={t('ASK.answer.synthesisReceipt.id')}>
            <Button variant="link" className={s.id} onClick={() => onReference({ kind: 'synthesis-receipt', receipt })}>
              {receipt.id}
            </Button>
          </Pair>
          <Pair name={t('ASK.answer.synthesisReceipt.toolTurn')}>
            <span className={s.id}>{receipt.toolTurnId}</span>
          </Pair>
          <Pair name={t('ASK.answer.synthesisReceipt.planner')}>
            <Reference intent={{ kind: 'model-receipt', id: receipt.plannerModelReceiptId }} onReference={onReference} />
          </Pair>
          <Pair name={t('ASK.answer.synthesisReceipt.writer')}>
            <Reference intent={{ kind: 'model-receipt', id: receipt.synthesisModelReceiptId }} onReference={onReference} />
          </Pair>
          <Pair name={t('ASK.answer.synthesisReceipt.input')}>
            <span className={s.id}>{receipt.inputDigest}</span>
          </Pair>
          <Pair name={t('ASK.answer.synthesisReceipt.output')}>
            <span className={s.id}>{receipt.outputDigest}</span>
          </Pair>
        </dl>
      </More>
    </>
  );
}

/** The AI model's one question back, in its own words, with its model receipt. */
function Clarification({ answer, onAnswer, onReference }: { answer: CheckedClarification; onAnswer: (() => void) | undefined; onReference: OnReference }) {
  const t = useT();
  const titleId = useId();
  const answerIt = onAnswer;
  return (
    <section className={s.section} aria-labelledby={titleId}>
      <h2 id={titleId} className={s.label}>
        {t('ASK.answer.clarification')}
      </h2>
      <p className={s.text}>{answer.clarification}</p>
      {answerIt !== undefined && (
        <div className={s.actions}>
          <Button variant="quiet" onClick={() => answerIt()}>
            {t('ASK.answer.continue')}
          </Button>
        </div>
      )}
      <dl className={s.pairs}>
        <Pair name={t('ASK.answer.modelReceipt')}>
          <Reference intent={{ kind: 'model-receipt', id: answer.modelReceiptId }} onReference={onReference} />
        </Pair>
      </dl>
    </section>
  );
}

/** A saved tool answer read back on its own: the tool's name over its checked content. */
function Standalone({ tool, children }: { tool: ConversationTool; children: ReactNode }) {
  const t = useT();
  const titleId = useId();
  return (
    <section className={s.section} aria-labelledby={titleId}>
      <h2 id={titleId} className={s.label}>
        {t(TOOL_WORDS[tool])}
      </h2>
      {children}
    </section>
  );
}

export function ConversationAnswer({ saved, onPreviewFinalWriting, onContinue, onReference }: ConversationAnswerProps) {
  const t = useT();
  const titleId = useId();
  const answerIt = onContinue;
  const previewWriting = onPreviewFinalWriting;

  const body = (): ReactNode => {
    switch (saved.kind) {
      case 'clarification':
        return <Clarification answer={saved.answer} onAnswer={answerIt !== undefined ? () => answerIt(saved.id) : undefined} onReference={onReference} />;
      case 'grounded-conversation':
        return (
          <>
            <GroundedTools tools={saved.answer} onReference={onReference} />
            {previewWriting !== undefined && (
              <div className={s.actions}>
                <Button variant="quiet" onClick={() => previewWriting()}>
                  {t('ASK.answer.previewWriting')}
                </Button>
                <span className={s.note}>{t('ASK.answer.previewWriting.note')}</span>
              </div>
            )}
          </>
        );
      case 'synthesized-conversation':
        return <Synthesized answer={saved.answer} onReference={onReference} />;
      case 'business-context':
        return (
          <Standalone tool="business.describe">
            <BusinessContext answer={saved.answer} onReference={onReference} />
          </Standalone>
        );
      case 'calculation':
        return (
          <Standalone tool="calculator.calculate">
            <Calculation answer={saved.answer} onReference={onReference} />
          </Standalone>
        );
    }
  };

  return (
    <article className={s.answer} aria-labelledby={titleId}>
      <h1 id={titleId} className={s.question}>
        {saved.question}
      </h1>
      {body()}
      <More name={t('ASK.answer.detail.saved')}>
        <dl className={s.pairs}>
          <Pair name={t('ASK.answer.saved.id')}>
            <span className={s.id}>{saved.id}</span>
          </Pair>
          <Pair name={t('ASK.answer.saved.at')} mono>
            <time dateTime={saved.at}>{saved.at}</time>
          </Pair>
        </dl>
      </More>
    </article>
  );
}
