// Chausar venture launcher, core (wave 6, package 6C3; DECISIONS D17): what clients pay for each of the 57 beta
// professions (PACKAGES 6E6), from credible published sources only, researched on 1 November 2026. Every amount is in
// minor units (paise for INR, cents for USD) as BigInt, like the rest of the money code. Each range names its sources
// (link, publisher, title, the source's own date when it shows one), the date it was checked and a plain note on how
// the range was read. A profession with no credible source carries `noData` (why) and no range: the app says "No
// reliable data" and never guesses. Nothing here is a model estimate and nothing here ever sets a price: prices stay
// owner-set (core/price-ranges.ts only describes these rows).
//
// Credible means a professional body (ICAI's recommended minimum scale of fees), government data (rate cards and fee
// orders), the published rate pages of established marketplaces (UrbanPro, Urban Company, Practo, WedMeGood, Topmate,
// IndiaMART, Tata 1mg) or reputable news. Sources that read as one firm's own sales page, an unsigned rate calculator or
// a user forum were left out; those professions are marked no reliable data, with the reason.

/** The 11 families of D2, in PACKAGES 6E6 order. */
export const PRICE_FAMILIES = Object.freeze([
  'money-and-tax', 'teaching-and-coaching', 'creative-work', 'writing-and-content', 'local-services',
  'documents-and-reports', 'research-and-analysis', 'people-and-careers', 'shop-and-back-office', 'tech-services',
  'licensed-work',
] as const);
export type PriceFamily = (typeof PRICE_FAMILIES)[number];

export type PriceSource = { url: string; publisher: string; title: string; published: string | null };
/**
 * kind: `range` is low to high as the sources state; `minimums` is a scale of minimum fees ("and above"), so the high
 * end is still a minimum; `cap` is a legal maximum, not a typical fee (low is zero and is not shown).
 */
export type PriceRangeRow = {
  id: string; label: string; currency: 'INR' | 'USD'; low: bigint; high: bigint; kind: 'range' | 'minimums' | 'cap';
  unit: string; city: string | null; sources: readonly PriceSource[]; checkedOn: string; note: string;
};
export type ProfessionPrices = { id: string; family: PriceFamily; label: string; ranges: readonly PriceRangeRow[]; noData?: string };

/** The day the research was done and every source was read. */
export const PRICES_CHECKED_ON = '2026-11-01';
const CHECKED = PRICES_CHECKED_ON;

const ICAI: PriceSource = {
  url: 'https://caalley.com/ca/minimum_fees_icai.pdf', publisher: 'ICAI Committee for Members in Practice',
  title: 'Revised Minimum Recommended Scale of Fees (reprinted on caalley.com)', published: '2020-02-11',
};
const urbanPro = (url: string, title: string, published: string | null = null): PriceSource => ({ url, publisher: 'UrbanPro', title, published });
const indiaMart = (url: string, title: string): PriceSource => ({ url, publisher: 'IndiaMART', title, published: null });
const urbanCompany = (url: string, title: string): PriceSource => ({ url, publisher: 'Urban Company', title, published: null });
const practo = (url: string, title: string): PriceSource => ({ url, publisher: 'Practo', title, published: null });

const rupees = (whole: number) => BigInt(whole) * 100n;
const dollars = (whole: number) => BigInt(whole) * 100n;
const range = (row: Omit<PriceRangeRow, 'checkedOn' | 'kind' | 'currency'> & Partial<Pick<PriceRangeRow, 'kind' | 'currency'>>): PriceRangeRow =>
  ({ currency: 'INR', kind: 'range', ...row, checkedOn: CHECKED });
const none = (id: string, family: PriceFamily, label: string, noData: string): ProfessionPrices => ({ id, family, label, ranges: [], noData });

