// Chausar delivery harness: made-up files for rehearsal. Chausar wrote them; no client sent them, so rehearsals stay
// free of client data and run under standing consent. Bookkeeping has a clean month that balances and a messy one
// (newest row first, two payments with no bill, one bill not paid); the clean month also has a sales register for a CA
// firm's GST working. Other service types have no practice files yet.
import { digest } from '../../records.ts';
import type { Scenario } from '../../contracts.ts';
import type { FileLike } from './files.ts';
import { CA_PRACTICE } from '../../playbooks/ca-firm/practice.ts';
import { kitPracticeClient, practiceFormat } from '../../playbooks/kit/practice.ts';

type PracticeFile = { name: string; content: string };

const CLEAN_BANK = [
  'Date,Narration,Withdrawal,Deposit,Balance',
  '2026-09-01,Opening balance,,,"50,000.00"',
  '2026-09-02,UPI/Fresh Farms Dairy/milk,"4,500.00",,"45,500.00"',
  '2026-09-05,NEFT/INV-0042/Bean Brothers Coffee,"12,000.00",,"33,500.00"',
  '2026-09-07,Card sales settlement,,"38,250.00","71,750.00"',
  '2026-09-10,UPI/Power Grid Electricity,"6,320.00",,"65,430.00"',
  '2026-09-15,IMPS/Rent September/Shree Estates,"25,000.00",,"40,430.00"',
  '2026-09-20,Card sales settlement,,"41,800.00","82,230.00"',
  '2026-09-28,UPI/Fresh Farms Dairy/milk,"4,500.00",,"77,730.00"',
].join('\n');
const CLEAN_BILLS = [
  'Bill date,Supplier,Bill number,Amount',
  '2026-09-01,Fresh Farms Dairy,FF-0901,"4,500.00"',
  '2026-09-03,Bean Brothers Coffee,INV-0042,"12,000.00"',
  '2026-09-08,Power Grid Electricity,PG-2209,"6,320.00"',
  '2026-09-14,Shree Estates,RENT-SEP,"25,000.00"',
  '2026-09-27,Fresh Farms Dairy,FF-0927,"4,500.00"',
].join('\n');
const MESSY_BANK = [
  'Txn Date,Description,Debit,Credit,Balance',
  '30 Sep 2026,UPI/Fresh Farms Dairy/milk,"4,500.00",,"61,480.00"',
  '22 Sep 2026,ATM cash withdrawal,"5,000.00",,"65,980.00"',
  '18 Sep 2026,Card sales settlement,,"36,900.00","70,980.00"',
  '12 Sep 2026,UPI/Quick Print Shop/flyers,"2,750.00",,"34,080.00"',
  '06 Sep 2026,NEFT/INV-0042/Bean Brothers Coffee,"12,000.00",,"36,830.00"',
  '03 Sep 2026,UPI/Fresh Farms Dairy/milk,"4,500.00",,"48,830.00"',
  '01 Sep 2026,Balance brought forward,,,"53,330.00"',
].join('\n');
const MESSY_BILLS = [
  'Date,Vendor,Ref,Total',
  '2 Sep 2026,Fresh Farms Dairy,FF-0902,"4,500.00"',
  '5 Sep 2026,Bean Bros Coffee,INV-0042,"12,000.00"',
  '29 Sep 2026,Fresh Farms Dairy,FF-0929,"4,500.00"',
  '25 Sep 2026,Kiran Electricals,KE-118,"3,400.00"',
].join('\n');

/**
 * The clean client's sales register for the month, so a CA firm's rehearsal can work its GST (tax.gst): three sales to
 * registered buyers, one of them in another state, and the month's counter sales to buyers with no GSTIN. Each line
 * shows the seller's own GSTIN, which is how the GST tool knows the working is for this client.
 */
const CLEAN_SALES = [
  'Invoice,Date,GSTIN,State,HSN,Taxable,Rate,Seller GSTIN',
  'CAT-0901,2026-09-06,27AAAFS1234K1ZB,27,996334,"18,000.00",18%,27AAACL1234F1ZZ',
  'CAT-0902,2026-09-19,29AAACB1234C1ZB,29,996334,"12,500.00",18%,27AAACL1234F1ZZ',
  'CAT-0903,2026-09-24,27AAAFS1234K1ZB,27,996334,"6,400.00",18%,27AAACL1234F1ZZ',
  'POS-SEP,2026-09-30,,27,996331,"80,050.00",5%,27AAACL1234F1ZZ',
].join('\n');

/** Practice files by template scenario id. Signal cases made from the messy client use the messy files. */
export const PRACTICE_FILES: Readonly<Record<string, readonly PracticeFile[]>> = Object.freeze({
  'bookkeeping-clean': [
    { name: 'bank-statement-september.csv', content: CLEAN_BANK }, { name: 'bills-september.csv', content: CLEAN_BILLS },
    { name: 'sales-register-september.csv', content: CLEAN_SALES },
  ],
  'bookkeeping-messy': [{ name: 'bank-statement-messy.csv', content: MESSY_BANK }, { name: 'bills-messy.csv', content: MESSY_BILLS }],
});

/** The template scenario a scenario's files come from: itself, or the messy client for a signal case. */
function sourceScenario(scenario: Pick<Scenario, 'id' | 'serviceType' | 'source'>): string {
  return scenario.source === 'signal' ? `${scenario.serviceType}-messy` : scenario.id;
}

/** A scenario's practice files: the service type's, or (Ink v2 wave 5, 5A1) a kit playbook's practice client's. */
function filesOf(key: string): readonly PracticeFile[] {
  if (key.startsWith('ca-firm-')) return CA_PRACTICE.find(row=>'ca-firm-'+row.id===key)?.files.map(file=>({name:file.name,content:file.text}))??[];
  if (Object.hasOwn(PRACTICE_FILES, key)) return PRACTICE_FILES[key];
  return kitPracticeClient(key)?.client.files.map(file => ({ name: file.name, content: file.text })) ?? [];
}

export function practiceFileNames(scenario: Pick<Scenario, 'id' | 'serviceType' | 'source'>): string[] {
  return filesOf(sourceScenario(scenario)).map(file => file.name);
}

/** The scenario's practice files as the tools read them. Ids are stable, so the same rehearsal reads the same tables. */
export function practiceFiles(scenario: Pick<Scenario, 'id' | 'serviceType' | 'source'>): FileLike[] {
  const key = sourceScenario(scenario);
  return filesOf(key).map((file, index) => {
    const contentBase64 = Buffer.from(file.content, 'utf8').toString('base64');
    return { id: `practice_${key}_${index + 1}`, name: file.name, format: practiceFormat(file.name) ?? 'csv', bytes: Buffer.byteLength(file.content), digest: digest(contentBase64), contentBase64, clientData: false };
  });
}
