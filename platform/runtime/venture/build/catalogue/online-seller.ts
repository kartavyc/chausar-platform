// F3 provider cards mirror the checked capability table. No credentials or vendor schemas are invented.
// Independent code; commerce research ideas from sealeap (MIT), no copied source.
import type { CatalogueEntry } from '../catalogue.ts';
import {MARKETPLACES} from '../marketplaces.ts';
export const ONLINE_SELLER_CATALOGUE: readonly CatalogueEntry[] = Object.freeze([
 ...MARKETPLACES.map(row=>({id:row.id,name:row.name,category:'docs-ops' as const,auth:row.label==='handoff'?'Owner account and current template':row.waitsOn??'Owner-scoped credentials, kept only for the open session',regions:['india','global'] as const,regionNote:null,note:[row.waitsOn,row.manualPath].filter(Boolean).join(' '),vendorUrl:row.source,targets:row.id==='shopify-admin'?['read','write'] as const:row.label.includes('read')?['read'] as const:row.label.includes('write')?['write'] as const:['handoff'] as const})),
 {id:'shopify-store-assistant',name:'Shopify buyer assistant',category:'docs-ops',auth:'Hosted owner app, public Storefront token and exact model approvals',regions:['india','global'],regionNote:null,note:'Planned for buyers until a named lawyer confirms the purpose notice and provider handling. Every buyer AI question asks separately. Open the Shopify shop meanwhile.',vendorUrl:'https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/getting-started',targets:['write']},
]);
