/** The three report packs: which registered calculations each page needs, and their words in English and Hindi. */
import type { Words } from './common.ts';

export type PackId = 'lender' | 'ca' | 'investor';
export type GstMode = 'regular' | 'composition' | 'none';
/** One printed line: a figure of one registered calculation's receipt. */
export type LineSpec = { id: string; op: string; figure: string; label: Words; side?: 'Dr' | 'Cr' };
/** A section is either fixed lines over the page period, one line per month for twelve months, or the projection. */
export type SectionSpec = { id: string; title: Words; lines?: LineSpec[]; monthly?: { op: string; figure: string }; forecast?: true };
export type PageSpec = { id: string; title: Words; needs: string[]; sections: SectionSpec[]; notes?: ('43bh' | 'treds')[]; disclaimer?: true };
export type PackSpec = { id: PackId; title: Words; gstModes: GstMode[]; pages: PageSpec[] };

const w = (en: string, hi: string): Words => ({ en, hi });
const line = (id: string, op: string, figure: string, label: Words, side?: 'Dr' | 'Cr'): LineSpec => ({ id, op, figure, label, ...(side ? { side } : {}) });

/** Plain reasons for a page that cannot be made yet. */
export const reasons = {
  gst_turnover: w('Needs GSTR-1 and GSTR-3B returns from the GST connector.', 'GST कनेक्टर से GSTR-1 और GSTR-3B रिटर्न चाहिए।'),
  gstr2b_match: w('Needs GSTR-2B from the GST connector.', 'GST कनेक्टर से GSTR-2B चाहिए।'),
  bank_summary: w('Needs bank statements.', 'बैंक विवरण चाहिए।'),
  unregistered: w('Needs a published calculation for this page.', 'इस पेज के लिए प्रकाशित गणना चाहिए।'),
  dictionary: w('Publish your business definitions first.', 'पहले अपनी व्यावसायिक परिभाषाएँ प्रकाशित करें।'),
  empty: w('No matching records are imported yet.', 'अभी तक कोई मेल खाते रिकॉर्ड आयात नहीं हुए हैं।'),
  refused: w('The calculation was refused for the current records.', 'मौजूदा रिकॉर्ड के लिए गणना अस्वीकार हुई।'),
};
export const notRegistered = (op: string): Words => (reasons as Record<string, Words>)[op] ?? reasons.unregistered;

const ageingLines: LineSpec[] = [
  line('not-due', 'aging', 'notDue', w('Not yet due', 'अभी देय नहीं'), 'Dr'),
  line('days-1-30', 'aging', 'days1to30', w('Overdue 1 to 30 days', '1 से 30 दिन से बकाया'), 'Dr'),
  line('days-31-60', 'aging', 'days31to60', w('Overdue 31 to 60 days', '31 से 60 दिन से बकाया'), 'Dr'),
  line('days-61-90', 'aging', 'days61to90', w('Overdue 61 to 90 days', '61 से 90 दिन से बकाया'), 'Dr'),
  line('over-90', 'aging', 'over90', w('Overdue more than 90 days', '90 दिन से अधिक से बकाया'), 'Dr'),
  line('outstanding', 'aging', 'outstanding', w('Total receivables outstanding', 'कुल बकाया प्राप्य राशि'), 'Dr'),
  line('unallocated', 'aging', 'unallocated', w('Receipts and credits not matched to an invoice', 'किसी बिल से न जुड़ी प्राप्तियाँ और क्रेडिट'), 'Cr'),
];
const ageingPage = (title: Words): PageSpec => ({ id: 'ageing', title, needs: ['aging'], notes: ['43bh', 'treds'],
  sections: [{ id: 'ageing', title: w('Receivables by age, on the last day of the period', 'अवधि के अंतिम दिन आयु के अनुसार प्राप्य राशि'), lines: ageingLines }] });
