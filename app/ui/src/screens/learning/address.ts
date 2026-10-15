import type { Address } from '../../app/presentation.ts';

/** The one address the learning place draws: Books, Learning (registered in places/subplaces/learning-ext.ts). */
export const LEARNING_ADDRESS = { place: 'books', sub: 'learning' } as const;
export const handlesLearning = (address: Address): boolean => address.place === LEARNING_ADDRESS.place && address.sub === LEARNING_ADDRESS.sub;
