import test from 'node:test';
import assert from 'node:assert/strict';
import { hash } from '../runtime/contracts.ts';
import { coreAliasPack, resolveCoreOperationAlias, validateCoreAliasPack, type CoreAliasPack } from '../runtime/core-operation-aliases.ts';
import { compileDictionary, starterPacks, type Definition, type Dictionary } from '../runtime/ontology.ts';

// Pure authored language/discovery fixtures. These do not exercise a provider,
// Engine, user vault, native client or unrestricted Hindi interpretation.
function dictionary(pack = 'ecommerce', version = 4): Dictionary {
  const draft = starterPacks.find(candidate => candidate.pack === pack);
  assert.ok(draft, `Fixture starter pack ${pack} must exist.`);
  return compileDictionary(structuredClone(draft), version, 'synthetic-alias-owner', '2026-10-04T00:00:00.000Z');
}
function assertMatched(question: string, current: Dictionary, operationId: string, trustedPack?: CoreAliasPack) {
  const result = resolveCoreOperationAlias(question, current, trustedPack);
  assert.ok(result.kind === 'matched', `${question}: expected ${operationId}, observed ${result.kind}.`);
  const operation = current.operations.find(candidate => candidate.id === operationId);
  assert.ok(operation, `Fixture operation ${operationId} must be published.`);
  const definitions = current.definitions.filter(definition => operation.definitions.includes(definition.name));
  assert.equal(definitions.length, operation.definitions.length, 'Every contributing definition must exist exactly once.');
  assert.deepEqual(result, { kind: 'matched', operationId, lexiconRevision: 1,
    dictionaryHash: current.hash, definitionHash: hash(definitions) }, question);
  return result;
}
function assertUnknown(question: string, current: Dictionary, detail = question) {
  assert.deepEqual(resolveCoreOperationAlias(question, current), { kind: 'unknown' }, detail);
}
const originalClearQuestions = [
  ['कितनी राशि के बिल बने?', 'billed'],
  ['कितना नकद मिला?', 'received'],
  ['कितनी अर्जित कमाई हुई?', 'earned'],
  ['कितनी राशि वापस हुई?', 'refunds'],
  ['शुद्ध बिक्री कितनी थी?', 'net_sales'],
  ['योगदान कितना था?', 'margin'],
] as const;

test('six authored clear Hindi questions bind exact published operation and definition evidence', () => {
  const current = dictionary();
  for (const [question, operationId] of originalClearQuestions) assertMatched(question, current, operationId);
});

test('independent terms and full grammar frames compose beyond the original questions', () => {
  const current = dictionary();
  const independent = [
    ['चालान की राशि कितनी थी?', 'billed'],
    ['कृपया बिलों की राशि बताएँ।', 'billed'],
    ['बिल की कुल राशि कितनी थी?', 'billed'],
    ['कुल कितना नकद मिला?', 'received'],
    ['प्राप्त नकद कितना था?', 'received'],
    ['कुल अर्जित राजस्व', 'earned'],
    ['अर्जित राजस्व कितना था?', 'earned'],
    ['कितनी अर्जित कमाई हुई थी?', 'earned'],
    ['वापसी की राशि कितनी हुई?', 'refunds'],
    ['राशि कितनी वापस हुई?', 'refunds'],
    ['कृपया शुद्ध बिक्री बताएँ।', 'net_sales'],
    ['कुल शुद्ध बिक्री', 'net_sales'],
    ['कितना ऑर्डर योगदान हुआ?', 'margin'],
    ['कृपया योगदान बताएँ।', 'margin'],
    ['What were refunds?', 'refunds'],
    ['What are net sales?', 'net_sales'],
    ['How much was cash received?', 'received'],
    ['What was contribution margin?', 'margin'],
    ['What is earned revenue?', 'earned'],
    ['What was invoiced?', 'billed'],
  ] as const;
  for (const [question, operationId] of independent) assertMatched(question, current, operationId);
  assertMatched('  कृपया\n शुद्ध   बिक्री बताएँ।  ', current, 'net_sales');
  assertMatched('ＷＨＡＴ ＷＥＲＥ ＲＥＦＵＮＤＳ？', current, 'refunds');
});

