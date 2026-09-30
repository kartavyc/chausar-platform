import test from 'node:test';
import assert from 'node:assert/strict';
import { ImportService, parseShopifyJson, defaultRecipe } from '../runtime/ingest.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { FixtureStateStore, fixtureOwner } from './database-fixtures.ts';

const order = { id:'synthetic-order',processed_at:'2026-09-10T00:00:00Z',subtotal_price:'100.00',taxes_included:false,currency:'INR',financial_status:'paid',customer:{id:'synthetic-customer'} };
async function setup() { const store = new FixtureStateStore(); await new OntologyService(store).publish(fixtureOwner,'ecommerce'); return {store,imports:new ImportService(store),calculator:new CalculatorService(store)}; }

test('paid Shopify orders are billed claims and do not establish received or earned money', async () => {
  const { imports,calculator } = await setup();
  await imports.commit(fixtureOwner,{sourceId:'synthetic-shopify',format:'shopify-json',content:JSON.stringify({orders:[order]}),expectedTotals:{rowCount:1,amountMinor:'10000'}});
  assert.equal((await calculator.calculate(fixtureOwner,{operation:'billed'})).totalMinor,'10000');
  for (const operation of ['received','earned','net_sales']) {
    const receipt = await calculator.calculate(fixtureOwner,{operation});
    assert.equal(receipt.totalMinor,'0'); assert.equal(receipt.coverage.completeness,'empty');
    assert.ok(receipt.coverage.gaps.some(gap => gap.includes('not proof')));
  }
});

test('seeded draft identity overrides a paid flag and remains excluded from billed claims', async () => {
  for (const identity of [{__typename:'DraftOrder'},{draft:true},{admin_graphql_api_id:'gid://shopify/DraftOrder/synthetic'},{id:'gid://shopify/DraftOrder/synthetic'}]) {
    const { imports,calculator } = await setup();
    await imports.commit(fixtureOwner,{sourceId:'synthetic-draft',format:'shopify-json',content:JSON.stringify({orders:[{...order,...identity}]}),expectedTotals:{rowCount:1,amountMinor:'10000'}});
    const receipt = await calculator.calculate(fixtureOwner,{operation:'billed'});
    assert.equal(receipt.totalMinor,'0'); assert.equal(receipt.coverage.countedRows,0);
    assert.ok(receipt.exclusions.some(exclusion => exclusion.reason.includes('draft')));
  }
});

test('original order totals and embedded refund records cannot silently substitute for a reviewed money-movement profile', async () => {
  for (const status of ['SUCCESS','FAILURE','PENDING']) {
    const { store,imports } = await setup();
    const content = JSON.stringify({orders:[{...order,totalPriceSet:{shopMoney:{amount:'118.00',currencyCode:'INR'}},currentTotalPriceSet:{shopMoney:{amount:'59.00',currencyCode:'INR'}},refunds:[{id:'synthetic-refund',transactions:[{kind:'REFUND',status,amount:'59.00'}]}]}]});
    assert.throws(() => parseShopifyJson(content),{code:'SHOPIFY_REFUND_PROFILE_REQUIRED'});
    await assert.rejects(imports.commit(fixtureOwner,{sourceId:'synthetic-refund',format:'shopify-json',content,expectedTotals:{rowCount:1,amountMinor:'10000'}}),{code:'SHOPIFY_REFUND_PROFILE_REQUIRED'});
    assert.equal(store.read().facts.length,0); assert.equal(store.read().imports.length,0);
  }
  assert.throws(() => parseShopifyJson(JSON.stringify({orders:[{id:'graphql-only',processed_at:order.processed_at,currency:'INR',totalPriceSet:{shopMoney:{amount:'118.00',currencyCode:'INR'}}}]})),{code:'AMBIGUOUS_SHOPIFY_EXPORT'});
  assert.equal(parseShopifyJson(JSON.stringify({orders:[{...order,total_price:'118.00',current_total_price:'59.00',refunds:[]}]}))[0].amount,'100.00');
});

