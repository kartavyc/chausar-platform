// Chausar venture launcher, core (wave 6, package 6E6; DECISIONS D1, D2, D21): the 57 professions of the beta. This is
// the one list: each profession's id, label, family, the offers it starts from, the playbook (or desk) that runs it and
// any other playbook it can use, its cautions (the statutes of PACKAGES 6E6 and its hard stops) and its size. The price
// guide (core/price-ranges-data.ts, 6C3) and the compliance check (core/compliance-data.ts, 6C6) key off these ids, and
// validatePriceRanges and the 6E6 test hold all three lists equal.
//
// The statutes were read on 1 November 2026. A statute is `checked` only when its text was opened on an official
// government host (the link is kept); the rest say why they are unchecked, and the screen marks them "Not checked
// against the official page yet". No section number here was taken from anywhere but the official text read.
//
// Pure: no clock, no store, no engine import. The fake engine reads this file too.
import type { FamilyId } from './first-run-types.ts';

/**
 * The usual shape of one client job, which also suggests how it is charged: `task` a single short job (a return, a
 * lesson, a repair visit), `monthly` ongoing work each month, `project` one piece of work over days or weeks.
 */
export const PROFESSION_SIZES = Object.freeze(['task', 'monthly', 'project'] as const);
export type ProfessionSize = (typeof PROFESSION_SIZES)[number];

export type CautionSource = { url: string; publisher: string; title: string };
/**
 * A statute a profession must keep. checked: its text was read on an official host on checkedOn; section is the
 * section, rule or regulation as that text states it. Unchecked: checkedOn and section are null and note says why.
 */
export type Caution = {
  id: string; title: string; line: string; instrument: string; section: string | null;
  checked: boolean; checkedOn: string | null; sources: readonly CautionSource[]; note: string;
};

export type Profession = {
  id: string; label: string; family: FamilyId;
  /** Offer names the plan starts from; plain words, no amounts. */
  offers: readonly string[];
  /** The registered playbook (or desk) that runs this profession. */
  playbook: string;
  /** Other playbooks this profession can also use. */
  also: readonly string[];
  /** Ids in CAUTIONS. */
  cautions: readonly string[];
  /** Ids in policy/hard-stops.ts HARD_STOPS that bear on this work. */
  hardStops: readonly string[];
  size: ProfessionSize;
};

/** The day every statute below was looked up. */
export const CAUTIONS_CHECKED_ON = '2026-11-01';
const ON = CAUTIONS_CHECKED_ON;

const checked = (caution: Omit<Caution, 'checked' | 'checkedOn'>): Caution => Object.freeze({ ...caution, checked: true, checkedOn: ON, sources: Object.freeze(caution.sources.map(source => Object.freeze({ ...source }))) });
const unchecked = (caution: Omit<Caution, 'checked' | 'checkedOn' | 'section' | 'sources'>): Caution => Object.freeze({ ...caution, section: null, checked: false, checkedOn: null, sources: Object.freeze([]) });

