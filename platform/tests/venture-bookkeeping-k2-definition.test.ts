// Package 5K2 adds its own offers and honest connector capabilities to the existing kit.
import test from 'node:test';
import assert from 'node:assert/strict';
import {BOOKKEEPING_CFO_DEFINITION as definition} from '../runtime/venture/playbooks/bookkeeping-cfo/definition.ts';
import {connectorModes} from '../runtime/venture/build/connectors.ts';
import {catalogueEntry} from '../runtime/venture/build/catalogue.ts';
import {TOOL_DECLARATIONS} from '../runtime/venture/policy/effects.ts';
test('seller books and setup expose the real finance desk and owner accounting handoff',()=>{
 assert.equal(definition.offers.find(row=>row.id==='seller-books')?.pricing,'monthly');
 assert.equal(definition.offers.find(row=>row.id==='back-office-setup')?.pricing,'project');
 assert.ok(definition.tools.includes('vouchers.draft'));assert.ok(definition.tools.includes('books.write'));
 assert.equal(definition.connectors.find(row=>row.id==='zoho-books')?.label,'write');
 assert.ok(definition.rules.every(row=>Object.hasOwn(row,'needs')));
 assert.ok(definition.rules.some(row=>row.id==='seller-tax-credit-review'&&row.needs==='ca'&&row.confirmedBy===null));
 assert.equal(connectorModes(catalogueEntry('zoho-books')!).find(row=>row.mode==='write')?.qualification,'fixture-tested');
 assert.equal(connectorModes(catalogueEntry('tally')!).find(row=>row.mode==='write')?.status,'planned');
 for(const name of ['books.setup','seller.books','vouchers.draft','books.write'] as const)assert.deepEqual(TOOL_DECLARATIONS[name]?.effects,['read']);
});

test('tested Zoho capability copy includes setup and received settlements without claiming automatic sending',()=>{
 const write=connectorModes(catalogueEntry('zoho-books')!).find(row=>row.mode==='write')!;
 assert.match(write.what,/settlements/i);assert.match(write.what,/masters/i);assert.match(write.what,/opening/i);
 assert.match(write.what,/separate/i);assert.match(write.what,/no email/i);
 assert.match(definition.connectors.find(row=>row.id==='zoho-books')!.note,/setup.*settlements/i);
 assert.ok(definition.notBuilt.some(line=>/AR\/AP.*inventory.*FX/.test(line)));
});
