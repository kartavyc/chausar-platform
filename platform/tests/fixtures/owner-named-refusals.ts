// B1 fix round 2 (quality finding 8): the refusals the B1 reviews named, each with the code the engine sends it under,
// shared by the engine's test (platform/tests/owner-flag-b1.test.ts) and the app's (app/ui/tests/engine/owner-flag-b1.test.ts)
// so the two lists cannot drift. Each is written for the owner, so every transport flags it and the app shows it as sent,
// even where a word in it ("digest", "Vault Studios") would say the general line on an unflagged error.
// No imports: the engine's own constants are checked against these words in the engine's test.
export const NAMED_REFUSALS: readonly (readonly [code: string, message: string])[] = Object.freeze([
  ['CONFIRMATION_REQUIRED', 'Confirm the exact reviewed archive and separate closed copy.'],
  ['CONFIRMATION_REQUIRED', 'Confirm a new empty managed activation target.'],
  ['CONFIRMATION_REQUIRED', 'Confirm the export in the app.'],
  ['CONFIRMATION_REQUIRED', 'Type the business name to start a new never-contact list.'],
  ['CONFIRMATION_REQUIRED', 'Confirm the restore in the app.'],
  ['CONFIRMATION_REQUIRED', 'Type your email address to delete your account.'],
  ['NOT_BUILT_YET', 'This part of Chausar is not built yet.'],
  ['NOT_BUILT_YET', 'This tool is not built yet.'],
  ['NOT_BUILT_YET', 'The model recording could not be read, so model calls are off.'],
  ['UNAUTHENTICATED', 'Your session ended. Sign in again.'],
  ['UNAUTHENTICATED', 'This temporary business has ended. Start again.'],
  ['VAULT_LOCKED', 'Choose one of your businesses first.'],
  ['VAULT_LOCKED', 'The temporary business did not open.'],
  ['INVALID_VENTURE_REQUEST', 'Use a web address starting with https (or http on this computer), with no password and nothing after ? or #. Add a password in its own box.'],
  ['INVALID_VENTURE_REQUEST', 'Send the digest of the consent you read.'],
  ['PRICE_REQUIRED', 'Set your price for Digest Ltd first.'],
  ['INVALID_VENTURE_REQUEST', 'This report has nothing from Vault Studios in it yet.'],
] as const);