const MONEY_AND_TAX: ProfessionPrices[] = [
  {
    id: 'accountant', family: 'money-and-tax', label: 'Accountant', ranges: [range({
      id: 'accountant-monthly-books', label: 'Monthly bookkeeping for a small business', low: rupees(499), high: rupees(15000), unit: 'per month', city: null,
      sources: [indiaMart('https://m.indiamart.com/impcat/accounting-services.html', 'Accounting Services')],
      note: 'Lowest and highest of twelve monthly prices that sellers posted, from several cities. What each covers varies by seller.',
    })],
  },
  {
    id: 'chartered-accountant', family: 'money-and-tax', label: 'Chartered accountant', ranges: [
      range({
        id: 'ca-itr-salary', label: 'Income tax return with salary or other income', low: rupees(4000), high: rupees(8000), kind: 'minimums', unit: 'per return', city: null,
        sources: [ICAI],
        note: 'ICAI recommended minimum fees, from class C cities (low) to class A cities such as Mumbai or Delhi (high). They are guidance, not mandatory.',
      }),
      range({
        id: 'ca-gst-monthly', label: 'GST returns, the monthly part of the fee', low: rupees(2000), high: rupees(4000), kind: 'minimums', unit: 'per month', city: null,
        sources: [ICAI],
        note: 'ICAI recommended minimums for class C to class A cities. The scale adds a separate fixed fee on top. Guidance, not mandatory.',
      }),
    ],
  },
  none('itr-preparer', 'money-and-tax', 'Retired tax or bank staff (income tax returns)', 'The only figures found are government scheme caps for tax return preparers from 2008 and 2012, not current prices.'),
  {
    id: 'payroll-executive', family: 'money-and-tax', label: 'Payroll executive', ranges: [range({
      id: 'payroll-monthly', label: 'Payroll processing for a small firm', low: rupees(500), high: rupees(20000), unit: 'per month', city: null,
      sources: [indiaMart('https://m.indiamart.com/impcat/payroll-processing-service.html', 'Payroll Services')],
      note: 'Lowest and highest of about thirteen monthly prices that sellers posted. Headcount and filings covered are not stated.',
    })],
  },
  {
    id: 'company-secretary', family: 'money-and-tax', label: 'Company secretary', ranges: [
      range({
        id: 'cs-incorporation', label: 'Forming a private limited company or LLP', low: rupees(18000), high: rupees(35000), kind: 'minimums', unit: 'per company formed', city: null,
        sources: [ICAI],
        note: 'From ICAI\'s scale for chartered accountants, who also do this work, class C to class A cities. ICSI publishes no rupee figures.',
      }),
      range({
        id: 'cs-annual-return', label: 'Filing an annual return with the registrar', low: rupees(5000), high: rupees(10000), kind: 'minimums', unit: 'per form', city: null,
        sources: [ICAI],
        note: 'ICAI recommended minimums, class C to class A cities. Guidance, not mandatory.',
      }),
    ],
  },
];

