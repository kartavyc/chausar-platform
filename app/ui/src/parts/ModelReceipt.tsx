/**
 * W6 6G5 (D44): a run's model receipt, as the engine sends it: which tool or model ran it, the tier, the tokens the
 * provider reported (or that none were), and the cost when it is known. A cost code priced from the reported use sits
 * with its receipt; a run on the owner's own plan says so, with no figure and never rupees; any other cost is the
 * engine's words. Nothing is worked out here.
 */

import { useT } from '../text';
import type { ModelReceiptView } from '../engine/types';
import { Figure } from './Figure';
import s from './ModelReceipt.module.css';

export function ModelReceipt({ receipt }: { receipt: ModelReceiptView | undefined }) {
  const t = useT();
  if (!receipt) return null;
  const parts = [receipt.tool, receipt.model, receipt.tier, receipt.usage];
  // 4Z3: a priced cost as the owner's currency leads it, the engine's own figure otherwise.
  const shown = receipt.costLead?.figure ?? receipt.cost;
  return (
    <div className={s.receipt} data-model-receipt={receipt.state}>
      <p className={s.head}>{t('run.modelReceipt.title')}</p>
      <p className={s.line}>
        {parts.map((part, index) => <span key={index} data-content={index === 1 ? '' : undefined}>{part}<span className={s.dot} aria-hidden="true"> · </span></span>)}
        {receipt.state === 'priced' && receipt.receiptId
          ? <Figure value={shown} receiptId={receipt.receiptId} />
          : <span data-engine-line="">{shown}</span>}
      </p>
      {receipt.agent && <p className={s.by}>{t('run.modelReceipt.by', { agent: receipt.agent })}</p>}
    </div>
  );
}
