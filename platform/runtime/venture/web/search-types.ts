// Wave 6 (6F3): the shapes of web search, with no Node imports, so the Ink app's fake engine and types can share them.
export type SearchProviderId = 'brave' | 'exa' | 'tavily';
export type AiNetworkSetting = 'off' | 'research' | 'on';

/** Kept in the business file: which provider, the key's last four characters, when, and the consent agreed. Never the key. */
export type SavedSearchKey = { provider: SearchProviderId; keyHint: string; savedAt: string; consentDigest: string };

/** venture.web.search: the AI tool's own search first, then the owner's own key for Chausar's own lookups. */
export type WebSearchView = {
  builtIn: { codex: AiNetworkSetting; claude: AiNetworkSetting; line: string };
  key: { provider: SearchProviderId; name: string; keyHint: string; savedAt: string; label: 'fixture-tested' } | null;
  providers: { id: SearchProviderId; name: string; label: 'fixture-tested'; keyPage: string; consent: string; consentDigest: string }[];
  line: string;
};

/** venture.web.read: one public page as Chausar's polite reader kept it (web/reader.ts). */
export type WebReadView = {
  url: string; title: string | null; siteName: string | null; text: string; words: number; more: boolean;
  via: 'page' | 'javascript'; label: string; line: string;
};
