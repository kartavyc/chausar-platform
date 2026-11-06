import {renderDeliverable} from '../../delivery/deliverable.ts';
import type {FlagshipCheckInput} from '../draft-checks.ts';

/** The exact client-facing article, with code-rendered figures and dates; generated attachments are separate evidence. */
export function seoArticleText(input: Pick<FlagshipCheckInput, 'deliverable' | 'receipts' | 'dateOrder'>): string {
 const receipts=input.receipts??[];
 for(const section of input.deliverable.sections)for(const part of section.parts){
  if(part.kind!=='figure')continue;
  const matches=receipts.filter(receipt=>receipt.id===part.receiptId);
  const figures=matches.length===1?matches[0].figures.filter(figure=>figure.key===part.figureKey):[];
  if(figures.length!==1)throw new Error('The article refers to a missing or ambiguous receipt figure. Check the current draft receipts.');
 }
 return renderDeliverable(input.deliverable,receipts,{dateOrder:input.dateOrder},{attachments:false});
}