const TEACHING: ProfessionPrices[] = [
  {
    id: 'school-teacher', family: 'teaching-and-coaching', label: 'School teacher (private tuition)', ranges: [
      range({
        id: 'tuition-class-10', label: 'Class 10 tuition', low: rupees(300), high: rupees(400), unit: 'per hour', city: null,
        sources: [urbanPro('https://www.urbanpro.com/class-10-tuition-fees', 'Class 10 Tuition Course Fees')],
        note: 'The range the page states for India. Teachers in government schools may not take private tuition (RTE Act section 28).',
      }),
      range({
        id: 'tuition-bengaluru', label: 'Tuition, all subjects', low: rupees(350), high: rupees(350), unit: 'per hour', city: 'Bengaluru',
        sources: [urbanPro('https://www.urbanpro.com/bangalore/tuition', 'Tuition Classes in Bangalore', '2026-10-29')],
        note: 'The average price the page shows across tutors in Bengaluru.',
      }),
    ],
  },
  {
    id: 'spoken-english-trainer', family: 'teaching-and-coaching', label: 'Spoken English trainer', ranges: [
      range({
        id: 'spoken-english-india', label: 'Spoken English classes', low: rupees(300), high: rupees(400), unit: 'per hour', city: null,
        sources: [urbanPro('https://www.urbanpro.com/spoken-english-classes-fees', 'Spoken English Course Fees')],
        note: 'The range the page states for India.',
      }),
      range({
        id: 'spoken-english-home', label: 'Spoken English classes at home', low: rupees(300), high: rupees(500), unit: 'per hour', city: 'Bengaluru',
        sources: [urbanPro('https://www.urbanpro.com/bangalore/spoken-english-classes/electronic-city', 'Spoken English Classes in Electronic City, Bangalore', '2026-10-26')],
        note: 'The hourly range shown for one Bengaluru area.',
      }),
    ],
  },
  {
    id: 'yoga-fitness-trainer', family: 'teaching-and-coaching', label: 'Yoga or fitness trainer', ranges: [
      range({
        id: 'yoga-india', label: 'Yoga classes', low: rupees(400), high: rupees(500), unit: 'per hour', city: null,
        sources: [urbanPro('https://www.urbanpro.com/yoga-classes-fees', 'Yoga Course Fees')],
        note: 'The range the page states for India.',
      }),
      range({
        id: 'fitness-home-pune', label: 'Personal trainer at home', low: rupees(600), high: rupees(1000), unit: 'per hour', city: 'Pune',
        sources: [urbanPro('https://www.urbanpro.com/pune/personal-trainer/camp', 'Personal Trainer in Camp, Pune', '2026-10-25')],
        note: 'The hourly range shown for one Pune area.',
      }),
    ],
  },
  {
    id: 'music-dance-teacher', family: 'teaching-and-coaching', label: 'Music or dance teacher', ranges: [
      range({
        id: 'music-india', label: 'Music lessons, guitar to vocal', low: rupees(400), high: rupees(600), unit: 'per hour', city: null,
        sources: [
          urbanPro('https://www.urbanpro.com/guitar-classes-fees', 'Guitar Course Fees'),
          urbanPro('https://www.urbanpro.com/vocal-music-classes-fees', 'Vocal Music Course Fees'),
        ],
        note: 'Low from the guitar page, high from the vocal music page, both for India.',
      }),
      range({
        id: 'dance-india', label: 'Dance classes', low: rupees(400), high: rupees(600), unit: 'per hour', city: null,
        sources: [urbanPro('https://www.urbanpro.com/dance-classes-fees', 'Dance Course Fees')],
        note: 'The range the page states for India.',
      }),
    ],
  },
  {
    id: 'corporate-trainer', family: 'teaching-and-coaching', label: 'Corporate trainer', ranges: [range({
      id: 'soft-skills-bengaluru', label: 'Soft skills training, one to one', low: rupees(600), high: rupees(1000), unit: 'per hour', city: 'Bengaluru',
      sources: [urbanPro('https://www.urbanpro.com/bangalore/soft-skills-training-classes/electronic-city/1324827', 'Soft Skills Training Classes in Electronic City, Bangalore', '2026-10-29')],
      note: 'Individual sessions. No reliable data was found for corporate day rates.',
    })],
  },
  {
    id: 'senior-mentor', family: 'teaching-and-coaching', label: 'Senior mentor', ranges: [range({
      id: 'mentor-30-min', label: 'Career coaching call', low: rupees(81), high: rupees(1205), unit: 'per 30 minute call', city: null,
      sources: [{ url: 'https://topmate.io/s/career-guidance', publisher: 'Topmate', title: 'Career coaching in India', published: null }],
      note: 'Lowest and highest of the seven priced 30 minute calls listed on the page. Prices vary widely.',
    })],
  },
  {
    id: 'dietitian', family: 'teaching-and-coaching', label: 'Dietitian', ranges: [
      range({
        id: 'dietitian-bengaluru', label: 'Clinic consultation', low: rupees(500), high: rupees(2500), unit: 'per consultation', city: 'Bengaluru',
        sources: [practo('https://www.practo.com/bangalore/dietitian-nutritionist', 'Dietitian/Nutritionists in Bangalore')],
        note: 'Lowest and highest of the first ten listings.',
      }),
      range({
        id: 'dietitian-delhi', label: 'Clinic consultation', low: rupees(499), high: rupees(2500), unit: 'per consultation', city: 'Delhi',
        sources: [practo('https://www.practo.com/delhi/dietitian-nutritionist', 'Dietitian/Nutritionists in Delhi')],
        note: 'Lowest and highest of the first ten listings, leaving out one free sponsored listing.',
      }),
    ],
  },
  {
    id: 'language-teacher', family: 'teaching-and-coaching', label: 'Language teacher', ranges: [
      range({
        id: 'french-india', label: 'French lessons', low: rupees(400), high: rupees(500), unit: 'per hour', city: null,
        sources: [urbanPro('https://www.urbanpro.com/french-language-classes-fees', 'French Language Course Fees')],
        note: 'The range the page states for India.',
      }),
      range({
        id: 'german-india', label: 'German lessons', low: rupees(300), high: rupees(500), unit: 'per hour', city: null,
        sources: [urbanPro('https://www.urbanpro.com/german-language-classes-fees', 'German Language Course Fees')],
        note: 'The range the page states for India.',
      }),
    ],
  },
];

