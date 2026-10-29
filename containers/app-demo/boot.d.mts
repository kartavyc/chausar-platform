export const DEMO_SESSION_SECONDS:3600;
export function demoEnvironment():{PATH:string;DISPLAY:string;HOME:string;LANG:string;XDG_RUNTIME_DIR:string};
export function demoRuntimePlan():string[][];
export function boot():Promise<{stop():void}>;
