// Canonical browser-safe types, shared by the engine and renderer.


export type ZohoDraftMapping={customerId:string;placeOfSupply:string;gstTreatment:'business_gst'|'business_none'|'consumer';gstNo:string|null;taxSpecification:'intra'|'inter';lineMode:'aggregate-non-inventory';lines:{itemId:string;taxId:string;taxKind:'tax'|'tax_group'}[]};
