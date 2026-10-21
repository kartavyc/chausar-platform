// P2-connectors: clipping rights. A playbook's intake records the rights to the footage (the client's own footage, a
// licence, or a creator clip programme with its reference), and every clipping step refuses with RIGHTS_REQUIRED
// without them. Chausar never clips other people's content without rights.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VENTURE_ERRORS } from '../runtime/venture/contracts.ts';
import { houseStyleFindings } from '../runtime/venture/records.ts';
import {
  RIGHTS_BASES, RIGHTS_INTAKE_FIELD, isClippingStep, recordRights, requireRights, rightsLine, type PlaybookIntake,
} from '../runtime/venture/delivery/rights.ts';

const code = (expected: string) => (error: any) => { assert.equal(error.code, expected, error.message); return true; };
const meta = { by: 'owner', at: '2026-10-21T10:00:00.000Z' };
const clipStep = { id: 'cut-shorts', clipping: true };
const writeStep = { id: 'write-title' };

test('the intake field offers exactly three bases, and a reference is required for a licence or a clip programme', () => {
  assert.deepEqual([...RIGHTS_BASES], ['own-footage', 'licence', 'creator-clip-programme']);
  assert.equal(RIGHTS_INTAKE_FIELD.id, 'rights');
  assert.deepEqual(RIGHTS_INTAKE_FIELD.options.map(o => o.id), [...RIGHTS_BASES]);

  const own = recordRights({ basis: 'own-footage', holder: 'Blue Cafe' }, meta);
  assert.equal(own.reference, null);
  assert.equal(rightsLine(own), "The client's own footage, owned by Blue Cafe.");

  assert.throws(() => recordRights({ basis: 'licence', holder: 'Stock House' }, meta), code('RIGHTS_REQUIRED'));
  assert.throws(() => recordRights({ basis: 'creator-clip-programme', holder: 'A Creator', reference: '  ' }, meta), code('RIGHTS_REQUIRED'));
  assert.throws(() => recordRights({ basis: 'found-it-online', holder: 'Someone' }, meta), code('RIGHTS_REQUIRED'));
  assert.throws(() => recordRights({ basis: 'own-footage' }, meta), code('RIGHTS_REQUIRED'));
  assert.throws(() => recordRights(null, meta), code('RIGHTS_REQUIRED'));

  const programme = recordRights({ basis: 'creator-clip-programme', holder: 'A Creator', reference: 'https://creator.example/clip-programme', scope: 'Shorts from the October streams' }, meta);
  assert.match(rightsLine(programme), /clip programme/);
  assert.equal(programme.recordedBy, 'owner');
});

test('clipping steps refuse without rights; other steps do not ask', () => {
  assert.ok(isClippingStep(clipStep));
  assert.ok(!isClippingStep(writeStep));
  const empty: PlaybookIntake = { rights: null };
  assert.equal(requireRights(writeStep, empty, '2026-10-21'), null);
  assert.throws(() => requireRights(clipStep, empty, '2026-10-21'), code('RIGHTS_REQUIRED'));
  assert.throws(() => requireRights(clipStep, {} as PlaybookIntake, '2026-10-21'), code('RIGHTS_REQUIRED'));
  // A hand-edited intake with a licence but no reference is still refused.
  assert.throws(() => requireRights(clipStep, { rights: { basis: 'licence', holder: 'Stock House', reference: null } as any }, '2026-10-21'), code('RIGHTS_REQUIRED'));

  const licence = recordRights({ basis: 'licence', holder: 'Stock House', reference: 'LIC-2026-118', expiresOn: '2026-12-31' }, meta);
  assert.deepEqual(requireRights(clipStep, { rights: licence }, '2026-10-21'), licence);
  assert.throws(() => requireRights(clipStep, { rights: licence }, '2027-01-01'), code('RIGHTS_REQUIRED'));
});

test('static: rights.ts throws only declared codes, does no number parsing and keeps the house style', async () => {
  const source = await readFile(new URL('../runtime/venture/delivery/rights.ts', import.meta.url), 'utf8');
  for (const match of source.matchAll(/'([A-Z]+(?:_[A-Z]+)+)'/g)) assert.ok((VENTURE_ERRORS as readonly string[]).includes(match[1]), match[1]);
  for (const banned of ['parseFloat', 'toFixed', 'Math.round', 'Number(']) assert.ok(!source.includes(banned), banned);
  assert.ok(!source.includes('—'));
  assert.deepEqual(houseStyleFindings(source), []);
});
