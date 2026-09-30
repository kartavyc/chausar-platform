import test from 'node:test';
import assert from 'node:assert/strict';
import { currencyMinorDigits, decimalMinor } from '../runtime/currency.ts';
import { CalculatorService, formatMoney } from '../runtime/calculator.ts';
import { defaultRecipe, ImportService, parseBankCsv, parseIndianMoney } from '../runtime/ingest.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';
import { FixtureStateStore, fixtureOwner } from './database-fixtures.ts';

test('exact currency parsing and presentation respect zero, two, three and four minor-unit digits', () => {
  for (const [currency, source, minor, displayed] of [
    ['JPY','123','123','JPY 123'], ['INR','123.45','12345','INR 123.45'],
    ['KWD','1.234','1234','KWD 1.234'], ['CLF','1.2345','12345','CLF 1.2345'],
    ['KWD','-9007199254740993.001','-9007199254740993001','KWD -9,007,199,254,740,993.001'],
  ]) {
    assert.equal(decimalMinor(source, currency), minor);
    assert.equal(parseIndianMoney(source, 'major', currency), minor);
    assert.equal(formatMoney(minor, currency), displayed);
  }
  assert.equal(parseIndianMoney('JPY 123.00', 'major', 'JPY'), '123');
  assert.equal(parseIndianMoney('KWD 1.234', 'major', 'KWD'), '1234');
  assert.equal(parseIndianMoney('₹ 1,250.03'), '125003');
  assert.equal(parseIndianMoney('2 lakh 50 thousand'), '25000000');
  assert.equal(parseIndianMoney('125.50 Cr'), '-12550');
  for (const [value,currency] of [['1.1','JPY'],['1.2345','KWD'],['1.00001','CLF'],['1e3','INR']]) assert.throws(() => decimalMinor(value,currency), { code:'INVALID_AMOUNT' });
  assert.throws(() => currencyMinorDigits('QQQ'), { code:'INVALID_CURRENCY' });
  assert.throws(() => parseIndianMoney('₹ 1.00','major','USD'), { code:'INVALID_AMOUNT' });
});

async function importCurrency(sourceCurrency: string, targetCurrency: string, amount: string, expectedMinor: string, rate?: { numerator: string; denominator: string; rounding: 'exact' | 'half-up' }) {
  const store = new FixtureStateStore(); const draft = structuredClone(starterPacks[0]);
  draft.currency = targetCurrency; for (const definition of draft.definitions) definition.currency = targetCurrency;
  await new OntologyService(store).publish(fixtureOwner, draft);
  const recipe = defaultRecipe(); const binding = recipe.bindings.find(b => b.target === 'amountMinor')!;
  binding.currency = sourceCurrency; binding.fx = rate;
  const content = `id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch\nC,sale,2026-09-10,${amount},${sourceCurrency},C,I,O,,delivered,Exact currency,main\n`;
  const input = { sourceId:'currency-source', format:'csv' as const, content, recipe, expectedTotals:{rowCount:1,amountMinor:expectedMinor} };
  const imports = new ImportService(store); const preview = imports.preview(fixtureOwner,input);
  return { store, imports, preview, input };
}

test('source and target currency exponents enter exact FX arithmetic before declared rounding', async () => {
  // 123 JPY * 65 INR/JPY = 7995 INR = 799500 INR minor units.
  // 1.234 KWD * 250 INR/KWD = 308.50 INR = 30850 INR minor units.
  // 1.23 INR * 1 KWD/INR = 1.230 KWD = 1230 KWD minor units.
  for (const [source,target,amount,expected,rate] of [
    ['JPY','INR','123','799500','65'], ['KWD','INR','1.234','30850','250'], ['INR','KWD','1.23','1230','1'],
  ]) {
    const fixture = await importCurrency(source,target,amount,expected,{numerator:rate,denominator:'1',rounding:'exact'});
    assert.equal(fixture.preview.accepted,true,JSON.stringify(fixture.preview.errors));
    await fixture.imports.commit(fixtureOwner,fixture.input);
    const receipt = await new CalculatorService(fixture.store).calculate(fixtureOwner,{operation:'earned'});
    assert.equal(receipt.totalMinor,expected);
    assert.equal(receipt.rows[0].normalization?.sourceCurrency,source);
    assert.equal(receipt.rows[0].normalization?.targetCurrency,target);
  }
  for (const [amount,expected] of [['1.235','124'],['-1.235','-124']]) {
    const fixture = await importCurrency('KWD','INR',amount,expected,{numerator:'1',denominator:'1',rounding:'half-up'});
    assert.equal(fixture.preview.accepted,true,JSON.stringify(fixture.preview.errors));
  }
  const inexact = await importCurrency('KWD','INR','1.235','123',{numerator:'1',denominator:'1',rounding:'exact'});
  assert.equal(inexact.preview.accepted,false); assert.ok(inexact.preview.errors.some(e => e.code==='FX_PRECISION'));
  const noConversion = await importCurrency('KWD','KWD','1.234','1234');
  assert.equal(noConversion.preview.accepted,true);
});

test('bank running balances use the bank currency precision', () => {
  const recipe = defaultRecipe('bank-csv');
  recipe.bankLayout = { idField:'ref',dateField:'date',descriptionField:'description',debitField:'debit',creditField:'credit',balanceField:'balance',dateFormat:'ISO',openingMinor:'1000',closingMinor:'2234',currency:'KWD' };
  const rows = parseBankCsv('ref,date,description,debit,credit,balance\nR,2026-09-10,Deposit,,1.234,2.234\n',recipe);
  assert.equal(rows[0].amount,'1234'); assert.equal(rows[0].currency,'KWD');
});

test('every typed money field needs explicit currency compatibility, including tax and additional measures', async () => {
  const fixture = await importCurrency('INR','INR','100.00','10000');
  fixture.input.recipe.bindings.push({ target:'taxMinor',constant:'1.234',type:'money',nulls:'reject',moneyUnit:'major',currency:'KWD' });
  const refused = fixture.imports.preview(fixtureOwner,fixture.input);
  assert.equal(refused.accepted,false); assert.ok(refused.errors.some(error => error.code==='CURRENCY_MISMATCH'));
  fixture.input.recipe.bindings.at(-1)!.fx = {numerator:'100',denominator:'1',rounding:'exact'};
  const converted = fixture.imports.preview(fixtureOwner,fixture.input);
  assert.equal(converted.accepted,true,JSON.stringify(converted.errors));
  assert.equal(converted.facts[0].fields.taxMinor,'12340', '1.234 KWD *100 INR/KWD =123.40 INR.');
  fixture.input.recipe.bindings.at(-1)!.fx!.numerator = '0';
  assert.throws(() => fixture.imports.preview(fixtureOwner,fixture.input), {code:'INVALID_EXCHANGE_RATE'});
});
