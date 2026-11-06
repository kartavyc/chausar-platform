import type { AiNetworkSetting, SavedSearchKey, SearchProviderId, WebSearchView } from '../../../contract/venture/web/search-types.ts';
export type { AiNetworkSetting, SavedSearchKey, SearchProviderId, WebSearchView } from '../../../contract/venture/web/search-types.ts';
// Wave 6 (6F3): the shapes of web search, with no Node imports, so the Ink app's fake engine and types can share them.



/** Kept in the business file: which provider, the key's last four characters, when, and the consent agreed. Never the key. */


/** venture.web.search: the AI tool's own search first, then the owner's own key for Chausar's own lookups. */


/** venture.web.read: one public page as Chausar's polite reader kept it (web/reader.ts). */
export type WebReadView = {
  url: string; title: string | null; siteName: string | null; text: string; words: number; more: boolean;
  via: 'page' | 'javascript'; label: string; line: string;
};