const PRASAR_BHARATI: PriceSource = {
  url: 'https://prasarbharati.gov.in/?p=27720', publisher: 'Prasar Bharati (Doordarshan)', title: 'Rate Card for Artist and Casual Assignees', published: '2023-07-04',
};

const CREATIVE: ProfessionPrices[] = [
  {
    id: 'photographer', family: 'creative-work', label: 'Photographer', ranges: [
      range({
        id: 'wedding-photo-delhi', label: 'Wedding photos and video', low: rupees(30000), high: rupees(200000), unit: 'per day', city: 'Delhi NCR',
        sources: [{ url: 'https://www.wedmegood.com/vendors/delhi-ncr/wedding-photographers/', publisher: 'WedMeGood', title: 'Wedding Photographers in Delhi NCR', published: null }],
        note: 'The range the page\'s own answers give for Delhi. No reliable data was found for product or event photography.',
      }),
      range({
        id: 'wedding-photo-mumbai', label: 'Wedding photos and video', low: rupees(30000), high: rupees(220000), unit: 'per day', city: 'Mumbai',
        sources: [{ url: 'https://www.wedmegood.com/vendors/mumbai/wedding-photographers/', publisher: 'WedMeGood', title: 'Wedding Photographers in Mumbai', published: null }],
        note: 'Lowest and highest of the first twenty listings, as the photographers entered them.',
      }),
    ],
  },
  none('video-editor', 'creative-work', 'Video editor', 'Marketplace rate pages would not load, and the rate text that did load reads as generic copy, not data.'),
  none('graphic-designer', 'creative-work', 'Graphic designer', 'Marketplace rate pages would not load, and the rate text that did load reads as generic copy, not data.'),
  {
    id: 'voice-artist', family: 'creative-work', label: 'Voice artist', ranges: [
      range({
        id: 'voice-others', label: 'Narration for a programme, most voices', low: rupees(3000), high: rupees(5000), unit: 'per programme', city: null,
        sources: [PRASAR_BHARATI],
        note: 'Doordarshan\'s rate card for its own programmes: the regional rate (low) and the national rate (high). Private work may pay differently.',
      }),
      range({
        id: 'voice-acclaimed', label: 'Narration for a programme, acclaimed voices', low: rupees(5000), high: rupees(30000), unit: 'per programme', city: null,
        sources: [PRASAR_BHARATI],
        note: 'From the regional rate for regionally acclaimed voices to the national rate for nationally acclaimed ones.',
      }),
    ],
  },
  none('interior-designer-architect', 'creative-work', 'Interior designer or architect', 'Only percentage-of-cost scales were found, and the Council of Architecture scale is no longer binding.'),
  none('tailor-fashion-designer', 'creative-work', 'Tailor or fashion designer', 'Only undated write-ups of single shops were found, which are too thin to show as a range.'),
];

