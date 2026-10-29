// Chausar playbook: Virtual assistant service (Ink v2 wave 5, packages 5R1). The bodies of its own records, as
// contracts.ts types each one (RecordBase<kind> & Body). Package 5-0 named each as a placeholder; the package replaces
// it with the record's fields here, never in contracts.ts. Types only. Written for Chausar; nothing here is learned
// from an outside source.

/** venture-room-brief: a placeholder until package 5R1 lands. */
export type RoomRequest={id:string;text:string;via:'owner-recorded'|'client-page';at:string};
export type RoomBriefBody={orderId:string;clientId:string;playbook:string;requests:RoomRequest[];brief:import('../kit/client-room-core.ts').RoomBrief|null};
