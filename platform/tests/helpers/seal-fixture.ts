// D12: test helper. Rewrites the State inside a vault on disk (authority.encrypted.json), opening and resealing it the
// way vault.ts does (scrypt-wrapped key, AES-256-GCM with the envelope as additional data), so a test can put data of
// another version, or an older shape, into a real vault without a ciphertext ever being committed. Test passphrases only.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type Ciphertext = { nonce: string; tag: string; data: string };
const FORMAT = 'chausar.vault.v1';
const KDF = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function unseal(key: Uint8Array, sealed: Ciphertext, aad: string): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.nonce, 'base64url'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64url')), decipher.final()]);
}
function seal(key: Uint8Array, plaintext: Uint8Array, aad: string): Ciphertext {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64url');
  return { nonce: nonce.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data };
}
const aadOf = (envelope: any) => JSON.stringify({ format: envelope.format, id: envelope.id, revision: envelope.revision, passphrase: envelope.passphrase, recovery: envelope.recovery });

/** A vault file (or a backup's envelope text) opened with the passphrase: the envelope, the data key and the State. */
export function openEnvelope(text: string, passphrase: string): { envelope: any; key: Buffer; state: any } {
  const parsed = JSON.parse(text);
  const envelope = parsed.backupFormat === 'chausar.backup.v1' ? parsed.envelope : parsed;
  if (envelope.format !== FORMAT) throw new Error('Not a vault file.');
  const wrapping = scryptSync(passphrase, Buffer.from(envelope.passphrase.salt, 'base64url'), 32, KDF);
  const key = unseal(wrapping, envelope.passphrase.ciphertext, `${FORMAT}:${envelope.id}:passphrase`);
  return { envelope, key, state: JSON.parse(unseal(key, envelope.snapshot, aadOf(envelope)).toString('utf8')) };
}

/** The vault's file, its State changed by `change` and sealed back. Returns the new file text. */
export async function rewriteVaultState(directory: string, passphrase: string, change: (state: any) => any): Promise<string> {
  const file = join(directory, 'authority.encrypted.json');
  const { envelope, key, state } = openEnvelope(await readFile(file, 'utf8'), passphrase);
  const next = change(state) ?? state;
  const text = JSON.stringify({ ...envelope, snapshot: seal(key, Buffer.from(JSON.stringify(next)), aadOf(envelope)) });
  await writeFile(file, text);
  return text;
}

/** The State inside a vault's file, read with the passphrase; the file is not touched. */
export async function readVaultState(directory: string, passphrase: string): Promise<any> {
  return openEnvelope(await readFile(join(directory, 'authority.encrypted.json'), 'utf8'), passphrase).state;
}
