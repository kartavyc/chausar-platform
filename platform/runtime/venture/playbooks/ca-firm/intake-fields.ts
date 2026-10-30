// C1 intake schema. Original Chausar fields with a plain reason for every technical question.
import type { KitIntakeField } from '../kit/define.ts';
export const CA_INCOME_KINDS = ['salary', 'house-property', 'business', 'capital-gains', 'other'];
export function caIntakeFields(offer: string): KitIntakeField[] | undefined {
    if(offer==='books-health-check')return [
      {id:'tdsHistoryComplete',kind:'yes-no',label:'Complete prior TDS history',help:'Confirm that every earlier payment relevant to this year TDS threshold is included, or that there were none.',required:false},
      {id:'quarter',kind:'text',label:'Calendar quarter',help:'For example 2026-Q4. It limits the source dates checked.',required:true},
      {id:'financialYear',kind:'choice',label:'Financial year',help:'The year selects the dated tax tables your CA confirms.',required:true,options:['2026-27']},
      {id:'coverage',kind:'text',label:'Source coverage and missing files',help:'Name each ledger or bank export and any known gaps. Only supplied lines can be checked.',required:true},
      {id:'reviewThreshold',kind:'text',label:'Purchase review threshold source',help:'Identify the source cell holding the owner threshold. The agent cannot invent an amount.',required:true},
    ];
    if (!offer.startsWith('itr-') && !['check-return-elsewhere', 'advance-tax-freelancer', 'tax-question-desk'].includes(offer))
        return undefined;
    return [
        { id: 'incomeKinds', kind: 'list', label: 'Income sources', help: 'Choose every source. The return form depends on the combination.', required: false, options: CA_INCOME_KINDS },
        { id: 'residency', kind: 'choice', label: 'Residency', help: 'Simple return forms are limited to ordinarily resident taxpayers.', required: false, options: ['resident', 'rnor', 'non-resident'] },
        { id: 'regimeLastYear', kind: 'choice', label: 'Last year tax regime', help: 'Past choices can limit how a business taxpayer switches regimes.', required: false, options: ['old', 'new'] },
        { id: 'hasBusinessIncome', kind: 'yes-no', label: 'Business or professional income', help: 'Business income changes the form and regime switching rules.', required: false },
        { id: 'incomeDate', kind: 'date', label: 'Income date', help: 'The date decides which Act and section numbers apply.', required: false },
        { id: 'questions', kind: 'text', label: 'Further tax questions', help: 'Second round: add technical facts or questions with the reason each matters. Leave facts already in your typed tables out.', required: false },
    ];
}
