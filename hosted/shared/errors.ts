/** Fixed upper-case codes. A message never carries data from outside. */
export class HostedError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.name = 'HostedError'; this.code = code; this.status = status; }
}
export function check(condition: unknown, code: string, message: string, status = 400): asserts condition {
  if (!condition) throw new HostedError(code, message, status);
}