const registerPage = (id: string, op: string, title: Words, total: Words): PageSpec => ({ id, title, needs: [op], sections: [
  { id: 'total', title: w('For the period', 'इस अवधि में'), lines: [line('total', op, 'total', total)] },
  { id: 'by-month', title: w('By month, last 12 months', 'महीने के अनुसार, पिछले 12 महीने'), monthly: { op, figure: 'total' } },
] });

export const packs: PackSpec[] = [
  { id: 'lender', title: w('Lender pack', 'ऋणदाता पैक'), gstModes: ['regular', 'composition', 'none'], pages: [
    { id: 'key-financials', title: w('Key financials (CMA-style summary)', 'मुख्य वित्तीय आँकड़े (CMA प्रारूप सारांश)'), needs: ['net_sales', 'aging'], sections: [
      { id: 'operations', title: w('Operating figures for the period', 'अवधि के परिचालन आँकड़े'), lines: [
        line('net-sales', 'net_sales', 'total', w('Net sales', 'शुद्ध बिक्री')),
        line('purchases', 'purchases', 'total', w('Purchases', 'ख़रीद')),
        line('contribution', 'margin', 'contribution', w('Contribution after imported costs', 'आयातित लागत के बाद योगदान')),
      ] },
      { id: 'working-capital', title: w('Working capital on the last day', 'अंतिम दिन की कार्यशील पूँजी'), lines: [
        line('receivables', 'aging', 'outstanding', w('Trade receivables', 'व्यापार प्राप्य राशि'), 'Dr'),
      ] },
    ] },
    { id: 'monthly-sales', title: w('Monthly sales, last 12 months', 'मासिक बिक्री, पिछले 12 महीने'), needs: ['net_sales'], sections: [
      { id: 'by-month', title: w('Net sales by month', 'महीने के अनुसार शुद्ध बिक्री'), monthly: { op: 'net_sales', figure: 'total' } },
    ] },
    { ...ageingPage(w('Receivables ageing', 'प्राप्य राशि की आयु-सूची')), id: 'receivables-ageing' },
    { id: 'collections', title: w('Collections', 'वसूली'), needs: ['received'], sections: [
      { id: 'period', title: w('For the period', 'इस अवधि में'), lines: [
        line('billed', 'billed', 'total', w('Billed', 'बिल किया गया')),
        line('received', 'received', 'total', w('Collected', 'वसूल किया गया')),
      ] },
      { id: 'by-month', title: w('Collected by month, last 12 months', 'महीने के अनुसार वसूली, पिछले 12 महीने'), monthly: { op: 'received', figure: 'total' } },
    ] },
    { id: 'gst-turnover', title: w('GST turnover against books', 'GST टर्नओवर बनाम खाते'), needs: ['gst_turnover', 'net_sales'], sections: [
      { id: 'compare', title: w('Turnover in returns and in the books', 'रिटर्न में और खातों में टर्नओवर'), lines: [
        line('gst', 'gst_turnover', 'total', w('Turnover in GST returns', 'GST रिटर्न में टर्नओवर')),
        line('books', 'net_sales', 'total', w('Net sales in the books', 'खातों में शुद्ध बिक्री')),
      ] },
    ] },
    { id: 'bank-summary', title: w('Bank statement summary', 'बैंक विवरण सारांश'), needs: ['bank_summary'], sections: [
      { id: 'bank', title: w('Bank accounts', 'बैंक खाते'), lines: [line('credits', 'bank_summary', 'total', w('Credits in the period', 'अवधि में जमा राशि'))] },
    ] },
    { id: 'loan-readiness', title: w('Ready for a loan?', 'क्या आप ऋण के लिए तैयार हैं?'), needs: ['net_sales', 'received', 'aging'], disclaimer: true, sections: [
      { id: 'signals', title: w('What a lender looks at first', 'ऋणदाता सबसे पहले क्या देखते हैं'), lines: [
        line('net-sales', 'net_sales', 'total', w('Net sales in the period', 'अवधि में शुद्ध बिक्री')),
        line('collected', 'received', 'total', w('Collected in the period', 'अवधि में वसूली')),
        line('receivables', 'aging', 'outstanding', w('Receivables outstanding', 'बकाया प्राप्य राशि'), 'Dr'),
        line('over-90', 'aging', 'over90', w('Overdue more than 90 days', '90 दिन से अधिक से बकाया'), 'Dr'),
      ] },
    ] },
    { id: 'projections', title: w('Projections, kept apart from facts', 'अनुमान, तथ्यों से अलग'), needs: ['revenue'], sections: [
      { id: 'history', title: w('Earned revenue by month (facts)', 'महीने के अनुसार अर्जित राजस्व (तथ्य)'), monthly: { op: 'revenue', figure: 'total' } },
      { id: 'forecast', title: w('Projection for the next month', 'अगले महीने का अनुमान'), forecast: true },
    ] },
  ] },
  { id: 'ca', title: w('CA pack', 'CA पैक'), gstModes: ['regular', 'composition'], pages: [
    registerPage('sales-register', 'billed', w('Sales register', 'बिक्री रजिस्टर'), w('Invoices raised', 'जारी किए गए बिल')),
    registerPage('purchase-register', 'purchases', w('Purchase register', 'ख़रीद रजिस्टर'), w('Purchases', 'ख़रीद')),
    registerPage('receipts', 'received', w('Receipts', 'प्राप्तियाँ'), w('Money received', 'प्राप्त राशि')),
    { id: 'refunds', title: w('Refunds and credit notes', 'रिफ़ंड और क्रेडिट नोट'), needs: ['refunds'], sections: [
      { id: 'total', title: w('For the period', 'इस अवधि में'), lines: [line('total', 'refunds', 'total', w('Refunds and credit notes', 'रिफ़ंड और क्रेडिट नोट'))] },
    ] },
    { id: 'purchases-gstr2b', title: w('Purchases against GSTR-2B', 'GSTR-2B से ख़रीद का मिलान'), needs: ['gstr2b_match', 'purchases'], sections: [
      { id: 'match', title: w('Purchase register against GSTR-2B', 'ख़रीद रजिस्टर बनाम GSTR-2B'), lines: [
        line('books', 'purchases', 'total', w('Purchases in the books', 'खातों में ख़रीद')),
        line('gstr2b', 'gstr2b_match', 'total', w('Purchases in GSTR-2B', 'GSTR-2B में ख़रीद')),
      ] },
    ] },
    ageingPage(w('Receivables ageing', 'प्राप्य राशि की आयु-सूची')),
  ] },
  { id: 'investor', title: w('Investor update', 'निवेशक अपडेट'), gstModes: ['regular', 'composition', 'none'], pages: [
    { id: 'headline', title: w('Headline', 'मुख्य बातें'), needs: ['net_sales'], sections: [
      { id: 'headline', title: w('This period', 'यह अवधि'), lines: [
        line('net-sales', 'net_sales', 'total', w('Net sales', 'शुद्ध बिक्री')),
        line('contribution', 'margin', 'contribution', w('Contribution after imported costs', 'आयातित लागत के बाद योगदान')),
        line('margin', 'margin', 'marginBps', w('Contribution margin', 'योगदान मार्जिन')),
      ] },
    ] },
    { id: 'monthly-trend', title: w('Monthly trend', 'मासिक रुझान'), needs: ['net_sales'], sections: [
      { id: 'by-month', title: w('Net sales by month', 'महीने के अनुसार शुद्ध बिक्री'), monthly: { op: 'net_sales', figure: 'total' } },
    ] },
    { id: 'receivables', title: w('Receivables', 'प्राप्य राशि'), needs: ['aging'], sections: [
      { id: 'receivables', title: w('On the last day of the period', 'अवधि के अंतिम दिन'), lines: [
        line('outstanding', 'aging', 'outstanding', w('Receivables outstanding', 'बकाया प्राप्य राशि'), 'Dr'),
        line('over-90', 'aging', 'over90', w('Overdue more than 90 days', '90 दिन से अधिक से बकाया'), 'Dr'),
      ] },
    ] },
    { id: 'notes', title: w('Notes', 'टिप्पणियाँ'), needs: ['change'], sections: [
      { id: 'change', title: w('Against the previous period of the same length', 'समान लंबाई की पिछली अवधि की तुलना में'), lines: [
        line('current', 'change', 'current', w('Earned revenue, this period', 'अर्जित राजस्व, यह अवधि')),
        line('previous', 'change', 'previous', w('Earned revenue, previous period', 'अर्जित राजस्व, पिछली अवधि')),
        line('change', 'change', 'change', w('Measured change', 'मापा गया बदलाव')),
      ] },
    ] },
  ] },
];

