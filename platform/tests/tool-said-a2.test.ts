// A2 second review (L5): what a tool printed is screened for the home folder in every spelling Windows gives it: any
// case, either separator, a doubled separator from JSON, and the 8.3 short name; elsewhere the home folder exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { screenHome } from '../runtime/venture/models/port.ts';

test('the Windows home folder is screened in any case, either separator, JSON escaping and its 8.3 short name', () => {
  const home = String.raw`C:\Users\Asha Kumar`;
  const said = (text: string) => screenHome(text, home, 'win32');
  assert.equal(said(String.raw`log at c:\users\asha kumar\AppData\codex.log`), String.raw`log at ~\AppData\codex.log`);
  assert.equal(said('log at C:/Users/Asha Kumar/AppData/codex.log'), 'log at ~/AppData/codex.log');
  assert.equal(said(String.raw`{"path":"C:\Users\Asha Kumar\AppData"}`).includes('Asha'), false, 'JSON-escaped');
  assert.equal(said(String.raw`log at C:\Users\ASHAKU~1\AppData\codex.log`), String.raw`log at ~\AppData\codex.log`, 'the 8.3 short name');
  assert.equal(said(String.raw`log at c:\users\ashaku~2\x`), String.raw`log at ~\x`);
  assert.equal(said(String.raw`C:\Users\Asha Kumari\x`), String.raw`C:\Users\Asha Kumari\x`, 'another folder that starts the same is not the home folder');
});

test('elsewhere the home folder is screened exactly as it is spelled', () => {
  assert.equal(screenHome('read /home/asha/.codex/log', '/home/asha', 'linux'), 'read ~/.codex/log');
  assert.equal(screenHome('read /HOME/ASHA/x', '/home/asha', 'linux'), 'read /HOME/ASHA/x');
  assert.equal(screenHome('read /home/ashab/x', '/home/asha', 'linux'), 'read /home/ashab/x');
});
