// HINDI_REVIEW: machine-drafted handoff instructions need native review.
// Original review package for manual client-system setup. This is not a provider import format or a write receipt.
import {setupDraft} from './setup.ts';
import {financeAmounts} from './finance-receipt-core.ts';
export function setupHandoff(saved:ReturnType<typeof setupDraft>,receiptId:string,sourceDigest:string){
 const {cycle,customers,vendors,categories,opening}=saved;const checked=setupDraft({cycle,customers,vendors,categories,opening});
 const amounts=financeAmounts(checked.opening);
 const pack={format:'chausar-finance-review-v1',systemOfRecord:'client',posted:false,cycle:checked.cycle,receiptId,sourceDigest,customers:checked.customers,vendors:checked.vendors,categories:checked.categories,opening:checked.opening.map((row,index)=>({...row,...amounts[index]})),instructions:{en:'Review the account classifications with the bookkeeper. Enter or map these records in the selected client accounting system, then compare its opening balances with this receipt. This review file is not a provider import template. No client record or balance has been created by this export.',hi:'खातों का वर्गीकरण बहीखाता रखने वाले से जांचें। चुनी हुई क्लाइंट लेखा प्रणाली में ये रिकॉर्ड दर्ज करें या मिलाएं, फिर शुरुआती शेष का इस रसीद से मिलान करें। यह समीक्षा फाइल प्रदाता का आयात टेम्पलेट नहीं है। इस निर्यात ने कोई क्लाइंट रिकॉर्ड या शेष नहीं बनाया है।'}};
 return {name:cycle.id+'-setup-review.json',folder:cycle.folder,mediaType:'application/json',content:JSON.stringify(pack,null,2)+'\n',posted:false as const};
}