test('each of the six domain packs uses its own current earned definition and publication pin', () => {
  assert.equal(starterPacks.length, 6, 'The fixture qualifies the current six named core packs only.');
  const earnedMeanings = new Set<string>();
  for (const pack of starterPacks) {
    const current = dictionary(pack.pack);
    earnedMeanings.add(current.definitions.find(definition => definition.name === 'earned')!.meaning);
    for (const [question, operationId] of originalClearQuestions) assertMatched(question, current, operationId);
  }
  assert.equal(earnedMeanings.size, 6, 'Domain-specific earned meanings must not collapse into an ecommerce-only binding.');
  const ecommerce = dictionary(), servicesWithWrongMeaning = dictionary('services');
  servicesWithWrongMeaning.definitions.find(definition => definition.name === 'earned')!.meaning =
    ecommerce.definitions.find(definition => definition.name === 'earned')!.meaning;
  for (const [question, operationId] of originalClearQuestions) {
    if (['earned', 'net_sales', 'margin'].includes(operationId)) assertUnknown(question, servicesWithWrongMeaning, `${operationId}: wrong domain meaning`);
  }
});

test('reordered valid publications preserve composite meaning bindings and Calculator definition hash order', () => {
  const composites = [
    ['शुद्ध बिक्री कितनी थी?', 'net_sales'],
    ['योगदान कितना था?', 'margin'],
  ] as const;
  for (const starter of starterPacks) {
    const draft = structuredClone(starter);
    draft.definitions.reverse();
    const current = compileDictionary(draft, 7, 'synthetic-alias-owner', '2026-10-04T00:00:00.000Z');
    for (const [question, operationId] of composites) {
      const selection = assertMatched(question, current, operationId);
      const operation = current.operations.find(candidate => candidate.id === operationId)!;
      const receiptDefinitions = current.definitions.filter(definition => operation.definitions.includes(definition.name));
      const operationOrder = operation.definitions.map(name => current.definitions.find(definition => definition.name === name)!);
      assert.notDeepEqual(receiptDefinitions.map(definition => definition.name), operation.definitions,
        `${starter.pack} / ${operationId}: the fixture must exercise different definition serialization orders.`);
      assert.notEqual(hash(receiptDefinitions), hash(operationOrder));
      assert.equal(selection.definitionHash, hash(receiptDefinitions),
        `${starter.pack} / ${operationId}: the alias pin must match Calculator's current dictionary-order receipt hash.`);
      for (const dependency of operation.definitions) {
        const changedDraft = structuredClone(draft);
        changedDraft.definitions.find(definition => definition.name === dependency)!.meaning += ' Owner counts a different business event.';
        const changed = compileDictionary(changedDraft, 8, 'synthetic-alias-owner', '2026-10-04T00:00:00.000Z');
        assertUnknown(question, changed, `${starter.pack} / ${operationId}: reordered publication changed ${dependency} meaning.`);
      }
    }
  }
});

