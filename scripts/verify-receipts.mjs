// Chausar (Ink v2 wave 4, package 4J10): checks an exported file of signed receipts offline (the receipts part of
// venture.money.export, saved as JSON). Each receipt in the file carries the business's Ed25519 signature over its
// canonical JSON and the public half of the key that made it; this script checks every one with nothing else: no
// network, no Chausar, no vault. A file can only vouch for itself, so --key=<base64 SPKI>, a public key the person got
// from somewhere other than this file, checks who signed it; without it the script says the signer was not checked.
// It prints OK or CHANGED for each receipt and a summary line.
// Exit 0 when every receipt matches its signature, 1 when any does not, 2 when the file cannot be read.
import { createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const FORMAT = 'chausar-signed-receipts/1';
const usage = 'Usage: node scripts/verify-receipts.mjs <export.json> [--key=<public key, base64 SPKI>]';

/** Canonical JSON as the engine makes it (platform/runtime/actions.ts canonical): keys sorted, nothing else changed. */
function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('A number in the file is not finite.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value !== 'object') throw new Error('The file holds something that is not plain JSON.');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function fail(line) {
  process.stderr.write(`${line}\n${usage}\n`);
  process.exit(2);
}

const args = process.argv.slice(2);
const path = args.find(arg => !arg.startsWith('--'));
const keyArg = args.find(arg => arg.startsWith('--key='));
if (!path || args.some(arg => arg.startsWith('--') && !arg.startsWith('--key='))) fail('Give the exported file.');

let file;
try { file = JSON.parse(await readFile(path, 'utf8')); } catch { fail('This file could not be read as JSON.'); }
if (!file || file.format !== FORMAT || file.algorithm !== 'ed25519' || !Array.isArray(file.receipts)) fail(`This is not a ${FORMAT} file.`);

const given = keyArg ? keyArg.slice('--key='.length) : null;
const keys = new Map();
const keyOf = text => {
  if (!keys.has(text)) {
    try { keys.set(text, createPublicKey({ key: Buffer.from(text, 'base64'), format: 'der', type: 'spki' })); } catch { keys.set(text, null); }
  }
  return keys.get(text);
};

let good = 0;
let otherKey = false;
for (const item of file.receipts) {
  const publicKey = typeof item?.publicKey === 'string' ? item.publicKey : file.publicKey;
  let ok = false;
  try {
    const key = typeof publicKey === 'string' ? keyOf(publicKey) : null;
    const pinned = given === null || given === publicKey;
    if (!pinned) otherKey = true;
    ok = pinned && !!key && typeof item?.signature === 'string'
      && verify(null, Buffer.from(canonical(item.receipt), 'utf8'), key, Buffer.from(item.signature, 'base64'));
  } catch { ok = false; }
  if (ok) good += 1;
  process.stdout.write(`${ok ? 'OK' : 'CHANGED'} ${String(item?.id ?? 'unknown')}\n`);
}
if (otherKey) process.stdout.write('Some receipts were signed with a key that is not the key you gave.\n');
if (given === null) process.stdout.write('The signer was not checked: these receipts match the keys in this file. Give --key=<public key> from somewhere other than this file to check who signed them.\n');
const total = file.receipts.length;
process.stdout.write(`${good} of ${total} receipt${total === 1 ? '' : 's'} match their signatures.\n`);
process.exit(good === total ? 0 : 1);
