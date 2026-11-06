// Browser-safe preview body. No model credentials are part of a stored request.
export type TestingPreview={clientAi?:import('../../clients/ai-consent-core.ts').ClientAiContextBinding;callId:string;payloadText:string;digest:string;presetId:string;model:string|null;endpoint:string;estimatedMaxCostMicros:string;estimatedMaxCostDisplay:string;payer?:string};
export type TestingAiState={aiRequest:{preview:TestingPreview;binding:string}|null;aiCallIds:string[]};