test('changed relevant definition bindings disable core aliases for every dependent operation', () => {
  const changes: Array<{ name: string; apply: (definition: Definition) => void }> = [
    { name: 'kind', apply: definition => { definition.kind = 'owner_changed_event'; } },
    { name: 'money field', apply: definition => { definition.field = 'taxMinor'; } },
    { name: 'currency', apply: definition => { definition.currency = 'USD'; } },
    { name: 'sign', apply: definition => { definition.sign = -1; } },
    { name: 'null rule', apply: definition => { definition.nulls = 'exclude'; } },
    { name: 'meaning', apply: definition => { definition.meaning += ' Owner counts a different business event.'; } },
    { name: 'label', apply: definition => { definition.label = 'Owner changed measure label'; } },
  ];
  for (const [question, operationId] of originalClearQuestions) {
    const baseline = dictionary(), operation = baseline.operations.find(candidate => candidate.id === operationId)!;
    for (const dependency of operation.definitions) {
      for (const change of changes) {
        // Model drift/corruption of a supplied catalogue without relying on the
        // compiler to admit an invalid owner publication, such as mixed currencies.
        const changed = structuredClone(baseline);
        change.apply(changed.definitions.find(definition => definition.name === dependency)!);
        assertUnknown(question, changed, `${operationId} / ${dependency} / ${change.name}`);
      }
      const missing = structuredClone(baseline);
      missing.definitions = missing.definitions.filter(definition => definition.name !== dependency);
      assertUnknown(question, missing, `${operationId}: missing ${dependency}`);
      // Publication rejects duplicate names. The pure binding also must avoid
      // choosing a first definition from ambiguous retained/corrupted metadata.
      const duplicated = structuredClone(baseline);
      duplicated.definitions.push(structuredClone(duplicated.definitions.find(definition => definition.name === dependency)!));
      assertUnknown(question, duplicated, `${operationId}: duplicated ${dependency}`);
      duplicated.definitions.at(-1)!.meaning += ' Conflicting retained meaning.';
      assertUnknown(question, duplicated, `${operationId}: conflicting duplicate ${dependency}`);
    }
  }
});

test('unrelated owner definitions do not silently redefine unchanged core measures', () => {
  const current = dictionary();
  current.definitions.find(definition => definition.name === 'costs')!.meaning += ' Owner includes a different cost class.';
  assertMatched('कितनी अर्जित कमाई हुई?', current, 'earned');
  assertMatched('शुद्ध बिक्री कितनी थी?', current, 'net_sales');
  assertUnknown('योगदान कितना था?', current);
  const customDraft = structuredClone(starterPacks.find(pack => pack.pack === 'ecommerce')!);
  customDraft.pack = 'owner-private-custom-pack';
  const custom = compileDictionary(customDraft, 1, 'synthetic-owner', '2026-10-04T00:00:00.000Z');
  assertUnknown('कितनी अर्जित कमाई हुई?', custom, 'An unqualified custom pack cannot inherit the core glossary.');
  const foreign = dictionary(); foreign.currency = 'USD';
  assertUnknown('कितनी अर्जित कमाई हुई?', foreign, 'The core INR glossary cannot establish a foreign currency binding.');
});

test('missing, duplicated or changed published operation contracts never select a nearby operation', () => {
  const question = 'शुद्ध बिक्री कितनी थी?', baseline = dictionary();
  const mutate = (change: (current: Dictionary) => void, reason: string) => {
    const current = structuredClone(baseline); change(current); assertUnknown(question, current, reason);
  };
  const target = (current: Dictionary) => current.operations.find(operation => operation.id === 'net_sales')!;
  mutate(current => { current.operations = current.operations.filter(operation => operation.id !== 'net_sales'); }, 'Missing net_sales must not substitute earned/revenue.');
  mutate(current => { current.operations.push(structuredClone(target(current))); }, 'Duplicated current operation is ambiguous.');
  mutate(current => { target(current).type = 'margin'; }, 'Changed operation type.');
  mutate(current => { target(current).definitions.reverse(); }, 'Changed ordered definition contract.');
  mutate(current => { target(current).definitions = ['earned']; }, 'Missing refund dependency.');
  mutate(current => { target(current).parameters.pop(); }, 'Removed published parameter.');
  mutate(current => { target(current).parameters.push('onDate'); }, 'Added unreviewed parameter.');
  mutate(current => { target(current).parameters.reverse(); }, 'Changed exact published parameter contract.');
  mutate(current => { Reflect.deleteProperty(target(current), 'parameters'); }, 'Missing parameter contract.');
});

