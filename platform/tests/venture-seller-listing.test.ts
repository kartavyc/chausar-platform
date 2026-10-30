// Seller listing checks: amazon-listing-doctor ideas (MIT), no code copied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listingHealth, imageDimensions } from '../runtime/venture/playbooks/online-seller/listing.ts';

test('missing listing evidence produces coverage-first questions and no invented score', () => {
  const r = listingHealth({ marketplace: 'amazon-in', title: 'Best free cup cup', bullets: null, description: null, images: null });
  assert.equal(r.score, null); assert.equal(r.basis, 'Chausar own rubric, not a marketplace internal score');
  assert.ok(r.questions.some(q => q.field === 'images' && /Upload/.test(q.words)));
  assert.ok(r.triage.some(t => t.phrase === 'Best' && t.action === 'delete'));
  assert.ok(r.triage.some(t => t.phrase === 'free' && t.action === 'delete'));
  assert.ok(r.triage.some(t => t.phrase === 'cup' && t.action === 'move'));
  assert.equal(r.coverage.present, 1); assert.equal(r.coverage.of, 4);
  assert.equal(r.manual[0], 'Check the main image background by eye.');
});

import { indiaListingChecks } from '../runtime/venture/playbooks/online-seller/india-checks.ts';

test('India packaged-goods checks reject above-MRP and cannot run for a client without legal confirmation', () => {
  const input = { packaged: true, sellingMinor: '10000', mrpMinor: '9999', countryOfOrigin: 'India', sellerDetails: 'Example seller, Mumbai' };
  const r = indiaListingChecks(input, { rehearsal: true });
  assert.ok(r.findings.some(f => f.code === 'PRICE_ABOVE_MRP'));
  assert.throws(() => indiaListingChecks(input, { rehearsal: false }), { code: 'RULE_UNCONFIRMED' });
  const missing = indiaListingChecks({ ...input, mrpMinor: null, countryOfOrigin: '', sellerDetails: '' }, { rehearsal: true });
  assert.deepEqual(missing.findings.map(f => f.code), ['MRP_REQUIRED', 'ORIGIN_REQUIRED', 'SELLER_DETAILS_REQUIRED']);
});

test('image dimensions come from headers and a truncated image refuses with a plain code', () => {
  const png = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(png); png.write('IHDR', 12); png.writeUInt32BE(1200,16); png.writeUInt32BE(1500,20);
  assert.deepEqual(imageDimensions(png), { width: 1200, height: 1500 });
  assert.throws(() => imageDimensions(Uint8Array.from([255,216,255,255,255,255])), { code: 'IMAGE_HEADER_UNREADABLE' });
});

import { sellerImageFiles } from '../runtime/venture/playbooks/online-seller/source.ts';
test('listing image uploads are read from bytes and never accept caller-provided dimensions', () => {
  const png = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(png); png.write('IHDR',12); png.writeUInt32BE(1200,16); png.writeUInt32BE(1500,20);
  assert.deepEqual(sellerImageFiles([{ name: 'cup.png', contentBase64: png.toString('base64') }])[0].dimensions, { width: 1200, height: 1500 });
  assert.throws(() => sellerImageFiles([{ name: 'cup.png', contentBase64: png.toString('base64'), width: 5000 }]), { code: 'SELLER_INPUT_INVALID' });
});

test('the packaged-goods MRP comparison is not applied to unpackaged goods', () => {
  const r = indiaListingChecks({ packaged: false, sellingMinor: '10000', mrpMinor: '9999', countryOfOrigin: '', sellerDetails: 'Shop, Pune' }, { rehearsal: true });
  assert.equal(r.findings.some(f => f.code === 'PRICE_ABOVE_MRP'), false);
});
