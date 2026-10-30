// Bounded operation registry, independently written against Shopify GraphQL 2026-10 official reference.
export type SellerRemoteOperation={id:string;method:string;safety:'read'|'write';scopes:readonly string[];apiVersion:'2026-10';source:string;liveVerified:null};
const entry=(id:string,method:string,safety:'read'|'write',scopes:readonly string[],path:string):SellerRemoteOperation=>({id,method,safety,scopes,apiVersion:'2026-10',source:'https://shopify.dev/docs/api/'+path,liveVerified:null});
/** No generic mutation passthrough. Live evidence belongs to a particular owner account and operation. */
export const SELLER_REMOTE_OPERATIONS:readonly SellerRemoteOperation[]=Object.freeze([
 entry('products','productVariants','read',['read_products'],'admin-graphql/2026-10/queries/productVariants'),
 entry('variant','productVariant','read',['read_products','read_inventory','read_locations'],'admin-graphql/2026-10/queries/productVariant'),
 entry('price','productVariantsBulkUpdate','write',['write_products'],'admin-graphql/2026-10/mutations/productVariantsBulkUpdate'),
 entry('title','productUpdate','write',['write_products'],'admin-graphql/2026-10/mutations/productUpdate'),
 entry('inventory-movement','inventoryAdjustQuantities','write',['write_inventory'],'admin-graphql/2026-10/mutations/inventoryAdjustQuantities'),
 entry('storefront-products','products','read',['unauthenticated_read_product_listings'],'storefront/2026-10/queries/products'),
]);
