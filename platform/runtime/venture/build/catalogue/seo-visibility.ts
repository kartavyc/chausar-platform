// SEO connector catalogue. Official crawler/API docs checked 27 October 2026; no copied source.
import type { CatalogueEntry } from '../catalogue.ts';
export const SEO_VISIBILITY_CATALOGUE: readonly CatalogueEntry[] = [
    { id: 'seo-client-site', name: 'Client site checks', category: 'analytics', auth: 'None for public pages', regions: ['global', 'india'], regionNote: null, note: 'Reads public pages as Chausar, respecting robots and network guards.', vendorUrl: null, targets: ['read'] },
    { id: 'seo-search-console', name: 'Search Console exports', category: 'analytics', auth: 'An export from the client account', regions: ['global', 'india'], regionNote: null, note: 'CSV uploads work now. An API connection is planned; export the CSV meanwhile.', vendorUrl: 'https://search.google.com/search-console/', targets: ['read'] },
    { id: 'seo-lintapple', name: 'lintapple website check', category: 'analytics', auth: 'An owner installed checker or uploaded JSON report', regions: ['global', 'india'], regionNote: null, note: 'The owner installs lintapple. Chausar never installs it; upload its report meanwhile.', vendorUrl: 'https://github.com/gholtzap/lintapple', targets: ['read'] },
];
