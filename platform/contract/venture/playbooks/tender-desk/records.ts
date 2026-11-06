// Canonical browser-safe types, shared by the engine and renderer.
import type { TenderQuestion } from '../../../../shared/venture/playbooks/tender-desk/questions.ts';
import type { TenderTone } from '../../../../shared/venture/playbooks/tender-desk/questions.ts';

export type TenderSourceSelection={rfpFileId:string|null;documentFileIds:string[];issuerFileId:string|null;mapping:{sheet:string;questionColumn:string;answerColumn:string;firstRow:number;lastRow:number}|null};

export type TenderQuestionBody={orderId:string;clientId:string;sourceDigest:string;selection:TenderSourceSelection;question:TenderQuestion;controls:{lengthWords:number;tone:TenderTone};approval:string|null;aiRequest:{preview:TenderPreview;binding:string}|null;aiCallIds:string[]};

export type TenderPreview={clientAi?:import('../../../../shared/venture/clients/ai-consent-core.ts').ClientAiContextBinding;callId:string;payloadText:string;digest:string;presetId:string;model:string|null;endpoint:string;estimatedMaxCostMicros:string;estimatedMaxCostDisplay:string;payer?:string};
