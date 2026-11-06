// Canonical browser-safe types, shared by the engine and renderer.


export type DocumentEntryInput=({kind:'bank-statement';account:string;pages:BankEntryPage[]}|{kind:'purchase-bill'|'sales-invoice';number:string;date:string;party:string;netMinor:string;taxMinor:string;totalMinor:string})&{source:string};

export type BankEntryPage={page:number;openingMinor:string;closingMinor:string;lines:BankEntryLine[]};

export type BankEntryLine={id:string;date:string;description:string;creditMinor:string;debitMinor:string};

export type DocumentEntryWorking={kind:DocumentEntryInput['kind'];account:string|null;vouchers:VoucherDraft[];pages:{page:number;openingMinor:string;creditsMinor:string;debitsMinor:string;closingMinor:string;ties:true}[]};

export type VoucherDraft={id:string;source:string;date:string;description:string;direction:'in'|'out';amountMinor:string;state:'draft';ownerApprovalRequired:true};
