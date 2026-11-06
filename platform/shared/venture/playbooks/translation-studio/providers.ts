// Original Chausar capability table, based on the actual configured routes. No verified language list is invented.
export type TranslationProviderCapability={id:string;languages:readonly string[]|null;local:boolean;model:boolean};
/** Null languages means unknown, never all supported. CLI routes may still send client data to remote providers. */
export const TRANSLATION_PROVIDERS:readonly TranslationProviderCapability[]=[
 {id:'manual-local',languages:null,local:true,model:false},
 {id:'anthropic-haiku-5-5',languages:null,local:false,model:true},
 {id:'anthropic-sonnet-5-5',languages:null,local:false,model:true},
 {id:'openai-gpt-6-luna',languages:null,local:false,model:true},
 {id:'claude-code-cli',languages:null,local:false,model:true},
 {id:'codex-cli',languages:null,local:false,model:true},
 {id:'built-in-templates',languages:[],local:true,model:false},
];
/** A verified finite language list limits both pickers; unverified models keep the explicit unknown warning. */
export function translationLanguageOptions(provider:string):readonly string[]|null{return TRANSLATION_PROVIDERS.find(p=>p.id===provider)?.languages??null;}
