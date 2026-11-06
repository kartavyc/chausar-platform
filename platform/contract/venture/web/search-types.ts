// Canonical browser-safe types, shared by the engine and renderer.


export type AiNetworkSetting = 'off' | 'research' | 'on';

export type SavedSearchKey = { provider: SearchProviderId; keyHint: string; savedAt: string; consentDigest: string };

export type SearchProviderId = 'brave' | 'exa' | 'tavily';

export type WebSearchView = {
  builtIn: { codex: AiNetworkSetting; claude: AiNetworkSetting; line: string };
  key: { provider: SearchProviderId; name: string; keyHint: string; savedAt: string; label: 'fixture-tested' } | null;
  providers: { id: SearchProviderId; name: string; label: 'fixture-tested'; keyPage: string; consent: string; consentDigest: string }[];
  line: string;
};
