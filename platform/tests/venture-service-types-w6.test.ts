// W6 6E1 (D2): the three new service types (teaching, local services, licensed work), every table that is keyed on a
// service type knows them, the families that borrowed another type now plan as their own, and the no-AI keyword
// fallback finds the right family for every one of the 57 beta professions (core/professions.ts, 6E6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SECOND_OFFER_MODEL, SERVICE_TYPE_LABELS, SERVICE_TYPES } from '../runtime/venture/contract-values.ts';
import { FAMILIES, familyOf } from '../runtime/venture/core/families.ts';
import { familyIdea, keywordFamily } from '../runtime/venture/core/family-plan.ts';
import { classifyIdea, SERVICE_KEYWORDS, serviceTemplate } from '../runtime/venture/core/service-types.ts';
import { INTERVIEW_SCHEMA } from '../runtime/venture/core/interview.ts';
import { PROFESSIONS } from '../runtime/venture/core/professions.ts';
import { REQUIRED_SECTIONS, TEMPLATE_OUTLINES } from '../runtime/venture/delivery/template-outline.ts';
import { PRACTICE_CLIENTS } from '../runtime/venture/delivery/scenarios.ts';
import { SERVICE_DEPARTMENTS } from '../runtime/venture/playbooks/departments.ts';
import { briefTemplateWords } from '../runtime/venture/build/brief.ts';

const NEW_TYPES = ['teaching', 'local-services', 'licensed'] as const;

test('6E1: teaching, local services and licensed work are service types, listed before other so older ties keep their type', () => {
  for (const type of NEW_TYPES) assert.ok((SERVICE_TYPES as readonly string[]).includes(type), type);
  assert.equal(SERVICE_TYPES[SERVICE_TYPES.length - 1], 'other');
  assert.deepEqual(SERVICE_TYPES.slice(0, 7), ['agency', 'studio', 'consulting', 'bookkeeping', 'research', 'content', 'support']);
  assert.deepEqual(NEW_TYPES.map(type => SERVICE_TYPE_LABELS[type]), ['Teaching and coaching', 'Local service business', 'Licensed practice']);
  for (const type of NEW_TYPES) assert.ok(SECOND_OFFER_MODEL[type], type);
});

test('6E1: every table keyed on a service type has the new ones, so nothing falls through to another type', () => {
  for (const type of SERVICE_TYPES) {
    assert.equal(REQUIRED_SECTIONS[type]?.length, 4, `sections ${type}`);
    assert.equal(TEMPLATE_OUTLINES[type]?.length, 4, `outline ${type}`);
    assert.ok(PRACTICE_CLIENTS[type]?.clean && PRACTICE_CLIENTS[type]?.messy && PRACTICE_CLIENTS[type]?.pushback, `practice ${type}`);
    assert.ok(SERVICE_DEPARTMENTS[type], `department ${type}`);
    assert.ok(briefTemplateWords(type, { name: 'Asha', customer: 'Families nearby' }), `brief ${type}`);
    assert.equal(serviceTemplate(type).type, type);
    if (type !== 'other') assert.ok(SERVICE_KEYWORDS[type].length >= 5, `keywords ${type}`);
  }
  // The new types have their own words, not another type's.
  const others = new Set(SERVICE_TYPES.filter(type => !(NEW_TYPES as readonly string[]).includes(type)).map(type => serviceTemplate(type).oneLiner));
  for (const type of NEW_TYPES) assert.ok(!others.has(serviceTemplate(type).oneLiner), type);
  // The AI's interview schema offers every type.
  assert.deepEqual((INTERVIEW_SCHEMA as any).properties.serviceType.enum, [...SERVICE_TYPES]);
});

test('6E1: the licensed template keeps the professional as the one who signs, and teaching asks a parent before a child\'s data', () => {
  assert.match(serviceTemplate('licensed').approvals.join(' '), /sign/i);
  assert.match(serviceTemplate('teaching').approvals.join(' '), /parent/i);
});

test('6E1: the families that borrowed a type now plan as their own, and the TODO is gone', async () => {
  assert.equal(familyOf('teaching').serviceType, 'teaching');
  assert.equal(familyOf('local-services').serviceType, 'local-services');
  assert.equal(familyOf('licensed').serviceType, 'licensed');
  for (const family of FAMILIES) {
    assert.equal(classifyIdea(family.planIdea), family.serviceType, family.id);
    assert.equal(familyIdea(family.id, ''), family.planIdea);
  }
  const source = await readFile(new URL('../runtime/venture/core/families.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /TODO\(6E1\)/);
});

test('6E1: plain ideas for the new types classify as them', () => {
  assert.equal(classifyIdea('Spoken English classes and tuition for school students'), 'teaching');
  assert.equal(classifyIdea('Home salon visits and beauty appointments for brides'), 'local-services');
  assert.equal(classifyIdea('Plumber and electrician repair visits for homes nearby'), 'local-services');
  assert.equal(classifyIdea('Client follow ups for my legal practice as a lawyer'), 'licensed');
  // Older ideas keep their type.
  assert.equal(classifyIdea('Monthly bookkeeping, GST and tax filing for small businesses'), 'bookkeeping');
  assert.equal(classifyIdea('Customer support and inbox help for online shops'), 'support');
});

test('6E1: the keyword fallback finds every family, and each of the 57 professions by its own name', () => {
  for (const family of FAMILIES) assert.equal(keywordFamily(`${family.label}. ${family.line}`), family.id, family.id);
  const misses = PROFESSIONS.filter(profession => keywordFamily(profession.label) !== profession.family)
    .map(profession => `${profession.label} -> ${keywordFamily(profession.label)} (want ${profession.family})`);
  assert.deepEqual(misses, []);
  assert.equal(PROFESSIONS.length, 57);
});

test('6E1: the UI and its fake engine know the same service types, labels, keywords and practice clients as the engine', async () => {
  const read = (path: string) => readFile(new URL(`../../app/ui/src/${path}`, import.meta.url), 'utf8');
  const types = await read('engine/types.ts');
  const list = SERVICE_TYPES.map(type => `'${type}'`).join(', ');
  assert.ok(types.includes(`export type ServiceType = ${SERVICE_TYPES.map(type => `'${type}'`).join(' | ')};`), 'types.ts ServiceType');
  assert.ok(types.includes(`export const SERVICE_TYPES: readonly ServiceType[] = [${list}];`), 'types.ts SERVICE_TYPES');
  const common = JSON.parse(await read('text/en/common.json'));
  for (const type of SERVICE_TYPES) assert.equal(common[`business.kind.${type}`], SERVICE_TYPE_LABELS[type], type);
  const fixtures = await read('engine/fixtures.ts');
  assert.match(fixtures, /from '\.\.\/\.\.\/\.\.\/\.\.\/platform\/runtime\/venture\/core\/service-keywords'/, 'the fake guesses from the engine keywords');
  for (const type of SERVICE_TYPES) assert.ok(fixtures.includes(`'${SERVICE_TYPE_LABELS[type]}'`), `fixtures label ${type}`);
  const practice = await read('engine/fake-practice.ts');
  for (const type of SERVICE_TYPES) for (const kind of ['clean', 'messy', 'pushback'] as const) {
    assert.ok(practice.includes(JSON.stringify(PRACTICE_CLIENTS[type][kind].persona).slice(1, -1)) || practice.includes(PRACTICE_CLIENTS[type][kind].persona), `fake persona ${type} ${kind}`);
  }
});
