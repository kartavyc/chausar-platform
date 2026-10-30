// Shared demo rights boundary for source desks and service runs.
import {EngineError,type OrderLite} from './types';
function check(value:unknown,code:string,message:string):asserts value{if(!value)throw new EngineError(code,message);}
export function fakeYoutubeRights(host:{ask(method:string,p:Record<string,unknown>):unknown;now():string},id:unknown){
    const order = (host.ask('venture.order.list', {}) as OrderLite[]).find(order => order.id === id && order.status !== 'cancelled');
    check(order, 'ORDER_NOT_FOUND', 'Choose an open order in this business.');
    const rights = (order.intake as { rights?: { basis: string; holder: string; reference?: string | null; expiresOn?: string | null } } | undefined)?.rights;
    check(rights, 'RIGHTS_REQUIRED', 'Record the rights to the footage at intake before clipping.');
    check(['own-footage', 'licence', 'creator-clip-programme'].includes(rights.basis), 'RIGHTS_REQUIRED', 'Choose own footage, a licence, or a creator clip programme.');
    check(typeof rights.holder === 'string' && rights.holder.trim().length > 0 && rights.holder.trim().length <= 160 && !/[\r\n\t\u0000-\u001f\u007f]/.test(rights.holder.trim()), 'RIGHTS_REQUIRED', 'Say who owns the footage.');
    check(rights.basis === 'own-footage' || (typeof rights.reference === 'string' && rights.reference.trim().length > 0 && rights.reference.trim().length <= 300 && !/[\r\n\t\u0000-\u001f\u007f]/.test(rights.reference.trim())), 'RIGHTS_REQUIRED', 'Add the licence or clip programme reference.');
    check(rights.expiresOn === undefined || rights.expiresOn === null || (typeof rights.expiresOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rights.expiresOn) && new Date(`${rights.expiresOn}T00:00:00Z`).toISOString().slice(0, 10) === rights.expiresOn), 'RIGHTS_REQUIRED', 'Give the end date like 2026-12-31, or leave it empty.');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(host.now()));
    check(!rights.expiresOn || rights.expiresOn >= today, 'RIGHTS_REQUIRED', `The rights to this footage ended on ${rights.expiresOn}.`);
}
