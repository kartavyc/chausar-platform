// Browser-safe seller metadata. Chausar original; sealeap/listing-doctor ideas (MIT).
export const SELLER_METADATA = {
  "registration": {
    "id": "online-seller",
    "label": "Online seller and seller services",
    "serviceType": "consulting",
    "picks": [
      "online seller",
      "seller services",
      "marketplace seller",
      "listing audit",
      "settlement audit",
      "amazon seller",
      "flipkart seller"
    ],
    "summary": "A back office for your shop, or export-based audits for other sellers, with every change approved by you.",
    "riskLevel": "high",
    "lastReviewed": "2026-10-27"
  },
  "offers": [
    {
      "id": "own-shop-back-office",
      "name": "Your own shop back office",
      "description": "Internal checks for your own shop. No customer invoice or client share link.",
      "pricing": "monthly",
      "unit": "a shop a month",
      "price": "owner-sets",
      "stages": [
        "financial-draft"
      ],
      "includes": [
        "Economics sheet",
        "Listing check",
        "Payout audit"
      ],
      "pilotable": false,
      "rights": [],
      "intake": [],
      "audience": "public"
    },
    {
      "id": "unit-economics-monthly",
      "name": "Monthly seller back office",
      "description": "Unit economics, listing checks and payout reconciliation from your exports.",
      "pricing": "monthly",
      "unit": "a shop a month",
      "price": "owner-sets",
      "stages": [
        "financial-draft"
      ],
      "includes": [
        "Economics sheet",
        "Listing check",
        "Payout audit"
      ],
      "pilotable": true,
      "rights": [],
      "intake": [
        "exports",
        "marketplace",
        "permission",
        "channels",
        "gstRegistered",
        "claimsInputCredit",
        "feeCards",
        "catalogueSheet",
        "thresholds"
      ],
      "audience": "client"
    },
    {
      "id": "listing-health-audit",
      "name": "Listing health audit",
      "description": "A coverage-first listing report and specific fixes for you to upload.",
      "pricing": "project",
      "unit": "per catalogue",
      "price": "owner-sets",
      "stages": [
        "listing-draft"
      ],
      "includes": [
        "Listing check"
      ],
      "pilotable": true,
      "rights": [],
      "intake": [
        "exports",
        "marketplace",
        "permission",
        "channels",
        "catalogueSheet"
      ],
      "audience": "client"
    },
    {
      "id": "reimbursement-audit",
      "name": "Fee and settlement audit",
      "description": "Payout differences and claim estimates for the seller to review and file.",
      "pricing": "project",
      "unit": "per audit",
      "price": "owner-sets",
      "stages": [
        "settlement-draft"
      ],
      "includes": [
        "Payout audit"
      ],
      "pilotable": true,
      "rights": [],
      "intake": [
        "exports",
        "marketplace",
        "permission",
        "channels",
        "settlementReports"
      ],
      "audience": "client"
    },
    {
      "id": "ads-health-check",
      "name": "Ads health check",
      "description": "Recomputed ads ratios with the sales basis shown.",
      "pricing": "project",
      "unit": "per audit",
      "price": "owner-sets",
      "stages": [
        "ads-draft"
      ],
      "includes": [
        "Ads check"
      ],
      "pilotable": true,
      "rights": [],
      "intake": [
        "exports",
        "marketplace",
        "permission",
        "channels",
        "adsSalesBasis"
      ],
      "audience": "client"
    }
  ],
  "intakeFields": [
    {
      "id": "channels",
      "label": "Selling channels",
      "help": "Name the marketplaces and shops covered by these exports.",
      "kind": "list",
      "required": true
    },
    {
      "id": "gstRegistered",
      "label": "GST registered",
      "help": "Say whether this seller is GST registered.",
      "kind": "yes-no",
      "required": true
    },
    {
      "id": "claimsInputCredit",
      "label": "Claims input credit",
      "help": "Say whether this seller claims eligible GST input credit.",
      "kind": "yes-no",
      "required": true
    },
    {
      "id": "adsSalesBasis",
      "label": "Ads sales basis",
      "help": "Choose the sales basis used by the ads export.",
      "kind": "choice",
      "required": true,
      "options": [
        "gst-inclusive",
        "taxable"
      ]
    },
    {
      "id": "feeCards",
      "label": "Fee cards",
      "help": "Add the dated marketplace fee cards when available.",
      "kind": "file",
      "required": false
    },
    {
      "id": "settlementReports",
      "label": "Settlement reports",
      "help": "Add the marketplace payout report when available.",
      "kind": "file",
      "required": false
    },
    {
      "id": "catalogueSheet",
      "label": "Catalogue sheet",
      "help": "Add the product catalogue when available.",
      "kind": "file",
      "required": false
    },
    {
      "id": "thresholds",
      "label": "Owner thresholds",
      "help": "Add your thresholds when used. No threshold is assumed for this audit.",
      "kind": "file",
      "required": false
    },
    {
      "id": "exports",
      "label": "Seller export",
      "help": "Add the product, ads or settlement file for this audit.",
      "kind": "file",
      "required": true
    },
    {
      "id": "marketplace",
      "label": "Marketplace",
      "help": "Choose the marketplace the export belongs to.",
      "kind": "choice",
      "required": true,
      "options": [
        "Amazon India",
        "Flipkart",
        "Meesho"
      ]
    },
    {
      "id": "permission",
      "label": "The seller agreed to this work",
      "help": "Record permission to use the seller exports.",
      "kind": "consent",
      "required": true
    }
  ]
} as const;
export const SELLER_TAX_DATA = {
  "tcsRule": {
    "id": "seller-tcs",
    "rateBps": "50",
    "source": "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2087659",
    "checkedOn": "2026-10-27",
    "confirmedBy": null
  },
  "tdsRule": {
    "id": "seller-tds",
    "rateBps": "10",
    "source": "https://www.incometaxindia.gov.in/w/section-194-o-5",
    "checkedOn": "2026-10-27",
    "confirmedBy": null
  }
} as const;
export const SELLER_INDIA_DATA = {
  "checkedOn": "2026-10-27",
  "confirmedBy": null
} as const;
