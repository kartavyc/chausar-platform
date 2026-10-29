// The Start gallery's tiles from the playbook kit (Ink v2 wave 5, package 5A1, test 6; plan "Gallery tile" lines of 5B,
// 5C and 5D). venture.playbooks.list shows one tile per registered playbook that delivers, the three flagships
// included: a kit playbook's tile comes from its definition's startTile (kit/tile.ts maps it onto the gallery's
// WayData), a flagship's from its own tile.ts. Hours and pay are a model estimate, labelled so, in English and Hindi.
// A playbook whose package has not landed (its definition stub still null) has no tile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listWays, waysView } from '../runtime/venture/core/ways.ts';
import { PLAYBOOK_REGISTRY } from '../runtime/venture/playbooks/registry.ts';
import { WAY_SOURCE, WAYS } from '../runtime/venture/playbooks/ways.ts';
import { kitWay } from '../runtime/venture/playbooks/kit/tile.ts';
import { definePlaybook } from '../runtime/venture/playbooks/kit/define.ts';
import { YOUTUBE_TILE } from '../runtime/venture/playbooks/youtube/tile.ts';
import { CA_FIRM_TILE } from '../runtime/venture/playbooks/ca-firm/tile.ts';
import { SOCIAL_AGENCY_TILE } from '../runtime/venture/playbooks/social/tile.ts';
import { fixtureHi, kitFixture } from './fixtures/venture/kit-fixture.ts';
import { installKitFixture } from './fixtures/venture/kit-business.ts';

const DEVANAGARI = /\p{Script=Devanagari}/u;
const byId = (id: string) => listWays({}).ways.find(way => way.id === id)!;

test('the three flagship tiles carry the plan\'s words, hours, team and pay, as a model estimate', () => {
  const youtube = byId('youtube');
  assert.equal(youtube.category, 'content');
  assert.equal(youtube.line, "Episodes, shorts, packaging and audits for your own channel or a client's, from footage you own or license.");
  assert.deepEqual([youtube.hours, youtube.youDo, youtube.teamLine], ['4 to 8 h a week', 'Record, watch each cut, meet sponsors.', 'Edits, shorts, titles and sponsor quotes.']);
  assert.deepEqual(youtube.team.map(member => [member.role, member.department]), [['Story editor', 'production'], ['Producer', 'sales'], ['Packager', 'marketing']]);
  assert.deepEqual([youtube.clientsPay.text, youtube.clientsPay.per], ['₹5,000 to ₹30,000', 'per video']);
  const ca = byId('ca-firm');
  assert.equal(ca.line, 'Books, GST, TDS and income tax working papers for small businesses; your CA of record signs anything regulated.');
  assert.deepEqual([ca.category, ca.hours, ca.youDo, ca.teamLine], ['money-and-tax', '6 to 10 h a week', 'Meet clients, review drafts, work with your CA.', 'Books, workings, receipts for every figure.']);
  assert.deepEqual(ca.team.map(member => member.role), ['Reconciler', 'Tax preparer'], 'its code roles are never shown as AI');
  assert.deepEqual([ca.clientsPay.text, ca.clientsPay.per], ['₹5,000 to ₹20,000', 'a client a month']);
  const social = byId('social-agency');
  assert.equal(social.line, 'Posts, replies, reels and monthly reports for local shops, clinics and coaches.');
  assert.deepEqual([social.category, social.hours, social.youDo, social.teamLine], ['marketing', '4 to 6 h a week', 'Approve drafts, talk to clients, post or hand off.', 'Calendars, posts, reply drafts, report figures from exports.']);
  assert.deepEqual(social.team.map(member => member.role), ['Strategist', 'Writer', 'Creative']);
  assert.deepEqual([social.clientsPay.text, social.clientsPay.per], ['₹8,000 to ₹25,000', 'a client a month']);
  for (const way of [youtube, ca, social]) {
    assert.equal(way.hoursEstimate, true);
    assert.equal(way.clientsPay.estimate, true);
    assert.equal(way.clientsPay.source, WAY_SOURCE.en);
    for (const words of [way.hi.line, way.hi.youDo, way.hi.teamLine, way.hi.source]) assert.match(words, DEVANAGARI, words);
  }
  // Each flagship's tile is its tile.ts data, team roles included (at most four, code roles left off the avatars).
  for (const [tile, id] of [[YOUTUBE_TILE, 'youtube'], [CA_FIRM_TILE, 'ca-firm'], [SOCIAL_AGENCY_TILE, 'social-agency']] as const) {
    const way = WAYS.find(item => item.playbook === id)!;
    assert.deepEqual([way.category, way.hours, way.pay, way.en.line, way.en.youDo, way.en.teamLine], [tile.category, { min: tile.youDo.hoursMin, max: tile.youDo.hoursMax }, { minRupees: tile.pay.minRupees, maxRupees: tile.pay.maxRupees }, tile.line, tile.youDo.line, tile.team.line]);
    assert.ok(tile.team.roleIds.length <= 4);
  }
});

