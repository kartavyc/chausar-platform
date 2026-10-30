// Original shared routine presets. These inputs use the existing exact standing approval flow.
import {check} from '../../../portable.ts';
export type VaRoutineInput={name:string;agent:null;prompt:string;recordReport:'va-morning'|'va-weekly';schedule:{kind:'calendar';weekdays:number[];time:string;timeZone:string};on:boolean};
export type VaReportKind='morning'|'weekly';
export const VA_REPORT_PROMPTS={morning:'Read the saved mail, monitor status and Today records. Quote each line with its source. Keep this report private.',weekly:'Read this week saved mail, monitor status and Today records. Quote each line with its source. Keep this report private.'};
export function vaRoutinePreset(kind:VaReportKind,timeZone:string):VaRoutineInput{
 check(kind==='morning'||kind==='weekly','INVALID_VENTURE_REQUEST','Choose a morning brief or weekly report.');
 return {name:kind==='morning'?'Morning brief':'Weekly report',agent:null,prompt:VA_REPORT_PROMPTS[kind],recordReport:kind==='morning'?'va-morning':'va-weekly',schedule:{kind:'calendar',weekdays:kind==='morning'?[1,2,3,4,5,6,7]:[5],time:kind==='morning'?'09:00':'17:00',timeZone},on:false};
}
