import {wholeCount} from '../../playbooks/kit/count.ts';
// C1 tools: original Chausar adapters. Client money comes from existing file/table picks, never typed model amounts.
import { check } from '../../../contracts.ts';
import { digest } from '../../records.ts';
import { checkCitations, citationUseFor } from '../../playbooks/ca-firm/citations.ts';
import { chooseItrForm, formIntake, FORM_EXCLUSIONS } from '../../playbooks/ca-firm/itr-forms.ts';
import { advanceTax, type AdvanceInput } from '../../playbooks/ca-firm/advance-tax.ts';
import { requireFacts, guessedFacts } from '../../playbooks/ca-firm/needs-facts.ts';
import { newLog, requireRupees, sumPicks } from '../../playbooks/ca-firm/tool-inputs.ts';
import { tablesOfFile } from './files.ts';
import { text, type Field, type Spec } from './tools.ts';
const choice = (values: readonly string[], about: string, required = false): Field => ({ type: 'enum', values, about, required });
const yesNo = (about: string) => choice(['yes', 'no'], about);
const pick: Field = { type: 'object', required: true, about: 'A client source amount.', fields: { table: text('Source table id.', 20), row: text('Source row id.', 20), column: text('Source column.', 80) } };
const picks = (about: string): Field => ({ type: 'list', required: false, max: 20, item: pick, about });
const bool = (value: unknown) => value === undefined ? undefined : value === 'yes';
const citationMode = (env: Parameters<Spec['run']>[0]) => citationUseFor(env.deps.store.read(), env.ventureId, env.rateUse?.mode ?? 'client');
export const CITATIONS: Spec = { name: 'tax.citations', effect: 'compute', tier: 'code', endsTurn: false, summary: 'Check every section against the CA-confirmed dated table. Pass the exact full draft text and the income date.', input: { draft: text('Exact full draft to check.', 100000), incomeDate: text('Date the income relates to, YYYY-MM-DD.', 10) }, async run(env, input) { return { result: { ...checkCitations({ draft: input.draft, incomeDate: input.incomeDate }, citationMode(env)), draftDigest: digest(input.draft), incomeDate: input.incomeDate } }; } };
export const FORM_CHOOSER: Spec = { name: 'tax.formChooser', effect: 'compute', tier: 'code', endsTurn: false, summary: 'Choose an ITR form by dated first-match rules. Read known categories from existing typed tables; never guess missing facts.', input: { assessmentYear: choice(['2026-27', '2027-28'], 'Assessment year.', true), facts: { type: 'object', required: false, about: 'Known facts only. Leave unknown fields out.', fields: { entity: choice(['individual', 'huf', 'firm'], 'Taxpayer type.'), residency: choice(['resident', 'rnor', 'non-resident'], 'Residency.'), hasBusinessIncome: yesNo('Business income?'), presumptive: yesNo('CA-confirmed presumptive eligibility?'), houseProperties: text('Number of house properties.', 3, false), capitalGains: choice(['none', '112A', 'other'], 'Capital gains kind.'), totalIncome: picks('Total income from client figures.'), capitalGainsAmount: picks('Capital gains total, including a source zero when none.'), agriculture: picks('Agricultural income, including a source zero when none.'), exclusions: { type: 'list', required: false, max: 20, item: choice(['none', ...FORM_EXCLUSIONS], 'An exclusion, or none.', true), about: 'Explicitly checked exclusions. Use only none when none applies.' }, regimeLastYear: choice(['old', 'new'], 'Last regime.'), wantedRegime: choice(['old', 'new'], 'Client requested regime.'), switchedBack: yesNo('Has the client switched back to the new regime before?') } } }, async run(env, input) {
        const { askingClient, noRetry } = await import('./tools-ca.ts');
        return noRetry(() => askingClient(env, 'tax.formChooser', input, async () => {
            requireRupees(env);
            const raw = input.facts ?? {};
            check(!raw.exclusions?.includes('none') || raw.exclusions.length === 1, 'TAX_INPUT_INVALID', 'Use none alone, or list the applicable exclusions.');
            const f = { ...raw, ...(raw.exclusions?.[0] === 'none' ? { exclusions: [] } : {}) }, log = newLog();
            const derived = formIntake(f, env.files.flatMap(file => { try {
                return tablesOfFile(file);
            }
            catch {
                return [];
            } }));
            const facts = { ...derived.facts, hasBusinessIncome: bool(f.hasBusinessIncome), presumptive: bool(f.presumptive), switchedBack: bool(f.switchedBack), houseProperties: f.houseProperties === undefined ? undefined : wholeCount(f.houseProperties), totalIncomeMinor: await sumPicks(env, f.totalIncome, 'Total income', log), capitalGainsMinor: await sumPicks(env, f.capitalGainsAmount, 'Capital gains', log), agricultureMinor: await sumPicks(env, f.agriculture, 'Agricultural income', log) };
            return { result: { ...chooseItrForm({ assessmentYear: input.assessmentYear, facts }, citationMode(env)), intake: derived, sourceAmounts: log.sources } };
        }));
    } };
export const ADVANCE: Spec = { name: 'tax.advance', effect: 'compute', tier: 'code', endsTurn: false, summary: 'Compute advance-tax dates and cumulative shares from the client estimate in a typed file. Results stay labelled client estimate.', input: { financialYear: choice(['2025-26', '2026-27'], 'Financial year.', true), estimate: { type: 'object', required: false, about: 'Client estimate and known facts. Unknown facts cause a client question.', fields: { tax: picks('Estimated annual tax.'), tds: picks('Expected TDS, source zero if none.'), tcs: picks('Expected TCS, source zero if none.'), relief: picks('Expected relief, source zero if none.'), residency: choice(['resident', 'non-resident'], 'Residency.'), ageBand: choice(['below-60', '60-79', '80-plus'], 'Age band.'), hasBusinessIncome: yesNo('Business or profession income?'), presumptive: yesNo('Presumptive business or profession?') } } }, async run(env, input) {
        const { askingClient, caAnswer, noRetry } = await import('./tools-ca.ts');
        return noRetry(() => askingClient(env, 'tax.advance', input, async () => {
            requireRupees(env);
            const e = input.estimate ?? {}, log = newLog();
            const engineInput = { financialYear: input.financialYear, estimate: { taxMinor: await sumPicks(env, e.tax, 'Client estimated tax', log), tdsMinor: await sumPicks(env, e.tds, 'Expected TDS', log), tcsMinor: await sumPicks(env, e.tcs, 'Expected TCS', log), reliefMinor: await sumPicks(env, e.relief, 'Expected relief', log), residency: e.residency, ageBand: e.ageBand, hasBusinessIncome: bool(e.hasBusinessIncome), presumptive: bool(e.presumptive) } } as AdvanceInput;
            const receipt = advanceTax(engineInput, env.rateUse ?? { mode: 'client', confirmations: [] });
            return caAnswer(env, receipt, engineInput, log, { instalments: receipt.working.instalments });
        }));
    } };