/** The nine statutes of PACKAGES 6E6, in its order. */
export const CAUTIONS: readonly Caution[] = Object.freeze([
  checked({
    id: 'rte-s28', title: 'RTE Act section 28', instrument: 'Right of Children to Free and Compulsory Education Act, 2009', section: 'Section 28',
    line: 'School teachers covered by the Right to Education Act may not take private tuition or do private teaching.',
    sources: [{ url: 'https://megscpcr.gov.in/ACTS/5%20Right%20To%20Education%20Act%202009.pdf', publisher: 'Meghalaya State Commission for Protection of Child Rights', title: 'The Right of Children to Free and Compulsory Education Act, 2009' }],
    note: 'Read in the Act as published by a state government commission. India Code would not load.',
  }),
  unchecked({
    id: 'bci-rule-36', title: 'BCI Rule 36', instrument: 'Bar Council of India Rules, Part VI, Chapter II',
    line: 'Advocates may not advertise or ask people for work, directly or through others.',
    note: 'The Bar Council site draws its rules with JavaScript and the India Code copy would not load, so the rule text was not read.',
  }),
  unchecked({
    id: 'telemedicine-2020', title: 'Telemedicine Practice Guidelines 2020', instrument: 'Telemedicine Practice Guidelines, March 2020',
    line: 'Only you, as a registered doctor, consult and prescribe. Chausar handles appointments and follow-ups.',
    note: 'The health ministry copy refused the reader and the National Health Mission copy is a scan with no text, so the guidelines were not read.',
  }),
  checked({
    id: 'sebi-ia-ra', title: 'SEBI adviser and research analyst rules',
    instrument: 'SEBI (Investment Advisers) Regulations, 2013 and SEBI (Research Analysts) Regulations, 2014', section: 'Regulation 3(1) of each',
    line: 'Investment advice and research reports need a SEBI registration. Without one, Chausar makes review packs only.',
    sources: [
      { url: 'https://www.sebi.gov.in/sebi_data/attachdocs/1358779330956.pdf', publisher: 'SEBI', title: 'SEBI (Investment Advisers) Regulations, 2013' },
      { url: 'https://www.sebi.gov.in/sebi_data/commondocs/RESEARCHANALYSTS-regulations_p.pdf', publisher: 'SEBI', title: 'SEBI (Research Analysts) Regulations, 2014' },
    ],
    note: 'Read in the regulations as first made. Later amendments were not read.',
  }),
  checked({
    id: 'coa-title', title: 'Architects Act title rule', instrument: 'Architects Act, 1972', section: 'Section 37(1)',
    line: 'Only an architect registered with the Council of Architecture may use the title architect. Interior design work itself is open.',
    sources: [{ url: 'https://api.sci.gov.in/supremecourt/2014/21001/21001_2014_3_1501_21539_Judgement_17-Mar-2020.pdf', publisher: 'Supreme Court of India', title: 'Council of Architecture v. Mukesh Goyal, judgment of 17 March 2020' }],
    note: 'Read as quoted in full in this Supreme Court judgment, which holds that the section limits the title, not the work. The Act\'s own pages would not load.',
  }),
  checked({
    id: 'rera-agent', title: 'RERA agent registration', instrument: 'Real Estate (Regulation and Development) Act, 2016', section: 'Sections 9 and 10',
    line: 'Agents register with the state RERA before helping sell or buy in a registered project.',
    sources: [{ url: 'https://reraonline.kerala.gov.in/PDF/RERA%20Act,%202016.pdf', publisher: 'Kerala Real Estate Regulatory Authority', title: 'The Real Estate (Regulation and Development) Act, 2016' }],
    note: 'Read in the Act as published by a state RERA.',
  }),
  checked({
    id: 'fssai', title: 'FSSAI licence or registration', instrument: 'Food Safety and Standards Act, 2006', section: 'Section 31',
    line: 'Selling food needs an FSSAI licence. A small home food business needs an FSSAI registration instead.',
    sources: [
      { url: 'https://fssai.gov.in/docs/food-law/act-2006/Food_Safety_and_Standards_Act_2006.pdf', publisher: 'FSSAI', title: 'Food Safety and Standards Act, 2006' },
      { url: 'https://fssai.gov.in/docs/business/registration/Licensing_Regulations.pdf', publisher: 'FSSAI', title: 'Food Safety and Standards (Licensing and Registration of Food Businesses) Regulations, 2011' },
    ],
    note: 'Section 31(2) sends petty food businesses to registration; the 2011 regulations set out who counts as one.',
  }),
  checked({
    id: 'ncahp', title: 'NCAHP Act', instrument: 'National Commission for Allied and Healthcare Professions Act, 2021', section: 'Section 15 and the Schedule',
    line: 'Physiotherapists must be on a State or the Central Register of allied and healthcare professionals to practise.',
    sources: [{ url: 'https://thc.nic.in/Central%20Governmental%20Acts/National%20Commission%20for%20Allied%20and%20Healthcare%20Professions%20Act,2021.pdf', publisher: 'High Court of Tripura', title: 'Gazette of India: National Commission for Allied and Healthcare Professions Act, 2021' }],
    note: 'The Schedule lists physiotherapy professionals. Read in the Gazette copy a High Court publishes.',
  }),
  checked({
    id: 'trai-dnd', title: 'TRAI commercial calls rules', instrument: 'Telecom Commercial Communications Customer Preference Regulations, 2018', section: 'Regulation 3(2), and regulation 2 as amended in 2025',
    line: 'Register as a sender, and send no promotional calls or messages to people who blocked them.',
    sources: [
      { url: 'https://trai.gov.in/sites/default/files/2026-05/CA_21052026.pdf', publisher: 'TRAI', title: 'Telecom Commercial Communications Customer Preference Regulations, 2018, consolidated to 21 May 2026' },
      { url: 'https://www.trai.gov.in/sites/default/files/2025-02/Regulation_12022025.pdf', publisher: 'TRAI', title: 'Telecom Commercial Communications Customer Preference (Second Amendment) Regulations, 2025' },
    ],
    note: 'TRAI also lists a regulation of September 2026 that was not read; it may amend these.',
  }),
]);

