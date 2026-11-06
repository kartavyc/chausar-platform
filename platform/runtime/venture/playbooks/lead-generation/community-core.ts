// Chausar browser-safe community lead report. reddit-skills (no licence) informs the idea only; no code copied.
export class CommunityError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
function check(condition: unknown, code: string, message: string): asserts condition { if (!condition) throw new CommunityError(code, message); }
function exact(value: unknown, keys: string[]): void {
  check(value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key)), 'INVALID_VENTURE_REQUEST', 'Send the required community fields and nothing else.');
}
function day(value: unknown): boolean { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
export type CommunityVote = { dimension: string; score: number; quote: string };
export type CommunityPost = { id: string; url: string; community: string; rulesUrl: string; rulesCheckedOn: string; readingAllowed: boolean; on: string; removed: boolean; text: string; votes: CommunityVote[] };
export type CommunityInput = { product: string; confirmed: boolean; problem: string; categories: string[]; painWords: string[]; days: number; posts: CommunityPost[] };
/** Validates owner-pasted posts and ranks only evidence with two strong dimensions. Makes no community request. */
export function communityReport(input: CommunityInput): { product: string; problem: string; categories: string[]; painWords: string[]; posts: CommunityPost[]; coverage: string; actions: never[] } {
  exact(input, ['product', 'confirmed', 'problem', 'categories', 'painWords', 'days', 'posts']);
  const sentences = typeof input.product === 'string' ? input.product.trim().split(/(?<=[.!?।])\s+/u).filter(Boolean) : [];
  check(input.confirmed === true && sentences.length >= 2 && sentences.length <= 3, 'PRODUCT_CONFIRM_REQUIRED', 'Confirm the product in two or three sentences before reading community posts.');
  check(typeof input.problem === 'string' && input.problem.trim() && Array.isArray(input.categories) && input.categories.length > 0 && input.categories.length <= 10 && input.categories.every(v => typeof v === 'string' && v.length <= 100) && Array.isArray(input.painWords) && input.painWords.length <= 20 && input.painWords.every(v => typeof v === 'string' && v.length <= 100), 'INVALID_VENTURE_REQUEST', 'Name the problem, categories and pain words.');
  check(Number.isInteger(input.days) && input.days >= 1 && input.days <= 90 && Array.isArray(input.posts) && input.posts.length <= 100, 'INVALID_VENTURE_REQUEST', 'Use a bounded set of pasted posts and days.');
  const posts: CommunityPost[] = [], covered = new Set<string>();
  for (const post of input.posts) {
    exact(post, ['id', 'url', 'community', 'rulesUrl', 'rulesCheckedOn', 'readingAllowed', 'on', 'removed', 'text', 'votes']);
    check(typeof post.id === 'string' && post.id.trim().length > 0 && post.id.length <= 200 && typeof post.community === 'string' && post.community.trim().length > 0 && post.community.length <= 200 && typeof post.removed === 'boolean' && typeof post.text === 'string', 'INVALID_VENTURE_REQUEST', 'Each post needs its id, community and removal status.');
    if (post.removed === true || /^\[(?:removed|deleted)\]$/i.test(post.text?.trim())) continue;
    check(post.readingAllowed === true && /^https?:\/\//.test(post.rulesUrl) && day(post.rulesCheckedOn), 'COMMUNITY_RULES_REQUIRED', 'Check this community rules before using its posts.');
    check(typeof post.text === 'string' && post.text.length <= 20000 && /^https?:\/\//.test(post.url) && day(post.on) && Array.isArray(post.votes) && post.votes.length === 3, 'INVALID_VENTURE_REQUEST', 'Each post needs a source, day and three distinct scored dimensions.');
    for (const vote of post.votes) {
      exact(vote, ['dimension', 'score', 'quote']);
      check(['pain', 'fit', 'intent'].includes(vote.dimension) && Number.isInteger(vote.score) && vote.score >= 1 && vote.score <= 5, 'INVALID_VENTURE_REQUEST', 'Score pain, fit and intent from one to five.');
      check(typeof vote.quote === 'string' && vote.quote.trim().length > 0 && post.text.includes(vote.quote), 'COMMUNITY_QUOTE_MISSING', 'Each vote needs an exact line from the post.');
    }
    check(new Set(post.votes.map(v => v.dimension)).size === 3, 'INVALID_VENTURE_REQUEST', 'Score three distinct dimensions.');
    covered.add(post.on);
    if (post.votes.filter(v => v.score >= 4).length >= 2) posts.push(structuredClone(post));
  }
  check(covered.size <= input.days, 'INVALID_VENTURE_REQUEST', 'The covered days exceed the report window.');
  return { product: input.product, problem: input.problem, categories: [...input.categories], painWords: [...input.painWords], posts, coverage: `covered ${covered.size} of ${input.days} days`, actions: [] };
}