const WRITING: ProfessionPrices[] = [
  none('journalist-newsletter', 'writing-and-content', 'Journalist (newsletters)', 'No Indian outlet or survey publishes current freelance rates.'),
  none('marketing-seo-blogs', 'writing-and-content', 'Marketing executive (SEO blogs)', 'Marketplace rate pages would not load, and the rate text that did load reads as generic copy, not data.'),
  none('copywriter', 'writing-and-content', 'Copywriter', 'Marketplace rate pages would not load, and the rate text that did load reads as generic copy, not data.'),
  none('podcaster', 'writing-and-content', 'Podcaster', 'Only one studio\'s own price page was found.'),
  {
    id: 'ghostwriter', family: 'writing-and-content', label: 'Founder ghostwriter', ranges: [range({
      id: 'linkedin-ghostwriting', label: 'LinkedIn ghostwriting for founders and leaders', currency: 'USD', low: dollars(400), high: dollars(1000), unit: 'per month', city: null,
      sources: [{ url: 'https://the-ken.com/story/inside-the-very-serious-business-of-ghostwriting-hot-takes-on-linkedin/', publisher: 'The Ken', title: 'Inside the very serious business of ghostwriting hot takes on LinkedIn', published: '2022-10-18' }],
      note: 'What Indian ghostwriters reported charging senior leaders in 2022, depending on the number of posts.',
    })],
  },
  {
    id: 'translator', family: 'writing-and-content', label: 'Translator', ranges: [
      range({
        id: 'translator-per-word', label: 'Translation at government rates', low: 50n, high: 125n, unit: 'per word', city: null,
        sources: [
          { url: 'https://www.ntm.org.in/announcements/Rates%20for%20translators,%20data%20entry,%20copy%20eidtor,%20proof%20reader%20and%20reviewers.pdf', publisher: 'National Translation Mission (Ministry of Education)', title: 'Rates for translators, data entry, copy editors, proof readers and reviewers', published: '2020-09-22' },
          { url: 'https://static.pib.gov.in/WriteReadData/specificdocs/documents/2024/mar/doc202437320701.pdf', publisher: 'Press Information Bureau', title: 'Guidelines for empanelment of casual and online translators', published: '2024-03' },
        ],
        note: 'Low is the National Translation Mission\'s general rate; high is PIB\'s online translator rate. Government rates sit at the low end of the market.',
      }),
      range({
        id: 'translator-shift', label: 'Casual translator at PIB', low: rupees(1800), high: rupees(2000), unit: 'per shift', city: 'New Delhi',
        sources: [{ url: 'https://static.pib.gov.in/WriteReadData/specificdocs/documents/2024/mar/doc202437320701.pdf', publisher: 'Press Information Bureau', title: 'Guidelines for empanelment of casual and online translators', published: '2024-03' }],
        note: 'Junior translator (low) and senior translator (high) rates per shift.',
      }),
    ],
  },
];

