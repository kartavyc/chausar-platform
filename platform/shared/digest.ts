// A lowercase SHA-256 identity. The shared pattern has no stateful flags.
export const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
export function isDigest(value: unknown): value is string {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}
