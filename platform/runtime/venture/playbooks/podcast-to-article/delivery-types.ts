// Browser-safe structural projections. These deliberately do not import the engine's server graph.
import type {ArticleLedgerBody} from './records.ts';
export type ArticleDelivery={title:string;sections:readonly {heading:string;parts:readonly {kind:string;text?:string}[]}[];questionsForClient:readonly string[];attachments?:readonly unknown[];estimate?:unknown;quoteFixes?:readonly unknown[]};
export type ArticleOutput={title:string;sections:{heading:string;parts:{kind:'text';text:string}[]}[];questionsForClient:string[]};
export type ArticleToolCall={tool:string;envelope:{ok:boolean;result?:unknown}};
export type ArticleCheckInput={stageId?:string;articleRecord?:ArticleLedgerBody|null;deliverable:ArticleDelivery;toolCalls?:readonly ArticleToolCall[]};
export type ArticleCheckResult={playbook:string;check:string;outcome:'pass'|'fail';detail:string};
