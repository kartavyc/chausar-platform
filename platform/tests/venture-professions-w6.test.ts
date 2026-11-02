// W6 6E6 (D1, D2, D21): the 57-profession map. One data file (core/professions.ts) names each profession's family,
// offers, the playbook that runs it, its cautions and job shape. Every profession resolves to a registered playbook that
// delivers; the price guide (6C3) and the compliance check (6C6) name the same professions; every listed statute is
// either checked against an official source (link and date) or marked unchecked; and the gallery shows the families.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFESSIONS, CAUTIONS, PROFESSION_JOB_SHAPES, professionOf, professionsForPlaybook, familiesForPlaybook, validateProfessions, PRICE_FAMILY_OF } from '../runtime/venture/core/professions.ts';
import { FAMILY_IDS, familyOf } from '../runtime/venture/core/families.ts';
import { PROFESSION_PRICES } from '../runtime/venture/core/price-ranges-data.ts';
import { WAY_PRICES, validatePriceRanges } from '../runtime/venture/core/price-ranges.ts';
import { PROFESSION_COMPLIANCE, professionCompliance, complianceOf } from '../runtime/venture/core/compliance-data.ts';
import { currentRegistry } from '../runtime/venture/playbooks/registry.ts';
import { flagshipDelivery } from '../runtime/venture/playbooks/steps.ts';
import { HARD_STOPS } from '../runtime/venture/policy/hard-stops.ts';
import { listWays } from '../runtime/venture/core/ways.ts';

/** The new family desks and the service type each plans as (6E1). */
const DESK_TYPES: Readonly<Record<string, string>> = Object.freeze({ 'lesson-desk': 'teaching', 'booking-desk': 'local-services', 'signoff-desk': 'licensed' });
/** Desks registered before 6E1 landed that still plan on a borrowed type; the integrator removes each once its package switches. */
const TYPE_PENDING: Readonly<Record<string, string>> = Object.freeze({});

const STATUTES = ['rte-s28', 'bci-rule-36', 'telemedicine-2020', 'sebi-ia-ra', 'coa-title', 'rera-agent', 'fssai', 'ncahp', 'trai-dnd'];

test('6E6: fifty-seven professions in the eleven families, each with offers, a playbook, cautions and a job shape', () => {
  assert.doesNotThrow(() => validateProfessions());
  assert.equal(PROFESSIONS.length, 57);
  assert.equal(new Set(PROFESSIONS.map(item => item.id)).size, 57);
  assert.deepEqual([...new Set(PROFESSIONS.map(item => item.family))], [...FAMILY_IDS]);
  const perFamily = Object.fromEntries(FAMILY_IDS.map(id => [id, PROFESSIONS.filter(item => item.family === id).length]));
  assert.deepEqual(perFamily, { 'money-tax': 5, teaching: 8, creative: 6, writing: 6, 'local-services': 7, documents: 7, research: 5, people: 2, 'shop-office': 4, tech: 4, licensed: 3 });
  for (const item of PROFESSIONS) {
    assert.ok(item.offers.length >= 2, item.id);
    assert.ok(PROFESSION_JOB_SHAPES.includes(item.jobShape), item.id);
    for (const words of [item.label, ...item.offers]) assert.doesNotMatch(words, /\d|₹|\$|—/, `${item.id}: ${words}`);
    for (const id of item.hardStops) assert.ok(HARD_STOPS.some(stop => stop.id === id), `${item.id}: ${id}`);
    for (const id of item.cautions) assert.ok(CAUTIONS.some(caution => caution.id === id), `${item.id}: ${id}`);
  }
  assert.equal(professionOf('advocate')?.family, 'licensed');
  assert.equal(professionOf('astronaut'), null);
});

test('6E6: every profession resolves to a registered playbook that delivers today', () => {
  const registry = currentRegistry();
  const missing: string[] = [];
  for (const item of PROFESSIONS) {
    for (const playbook of [item.playbook, ...item.also]) {
      const registered = registry.some(entry => entry.id === playbook) && flagshipDelivery(playbook) !== null;
      if (!registered) missing.push(`${item.id} -> ${playbook}`);
    }
  }
  assert.deepEqual(missing, []);
  // A family desk plans as its family's own service type, so a profession's idea that picks the desk plans the same way.
  for (const [id, type] of Object.entries(DESK_TYPES)) {
    const entry = registry.find(item => item.id === id);
    if (!entry || TYPE_PENDING[id]) { if (entry && TYPE_PENDING[id]) assert.notEqual(entry.serviceType, type, `${id} plans as ${type} now: take it off TYPE_PENDING`); continue; }
    assert.equal(entry.serviceType, type, id);
  }
  // The family engines of PACKAGES 6E6.
  assert.deepEqual(professionsForPlaybook('lesson-desk').map(item => item.family), Array(8).fill('teaching'));
  assert.deepEqual([...new Set(professionsForPlaybook('booking-desk').filter(item => item.playbook === 'booking-desk').map(item => item.family))], ['local-services']);
  assert.deepEqual(familiesForPlaybook('signoff-desk'), ['money-tax', 'licensed']);
});

