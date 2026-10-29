// F3 implementation labels match the public owner desk; live buyer use remains legally gated.
export const SELLER_F3_CONNECTORS=[
 {id:'shopify-admin',name:'Shopify Admin',label:'write' as const,note:'Exact owner-approved product reads and price, stock or title changes. Credentials stay in the open session; unknown outcomes are never resent.'},
 {id:'shopify-storefront',name:'Shopify Storefront',label:'read' as const,note:'Approved bounded public catalogue reads. Buyer AI handling waits for its own legal gate and each exact question approval.'},
 {id:'shopify-store-assistant',name:'Shopify buyer assistant',label:'planned: write' as const,note:'Hosted catalogue-only buyer answers with code prices and checkout on Shopify. No order is placed.',waitsOn:'Named lawyer confirmation of the buyer notice, consent and provider handling.',manualPath:'Link buyers to your Shopify shop and answer manually meanwhile.'},
];