const LOCAL: ProfessionPrices[] = [
  {
    id: 'beautician', family: 'local-services', label: 'Beautician or salon', ranges: [
      range({
        id: 'salon-home-basics', label: 'Salon at home, threading to full body waxing', low: rupees(49), high: rupees(1419), unit: 'per service', city: 'Delhi NCR',
        sources: [urbanCompany('https://www.urbancompany.com/delhi-ncr-salon-at-home', 'Salon at home, Delhi NCR')],
        note: 'Starting prices of the cheapest and dearest listed service. Bills can run higher.',
      }),
      range({
        id: 'salon-home-facials', label: 'Salon at home, cleanups and facials', low: rupees(699), high: rupees(2059), unit: 'per service', city: 'Delhi NCR',
        sources: [urbanCompany('https://www.urbancompany.com/delhi-ncr-salon-at-home', 'Salon at home, Delhi NCR')],
        note: 'The cheapest cleanup to the dearest facial on the page.',
      }),
    ],
  },
  {
    id: 'electrician-plumber-ac', family: 'local-services', label: 'Electrician, plumber or AC technician', ranges: [
      range({
        id: 'electrician-plumber-visit', label: 'Home visit and small fixes', low: rupees(49), high: rupees(199), unit: 'per visit', city: 'Delhi NCR',
        sources: [
          urbanCompany('https://www.urbancompany.com/delhi-ncr-electricians', 'Electricians, Delhi NCR'),
          urbanCompany('https://www.urbancompany.com/delhi-ncr-plumbers', 'Plumbers, Delhi NCR'),
        ],
        note: 'From the consultation visit to the starting price of common small repairs. Larger jobs cost more.',
      }),
      range({
        id: 'ac-service-visit', label: 'AC check-up to a single AC service', low: rupees(299), high: rupees(599), unit: 'per visit', city: 'Delhi NCR',
        sources: [urbanCompany('https://www.urbancompany.com/delhi-ncr-ac-service-repair', 'AC service and repair, Delhi NCR')],
        note: 'Starting prices. Gas refills and installation are priced separately.',
      }),
    ],
  },
  none('home-chef-tiffin', 'local-services', 'Home chef or tiffin', 'Only lifestyle lists and old news stories were found, with no current monthly prices.'),
  none('real-estate-broker', 'local-services', 'Real estate broker', 'Brokerage is a custom percentage, and the only sources found were user forums and an old news line.'),
  none('travel-agent', 'local-services', 'Travel agent', 'The only fee figures found are more than ten years old.'),
  {
    id: 'event-wedding-planner', family: 'local-services', label: 'Event or wedding planner', ranges: [range({
      id: 'wedding-planning-fee', label: 'Wedding planning fee, starting prices', low: rupees(100000), high: rupees(600000), unit: 'per wedding', city: 'Delhi NCR',
      sources: [{ url: 'https://www.wedmegood.com/vendors/delhi-ncr/wedding-planners/', publisher: 'WedMeGood', title: 'Wedding Planners in Delhi NCR', published: null }],
      note: 'Lowest and highest starting fee among the twenty planners listed. Most list about two lakh.',
    })],
  },
  {
    id: 'physiotherapist', family: 'local-services', label: 'Physiotherapist', ranges: [range({
      id: 'physio-home-session', label: 'Physiotherapy at home, up to an hour', low: rupees(800), high: rupees(900), unit: 'per session', city: null,
      sources: [{ url: 'https://www.1mg.com/labs/test/physiotherapy-home-1-session-36976', publisher: 'Tata 1mg', title: 'Physiotherapy at Home, 1 Session', published: null }],
      note: 'Bengaluru, Hyderabad and Kolkata (low); New Delhi and Noida (high).',
    })],
  },
];

