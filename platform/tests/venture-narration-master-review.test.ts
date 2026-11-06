// Independent review: missing or impossible measurements must never qualify a master.
import test from 'node:test';
import assert from 'node:assert/strict';
import { narrationMasterCheck } from '../runtime/venture/playbooks/narration-studio/master-core.ts';

const measured = { durationMs: 5000, format: 'mp3', sampleRate: 44100, bitrateKbps: 192, constantBitrate: true, channels: 1, rmsTenths: -200, peakTenths: -40, noiseTenths: -650, headMs: 700, tailMs: 1500, bitDepth: 16 };

test('non-finite levels and bitrate cannot qualify a narration master', () => {
  for (const change of [{ peakTenths: -Infinity }, { noiseTenths: -Infinity }, { bitrateKbps: Infinity }]) {
    assert.equal(narrationMasterCheck('spotify', { ...measured, ...change }).pass, false, JSON.stringify(Object.keys(change)));
  }
});

test('leading and trailing room tone must fit the measured file duration', () => {
  assert.equal(narrationMasterCheck('spotify', { ...measured, durationMs: 1000 }).pass, false);
});
