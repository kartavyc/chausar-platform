// Chausar venture launcher: the words Today's queue writes itself, the same every time (the setup cards and the plan's
// decided line). The app says each in the owner's language from its own pack, keyed by these names
// (app/ui/src/places/today/plan-words.ts); a test holds the English pack to exactly these words. Round 5 (re-check 082):
// with Hindi on, Today kept "Keep this business" and "Plan accepted." in English. A line built with a name, a price or
// a reason in it is not one of these and stays as written.
//
// Pure: no store, no network and no Node imports, so the app's fake engine says exactly these words by using this file.

export const QUEUE_FIXED_WORDS = Object.freeze({
  planAccepted: 'Plan accepted.',
  connectAi: 'Connect your AI',
  connectAiLine: 'Templates work without one. Your agents draft with your AI once it is connected.',
  aiAttention: 'Your AI needs attention',
  confirmTax: 'Confirm your tax',
  confirmPricesTax: 'Confirm your prices and tax',
  keep: 'Keep this business',
  keepLine: 'Make a recovery code so you can open it if this computer is lost.',
});