export const words = {
  disclaimer: w('This is not a loan offer or a promise of one.', 'यह ऋण का प्रस्ताव या उसका वादा नहीं है।'),
  investorNote: w('These figures come from imported records only. They are not a valuation and are not audited.', 'ये आँकड़े केवल आयात किए गए रिकॉर्ड से हैं। ये मूल्यांकन नहीं हैं और इनका ऑडिट नहीं हुआ है।'),
  emptyMonths: w('Months with no imported records are shown as missing, not as zero.', 'जिन महीनों के कोई रिकॉर्ड आयात नहीं हुए, वे शून्य नहीं, अनुपलब्ध दिखाए गए हैं।'),
  forecastLine: w('Projected earned revenue, next month', 'अगले महीने का अनुमानित अर्जित राजस्व'),
  forecastInAsk: w('A forecast passed its baseline test. It opens in Ask, not on this page yet.', 'एक अनुमान अपनी आधार-रेखा जाँच में सफल रहा। यह Ask में खुलता है, अभी इस पृष्ठ पर नहीं।'),
  forecastRefused: w('The forecast was refused: it needs at least eight whole, reconciled months of earned revenue and must beat the last-month baseline.', 'अनुमान अस्वीकार किया गया: इसके लिए अर्जित राजस्व के कम से कम आठ पूरे, मिलान किए गए महीने चाहिए और इसे पिछले महीने के आधार से बेहतर होना चाहिए।'),
};
const checkedOn = '2026-10-14';
export const notes: Record<'43bh' | 'treds', { text: Words; source: { title: string; url: string; checkedOn: string } }> = {
  '43bh': {
    text: w('Section 43B(h) of the Income-tax Act: a buyer may deduct an amount owed to a micro or small enterprise registered under the MSMED Act only in the year it is paid, unless it is paid within the time in section 15 of the MSMED Act (15 days, or up to 45 days with a written agreement).',
      'आयकर अधिनियम की धारा 43B(h): MSMED अधिनियम के अंतर्गत पंजीकृत सूक्ष्म या लघु उद्यम को देय राशि की कटौती ख़रीदार को उसी वर्ष मिलती है जिस वर्ष भुगतान हो, जब तक कि भुगतान MSMED अधिनियम की धारा 15 की समय-सीमा (15 दिन, या लिखित समझौते के साथ अधिकतम 45 दिन) के भीतर न किया जाए।'),
    source: { title: 'Income-tax Act, 1961, section 43B(h) (Income Tax Department)', url: 'https://incometaxindia.gov.in/Pages/acts/income-tax-act.aspx', checkedOn },
  },
  treds: {
    text: w('TReDS (Trade Receivables Discounting System) is an RBI-authorised electronic platform where an MSME seller can sell invoices raised on larger buyers to financiers, without recourse to the seller.',
      'TReDS (व्यापार प्राप्य बट्टाकरण प्रणाली) RBI द्वारा अधिकृत एक इलेक्ट्रॉनिक मंच है, जहाँ MSME विक्रेता बड़े ख़रीदारों पर जारी किए गए बिल वित्तदाताओं को बेच सकते हैं, और विक्रेता पर वापसी का दायित्व नहीं रहता।'),
    source: { title: 'Reserve Bank of India, Frequently Asked Questions: Trade Receivables Discounting System (TReDS)', url: 'https://www.rbi.org.in/Scripts/FAQView.aspx?Id=132', checkedOn },
  },
};
