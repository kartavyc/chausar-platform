// Original Chausar browser-safe structural inputs for the shared W4 calendar arithmetic.
export type IsoDate=string;export type IsoTime=string;export type DateOrder='day-month-year'|'month-day-year'|'year-month-day';
export type PipelineStage='found'|'asked'|'talking'|'proposal'|'won'|'lost'|'not-now';
export type OutreachKind='intro-request'|'double-opt-in'|'connection-note'|'follow-up'|'reply'|'cold-email'|'reminder';
export type OutreachChannel='email'|'linkedin'|'whatsapp';export type OutreachSentChannel='own-mailbox'|'linkedin'|'whatsapp'|'phone';
export type FollowupSequence={kind:'intro-request'|'first-email'|'message';steps:{afterDays:number;channel:OutreachChannel|null}[];weekdays:number[];sendTime:string;copiedAt:IsoTime};
export type CardTouch={what:'sent'|'reply';on:IsoDate;at:IsoTime;kind:'first'|'nudge'|null;channel:OutreachSentChannel|null;ref:string|null;by:string};
export type PipelineSettingsRecord={weekdays:number[];sendTime:string;caps:{newPerDay:number;perWeek:number;channels?:Partial<Record<'linkedin-note'|'linkedin-message'|'whatsapp'|'email',number>>};scoreRules:{field:string;operator:'is'|'contains'|'at-least'|'at-most';value:string;points:number}[]};