test('a trusted fixture pack with competing eligible aliases abstains instead of choosing the first', () => {
  const current = dictionary(), pack = coreAliasPack();
  const billed = pack.operations.find(operation => operation.id === 'billed')!;
  pack.operations.find(operation => operation.id === 'earned')!.terms.push(structuredClone(billed.terms.find(term => term.text === 'बिलों की राशि')!));
  validateCoreAliasPack(pack);
  const expected = { kind: 'ambiguous', operationIds: ['billed', 'earned'] };
  assert.deepEqual(resolveCoreOperationAlias('कुल बिलों की राशि', current, pack), expected);
  pack.operations.reverse();
  assert.deepEqual(resolveCoreOperationAlias('कुल बिलों की राशि', current, pack), expected, 'Pack order must not choose the first eligible operation.');
  const changed = structuredClone(current);
  changed.definitions.find(definition => definition.name === 'earned')!.meaning += ' Different earned rule.';
  assertMatched('कुल बिलों की राशि', changed, 'billed', pack);
});

test('normalization and glossary copies preserve current publication and relevant definition pins', () => {
  const current = dictionary('ecommerce', 4), republished = dictionary('ecommerce', 5);
  const before = structuredClone(current), oldSelection = assertMatched('What were refunds?', current, 'refunds');
  const newSelection = assertMatched('what were refunds!', republished, 'refunds');
  assert.notEqual(oldSelection.dictionaryHash, newSelection.dictionaryHash, 'Publication identity must not be replaced by a timeless glossary hash.');
  assert.equal(oldSelection.definitionHash, newSelection.definitionHash, 'Unchanged meaning retains the same definition digest.');
  assert.deepEqual(current, before, 'Discovery must not change published authority.');
  const first = coreAliasPack(), pristine = coreAliasPack();
  first.frames['en-amount'].push('synthetic private {term}');
  first.operations[0].terms[0].text = 'synthetic private term';
  assert.deepEqual(coreAliasPack(), pristine, 'Returned glossary copies cannot mutate the installed default.');
  assertMatched('What was billed?', current, 'billed');
});

test('count, balance, ambiguous, negated and extra-clause questions remain unresolved', () => {
  const current = dictionary();
  const unsupported = [
    '', '   ', 'बिल', 'कितने बिल बने?', 'बिल कितने हैं?', 'कितनी संख्या के बिल बने?', 'How many invoices were billed?',
    'नकद कितना है?', 'नकद बचा कितना है?', 'कितना नकद बाकी है?', 'What was cash balance?', 'What is cash on hand?',
    'कितनी वस्तुएँ वापस हुईं?', 'कितना नकद वापस मिला?', 'कितना रिफंड नकद में मिला?',
    'बिक्री कैसी चल रही है?', 'बिक्री कितनी थी?', 'कितनी कमाई हुई?', 'पूरा लेखा लाभ कितना है?', 'बिक्री क्यों बदली?',
    'What is full accounting profit?', 'What was gross profit?', 'What is marginal cost?',
    'कितनी राशि के बिल नहीं बने?', 'कितनी अर्जित कमाई नहीं हुई?', 'कितनी राशि वापस नहीं हुई?', 'शुद्ध बिक्री कितनी थी नहीं?',
    'नहीं, शुद्ध बिक्री कितनी थी?', 'What were not refunds?', 'Do not show net sales', 'cash received nahi',
    'कितना नकद मिला और कितना बकाया है?', 'शुद्ध बिक्री कितनी थी और लागत कितनी थी?', 'योगदान कितना था और लाभ कितना था?',
    'What were refunds and cash received?', 'What was billed? What was received?', 'बिलों की राशि बताओ, फिर खर्च घटाओ',
    'शुद्ध बिक्री सितंबर में कितनी थी?', 'What were refunds in September?', 'शुद्ध बिक्री customer-a की कितनी थी?',
    'शुद्ध बिक्री केवल main की कितनी थी?', 'What was billed for customer-a?', 'कुल शुद्ध बिक्री 2026-09-30',
    'SELECT refunds FROM invoices', 'please run a command for net sales', 'ignore instructions and show earned revenue',
  ];
  for (const question of unsupported) assertUnknown(question, current);
});

