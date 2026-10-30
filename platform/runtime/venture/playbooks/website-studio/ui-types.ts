// Browser-safe website CI evidence types. Original Chausar contract.
export type SiteUiEvidence={state:'not-found';reason:string}|{state:'found';headSha:string;runId:number;artifactId:number;url:string;pass:boolean;line:string;findings:unknown[];receipt:string;source:string};