const DOCUMENTS: ProfessionPrices[] = [
  none('tender-bid-writer', 'documents-and-reports', 'Tender or GeM bid writer', 'Only seller listings with unclear units were found.'),
  none('hr-handbooks', 'documents-and-reports', 'HR executive (handbooks)', 'No professional body, government or news source gives figures.'),
  none('quality-sops', 'documents-and-reports', 'Quality engineer (SOPs)', 'Listings found price certificates, not SOP writing.'),
  {
    id: 'dpr-cma-reports', family: 'documents-and-reports', label: 'Bank officer (DPR or CMA reports)', ranges: [
      range({
        id: 'cma-data', label: 'CMA data for a bank loan', low: rupees(2599), high: rupees(20000), unit: 'per set', city: null,
        sources: [indiaMart('https://m.indiamart.com/impcat/data-preparation-services.html', 'Data Preparation Services')],
        note: 'Lowest and highest of six prices that sellers posted. Most sit near five thousand.',
      }),
      range({
        id: 'project-report', label: 'Project report for a bank loan', low: rupees(1999), high: rupees(50000), unit: 'per report', city: null,
        sources: [indiaMart('https://m.indiamart.com/impcat/project-report-services.html', 'Project Report Services')],
        note: 'Lowest and highest of about eighteen business report listings. Some are generic industry profiles, not reports made for one client.',
      }),
    ],
  },
  {
    id: 'civil-estimates', family: 'documents-and-reports', label: 'Civil engineer (estimates)', ranges: [range({
      id: 'building-estimate', label: 'Building estimate or bill of quantities', low: 150n, high: 600n, unit: 'per sq ft built up', city: 'Pune',
      sources: [indiaMart('https://m.indiamart.com/pune/estimating-services.html', 'Estimating Services in Pune')],
      note: 'Lowest and highest of the per square foot prices sellers posted, leaving out one outlier.',
    })],
  },
  {
    id: 'thesis-editing', family: 'documents-and-reports', label: 'Academic (thesis editing)', ranges: [range({
      id: 'thesis-proofreading', label: 'Thesis proofreading', low: rupees(100), high: rupees(499), unit: 'per page', city: null,
      sources: [indiaMart('https://m.indiamart.com/impcat/proofreading-service.html', 'Proofreading Service')],
      note: 'Lowest and highest of the listings for thesis proofreading.',
    })],
  },
  none('technical-writer', 'documents-and-reports', 'Technical writer', 'The only survey found rests on nine profiles, too few to rely on.'),
];

const NO_MARKETPLACE = 'Marketplace rate pages would not load, and no other credible source was found.';
const RESEARCH: ProfessionPrices[] = [
  none('market-research-analyst', 'research-and-analysis', 'Market research analyst', NO_MARKETPLACE),
  none('mis-data-analyst', 'research-and-analysis', 'MIS or data analyst', NO_MARKETPLACE),
  none('sales-executive', 'research-and-analysis', 'Sales executive', 'No credible published price for lead generation or sales outsourcing was found.'),
  none('researcher', 'research-and-analysis', 'Researcher', NO_MARKETPLACE),
  none('procurement-executive', 'research-and-analysis', 'Procurement executive', 'No credible published procurement consulting fees were found.'),
];

const PEOPLE: ProfessionPrices[] = [
  none('hr-recruiter', 'people-and-careers', 'HR recruiter', 'Only recruiters\' own blogs were found; the news pages would not load.'),
  none('resume-writer', 'people-and-careers', 'Placement officer (resumes)', 'The established services\' price pages would not load.'),
];

const SHOP: ProfessionPrices[] = [
  none('marketplace-seller-ops', 'shop-and-back-office', 'Ex-retail staff (marketplaces)', 'Marketplaces leave fees to seller and provider; only unverified ads were found.'),
  none('customer-service', 'shop-and-back-office', 'Customer service', 'No credible published price per support agent was found.'),
  none('data-entry', 'shop-and-back-office', 'Data entry', NO_MARKETPLACE),
  none('executive-assistant', 'shop-and-back-office', 'Executive assistant', NO_MARKETPLACE),
];