const p = (item: Omit<Profession, 'also' | 'cautions' | 'hardStops'> & Partial<Pick<Profession, 'also' | 'cautions' | 'hardStops'>>): Profession => Object.freeze({
  ...item, offers: Object.freeze([...item.offers]), also: Object.freeze([...(item.also ?? [])]),
  cautions: Object.freeze([...(item.cautions ?? [])]), hardStops: Object.freeze([...(item.hardStops ?? [])]),
});

/** Every profession of the beta, by family in PACKAGES 6E6 order. Labels match the price guide's word for word. */
export const PROFESSIONS: readonly Profession[] = Object.freeze([
  // Money and tax: CA firm, bookkeeping and CFO help, sign-off desk.
  p({ id: 'accountant', label: 'Accountant', family: 'money-tax', offers: ['Monthly books', 'GST returns'], playbook: 'bookkeeping-cfo', size: 'monthly' }),
  p({ id: 'chartered-accountant', label: 'Chartered accountant', family: 'money-tax', offers: ['Monthly books and GST', 'Income tax returns', 'Trader tax packs'], playbook: 'ca-firm', also: ['signoff-desk', 'trading-journal'], size: 'monthly' }),
  p({ id: 'itr-preparer', label: 'Retired tax or bank staff (income tax returns)', family: 'money-tax', offers: ['Income tax return papers', 'Trader tax packs'], playbook: 'ca-firm', also: ['trading-journal'], hardStops: ['securities-advice'], size: 'task' }),
  p({ id: 'payroll-executive', label: 'Payroll executive', family: 'money-tax', offers: ['Monthly payroll', 'Payslips and registers'], playbook: 'bookkeeping-cfo', size: 'monthly' }),
  p({ id: 'company-secretary', label: 'Company secretary', family: 'money-tax', offers: ['Annual filings', 'Board papers and minutes'], playbook: 'signoff-desk', also: ['ca-firm'], size: 'monthly' }),
  // Teaching and coaching: lesson desk, with job-search coaching and narration.
  p({ id: 'school-teacher', label: 'School teacher (private tuition)', family: 'teaching', offers: ['Weekly tuition batches', 'Progress reports for parents'], playbook: 'lesson-desk', cautions: ['rte-s28'], hardStops: ['child-data'], size: 'monthly' }),
  p({ id: 'spoken-english-trainer', label: 'Spoken English trainer', family: 'teaching', offers: ['Spoken English batches', 'One to one practice'], playbook: 'lesson-desk', hardStops: ['child-data'], size: 'monthly' }),
  p({ id: 'yoga-fitness-trainer', label: 'Yoga or fitness trainer', family: 'teaching', offers: ['Group classes', 'Personal sessions'], playbook: 'lesson-desk', size: 'monthly' }),
  p({ id: 'music-dance-teacher', label: 'Music or dance teacher', family: 'teaching', offers: ['Weekly classes', 'Recital preparation'], playbook: 'lesson-desk', hardStops: ['child-data'], size: 'monthly' }),
  p({ id: 'corporate-trainer', label: 'Corporate trainer', family: 'teaching', offers: ['Workshops for teams', 'Training videos'], playbook: 'lesson-desk', also: ['narration-studio'], hardStops: ['undisclosed-ai'], size: 'project' }),
  p({ id: 'senior-mentor', label: 'Senior mentor', family: 'teaching', offers: ['Mentor sessions', 'Career reviews'], playbook: 'lesson-desk', also: ['job-search-desk'], size: 'task' }),
  p({ id: 'dietitian', label: 'Dietitian', family: 'teaching', offers: ['Diet plans with check ins', 'Group nutrition classes'], playbook: 'lesson-desk', hardStops: ['medical-diagnosis'], size: 'monthly' }),
  p({ id: 'language-teacher', label: 'Language teacher', family: 'teaching', offers: ['Language batches', 'Exam preparation'], playbook: 'lesson-desk', hardStops: ['child-data'], size: 'monthly' }),
  // Creative work: brand kit, YouTube, narration, social.
  p({ id: 'photographer', label: 'Photographer', family: 'creative', offers: ['Shoots with edited photos', 'Social posts from a shoot'], playbook: 'social-agency', size: 'project' }),
  p({ id: 'video-editor', label: 'Video editor', family: 'creative', offers: ['Video edits', 'Monthly channel edits'], playbook: 'youtube', size: 'project' }),
  p({ id: 'graphic-designer', label: 'Graphic designer', family: 'creative', offers: ['Brand kits', 'Social post designs'], playbook: 'social-agency', size: 'project' }),
  p({ id: 'voice-artist', label: 'Voice artist', family: 'creative', offers: ['Voice overs', 'Audiobook narration'], playbook: 'narration-studio', hardStops: ['undisclosed-ai'], size: 'task' }),
  p({ id: 'interior-designer-architect', label: 'Interior designer or architect', family: 'creative', offers: ['Design concepts', 'Portfolio posts'], playbook: 'social-agency', cautions: ['coa-title'], size: 'project' }),
  p({ id: 'tailor-fashion-designer', label: 'Tailor or fashion designer', family: 'creative', offers: ['Made to measure orders', 'Lookbook posts'], playbook: 'social-agency', also: ['online-seller'], size: 'project' }),
  // Writing and content: SEO, newsletter, social, podcast, translation.
  p({ id: 'journalist-newsletter', label: 'Journalist (newsletters)', family: 'writing', offers: ['Newsletter issues', 'Researched explainers'], playbook: 'newsletter-studio', size: 'monthly' }),
  p({ id: 'marketing-seo-blogs', label: 'Marketing executive (SEO blogs)', family: 'writing', offers: ['SEO blog articles', 'Monthly search reports'], playbook: 'seo-visibility', also: ['social-agency'], size: 'monthly' }),
  p({ id: 'copywriter', label: 'Copywriter', family: 'writing', offers: ['Website and ad copy', 'Social captions'], playbook: 'social-agency', also: ['seo-visibility'], size: 'project' }),
  p({ id: 'podcaster', label: 'Podcaster', family: 'writing', offers: ['Articles from episodes', 'Show notes'], playbook: 'podcast-to-article', size: 'monthly' }),
  p({ id: 'ghostwriter', label: 'Founder ghostwriter', family: 'writing', offers: ['Founder newsletters', 'Posts in the founder\'s voice'], playbook: 'newsletter-studio', also: ['social-agency'], hardStops: ['linkedin-automation'], size: 'monthly' }),
  p({ id: 'translator', label: 'Translator', family: 'writing', offers: ['Document translation', 'Subtitles'], playbook: 'translation-studio', size: 'project' }),
  // Local services: booking desk.
  p({ id: 'beautician', label: 'Beautician or salon', family: 'local-services', offers: ['Booked salon visits', 'Bridal packages'], playbook: 'booking-desk', hardStops: ['fake-reviews'], size: 'task' }),
  p({ id: 'electrician-plumber-ac', label: 'Electrician, plumber or AC technician', family: 'local-services', offers: ['Repair visits', 'Service plans'], playbook: 'booking-desk', hardStops: ['fake-reviews'], size: 'task' }),
  p({ id: 'home-chef-tiffin', label: 'Home chef or tiffin', family: 'local-services', offers: ['Monthly tiffin plans', 'Party orders'], playbook: 'booking-desk', cautions: ['fssai'], hardStops: ['fake-reviews'], size: 'monthly' }),
  p({ id: 'real-estate-broker', label: 'Real estate broker', family: 'local-services', offers: ['Property visits', 'Rental listings'], playbook: 'booking-desk', cautions: ['rera-agent'], hardStops: ['fake-reviews'], size: 'project' }),
  p({ id: 'travel-agent', label: 'Travel agent', family: 'local-services', offers: ['Trip plans', 'Group tours'], playbook: 'booking-desk', hardStops: ['fake-reviews'], size: 'project' }),
  p({ id: 'event-wedding-planner', label: 'Event or wedding planner', family: 'local-services', offers: ['Wedding planning', 'Event days'], playbook: 'booking-desk', hardStops: ['fake-reviews'], size: 'project' }),
  p({ id: 'physiotherapist', label: 'Physiotherapist', family: 'local-services', offers: ['Home sessions', 'Exercise plans with follow ups'], playbook: 'booking-desk', cautions: ['ncahp'], hardStops: ['medical-diagnosis'], size: 'task' }),
  // Documents and reports: document desk.
  p({ id: 'tender-bid-writer', label: 'Tender or GeM bid writer', family: 'documents', offers: ['Tender responses', 'GeM bid packs'], playbook: 'tender-desk', also: ['document-desk'], size: 'project' }),
  p({ id: 'hr-handbooks', label: 'HR executive (handbooks)', family: 'documents', offers: ['Employee handbooks', 'HR policies'], playbook: 'document-desk', size: 'project' }),
  p({ id: 'quality-sops', label: 'Quality engineer (SOPs)', family: 'documents', offers: ['SOPs', 'Audit checklists'], playbook: 'document-desk', size: 'project' }),
  p({ id: 'dpr-cma-reports', label: 'Bank officer (DPR or CMA reports)', family: 'documents', offers: ['Project reports for loans', 'CMA data reports'], playbook: 'document-desk', size: 'project' }),
  p({ id: 'civil-estimates', label: 'Civil engineer (estimates)', family: 'documents', offers: ['Cost estimates', 'Bills of quantities'], playbook: 'document-desk', size: 'project' }),
  p({ id: 'thesis-editing', label: 'Academic (thesis editing)', family: 'documents', offers: ['Thesis editing', 'Reference checks'], playbook: 'document-desk', size: 'project' }),
  p({ id: 'technical-writer', label: 'Technical writer', family: 'documents', offers: ['User guides', 'Product documents'], playbook: 'document-desk', size: 'project' }),
  // Research and analysis: monitored data, lead generation, CFO pack.
  p({ id: 'market-research-analyst', label: 'Market research analyst', family: 'research', offers: ['Market research reports', 'Price and competitor watch'], playbook: 'monitored-data', size: 'project' }),
  p({ id: 'mis-data-analyst', label: 'MIS or data analyst', family: 'research', offers: ['Monthly MIS packs', 'Dashboards from your sheets'], playbook: 'bookkeeping-cfo', size: 'monthly' }),
  p({ id: 'sales-executive', label: 'Sales executive', family: 'research', offers: ['Lead lists', 'Outreach drafts'], playbook: 'lead-generation', hardStops: ['linkedin-automation'], size: 'monthly' }),
  p({ id: 'researcher', label: 'Researcher', family: 'research', offers: ['Desk research', 'Source watch'], playbook: 'monitored-data', size: 'project' }),
  p({ id: 'procurement-executive', label: 'Procurement executive', family: 'research', offers: ['Supplier price watch', 'Vendor comparisons'], playbook: 'monitored-data', size: 'monthly' }),
  // People and careers: recruiting, job search.
  p({ id: 'hr-recruiter', label: 'HR recruiter', family: 'people', offers: ['Candidate shortlists', 'Screening notes'], playbook: 'recruiting-desk', hardStops: ['linkedin-automation'], size: 'project' }),
  p({ id: 'resume-writer', label: 'Placement officer (resumes)', family: 'people', offers: ['Resume rewrites', 'Job search packs'], playbook: 'job-search-desk', hardStops: ['linkedin-automation'], size: 'task' }),
  // Shop and back office: online seller, support desk, data entry, virtual assistant.
  p({ id: 'marketplace-seller-ops', label: 'Ex-retail staff (marketplaces)', family: 'shop-office', offers: ['Marketplace listings', 'Order and stock upkeep'], playbook: 'online-seller', hardStops: ['fake-reviews'], size: 'monthly' }),
  p({ id: 'customer-service', label: 'Customer service', family: 'shop-office', offers: ['Support replies', 'Help pages'], playbook: 'support-desk', size: 'monthly' }),
  p({ id: 'data-entry', label: 'Data entry', family: 'shop-office', offers: ['Data entry from documents', 'Sheet clean ups'], playbook: 'data-entry-desk', size: 'project' }),
  p({ id: 'executive-assistant', label: 'Executive assistant', family: 'shop-office', offers: ['Inbox and calendar help', 'Weekly reports'], playbook: 'virtual-assistant', size: 'monthly' }),
  // Tech services: website studio, dev agency, app testing, IT triage, phone receptionist.
  p({ id: 'website-developer', label: 'Software engineer (websites)', family: 'tech', offers: ['Small websites', 'Website care'], playbook: 'website-studio', also: ['dev-agency'], size: 'project' }),
  p({ id: 'qa-tester', label: 'QA tester', family: 'tech', offers: ['App test runs', 'Demo videos'], playbook: 'app-testing', size: 'project' }),
  p({ id: 'it-support', label: 'IT support', family: 'tech', offers: ['IT help requests', 'Device set up'], playbook: 'it-triage', size: 'task' }),
  p({ id: 'ai-receptionist', label: 'Call centre agent (AI receptionist)', family: 'tech', offers: ['Call answering', 'Call summaries'], playbook: 'phone-receptionist', cautions: ['trai-dnd'], hardStops: ['undisclosed-ai'], size: 'monthly' }),
  // Licensed work: sign-off desk with the regulator's limits.
  p({ id: 'advocate', label: 'Advocate', family: 'licensed', offers: ['Consultations', 'Document review packs'], playbook: 'signoff-desk', cautions: ['bci-rule-36'], hardStops: ['advocate-solicit'], size: 'task' }),
  p({ id: 'doctor', label: 'Doctor', family: 'licensed', offers: ['Appointments', 'Follow up reminders'], playbook: 'signoff-desk', also: ['booking-desk'], cautions: ['telemedicine-2020'], hardStops: ['medical-diagnosis'], size: 'task' }),
  p({ id: 'financial-planner', label: 'Financial planner or MFD', family: 'licensed', offers: ['Review packs', 'Client follow ups'], playbook: 'signoff-desk', cautions: ['sebi-ia-ra'], hardStops: ['securities-advice'], size: 'monthly' }),
]);

