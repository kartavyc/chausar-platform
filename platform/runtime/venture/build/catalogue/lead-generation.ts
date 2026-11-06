// Chausar lead-source catalogue. Provider documentation read on build day; APIs only, no scraper code copied.
import type { CatalogueEntry } from '../catalogue.ts';
const entry = (id: string, name: string, vendorUrl: string | null, auth: string, note: string): CatalogueEntry => ({ id, name, vendorUrl, auth, category: 'marketing', regions: ['global', 'india'], regionNote: null, note, targets: ['read'] });
export const LEAD_GENERATION_CATALOGUE: readonly CatalogueEntry[] = Object.freeze([
  entry('overpass', 'OpenStreetMap Overpass', 'https://overpass-api.de/', 'None', 'Bounded city research with OSM attribution; gaps for small Indian shops are expected. Derived databases retain the ODbL licence.'),
  entry('nominatim', 'Nominatim city lookup', 'https://operations.osmfoundation.org/policies/nominatim/', 'None', 'Deliberate city lookups only, cached and serialised. No autocomplete or systematic geocoding. Read the linked usage restrictions before use.'),
  entry('own-site', 'Business own site', null, 'None', 'Reads the homepage and at most three same-host contact pages, obeying robots and the source terms policy.'),
  entry('google-places', 'Google Places', 'https://developers.google.com/maps/documentation/places/web-service', 'Your own key after a current terms review', 'Planned: look up and qualify only after a current terms review. Never scrape Google Maps or resell its listings; look up businesses manually meanwhile.'),
  entry('reddit', 'Reddit', 'https://redditinc.com/policies/data-api-terms', 'Approved Reddit Data API access', 'Planned: waits for Reddit Data API access. Paste posts you may read with their community rules; Chausar never writes to Reddit.'),
  entry('happenstance', 'Happenstance', 'https://developer.happenstance.ai/', 'Your own API key typed for one approved search in the lead desk', 'Read search results with your own key. The dated credit cost is shown and the exact paid search approved and journalled; unknown searches are never retried.'),
]);
