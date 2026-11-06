// Official-schema synthetic setup service, never live provider evidence.
import type {PinnedSender} from '../../../runtime/venture/core/net-guard.ts';
export function setupProvider(){
 const contacts:any[]=[],accounts:any[]=[],writes:string[]=[];let opening:any={accounts:[],total:0};
 const send:PinnedSender=async target=>{const path=target.url.pathname.slice('/books/v3/'.length);let result:any;
 if(target.method==='POST'){const body=JSON.parse(String(target.body));writes.push(path);if(path==='contacts'){contacts.push({...body,contact_id:String(100+contacts.length),currency_code:'INR',status:'active',gst_no:body.gst_no??'',opening_balances:[]});}else if(path==='chartofaccounts'){accounts.push({...body,account_id:String(200+accounts.length),currency_code:'INR',is_active:true});}else if(path==='settings/openingbalances'){opening={opening_balance_id:'900',date:body.date,location_id:'',accounts:body.accounts.map((row:any)=>({...row,currency_code:'INR',bcy_amount:row.amount})),total:0};}else throw Error(path);result={};
 }else if(path==='organizations/12345')result={organization:{organization_id:'12345',currency_id:'66',currency_code:'INR',price_precision:2,is_org_active:true,address:{country:'India'}}};
 else if(path==='contacts')result={contacts,page_context:{has_more_page:false}};else if(path.startsWith('contacts/'))result={contact:contacts.find(row=>row.contact_id===path.split('/')[1])};
 else if(path==='chartofaccounts')result={chartofaccounts:accounts,page_context:{has_more_page:false}};else if(path.startsWith('chartofaccounts/'))result=accounts.find(row=>row.account_id===path.split('/')[1]);
 else if(path==='settings/openingbalances')result={opening_balance:opening};else throw Error(path);
 return {status:target.method==='POST'?201:200,headers:{},body:Buffer.from(JSON.stringify({code:0,...result}))};};
 return {send,writes,contacts,accounts,resolve:async()=>[{address:'93.184.216.34',family:4 as const}]};
}
