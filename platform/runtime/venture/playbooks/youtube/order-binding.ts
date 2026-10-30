// Derived source records bind the owner order, not each other's review lifecycle.
import {digest} from '../../../portable.ts';
export function youtubeOrderDigest(order:Record<string,unknown>){const {youtubeResearch:_research,youtubePublic:_public,...material}=order;return digest(material);}
