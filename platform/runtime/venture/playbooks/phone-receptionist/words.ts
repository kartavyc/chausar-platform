// Original bilingual receptionist copy. Hindi is machine drafted for native review.
export const PHONE_HI:Record<string,string>={_review:'machine-drafted, needs a native reviewer',_note:'HINDI_REVIEW: machine drafted; needs a native reviewer.'};
export function phoneWords(en:string,hi:string){PHONE_HI[en]=hi;return en;}
