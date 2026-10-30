// Browser-safe type declarations. No authority, network, filesystem or host implementation is imported.
export type FormsOpen={runId:string;origin:string;url:string;savedSignInId:string|null};
export type FormsBrowserPort={
 open(input:FormsOpen,guard:()=>void,signal:AbortSignal):Promise<unknown>;
 navigate(runId:string,input:{url:string}):Promise<unknown>;
 capture(runId:string):Promise<unknown>;
 fill(runId:string,input:unknown):Promise<unknown>;
 prepare(runId:string,input:unknown):Promise<unknown>;
 submit(runId:string,input:{handle:string;digest:string},beforeSend:()=>void):Promise<unknown>;
 readSaved(runId:string):Promise<unknown>;
 close(runId?:string):Promise<void>;
 eraseSignIns(ids:string[]):Promise<void>;
};

import type {FormTarget} from './types.ts';
export type FormCapture={pageHash:string;url:string;title:string;complete:true;pages:{index:number;pageHash:string;text:string}[];targets:FormTarget[];screenshot:{mime:string;base64:string}|null;responseEvidence:unknown};
export type SavedCapture={digest:string;responseEvidence:{requestId:number|string;url:string;statusCode:number};targets:{id:string;fingerprint:string;name:string;kind:string;value:string}[]};
