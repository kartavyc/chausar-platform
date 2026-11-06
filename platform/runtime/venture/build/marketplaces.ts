// F3 provider status, independently written from official pages checked 29 October 2026.
// This metadata is not evidence that Chausar or the owner has made a successful live call.
export type MarketplaceStatus={id:string;name:string;label:'read'|'write'|'handoff'|'planned: read'|'planned: write';waitsOn:string|null;manualPath:string;source:string;checkedOn:string;liveVerified:null};
const row=(id:string,name:string,label:MarketplaceStatus['label'],waitsOn:string|null,manualPath:string,source:string):MarketplaceStatus=>({id,name,label,waitsOn,manualPath,source,checkedOn:'2026-10-29',liveVerified:null});
/** Availability remains conservative until the actual account and operation are qualified. */
export const MARKETPLACES:readonly MarketplaceStatus[]=Object.freeze([
 row('amazon-sp-api','Amazon.in Selling Partner API','planned: read','Amazon developer registration and seller authorization; Chausar adapter and account verification.','Download the reports in Seller Central and add them to the order.','https://developer-docs.amazon.com/sp-api/docs/sp-api-registration-overview'),
 row('amazon-ads','Amazon Ads API','planned: read','Amazon Ads developer access and advertiser authorization; Chausar adapter.','Download your ads reports in the Amazon Ads console.','https://advertising.amazon.com/API/docs/en-us/guides/get-started/overview'),
 row('flipkart-api','Flipkart Seller API','planned: read','Seller developer access and authorization; Chausar adapter.','Download the settlement report in Seller Hub and add it to the order.','https://seller.flipkart.com/api-docs/FMSAPI.html'),
 row('meesho','Meesho','handoff',null,'Use the current category template in the Supplier Panel. Review the prepared sheet and upload it yourself.','https://supplier.meesho.com/how-it-works'),
 row('myntra','Myntra','handoff',null,'Get the current authorized seller template from your partner account. Review and upload the prepared sheet yourself.','https://partners.myntrainfo.com/'),
 row('ajio','AJIO','handoff',null,'Download the current category template in AJIO Commerce. Review the prepared sheet and upload it yourself.','https://seller.ajio.com/ajiocommerce/faq/'),
 row('nykaa','Nykaa','handoff',null,'Use the current template supplied by your authorized seller account. Review and upload the prepared sheet yourself.','https://seller.nykaa.com/'),
 row('jiomart','JioMart','handoff',null,'Use the current template supplied by your authorized seller account. Review and upload the prepared sheet yourself.','https://seller.jiomart.com/'),
 row('shiprocket','Shiprocket','planned: write','Owner API user and scoped token; Chausar shipment adapter and verified read-back.','Create and check the shipment in Shiprocket yourself.','https://apidocs.shiprocket.in/'),
 row('delhivery','Delhivery','planned: write','Owner business account API token; Chausar shipment adapter and verified read-back.','Create and check the shipment in Delhivery One yourself.','https://help.delhivery.com/docs/api-token-generation'),
 row('instagram-shop','Instagram shop','handoff',null,'Review the prepared catalogue sheet and use your own Meta Commerce Manager. No automatic posting.','https://www.facebook.com/business/help/1275400645914358'),
 row('whatsapp-business','WhatsApp Business','handoff',null,'Review the catalogue text and add it in your own WhatsApp Business app. No messages are sent.','https://www.whatsapp.com/business/'),
 row('sorftime','Sorftime','planned: read','Owner paid API key and current terms; API contract remains unverified.','Use your own Sorftime account and add the permitted export to the order.','https://sorftime.com/'),
 row('shopify-admin','Shopify Admin','write',null,'Desktop or hosted owner desk; your organisation\'s app. Exact approved price, stock and title edits need acknowledgement and readback. Live account unqualified. Otherwise edit in Shopify yourself.','https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant'),
 row('shopify-storefront','Shopify Storefront','read',null,'Owner-approved public catalogue reads only. The buyer assistant waits for named legal confirmation. Link customers to your Shopify shop meanwhile.','https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/getting-started'),
]);