test('a kit playbook gets one tile from its definition, in English and Hindi, with both figures a model estimate', async t => {
  assert.deepEqual(listWays({}).ways.map(way => way.id), ['ca-firm', 'youtube', 'social-agency'], 'no kit package has landed: no tile');
  t.after(installKitFixture());
  const view = listWays({});
  assert.deepEqual(view.ways.map(way => way.id), ['ca-firm', 'youtube', 'social-agency', 'kit-fixture']);
  const kit = view.ways.find(way => way.id === 'kit-fixture')!;
  assert.deepEqual([kit.label, kit.category, kit.line, kit.hours, kit.youDo, kit.teamLine], [
    'Kit fixture studio', 'marketing', 'Voice sheets, calendars and posts for small shops.', '2 to 4 h a week', 'Approve drafts and talk to clients.', 'Research, voice sheets and posts.',
  ]);
  assert.deepEqual(kit.team.map(member => [member.role, member.department]), [['Researcher', 'marketing'], ['Writer', 'production']], 'Billing is code, never an AI avatar');
  assert.deepEqual([kit.clientsPay.text, kit.clientsPay.per, kit.clientsPay.estimate, kit.hoursEstimate], ['₹5,000 to ₹15,000', 'a client a month', true, true]);
  assert.equal(kit.hi.label, 'हिंदी में: Kit fixture studio');
  assert.equal(kit.hi.line, 'हिंदी में: Voice sheets, calendars and posts for small shops.');
  assert.deepEqual(kit.hi.team, ['हिंदी में: Researcher', 'हिंदी में: Writer']);
  assert.equal(kit.hi.hours, 'हफ़्ते में 2 से 4 घंटे');
  assert.match(kit.needs.connections, /Your mail app/);
  assert.doesNotMatch(kit.needs.connections, /scheduler/i, 'a planned connector is not a need');
  assert.equal(view.categories.find(category => category.id === 'marketing')!.count, 2);
});

test('a registered playbook with no definition yet has no tile; kitWay maps a definition onto the gallery\'s way data', () => {
  const fixture = definePlaybook(kitFixture(), fixtureHi(kitFixture()));
  const registry = [...PLAYBOOK_REGISTRY, fixture.registration];
  assert.deepEqual(waysView(WAYS, registry, []).ways.map(way => way.id), ['ca-firm', 'youtube', 'social-agency'], 'registered, but its way data never landed');
  const way = kitWay(fixture);
  assert.deepEqual([way.playbook, way.category, way.hours, way.pay, way.team], ['kit-fixture', 'marketing', { min: 2, max: 4 }, { minRupees: 5000, maxRupees: 15000 }, ['researcher', 'writer', 'billing']]);
  assert.equal(way.en.starter, 'Kit fixture studio: Voice sheets, calendars and posts for small shops.');
});
