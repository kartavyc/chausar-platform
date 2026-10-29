// Chausar connector catalogue: the phone-receptionist playbook's own entries (AI phone receptionist; Ink v2 wave 5,
// packages 5R6). Package 5-0 left it empty; the package adds its connectors here, never in build/catalogue.ts. Import
// only types from catalogue.ts: it loads this file while it is still being set up (build/catalogue-playbooks.ts).
// Written for Chausar; nothing here is learned from an outside source.
import type { CatalogueEntry } from '../catalogue.ts';

export const PHONE_RECEPTIONIST_CATALOGUE: readonly CatalogueEntry[] = Object.freeze([{id:'voice-provider',name:'Phone receptionist provider',category:'docs-ops',auth:'Owner account, Indian number, provider identity checks and authenticated hosted callback',regions:['india'],regionNote:null,note:'Live calling is planned until the provider account, Indian number, callback authentication and dated rates are verified and a lawyer confirms the calling setup. Use your own phone forwarding and the approved client script meanwhile.',vendorUrl:null,targets:['write']}]);
