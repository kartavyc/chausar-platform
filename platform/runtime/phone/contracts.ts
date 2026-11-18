/** The phone protocol's refusal codes and its error, whose words are its code. No desktop, database, framework, or Node imports. */
export type PhoneErrorCode = 'OFFLINE' | 'VALIDATION_REQUIRED' | 'ACCESS_REVOKED' | 'SESSION_EXPIRED' | 'UNPAIRED' | 'INVALID_RESPONSE' | 'INVALID_REQUEST' | 'CHANNEL_FORBIDDEN' | 'CAPABILITY_FORBIDDEN' | 'APPROVAL_EXPIRED' | 'APPROVAL_USED' | 'PREVIEW_CHANGED' | 'OPEN_DESKTOP' | 'REQUEST_EXISTS' | 'TRANSPORT_UNKNOWN' | 'CACHE_INVALID';
export class PhoneError extends Error {
  readonly code: PhoneErrorCode;
  constructor(code: PhoneErrorCode) { super(code); this.name = 'PhoneError'; this.code = code; }
}
