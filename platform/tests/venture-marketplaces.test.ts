// F3 connector honesty and operation scope, based on official provider documentation.
import test from 'node:test';import assert from 'node:assert/strict';
import {MARKETPLACES} from '../runtime/venture/build/marketplaces.ts';
import {SELLER_REMOTE_OPERATIONS} from '../runtime/venture/playbooks/online-seller/operations.ts';
test('marketplace labels keep unbuilt calls planned and name the actual manual path',()=>{
 const labels=Object.fromEntries(MARKETPLACES.map(row=>[row.id,row.label]));
 assert.deepEqual(labels,{'amazon-sp-api':'planned: read','amazon-ads':'planned: read','flipkart-api':'planned: read',meesho:'handoff',myntra:'handoff',ajio:'handoff',nykaa:'handoff',jiomart:'handoff',shiprocket:'planned: write',delhivery:'planned: write','instagram-shop':'handoff','whatsapp-business':'handoff',sorftime:'planned: read','shopify-admin':'write','shopify-storefront':'read'});
 for(const row of MARKETPLACES){assert.match(row.manualPath,/\S/);assert.equal(row.checkedOn,'2026-10-29');assert.match(row.source,/^https:\/\//);assert.equal(row.liveVerified,null);if(row.label.startsWith('planned'))assert.match(row.waitsOn!,/\S/);}
 assert.match(MARKETPLACES.find(r=>r.id==='shopify-admin')!.manualPath,/own organization/);assert.match(MARKETPLACES.find(r=>r.id==='sorftime')!.waitsOn!,/unverified/);
});
test('only named Shopify operations exist; none is falsely live-qualified',()=>{
 assert.deepEqual(SELLER_REMOTE_OPERATIONS.map(r=>[r.id,r.safety]),[['products','read'],['variant','read'],['price','write'],['title','write'],['inventory-movement','write'],['storefront-products','read']]);
 for(const row of SELLER_REMOTE_OPERATIONS){assert.equal(row.liveVerified,null);assert.equal(row.apiVersion,'2026-10');assert.ok(row.scopes.length);assert.match(row.source,/^https:\/\/shopify.dev\//);}
 assert.equal(SELLER_REMOTE_OPERATIONS.find(r=>r.id==='inventory-movement')!.method,'inventoryAdjustQuantities');
});