test('6E6: the price guide names the same fifty-seven professions, in the same families, and every way\'s profession runs on that way', () => {
  assert.deepEqual(PROFESSION_PRICES.map(item => item.id), PROFESSIONS.map(item => item.id));
  assert.deepEqual(PROFESSION_PRICES.map(item => item.label), PROFESSIONS.map(item => item.label));
  for (const item of PROFESSION_PRICES) assert.equal(item.family, PRICE_FAMILY_OF[professionOf(item.id)!.family], item.id);
  assert.doesNotThrow(() => validatePriceRanges());
  for (const [playbook, mapping] of Object.entries(WAY_PRICES)) {
    assert.ok(professionsForPlaybook(playbook).some(item => item.id === mapping.profession), `${playbook} -> ${mapping.profession}`);
  }
});

test('6E6: the nine statutes are carried, each checked against an official source with link and date, or marked unchecked', () => {
  assert.deepEqual(CAUTIONS.map(caution => caution.id), STATUTES);
  for (const caution of CAUTIONS) {
    assert.ok(caution.title && caution.line && caution.instrument, caution.id);
    assert.doesNotMatch(`${caution.title} ${caution.line} ${caution.note}`, /—/, caution.id);
    if (caution.checked) {
      // W6 F4: BCI Rule 36, the Telemedicine Guidelines and the FSSAI turnover limits were read on 2 November 2026, and
      // the SEBI regulations again, as amended, on 3 November.
      const day = caution.id === 'sebi-ia-ra' ? '2026-11-03' : ['bci-rule-36', 'telemedicine-2020', 'fssai'].includes(caution.id) ? '2026-11-02' : '2026-11-01';
      assert.equal(caution.checkedOn, day, caution.id);
      assert.ok(caution.section, caution.id);
      assert.ok(caution.sources.length > 0, caution.id);
      for (const source of caution.sources) {
        assert.match(source.url, /^https:\/\/([^\s]+\.(gov\.in|nic\.in)|www\.barcouncilofindia\.org)\//, `${caution.id}: official host`);
        assert.ok(source.publisher && source.title, caution.id);
      }
    } else {
      assert.equal(caution.checkedOn, null, caution.id);
      assert.match(caution.note, /\S/, `${caution.id} says why it is unchecked`);
    }
  }
  // Which professions carry which statute (PACKAGES 6E6).
  const carriers = (id: string) => PROFESSIONS.filter(item => item.cautions.includes(id)).map(item => item.id);
  assert.deepEqual(carriers('rte-s28'), ['school-teacher']);
  assert.deepEqual(carriers('bci-rule-36'), ['advocate']);
  assert.deepEqual(carriers('telemedicine-2020'), ['doctor']);
  assert.deepEqual(carriers('sebi-ia-ra'), ['financial-planner']);
  assert.deepEqual(carriers('coa-title'), ['interior-designer-architect']);
  assert.deepEqual(carriers('rera-agent'), ['real-estate-broker']);
  assert.deepEqual(carriers('fssai'), ['home-chef-tiffin']);
  assert.deepEqual(carriers('ncahp'), ['physiotherapist']);
  assert.deepEqual(carriers('trai-dnd'), ['ai-receptionist']);
  // Statutes with no checked source are honest about it. W6 F4: the last two were read on 2 November 2026.
  const unchecked = CAUTIONS.filter(caution => !caution.checked).map(caution => caution.id);
  assert.deepEqual(unchecked, []);
});

test('6E6: the compliance check reads the map, so every profession answers and a checked statute carries its source', () => {
  assert.deepEqual(PROFESSION_COMPLIANCE.map(item => item.id), PROFESSIONS.map(item => item.id));
  for (const item of PROFESSIONS) {
    const compliance = professionCompliance(item.id)!;
    assert.equal(compliance.family, item.family, item.id);
    assert.deepEqual(compliance.rules.map(rule => rule.id), item.cautions, item.id);
    assert.deepEqual(compliance.hardStops, item.hardStops, item.id);
  }
  const teacher = complianceOf(professionCompliance('school-teacher')!);
  assert.deepEqual(teacher.rules.map(rule => [rule.id, rule.checked]), [['rte-s28', true]]);
  assert.match(teacher.rules[0]!.source!.url, /^https:\/\//);
  assert.equal(teacher.rules[0]!.checkedOn, '2026-11-01');
  const advocate = complianceOf(professionCompliance('advocate')!);
  assert.deepEqual(advocate.rules.map(rule => [rule.id, rule.checked, rule.source?.publisher]), [['bci-rule-36', true, 'Bar Council of India']]);
  assert.deepEqual(advocate.switchedOff.map(entry => entry.tool), ['outreach', 'advertising']);
  // Ids recorded before the map keep answering.
  assert.equal(professionCompliance('architect')?.id, 'interior-designer-architect');
  assert.equal(professionCompliance('home-chef')?.id, 'home-chef-tiffin');
  assert.equal(professionCompliance('call-centre-agent')?.id, 'ai-receptionist');
  assert.equal(professionCompliance('teaching')?.label, familyOf('teaching').label);
});

test('6E6: the gallery shows the families: each way names its families and the view counts the ways in each', () => {
  const view = listWays({});
  assert.ok(view.families.length > 0);
  for (const family of view.families) {
    assert.equal(family.label, familyOf(family.id).label);
    assert.equal(family.count, view.ways.filter(way => way.families.includes(family.id)).length, family.id);
    assert.ok(family.count > 0, family.id);
  }
  assert.deepEqual(view.families.map(family => family.id), FAMILY_IDS.filter(id => view.families.some(family => family.id === id)));
  for (const way of view.ways) assert.deepEqual(way.families, familiesForPlaybook(way.playbook), way.id);
  const ca = view.ways.find(way => way.playbook === 'ca-firm')!;
  assert.deepEqual(ca.families, ['money-tax']);
});
