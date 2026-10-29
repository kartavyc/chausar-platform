import type {phoneView} from '../../../../../../platform/runtime/venture/playbooks/phone-receptionist/view';
export type PhoneView=ReturnType<typeof phoneView>;
export type PhoneAct=(id:string,action:string,payload:Record<string,unknown>,digest?:string)=>Promise<{id:string;result:unknown}|null>;
export type PhoneProps={item:PhoneView;digest:string;busy:boolean;act:PhoneAct};