test('tax-inclusive or ambiguous Shopify subtotals require a separate reviewed tax profile', async () => {
  const {taxes_included:_taxMode,...missingTaxMode} = order;
  assert.throws(() => parseShopifyJson(JSON.stringify({orders:[missingTaxMode]})),{code:'SHOPIFY_TAX_PROFILE_REQUIRED'});
  for (const taxFlag of ['taxes_included','taxesIncluded']) {
    for (const value of [true,'true','false',null]) {
      const {store,imports} = await setup();
      const content = JSON.stringify({orders:[{...order,[taxFlag]:value}]});
      assert.throws(() => parseShopifyJson(content),{code:'SHOPIFY_TAX_PROFILE_REQUIRED'});
      await assert.rejects(imports.commit(fixtureOwner,{sourceId:'synthetic-tax',format:'shopify-json',content,expectedTotals:{rowCount:1,amountMinor:'10000'}}),{code:'SHOPIFY_TAX_PROFILE_REQUIRED'});
      assert.equal(store.read().facts.length,0);
    }
    assert.equal(parseShopifyJson(JSON.stringify({orders:[{...missingTaxMode,[taxFlag]:false}]}))[0].amount,'100.00');
  }
});

test('custom recipes cannot promote draft or cancelled source states to billable claims', async () => {
  for (const identity of [{__typename:'DraftOrder'},{cancelled_at:'2026-09-11T00:00:00Z'}]) {
    for (const overwrite of ['map','omit']) {
      const {store,imports} = await setup();
      const recipe = defaultRecipe('shopify-json');
      if (overwrite === 'map') recipe.bindings.find(binding => binding.target === 'status')!.values = {draft:'paid',cancelled:'paid'};
      else recipe.bindings = recipe.bindings.filter(binding => binding.target !== 'status');
      const input = {sourceId:'synthetic-state-override',format:'shopify-json' as const,content:JSON.stringify({orders:[{...order,...identity}]}),recipe,expectedTotals:{rowCount:1,amountMinor:'10000'}};
      assert.ok(imports.preview(fixtureOwner,input).errors.some(error => error.code === 'SHOPIFY_SOURCE_STATE_REQUIRED'));
      await assert.rejects(imports.commit(fixtureOwner,input),{code:'IMPORT_REFUSED'});
      assert.equal(store.read().facts.length,0);
    }
  }
});

test('custom recipes cannot turn original order totals into received or earned money', async () => {
  for (const kind of ['sale','payment']) {
    const {store,imports} = await setup();
    const recipe = defaultRecipe('shopify-json');
    recipe.bindings.find(binding => binding.target === 'kind')!.values = {invoice:kind};
    const input = {sourceId:'synthetic-recognition-override',format:'shopify-json' as const,content:JSON.stringify({orders:[order]}),recipe,expectedTotals:{rowCount:1,amountMinor:'10000'}};
    assert.ok(imports.preview(fixtureOwner,input).errors.some(error => error.code === 'SHOPIFY_RECOGNITION_PROFILE_REQUIRED'));
    await assert.rejects(imports.commit(fixtureOwner,input),{code:'IMPORT_REFUSED'});
    assert.equal(store.read().facts.length,0);
  }
});

test('explicit unsupported Shopify object identities and ambiguous draft flags cannot become invoices', async () => {
  for (const identity of [{__typename:'Refund'},{__typename:null},{id:'gid://shopify/Refund/123'},{admin_graphql_api_id:'gid://shopify/Payment/123'},{id:'gid://other/Order/123'},{draft:'true'},{draft:null}]) {
    const {store,imports} = await setup();
    const content = JSON.stringify({orders:[{...order,...identity}]});
    const code = Object.hasOwn(identity,'draft') ? 'SHOPIFY_SOURCE_STATE_REQUIRED' : 'SHOPIFY_OBJECT_PROFILE_REQUIRED';
    assert.throws(() => parseShopifyJson(content),{code});
    await assert.rejects(imports.commit(fixtureOwner,{sourceId:'synthetic-object-override',format:'shopify-json',content,expectedTotals:{rowCount:1,amountMinor:'10000'}}),{code});
    assert.equal(store.read().facts.length,0);
  }
  assert.equal(parseShopifyJson(JSON.stringify({orders:[{...order,__typename:'Order',id:'gid://shopify/Order/123'}]}))[0].kind,'invoice');
});
