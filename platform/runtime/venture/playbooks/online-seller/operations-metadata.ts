// Browser-safe seller operations metadata, original Chausar code.
export const SELLER_AMAZON_OFFERS = [
 ['ungating','Amazon category access checklist'],['brand-registry','Amazon brand registry checklist'],['returns','Amazon returns checklist'],['storefront','Amazon storefront checklist'],['deals','Amazon deals checklist'],['compliance','Amazon compliance checklist'],
].map(([id,name])=>({id:'amazon-'+id,name:name!,description:'An owner-priced handoff checklist. You review and submit it yourself.',pricing:'project' as const,unit:'per pack',price:'owner-sets' as const,stages:['amazon-checklist-draft'],workflow:['amazon-checklist-draft','approve'],includes:['Seller checklist'],pilotable:false,rights:[],intake:['permission'],audience:'client' as const}));
export const SELLER_OPERATION_OFFERS = [
  {
    "id": "catalogue-upload",
    "name": "Catalogue upload pack",
    "description": "A dated marketplace sheet for the seller to check and upload.",
    "pricing": "project",
    "unit": "per pack",
    "price": "owner-sets",
    "stages": [
      "catalogue-draft"
    ],
    "workflow": ["catalogue-draft", "approve"],
    "includes": [
      "Catalogue upload pack"
    ],
    "pilotable": true,
    "rights": [],
    "intake": [
      "exports",
      "marketplace",
      "permission",
      "catalogueMapping",
      "mappingCheckedOn",
      "mappingSource"
    ],
    "audience": "client"
  },
  {
    "id": "product-research",
    "name": "Product research shortlist",
    "description": "Every candidate kept with evidence and deterministic risk checks.",
    "pricing": "project",
    "unit": "per pack",
    "price": "owner-sets",
    "stages": [
      "research-draft"
    ],
    "workflow": ["research-draft", "approve"],
    "includes": [
      "Product research shortlist"
    ],
    "pilotable": true,
    "rights": [],
    "intake": [
      "exports",
      "permission",
      "researchDate",
      "researchProfile",
      "trademarks"
    ],
    "audience": "client"
  },
  {
    "id": "multi-store-report",
    "name": "Multi-store comparison",
    "description": "Compare catalogue gaps, stock and prices with currencies kept separate.",
    "pricing": "project",
    "unit": "per pack",
    "price": "owner-sets",
    "stages": [
      "multi-store-draft"
    ],
    "workflow": ["multi-store-draft", "approve"],
    "includes": [
      "Multi-store comparison"
    ],
    "pilotable": true,
    "rights": [],
    "intake": [
      "exports",
      "permission",
      "stores"
    ],
    "audience": "client"
  },
  {
    "id": "product-photos",
    "name": "Product photo pack",
    "description": "Source-bound photo briefs and imported outputs from your own image app.",
    "pricing": "project",
    "unit": "per pack",
    "price": "owner-sets",
    "stages": [
      "photo-draft"
    ],
    "workflow": ["photo-draft", "approve"],
    "includes": [
      "Product photo pack"
    ],
    "pilotable": true,
    "rights": [
      "own-footage",
      "licence"
    ],
    "intake": [
      "permission",
      "mainImage",
      "brandText"
    ],
    "audience": "public"
  },
  {
    "id": "case-tracker",
    "name": "Seller case tracker",
    "description": "Evidence, deadlines and follow-up drafts for cases you submit yourself.",
    "pricing": "project",
    "unit": "per pack",
    "price": "owner-sets",
    "stages": [
      "case-draft"
    ],
    "workflow": ["case-draft", "approve"],
    "includes": [
      "Seller case tracker"
    ],
    "pilotable": true,
    "rights": [],
    "intake": [
      "permission"
    ],
    "audience": "client"
  }
] as const;
export const SELLER_OPERATION_INTAKE = [
  {
    "id": "catalogueMapping",
    "label": "Marketplace column map",
    "help": "Add the current header and field mapping as a CSV file.",
    "kind": "file",
    "required": true
  },
  {
    "id": "mappingCheckedOn",
    "label": "Mapping checked on",
    "help": "Give the day you checked the current marketplace template.",
    "kind": "date",
    "required": true
  },
  {
    "id": "mappingSource",
    "label": "Mapping source",
    "help": "Name the official template or owner confirmation behind this mapping.",
    "kind": "text",
    "required": true
  },
  {
    "id": "researchDate",
    "label": "Research date",
    "help": "Choose the date whose month the seasonal checks should use.",
    "kind": "date",
    "required": true
  },
  {
    "id": "researchProfile",
    "label": "Seller experience",
    "help": "Choose the experience profile for this research.",
    "kind": "choice",
    "required": true,
    "options": [
      "beginner",
      "grower",
      "pro",
      "factory",
      "brand"
    ]
  },
  {
    "id": "trademarks",
    "label": "Protected names to check",
    "help": "List known protected names. Unknown rights remain a question.",
    "kind": "list",
    "required": false
  },
  {
    "id": "stores",
    "label": "Stores in this report",
    "help": "Name every store to compare, including stores absent from the export.",
    "kind": "list",
    "required": true
  },
  {
    "id": "mainImage",
    "label": "Real main product photo",
    "help": "Add the real product photo that every later image must reference.",
    "kind": "file",
    "required": true
  },
  {
    "id": "brandText",
    "label": "Exact brand text",
    "help": "Record the approved product and brand wording.",
    "kind": "text",
    "required": true
  }
] as const;
export const SELLER_OPERATION_STEPS = [
  {
    "id": "catalogue-draft",
    "title": "Draft the catalogue handoff",
    "kind": "write",
    "role": "analyst",
    "produces": "Catalogue upload pack",
    "tier": "actor",
    "model": "main",
    "doneBy": "agent",
    "requiredSections": [
      "Data coverage",
      "Findings",
      "Specific fixes",
      "Open questions"
    ],
    "checks": [],
    "tools": [],
    "guidance": [
      "Use the code prerequisite and owner records. Never claim a marketplace write or a generated image. Missing evidence stays a question."
    ]
  },
  {
    "id": "research-draft",
    "title": "Draft the research shortlist",
    "kind": "write",
    "role": "analyst",
    "produces": "Product research shortlist",
    "tier": "actor",
    "model": "main",
    "doneBy": "agent",
    "requiredSections": [
      "Data coverage",
      "Findings",
      "Specific fixes",
      "Open questions"
    ],
    "checks": [],
    "tools": [],
    "guidance": [
      "Use the code prerequisite and owner records. Never claim a marketplace write or a generated image. Missing evidence stays a question."
    ]
  },
  {
    "id": "multi-store-draft",
    "title": "Draft the store comparison",
    "kind": "write",
    "role": "analyst",
    "produces": "Multi-store comparison",
    "tier": "actor",
    "model": "main",
    "doneBy": "agent",
    "requiredSections": [
      "Data coverage",
      "Findings",
      "Specific fixes",
      "Open questions"
    ],
    "checks": [],
    "tools": [],
    "guidance": [
      "Use the code prerequisite and owner records. Never claim a marketplace write or a generated image. Missing evidence stays a question."
    ]
  },
  {
    "id": "photo-draft",
    "title": "Draft the photo handoff",
    "kind": "write",
    "role": "photo-producer",
    "produces": "Product photo pack",
    "tier": "actor",
    "model": "main",
    "doneBy": "agent",
    "requiredSections": [
      "Data coverage",
      "Findings",
      "Specific fixes",
      "Open questions"
    ],
    "checks": [],
    "tools": [],
    "guidance": [
      "Use the code prerequisite and owner records. Never claim a marketplace write or a generated image. Missing evidence stays a question."
    ]
  },
  {
    "id": "case-draft",
    "title": "Draft the case follow-up",
    "kind": "write",
    "role": "analyst",
    "produces": "Seller case tracker",
    "tier": "actor",
    "model": "main",
    "doneBy": "agent",
    "requiredSections": [
      "Data coverage",
      "Findings",
      "Specific fixes",
      "Open questions"
    ],
    "checks": [],
    "tools": [],
    "guidance": [
      "Use the code prerequisite and owner records. Never claim a marketplace write or a generated image. Missing evidence stays a question."
    ]
  }
] as const;
export const SELLER_OPERATION_JUDGES = [
  {
    "id": "move-has-cap",
    "question": "Does each proposed change respect the owner cap?",
    "text": "Keep changes inside the current cap and show exact owner approval.",
    "floor": {
      "kind": "required-yes"
    }
  },
  {
    "id": "photo-is-the-product",
    "question": "Does each image keep the real product reference?",
    "text": "Keep the real product reference, consistent style and no fake interface.",
    "floor": {
      "kind": "required-yes"
    }
  }
] as const;
export const SELLER_OPERATION_CONNECTORS = [
  {
    "id": "seller-research",
    "name": "Sorftime research",
    "label": "planned: read",
    "note": "Paid research needs your provider key and an approved quote.",
    "manualPath": "Use your own Sorftime account after reviewing its quote, then upload the export.",
    "waitsOn": "A verified Sorftime adapter and provider access."
  },
  {
    "id": "seller-photo-app",
    "name": "Your image app",
    "label": "handoff",
    "note": "Approve the quote, use the real main photo, then import each output with its licence."
  }
] as const;