/** The price guide's family ids (core/price-ranges-data.ts PRICE_FAMILIES) for each family here. */
export const PRICE_FAMILY_OF: Readonly<Record<FamilyId, string>> = Object.freeze({
  'money-tax': 'money-and-tax', teaching: 'teaching-and-coaching', creative: 'creative-work', writing: 'writing-and-content',
  'local-services': 'local-services', documents: 'documents-and-reports', research: 'research-and-analysis', people: 'people-and-careers',
  'shop-office': 'shop-and-back-office', tech: 'tech-services', licensed: 'licensed-work',
});

/** Ids recorded before this map (6C6 used them), and the profession each now names. */
export const PROFESSION_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  architect: 'interior-designer-architect', 'home-chef': 'home-chef-tiffin', 'call-centre-agent': 'ai-receptionist',
});

const BY_ID: ReadonlyMap<string, Profession> = new Map(PROFESSIONS.map(item => [item.id, item]));
const FAMILY_ORDER: readonly FamilyId[] = Object.freeze([...new Set(PROFESSIONS.map(item => item.family))]);

/** A profession by its id (or an older alias), else null. */
export function professionOf(id: unknown): Profession | null {
  if (typeof id !== 'string') return null;
  return BY_ID.get(id) ?? BY_ID.get(PROFESSION_ALIASES[id] ?? '') ?? null;
}

