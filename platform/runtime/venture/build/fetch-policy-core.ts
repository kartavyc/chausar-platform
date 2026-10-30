// Pure dated site policy shared with browser rehearsals. Transport and robots checks remain native.
export type FetchPolicyRule={id:string;scope:string;topic:string;rule:string;sources:readonly {title:string;url:string}[];checkedOn:string;read:'unconfirmed';how:string;usedBy:readonly string[];limitations:string;needs:null};
const CHECKED_ON = '2026-10-27';
const HOW = "Read in Chausar's research notes of October 2026 (the harvest's list of sites whose terms bar automated reading); not re-read word for word on build day.";
const LIMITS = 'Covers reading the site by a program. The owner reading the page and pasting text, and the owner\'s own signed-in posting, are not covered.';

/** One site on the list: its rule, the hosts it covers, and the pages (all of them, or only product pages). */
type PolicySite = { rule: FetchPolicyRule; hosts: readonly string[]; pages: ((url: URL) => boolean) | null };

function site(id: string, topic: string, rule: string, terms: { title: string; url: string }, hosts: readonly string[], pages: PolicySite['pages'] = null): PolicySite {
  return Object.freeze({
    rule: Object.freeze({
      id: `fetch-policy-${id}`, scope: 'fetch-policy', topic, rule, sources: Object.freeze([Object.freeze({ ...terms })]), checkedOn: CHECKED_ON,
      read: 'unconfirmed' as const, how: HOW, usedBy: Object.freeze(['fetch-policy']), limitations: LIMITS, needs: null,
    }),
    hosts: Object.freeze([...hosts]), pages,
  });
}

/** Amazon's product pages: /dp/<id>, /gp/product/<id>, /gp/aw/d/<id>. */
const amazonProduct = (url: URL) => /\/(?:dp|gp\/product|gp\/aw\/d)\/[A-Za-z0-9]{6,}/.test(url.pathname);
/** Flipkart's product pages: /<name>/p/<item id>. */
const flipkartProduct = (url: URL) => /\/p\/itm[a-z0-9]+/i.test(url.pathname);
/** Google Maps: the maps hosts whole, and google.com's /maps pages. */
const googleMaps = (url: URL) => url.hostname.startsWith('maps.') || url.hostname === 'maps.app.goo.gl' || /^\/maps(?:\/|$)/.test(url.pathname);

const SITES: readonly PolicySite[] = Object.freeze([
  site('linkedin', 'linkedin.com', 'LinkedIn\'s User Agreement does not allow scraping or copying profiles and data by bots or other automated means.',
    { title: 'LinkedIn User Agreement', url: 'https://www.linkedin.com/legal/user-agreement' }, ['linkedin.com']),
  site('naukri', 'naukri.com', 'Naukri\'s terms do not allow automated access to or copying of its listings and resumes.',
    { title: 'Naukri.com Terms and Conditions', url: 'https://www.naukri.com/termsconditions' }, ['naukri.com']),
  site('google-maps', 'google.com/maps', 'Google Maps\' terms do not allow scraping or bulk export of Maps content.',
    { title: 'Google Maps/Google Earth Additional Terms of Service', url: 'https://www.google.com/help/terms_maps/' },
    ['google.com', 'google.co.in', 'maps.google.com', 'maps.app.goo.gl'], googleMaps),
  site('justdial', 'justdial.com', 'Justdial\'s terms do not allow automated copying of its listings.',
    { title: 'Justdial Terms of Use', url: 'https://www.justdial.com/Terms-Of-Use' }, ['justdial.com']),
  site('indiamart', 'indiamart.com', 'IndiaMART\'s terms do not allow automated collection of its listings and supplier details.',
    { title: 'IndiaMART Terms of Use', url: 'https://www.indiamart.com/terms-of-use.html' }, ['indiamart.com']),
  site('instagram', 'instagram.com', 'Instagram\'s Terms of Use do not allow collecting information in an automated way without its permission.',
    { title: 'Instagram Terms of Use', url: 'https://help.instagram.com/581066165581870' }, ['instagram.com']),
  site('facebook', 'facebook.com', 'Facebook\'s terms and its automated data collection terms do not allow automated collection without its written permission.',
    { title: 'Facebook Automated Data Collection Terms', url: 'https://www.facebook.com/apps/site_scraping_tos_terms.php' }, ['facebook.com', 'fb.com']),
  site('x', 'x.com', 'X\'s Terms of Service do not allow crawling or scraping without its prior written consent.',
    { title: 'X Terms of Service', url: 'https://x.com/en/tos' }, ['x.com', 'twitter.com']),
  site('amazon-in', 'amazon.in product pages', 'Amazon.in\'s Conditions of Use do not allow robots or data mining on its pages.',
    { title: 'Amazon.in Conditions of Use', url: 'https://www.amazon.in/gp/help/customer/display.html?nodeId=200545940' }, ['amazon.in'], amazonProduct),
  site('flipkart', 'flipkart.com product pages', 'Flipkart\'s Terms of Use do not allow robots, spiders or scraping of its pages.',
    { title: 'Flipkart Terms of Use', url: 'https://www.flipkart.com/pages/terms' }, ['flipkart.com'], flipkartProduct),
]);

/** The dated rule set, as the kit's rules view and the rule checks read it. */
export const FETCH_POLICY_RULES: readonly FetchPolicyRule[] = Object.freeze(SITES.map(item => item.rule));

const hostOf = (url: URL) => url.hostname.toLowerCase().replace(/\.$/, '');

/** The site on the list a web address belongs to, as its rule, or null when it is not on the list. */
export function fetchPolicySite(url: URL): FetchPolicyRule | null {
  const host = hostOf(url);
  const found = SITES.find(item => item.hosts.some(name => host === name || host.endsWith(`.${name}`)) && (!item.pages || item.pages(url)));
  return found?.rule ?? null;
}
