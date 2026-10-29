// Chausar connector catalogue: the data-entry-desk playbook's own entries (Data entry desk; Ink v2 wave 5, packages
// 5R2). Package 5-0 left it empty; the package adds its connectors here, never in build/catalogue.ts. Import only types
// from catalogue.ts: it loads this file while it is still being set up (build/catalogue-playbooks.ts). Written for
// Chausar; nothing here is learned from an outside source.
import type { CatalogueEntry } from '../catalogue.ts';

export const DATA_ENTRY_DESK_CATALOGUE: readonly CatalogueEntry[] = Object.freeze([{id:'formfill',name:'Client form browser',category:'docs-ops',auth:'Written client permission and a revocable staff login entered by the owner',regions:['india','global'],regionNote:null,note:'Planned pending a lawyer confirming client permission and data use. A guarded desktop native-form browser is implemented; dynamic forms and restricted portals stay unsupported. Use the permitted client system manually meanwhile.',vendorUrl:null,targets:['write']}]);