/** The professions a playbook serves, as its main playbook or as another it can use, in list order. */
export function professionsForPlaybook(playbook: string): Profession[] {
  return PROFESSIONS.filter(item => item.playbook === playbook || item.also.includes(playbook));
}

/** The families a playbook serves, in the families' order (what the gallery shows on each way). */
export function familiesForPlaybook(playbook: string): FamilyId[] {
  const families = new Set(professionsForPlaybook(playbook).map(item => item.family));
  return FAMILY_ORDER.filter(id => families.has(id));
}

/** A statute by id, else null. */
export function cautionOf(id: string): Caution | null {
  return CAUTIONS.find(caution => caution.id === id) ?? null;
}

/**
 * Throws, naming the row and the rule, unless the ids are unique short names, every profession has a label, a known
 * family, at least two offers, a playbook, a size and known cautions, and every checked statute has its section, date
 * and https sources while every unchecked one says why.
 */
export function validateProfessions(rows: readonly Profession[] = PROFESSIONS, cautions: readonly Caution[] = CAUTIONS): void {
  const fail = (message: string): never => { throw new Error(message); };
  const ids = new Set<string>();
  for (const row of rows) {
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(row.id)) fail(`${row.id} is not a short lowercase id.`);
    if (ids.has(row.id)) fail(`${row.id} is listed twice.`);
    ids.add(row.id);
    if (!row.label.trim()) fail(`${row.id} needs a label.`);
    if (!(row.family in PRICE_FAMILY_OF)) fail(`${row.id} needs one of the eleven families.`);
    if (row.offers.length < 2 || row.offers.some(offer => !offer.trim())) fail(`${row.id} needs at least two offers.`);
    if (!row.playbook.trim() || row.also.includes(row.playbook)) fail(`${row.id} needs one main playbook, not repeated in also.`);
    if (!PROFESSION_SIZES.includes(row.size)) fail(`${row.id} needs a size: task, monthly or project.`);
    for (const id of row.cautions) if (!cautions.some(caution => caution.id === id)) fail(`${row.id} names an unknown caution ${id}.`);
  }
  for (const caution of cautions) {
    if (!caution.title.trim() || !caution.line.trim() || !caution.instrument.trim() || !caution.note.trim()) fail(`${caution.id} needs a title, line, instrument and note.`);
    if (caution.checked) {
      if (caution.checkedOn !== CAUTIONS_CHECKED_ON || !caution.section || caution.sources.length === 0) fail(`${caution.id} is checked, so it needs its section, the date and its sources.`);
      for (const source of caution.sources) if (!source.url.startsWith('https://') || /\s/.test(source.url) || !source.publisher.trim() || !source.title.trim()) fail(`${caution.id} needs each source's https link, publisher and title.`);
    } else if (caution.checkedOn !== null || caution.section !== null || caution.sources.length > 0) {
      fail(`${caution.id} is unchecked, so it carries no section, date or source.`);
    }
  }
}
