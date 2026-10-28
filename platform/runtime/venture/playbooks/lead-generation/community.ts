// Chausar community report engine boundary; reddit-skills no-licence ideas only, no copied source.
import { ChausarError } from '../../../contracts.ts';
import { communityReport as report, CommunityError } from './community-core.ts';
import type { CommunityInput } from './community-core.ts';
export type { CommunityInput, CommunityVote, CommunityPost } from './community-core.ts';
/** Engine-coded refusal around the browser-safe scoring core. */
export function communityReport(input: CommunityInput): ReturnType<typeof report> { try { return report(input); } catch (error) { if(error instanceof CommunityError) throw new ChausarError(error.code,error.message); throw error; } }