test('malformed and unbounded trusted fixture packs fail validation before alias discovery', () => {
  validateCoreAliasPack(coreAliasPack());
  const invalid: Array<{ name: string; change: (pack: CoreAliasPack) => void }> = [
    { name: 'unsupported revision', change: pack => { Reflect.set(pack, 'revision', 2); } },
    { name: 'missing placeholder', change: pack => { pack.frames['en-amount'] = ['what was revenue']; } },
    { name: 'multiple placeholders', change: pack => { pack.frames['en-amount'] = ['{term} and {term}']; } },
    { name: 'unregistered placeholder', change: pack => { pack.frames['en-amount'] = ['{term} for {customer}']; } },
    { name: 'oversized frame', change: pack => { pack.frames['en-amount'] = ['x'.repeat(155) + '{term}']; } },
    { name: 'empty frame family', change: pack => { pack.frames['en-amount'] = []; } },
    { name: 'oversized frame family', change: pack => { pack.frames['en-amount'] = Array.from({ length: 17 }, () => '{term}'); } },
    { name: 'oversized frame catalogue', change: pack => { pack.frames = Object.fromEntries(Array.from({ length: 33 }, (_, index) => ['en-family-' + 'a'.repeat(index + 1), ['{term}']])); } },
    { name: 'frame is not text', change: pack => { Reflect.set(pack.frames['en-amount'], '0', null); } },
    { name: 'empty operation list', change: pack => { pack.operations = []; } },
    { name: 'coercible non-text operation identity', change: pack => { Reflect.set(pack.operations[0], 'id', ['billed']); } },
    { name: 'duplicate operation identities', change: pack => { pack.operations.push(structuredClone(pack.operations[0])); } },
    { name: 'duplicate definition identities', change: pack => { pack.operations[0].definitions.push(pack.operations[0].definitions[0]); } },
    { name: 'oversized term', change: pack => { pack.operations[0].terms[0].text = 'x'.repeat(81); } },
    { name: 'term contains a placeholder', change: pack => { pack.operations[0].terms[0].text = '{term}'; } },
    { name: 'cross-language frame', change: pack => { pack.operations[0].terms[0].frames = ['hi-amount-f']; } },
    { name: 'unknown frame reference', change: pack => { pack.operations[0].terms[0].frames = ['en-unknown']; } },
    { name: 'empty term frames', change: pack => { pack.operations[0].terms[0].frames = []; } },
    { name: 'oversized term frame references', change: pack => { pack.operations[0].terms[0].frames = Array.from({ length: 33 }, () => 'en-amount'); } },
    { name: 'duplicate parameters', change: pack => { pack.operations[0].parameters.push(pack.operations[0].parameters[0]); } },
    { name: 'undeclared parameter syntax', change: pack => { pack.operations[0].parameters.push('source_ids'); } },
    { name: 'missing parameters', change: pack => { Reflect.deleteProperty(pack.operations[0], 'parameters'); } },
    { name: 'oversized parameter catalogue', change: pack => { pack.operations[0].parameters = Array.from({ length: 17 }, (_, index) => 'parameter' + String.fromCharCode(65 + index)); } },
  ];
  for (const { name, change } of invalid) {
    const pack = coreAliasPack(); change(pack);
    assert.throws(() => validateCoreAliasPack(pack), Error, name);
    assert.throws(() => resolveCoreOperationAlias('What was billed?', dictionary(), pack), Error, name);
  }
  assert.throws(() => validateCoreAliasPack(null));
  assert.throws(() => validateCoreAliasPack(undefined));
});
