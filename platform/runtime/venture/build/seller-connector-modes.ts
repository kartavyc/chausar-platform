// Original F3 modes: fixture-tested code, no live account qualification or automatic uploads.
import type {ConnectorMode} from '../contracts.ts';
type Mode=Omit<ConnectorMode,'mode'|'status'>;
export const SELLER_HANDOFF_MODES:Readonly<Record<string,Mode>>=Object.freeze(Object.fromEntries(['meesho','myntra','ajio','nykaa','jiomart','instagram-shop','whatsapp-business'].map(id=>[id,{qualification:'fixture-tested' as const,what:'Prepares a bounded text-only catalogue sheet from the current template and column map you supply. You review and upload or copy it in your own account. No messages or uploads are sent.'}])));
export const SELLER_READ_MODES:Readonly<Record<string,Mode>>={
 'shopify-admin':{qualification:'fixture-tested',what:'Reads the exact own-organization store, product and location after approval. Multi-page reads show incomplete coverage until all pages are read.'},
 'shopify-storefront':{qualification:'fixture-tested',what:'Reads an approved bounded public catalogue using the owner public token. No buyer AI call occurs while connecting. Live buyer handling remains planned pending named legal confirmation.'},
};
export const SELLER_WRITE_MODES:Readonly<Record<string,Mode>>={
 'shopify-admin':{qualification:'fixture-tested',what:'Stages one exact price, available-stock or title change under owner caps. Applies only after separate owner approval; acknowledgement and exact read-back are required. Unknown outcomes never retry.'},
};