const TECH: ProfessionPrices[] = [
  none('website-developer', 'tech-services', 'Software engineer (websites)', 'Only agency and hosting blogs were found.'),
  none('qa-tester', 'tech-services', 'QA tester', NO_MARKETPLACE),
  {
    id: 'it-support', family: 'tech-services', label: 'IT support', ranges: [range({
      id: 'computer-repair-visit', label: 'Laptop or computer repair visit', low: rupees(159), high: rupees(599), unit: 'per visit', city: 'Noida',
      sources: [urbanCompany('https://www.urbancompany.com/delhi-ncr-laptop-repair-sector-23-noida', 'Laptop repair, Sector 23 Noida')],
      note: 'From the inspection charge to the starting price of a service. Spare parts cost extra.',
    })],
  },
  none('ai-receptionist', 'tech-services', 'Call centre agent (AI receptionist)', 'No credible published monthly price for a call answering service was found.'),
];

const CGC: PriceSource = {
  url: 'https://www.staffnews.in/2026/02/revision-of-fee-payable-to-various-categories-of-central-government-counsel.html',
  publisher: 'Department of Legal Affairs (reproduced by StaffNews)', title: 'Revision of fee payable to Central Government Counsel', published: '2026-02-05',
};

const LICENSED: ProfessionPrices[] = [
  {
    id: 'advocate', family: 'licensed-work', label: 'Advocate', ranges: [
      range({
        id: 'govt-counsel-district', label: 'Government counsel, district courts', low: rupees(960), high: rupees(2880), unit: 'per hearing', city: null,
        sources: [CGC],
        note: 'What the central government pays its own panel lawyers from 1 February 2026, not private fees. Advocates may not advertise fees.',
      }),
      range({
        id: 'govt-counsel-high-court', label: 'Government counsel, High Courts and tribunals', low: rupees(3600), high: rupees(14400), unit: 'per hearing', city: null,
        sources: [CGC],
        note: 'Effective hearing fees for the central government\'s panel lawyers, by grade.',
      }),
    ],
  },
  {
    id: 'doctor', family: 'licensed-work', label: 'Doctor', ranges: [
      range({
        id: 'online-consultation', label: 'Online consultation', low: rupees(199), high: rupees(899), unit: 'per consultation', city: null,
        sources: [practo('https://www.practo.com/consult', 'Online doctor consultation')],
        note: 'From the starting price to the dearest speciality shown. Follow the Telemedicine Practice Guidelines 2020.',
      }),
      range({
        id: 'gp-clinic-bengaluru', label: 'General physician at a clinic', low: rupees(400), high: rupees(1200), unit: 'per consultation', city: 'Bengaluru',
        sources: [practo('https://www.practo.com/bangalore/general-physician', 'General Physicians in Bangalore')],
        note: 'Lowest and highest of the first ten doctors listed.',
      }),
    ],
  },
  {
    id: 'financial-planner', family: 'licensed-work', label: 'Financial planner or MFD', ranges: [range({
      id: 'ria-fee-cap', label: 'Registered investment adviser, fixed fee', low: 0n, high: rupees(151000), kind: 'cap', unit: 'per family a year', city: null,
      sources: [
        { url: 'https://cafemutual.com/news/industry/33937-rias-can-now-charge-fees-up-to-rs-151-lakh-per-family-in-fixed-fees', publisher: 'Cafemutual', title: 'RIAs can now charge fees up to Rs 1.51 lakh per family in fixed fees', published: '2025-01-09' },
        { url: 'https://www.taxmann.com/post/blog/sebi-master-circular-for-investment-advisers-fees-aua-disclosures/', publisher: 'Taxmann', title: 'SEBI Master Circular for Investment Advisers: fees', published: '2026-02-09' },
      ],
      note: 'SEBI\'s legal maximum for a registered adviser, not a typical fee. Advice needs SEBI registration.',
    })],
  },
];

/** Every profession of the beta, by family, in PACKAGES 6E6 order. */
export const PROFESSION_PRICES: readonly ProfessionPrices[] = Object.freeze([
  ...MONEY_AND_TAX, ...TEACHING, ...CREATIVE, ...WRITING, ...LOCAL, ...DOCUMENTS, ...RESEARCH, ...PEOPLE, ...SHOP, ...TECH, ...LICENSED,
]);
